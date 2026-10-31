import { Component, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { fmtKr, fmtNum, fmtScore, petClass, scoreColor } from '../format';
import { Listing } from '../models';
import { ApiService, apiError } from '../services/api.service';
import { TagsStore } from '../services/tags.store';

type Picker = { mode: 'like' | 'dislike'; tags: Set<string>; note: string } | null;

/**
 * Fast triage table. Keys: j/k move · Enter open · s shortlist · r reject (tag picker) · l like (tag picker)
 * · a archive · / search. Changes are posted immediately.
 */
@Component({
  selector: 'fh-candidates',
  imports: [FormsModule, RouterLink],
  template: `
  <div class="fh-page-head">
    <h1>Candidates</h1>
    <select class="form-select form-select-sm w-auto" [(ngModel)]="status" (ngModelChange)="load()">
      <option value="">all statuses</option>
      @for (s of tags.statuses(); track s) { <option [value]="s">{{ s }}</option> }
    </select>
    <input #search class="form-control form-control-sm w-auto" placeholder="search (/)" [(ngModel)]="q" (keyup.enter)="load()" />
    <label class="form-check-label small"><input type="checkbox" class="form-check-input me-1" [(ngModel)]="hideRejected" (ngModelChange)="load()" />hide rejected</label>
    <button class="btn btn-sm btn-outline-primary" (click)="recompute()">Recompute scores</button>
    <span class="small text-body-secondary ms-auto">
      <span class="fh-kbd">j</span>/<span class="fh-kbd">k</span> move · <span class="fh-kbd">⏎</span> open ·
      <span class="fh-kbd">s</span> shortlist · <span class="fh-kbd">l</span> like · <span class="fh-kbd">r</span> reject · <span class="fh-kbd">a</span> archive
    </span>
  </div>
  @if (message()) { <div class="alert alert-info py-1 small">{{ message() }}</div> }
  @if (error()) { <div class="alert alert-danger py-1 small" style="white-space:pre-wrap">{{ error() }}</div> }

  @if (picker(); as p) {
    <div class="card mb-2"><div class="card-body py-2">
      <div class="small mb-1">{{ p.mode === 'like' ? 'Why do you like' : 'Why reject' }} {{ selected()?.short_id }}? (Enter to save, Esc to cancel)</div>
      @for (t of (p.mode === 'like' ? tags.positive() : tags.negative()); track t.key) {
        <button class="btn btn-sm me-1 mb-1" [class.btn-primary]="p.tags.has(t.key)" [class.btn-outline-secondary]="!p.tags.has(t.key)"
                (click)="toggleTag(t.key)">{{ t.label }}</button>
      }
      <input class="form-control form-control-sm mt-1" placeholder="note (optional)" [(ngModel)]="p.note" (keyup.enter)="savePicker()" />
    </div></div>
  }

  @if (!rows().length && !loading()) {
    <div class="fh-empty">No listings yet. Ingest the sample with
      <code>scripts/findhome ingest listings -f backend/tests/fixtures/listings_sample.json</code>, or run a scan from Sites.</div>
  } @else {
    <div class="table-responsive">
    <table class="table table-sm table-hover align-middle">
      <thead><tr><th>Id</th><th>Score</th><th>Status</th><th>Area / address</th><th>Rooms</th><th>m²</th><th>Rent</th><th>Pets</th><th>Contract</th></tr></thead>
      <tbody>
        @for (r of rows(); track r.short_id; let i = $index) {
          <tr [style.background]="i === cursor() ? 'var(--fh-sel)' : null" (click)="cursor.set(i)" (dblclick)="open(r)">
            <td class="fh-mono"><a [routerLink]="['/candidates', r.short_id]">{{ r.short_id }}</a></td>
            <td>
              @if (r.rejected_by?.length) { <span class="badge text-bg-danger" [title]="r.rejected_by!.join(', ')">rejected</span> }
              @else { <strong [style.color]="color(r.score)">{{ score(r.score) }}</strong> }
              @if (r.score_stale) { <span class="text-body-secondary small" title="no score for the current config"> ·stale</span> }
            </td>
            <td>{{ r.status }}</td>
            <td>{{ r.area }} <span class="text-body-secondary small">{{ r.address_raw }}</span></td>
            <td>{{ num(r.rooms_rok) }}{{ r.has_sovalkov ? '+alkov' : '' }}</td>
            <td>{{ num(r.size_m2) }}</td>
            <td>{{ kr(r.rent_sek) }}</td>
            <td><span class="badge" [class]="pet(r.pet_status)">{{ r.pet_status }}</span></td>
            <td class="small">{{ r.contract_type ?? '' }}{{ r.contract_end ? ' → ' + r.contract_end : '' }}</td>
          </tr>
        }
      </tbody>
    </table>
    </div>
  }
  `,
})
export class CandidatesPage implements OnInit {
  private api = inject(ApiService);
  private router = inject(Router);
  protected tags = inject(TagsStore);
  protected rows = signal<Listing[]>([]);
  protected cursor = signal(0);
  protected loading = signal(false);
  protected error = signal('');
  protected message = signal('');
  protected picker = signal<Picker>(null);
  protected selected = computed(() => this.rows()[this.cursor()]);
  protected status = '';
  protected q = '';
  protected hideRejected = false;
  protected kr = fmtKr; protected num = fmtNum; protected score = fmtScore; protected pet = petClass; protected color = scoreColor;

  ngOnInit(): void { this.load(); }

  load(): void {
    this.loading.set(true);
    this.api.listings({ status: this.status || undefined, q: this.q || undefined, includeRejected: !this.hideRejected }).subscribe({
      next: (res) => { this.rows.set(res.items); this.cursor.set(0); this.loading.set(false); this.error.set(''); },
      error: (e) => { this.error.set(apiError(e)); this.loading.set(false); },
    });
  }

  recompute(): void {
    this.api.recompute().subscribe({
      next: (r) => { this.message.set(`Scored ${r.scored} (${r.rejected} rejected by hard filters)`); this.load(); },
      error: (e) => this.error.set(apiError(e)),
    });
  }

  open(r: Listing): void { this.router.navigate(['/candidates', r.short_id]); }

  toggleTag(key: string): void {
    const p = this.picker();
    if (!p) return;
    p.tags.has(key) ? p.tags.delete(key) : p.tags.add(key);
    this.picker.set({ ...p, tags: new Set(p.tags) });
  }

  savePicker(): void {
    const p = this.picker(); const r = this.selected();
    if (!p || !r) return;
    const tags = [...p.tags];
    this.api.feedback(r.short_id, p.mode, tags, p.note || undefined).subscribe({
      next: () => {
        if (p.mode === 'dislike') this.setStatus(r, 'rejected');
        else this.message.set(`${r.short_id}: liked ${tags.join(', ')}`);
        this.picker.set(null);
      },
      error: (e) => this.error.set(apiError(e)),
    });
  }

  private setStatus(r: Listing, status: string): void {
    const prev = r.status;
    this.rows.update((rows) => rows.map((x) => (x.short_id === r.short_id ? { ...x, status } : x)));
    this.api.setStatus(r.short_id, status).subscribe({
      next: () => this.message.set(`${r.short_id}: ${prev} → ${status}`),
      error: (e) => { this.error.set(apiError(e)); this.load(); },
    });
  }

  @HostListener('document:keydown', ['$event'])
  onKey(ev: KeyboardEvent): void {
    const target = ev.target as HTMLElement;
    if (this.picker()) {
      if (ev.key === 'Escape') this.picker.set(null);
      else if (ev.key === 'Enter' && target.tagName !== 'INPUT') this.savePicker();
      return;
    }
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;
    const r = this.selected();
    switch (ev.key) {
      case 'j': this.cursor.update((c) => Math.min(c + 1, this.rows().length - 1)); break;
      case 'k': this.cursor.update((c) => Math.max(c - 1, 0)); break;
      case 'Enter': if (r) this.open(r); break;
      case 's': if (r) this.setStatus(r, 'shortlisted'); break;
      case 'a': if (r) this.setStatus(r, 'archived'); break;
      case 'l': if (r) this.picker.set({ mode: 'like', tags: new Set(), note: '' }); break;
      case 'r': if (r) this.picker.set({ mode: 'dislike', tags: new Set(), note: '' }); break;
      case '/': (document.querySelector('input[placeholder^="search"]') as HTMLInputElement | null)?.focus(); ev.preventDefault(); break;
      default: return;
    }
  }
}
