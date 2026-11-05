import { Component, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { fmtKr, fmtNum, fmtScore, petClass, scoreColor } from '../format';
import { ScoreTip } from '../components/score-tip';
import { ZoneMinimap } from '../components/zone-minimap';
import { ValueScaleStore, valueOf } from '../value-scale';
import { indexColour } from '../house/house-bubbles';
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
  imports: [FormsModule, RouterLink, ScoreTip, ZoneMinimap, DecimalPipe, DatePipe],
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
      <thead><tr><th>Id</th><th>Score</th>
        <th class="text-center" title="The home's transport score, 0-100, from its exact address: walks to rail and bus, lines and departures nearby">Transport</th>
        <th class="text-center" title="The home's services score, 0-100, from its exact address: walks to groceries, pharmacy, gym, park, vet and how many are near">Services</th>
        <th>Status</th><th>Area / address</th><th>Rooms</th><th>m²</th><th>Rent</th><th>kr/m²</th><th>Pets</th><th>Contract</th></tr></thead>
      <tbody>
        @for (r of rows(); track r.short_id; let i = $index) {
          <tr [style.background]="i === cursor() ? 'var(--fh-sel)' : null" (click)="cursor.set(i)" (dblclick)="open(r)"
            (mouseenter)="hoverIn(r, $event)" (mouseleave)="hoverOut()">
            <td class="fh-mono"><a [routerLink]="['/candidates', r.short_id]">{{ r.short_id }}</a></td>
            <td>
              <fh-score-tip [total]="r.score" [breakdown]="r.breakdown" [rejected]="r.rejected_by" />
              @if (r.score_stale) { <span class="text-body-secondary small" title="no score for the current config"> ·stale</span> }
            </td>
            <td class="fh-idx" [style.color]="idx(r.house_transport)" [title]="houseTitle(r, 'transport')">{{ int(r.house_transport) }}@if (r.house_estimated) { <i class="fh-est-dot inline"></i> }</td>
            <td class="fh-idx" [style.color]="idx(r.house_services)" [title]="houseTitle(r, 'services')">{{ int(r.house_services) }}</td>
            <td>{{ r.status }}</td>
            <td>{{ r.area }} <span class="text-body-secondary small">{{ r.address_raw }}</span></td>
            @let ro = values.rate(r, 'rooms_rok'); @let rs = values.rate(r, 'size_m2');
            @let rr = values.rate(r, 'rent_sek'); @let rm = values.rate(r, 'rent_per_m2');
            <td [style.color]="ro?.colour" [title]="ro?.title ?? ''">{{ num(r.rooms_rok) }}{{ r.has_sovalkov ? '+alkov' : '' }}</td>
            <td [style.color]="rs?.colour" [title]="rs?.title ?? ''">{{ num(r.size_m2) }}</td>
            <td [style.color]="rr?.colour" [title]="rr?.title ?? ''">{{ kr(r.rent_sek) }}</td>
            <td [style.color]="rm?.colour" [title]="rm?.title ?? ''" class="small">{{ perM2(r) == null ? '' : (perM2(r)! | number: '1.0-0') }}</td>
            <td><span class="badge" [class]="pet(r.pet_status)">{{ r.pet_status }}</span></td>
            <td class="small">{{ r.contract_type ?? '' }}{{ r.contract_end ? ' → ' + r.contract_end : '' }}</td>
          </tr>
        }
      </tbody>
    </table>
    </div>
    @if (values.scale(); as sc) {
      <div class="small text-body-secondary">Rooms, m², rent and kr/m² are coloured against the {{ sc.n }} listings still in the running
        (scored, not rejected) and your targets in config/profile.yaml: green good, amber middling, red poor or past your limit. Hover a value for why.</div>
    }
  }
  <!-- one hover card, reused: its minimap stays alive between rows -->
  <div class="fh-ltip" [class.off]="!tip()" [style.top.px]="tip()?.top ?? -1000" [style.left.px]="tip()?.left ?? -1000">
    @let t = tip()?.row;
    <fh-zone-minimap [lat]="t?.lat" [lon]="t?.lon" [zoneId]="t?.zone_id" [zoneName]="t?.zone_name" [height]="170" />
    @if (t) {
      <div class="fh-ltip-head"><span class="fh-mono">{{ t.short_id }}</span><b>{{ t.title || t.address_raw }}</b>
        @if (t.rejected_by?.length) { <span class="badge text-bg-danger">rejected</span> }
        @else { <strong [style.color]="color(t.score)">{{ score(t.score) }}</strong> }</div>
      @if (t.photo_urls.length) { <img class="fh-ltip-photo" [src]="t.photo_urls[0]" alt="" /> }
      <div class="fh-ltip-grid">
        <span>Where</span><span>{{ t.area }}{{ t.zone_name && t.zone_name !== t.area ? ' · zone ' + t.zone_name : '' }}{{ t.zone_id ? '' : ' · outside the zones' }}</span>
        <span>Rent</span><span><b [style.color]="values.rate(t, 'rent_sek')?.colour">{{ kr(t.rent_sek) }}</b>
          @if (perM2(t) != null) { <span [style.color]="values.rate(t, 'rent_per_m2')?.colour"> · {{ perM2(t)! | number: '1.0-0' }} kr/m²</span> }</span>
        <span>Size</span><span><span [style.color]="values.rate(t, 'rooms_rok')?.colour">{{ num(t.rooms_rok) }} rok{{ t.has_sovalkov ? ' + alkov' : '' }}</span> ·
          <span [style.color]="values.rate(t, 'size_m2')?.colour">{{ num(t.size_m2, ' m²') }}</span></span>
        @if (t.house_transport != null) {
          <span>From the address</span><span>transport <b [style.color]="idx(t.house_transport)">{{ int(t.house_transport) }}</b>@if (t.house_estimated) { <i class="fh-est-dot inline"></i> <span class="fh-badge-est">estimate</span> } ·
            services <b [style.color]="idx(t.house_services)">{{ int(t.house_services) }}</b></span>
        }
        <span>Building</span><span>floor {{ t.floor ?? '?' }}{{ t.has_elevator ? ', lift' : '' }}{{ t.has_balcony ? ', balcony' : '' }}{{ t.build_year ? ' · built ' + t.build_year : '' }}</span>
        <span>Pets</span><span><span class="badge" [class]="pet(t.pet_status)">{{ t.pet_status }}</span></span>
        <span>Contract</span><span>{{ t.contract_type ?? '?' }}{{ t.contract_end ? ' → ' + t.contract_end : '' }}{{ t.available_from ? ' · from ' + t.available_from : '' }}</span>
        <span>Status</span><span>{{ t.status }} · seen {{ t.first_seen_at | date: 'mediumDate' }}</span>
        @if (t.rejected_by?.length) { <span>Rejected by</span><span class="text-danger">{{ t.rejected_by!.join(', ') }}</span> }
        @else if (topGroups(t).length) { <span>Best for</span><span>{{ topGroups(t).join(' · ') }}</span> }
      </div>
    }
  </div>
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
  protected values = inject(ValueScaleStore);
  /** The row under the mouse and where its hover card goes (shown after a short pause). */
  protected tip = signal<{ row: Listing; top: number; left: number } | null>(null);
  private tipTimer: ReturnType<typeof setTimeout> | null = null;
  protected perM2 = (l: Listing) => valueOf(l, 'rent_per_m2');
  protected idx = indexColour;
  protected int = (v: number | null | undefined) => (v == null ? '' : Math.round(v));
  protected houseTitle(l: Listing, k: 'transport' | 'services'): string {
    if (k === 'transport' && l.house_transport != null) return `Transport score of this home, 0-100: access from its exact address + the minutes to your points`
      + (l.house_estimated ? ' · estimate: some minutes come from the Connectivity matrix (compute the transit routes to your points to make them exact)' : ' (ResRobot trips)');
    if (l[k === 'transport' ? 'house_transport' : 'house_services'] != null) return `Services score of this home, 0-100, measured from its exact address (open it for the details)`;
    return l.zone_id ? 'Not measured yet: open the listing, or run findhome listings location --all' : 'Outside the analysed zones: not measured';
  }
  protected kr = fmtKr; protected num = fmtNum; protected score = fmtScore; protected pet = petClass; protected color = scoreColor;

  ngOnInit(): void { this.load(); this.values.load(); }

  protected hoverIn(r: Listing, ev: MouseEvent): void {
    if (this.tipTimer) clearTimeout(this.tipTimer);
    const row = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    this.tipTimer = setTimeout(() => {
      const w = 380, h = 470, vw = window.innerWidth, vh = window.innerHeight;
      const left = ev.clientX + 24 + w < vw ? ev.clientX + 24 : Math.max(8, ev.clientX - w - 24);
      const top = Math.max(8, Math.min(row.top - 40, vh - h - 8));
      this.tip.set({ row: r, top, left });
    }, 250);
  }

  protected hoverOut(): void {
    if (this.tipTimer) clearTimeout(this.tipTimer);
    this.tipTimer = null;
    this.tip.set(null);
  }

  /** The two score groups that add the most to the total. */
  protected topGroups(l: Listing): string[] {
    return Object.entries(l.breakdown ?? {}).filter(([, p]) => p.score != null)
      .sort(([, a], [, b]) => b.score! * b.weight - a.score! * a.weight).slice(0, 2)
      .map(([name, p]) => `${name} ${fmtScore(p.score)}`);
  }

  load(): void {
    this.loading.set(true);
    this.api.listings({ status: this.status || undefined, q: this.q || undefined, includeRejected: !this.hideRejected }).subscribe({
      next: (res) => { this.rows.set(res.items); this.cursor.set(0); this.loading.set(false); this.error.set(''); },
      error: (e) => { this.error.set(apiError(e)); this.loading.set(false); },
    });
  }

  recompute(): void {
    this.api.recompute().subscribe({
      next: (r) => { this.message.set(`Scored ${r.scored} (${r.rejected} rejected by hard filters)`); this.load(); this.values.load(true); },
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
