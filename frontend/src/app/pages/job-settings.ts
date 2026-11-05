import { Component, DestroyRef, OnChanges, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { LaunchButton } from '../components/launch-button';
import { PagesStepper } from '../components/pages-stepper';
import { PetBadge } from '../components/pet-badge';
import { SiteLogo } from '../components/site-logo';
import { Job, JobPreview, JobSettings, JobSubset, Launcher } from '../models';
import { ApiService, apiError } from '../services/api.service';
import { MODEL_HINT, MODEL_LABEL, ProfilesStore } from '../services/profiles.store';
import { SitesStore } from '../services/sites.store';

const PET = ['unknown', 'conflict', 'ask', 'yes', 'no'];
const SOURCES = ['none', 'keywords', 'site', 'agent', 'user'];

/** The subset without empty values, as the API stores it. */
export function cleanSubset(s: JobSubset): JobSubset {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) {
    if (v == null || v === '' || v === false || (Array.isArray(v) && !v.length)) continue;
    out[k] = v;
  }
  return out as JobSubset;
}
/** "l-ab12, L-CD34 x" → ["L-AB12", "L-CD34", "X"] */
export const parseIds = (t: string) => t.split(/[\s,;]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);

/**
 * Right panel of a job: what it does, which listings it takes (subset builder with a live count), how many, the
 * launcher (agent jobs), Save and Run. Run uses the form as it is, saved or not.
 */
@Component({
  selector: 'fh-job-settings',
  imports: [FormsModule, RouterLink, LaunchButton, PagesStepper, PetBadge, SiteLogo],
  template: `
  @let j = job();
  @let sub = form().subset;
  <p class="small text-body-secondary">{{ j.description }}</p>

  <div class="fh-field"><span class="fh-field-label">Pet status</span>
    <div class="d-flex flex-wrap gap-1">
      @for (p of pets; track p) { <button type="button" class="fh-fchip" [class.active]="has('pet_status', p)" (click)="flip('pet_status', p)">{{ p }}</button> }
    </div>
  </div>
  <div class="fh-field"><span class="fh-field-label">Set by</span>
    <div class="d-flex flex-wrap gap-1">
      @for (p of sources; track p) { <button type="button" class="fh-fchip" [class.active]="has('pet_source', p)" (click)="flip('pet_source', p)">{{ p }}</button> }
    </div>
  </div>
  <div class="fh-field"><span class="fh-field-label">Found on</span>
    <div class="d-flex flex-wrap gap-1">
      @for (s of scanned(); track s.slug) {
        <button type="button" class="fh-fchip" [class.active]="has('sites', s.slug)" (click)="flip('sites', s.slug)"><fh-site-logo [slug]="s.slug" [withName]="true" /></button>
      }
    </div>
  </div>
  <div class="fh-field"><span class="fh-field-label">First published on</span>
    <div class="d-flex flex-wrap gap-1">
      @for (s of sites.sites(); track s.slug) {
        <button type="button" class="fh-fchip" [class.active]="has('origin_sites', s.slug)" (click)="flip('origin_sites', s.slug)"><fh-site-logo [slug]="s.slug" [withName]="true" /></button>
      }
    </div>
  </div>
  <div class="row g-2">
    <div class="col-6 fh-field"><label for="js-order">Order</label>
      <select id="js-order" class="form-select form-select-sm" [ngModel]="sub.order ?? 'score_desc'" (ngModelChange)="set('order', $event)">
        <option value="score_desc">best score first</option><option value="newest">newest first</option><option value="oldest">oldest first</option>
      </select></div>
    <div class="col-6 fh-field"><label for="js-days">Skip if checked in the last</label>
      <div class="input-group input-group-sm">
        <input id="js-days" type="number" min="0" class="form-control" [ngModel]="sub.exclude_checked_within_days ?? null"
               (ngModelChange)="set('exclude_checked_within_days', $event === null || $event === '' ? null : +$event)" placeholder="–" />
        <span class="input-group-text">days</span></div></div>
    <div class="col-6 fh-field"><label for="js-since">New since</label>
      <input id="js-since" type="date" class="form-control form-control-sm" [ngModel]="sub.new_since ?? ''" (ngModelChange)="set('new_since', $event || null)" /></div>
    <div class="col-6 fh-field d-flex align-items-end">
      <div class="form-check form-switch mb-1">
        <input id="js-hard" class="form-check-input" type="checkbox" [ngModel]="!!sub.passes_hard_filters" (ngModelChange)="set('passes_hard_filters', $event)" />
        <label class="form-check-label small" for="js-hard">passes the hard filters</label></div></div>
  </div>
  <div class="fh-field"><label for="js-ids">Only these listings (optional)</label>
    <input id="js-ids" class="form-control form-control-sm fh-mono" placeholder="L-AB12, L-CD34" [ngModel]="ids()"
           (ngModelChange)="ids.set($event); set('short_ids', parseIds($event))" /></div>

  <div class="fh-card mb-3" style="padding:10px 12px">
    <div class="d-flex align-items-center gap-3">
      <div><div class="fh-preview-count">{{ preview()?.count ?? '…' }}</div><div class="small text-body-secondary">match</div></div>
      <div class="flex-grow-1 small">
        @if (preview(); as p) { This run takes <b>{{ take() }}</b> of them{{ p.count > form().n ? ' (N)' : '' }}, {{ orderLabel() }}. }
        @if (previewError()) { <div class="text-danger">{{ previewError() }}</div> }
      </div>
    </div>
    @if (preview()?.items?.length) {
      <details class="mt-2 small"><summary>First {{ preview()!.items.length }}</summary>
        @for (l of preview()!.items; track l.short_id) {
          <div class="d-flex gap-2 align-items-center py-1">
            @if (l.origin_site) { <fh-site-logo [slug]="l.origin_site" /> }
            <a class="fh-mono" [routerLink]="['/candidates', l.short_id]">{{ l.short_id }}</a>
            <span class="text-truncate">{{ l.area }}</span>
            <fh-pet-badge class="ms-auto" [status]="l.pet_status" [source]="l.pet_source" />
          </div>
        }
      </details>
    }
  </div>

  <div class="d-flex flex-wrap gap-3 align-items-end mb-3">
    <div class="fh-field mb-0"><span class="fh-field-label">N (max {{ j.max_n }})</span>
      <fh-pages-stepper [value]="form().n" (valueChange)="setN($event)" [max]="j.max_n" unit="listings" /></div>
    @if (j.kind === 'agent') {
      <div class="fh-field mb-0"><span class="fh-field-label">Launcher</span>
        <div class="btn-group btn-group-sm">
          @for (l of launcherOptions; track l) {
            <button type="button" class="btn" [class.btn-primary]="form().launcher === l" [class.btn-outline-secondary]="form().launcher !== l"
                    (click)="setLauncher(l)">{{ l === 'vscode' ? 'VS Code' : 'CLI' }}</button>
          }
        </div></div>
      @if (models(); as mc) {
        <div class="fh-field mb-0"><span class="fh-field-label">Model</span>
          <div class="btn-group btn-group-sm">
            @for (m of mc.choices; track m) {
              <button type="button" class="btn" [class.btn-primary]="(form().model ?? mc.default) === m"
                      [class.btn-outline-secondary]="(form().model ?? mc.default) !== m" [title]="modelHint(m)"
                      (click)="setModel(m)">{{ modelName(m) }}</button>
            }
          </div></div>
      }
    }
  </div>
  @if (error()) { <div class="fh-inline-err mb-2" style="max-width:none"><span>{{ error() }}</span></div> }
  <div class="d-flex flex-wrap gap-2 align-items-start">
    <button class="btn btn-sm btn-outline-primary" [disabled]="!dirty() || saving()" (click)="save()">{{ dirty() ? 'Save settings' : 'Saved' }}</button>
    @if (j.kind === 'agent') {
      <fh-launch-button label="Run" [launchers]="launcherOptions" [defaultLauncher]="form().launcher ?? 'cli'" [starter]="starter"
                        [disabled]="!j.enabled || !!j.running || !take()" [reason]="j.running ? 'Already running' : !take() ? 'No listing matches' : 'Job disabled'"
                        (started)="ran.emit($event.result)" />
    } @else {
      <button class="btn btn-sm btn-primary" [disabled]="!j.enabled || !!j.running || !take() || running()" (click)="runInApp()">
        @if (running()) { <span class="spinner-border spinner-border-sm me-1"></span> }Run on {{ take() }}</button>
    }
  </div>`,
})
export class JobSettingsPanel implements OnChanges {
  private api = inject(ApiService);
  protected sites = inject(SitesStore);
  private profiles = inject(ProfilesStore);
  readonly job = input.required<Job>();
  readonly saved = output<Job>();
  readonly ran = output<unknown>();
  protected pets = PET; protected sources = SOURCES; protected launcherOptions: Launcher[] = ['cli', 'vscode'];
  protected form = signal<JobSettings>({ subset: {}, n: 1 });
  protected ids = signal('');
  protected preview = signal<JobPreview | null>(null);
  protected previewError = signal('');
  protected error = signal('');
  protected saving = signal(false);
  protected running = signal(false);
  protected parseIds = parseIds;
  private loadedKey = '';
  private savedJson = signal('');
  private sub?: Subscription;

  protected models = computed(() => (this.job().profile ? this.profiles.models(this.job().profile!) : null));
  protected modelName = (m: string) => MODEL_LABEL[m] ?? m;
  protected modelHint = (m: string) => MODEL_HINT[m] ?? '';
  protected scanned = computed(() => this.sites.sites().filter((s) => s.role !== 'origin'));
  protected payload = computed<JobSettings>(() => {
    const f = this.form();
    return { subset: cleanSubset(f.subset), n: f.n,
             ...(this.job().kind === 'agent' ? { launcher: f.launcher ?? 'cli', ...(f.model ? { model: f.model } : {}) } : {}) };
  }, { equal: (a, b) => JSON.stringify(a) === JSON.stringify(b) });
  protected dirty = computed(() => JSON.stringify(this.payload()) !== this.savedJson());
  protected take = computed(() => Math.min(this.preview()?.count ?? 0, this.form().n));
  protected orderLabel = computed(() => ({ score_desc: 'best score first', newest: 'newest first', oldest: 'oldest first' })[this.form().subset.order ?? 'score_desc']);
  protected starter = (l: Launcher) => this.api.runJob(this.job().key, this.payload(), l);

  constructor() {
    this.profiles.load();
    this.sites.load();
    let t: ReturnType<typeof setTimeout> | undefined;
    // live preview, debounced: every change of the form asks the API how many listings match
    effect(() => {
      const p = this.payload();
      const key = untracked(() => this.job().key);
      clearTimeout(t);
      t = setTimeout(() => {
        this.sub?.unsubscribe();
        this.sub = this.api.previewJob(key, p).subscribe({
          next: (r) => { this.preview.set(r); this.previewError.set(''); },
          error: (e) => this.previewError.set(apiError(e)),
        });
      }, 350);
    });
    inject(DestroyRef).onDestroy(() => { clearTimeout(t); this.sub?.unsubscribe(); });
  }

  ngOnChanges(): void {
    const j = this.job();
    if (this.loadedKey !== j.key || !this.dirty()) this.reset(j);      // a refresh keeps what you are editing
  }
  private reset(j: Job): void {
    this.loadedKey = j.key;
    const s = structuredClone(j.settings ?? { subset: {}, n: 1 });
    this.form.set({ subset: s.subset ?? {}, n: s.n ?? 1, launcher: s.launcher ?? (j.kind === 'agent' ? 'cli' : undefined),
                    ...(s.model ? { model: s.model } : {}) });
    this.ids.set((s.subset?.short_ids ?? []).join(', '));
    this.savedJson.set(JSON.stringify(this.payload()));
  }

  has(k: 'pet_status' | 'pet_source' | 'sites' | 'origin_sites', v: string): boolean { return (this.form().subset[k] ?? []).includes(v); }
  flip(k: 'pet_status' | 'pet_source' | 'sites' | 'origin_sites', v: string): void {
    const cur = this.form().subset[k] ?? [];
    this.set(k, cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]);
  }
  set<K extends keyof JobSubset>(k: K, v: JobSubset[K]): void { this.form.update((f) => ({ ...f, subset: { ...f.subset, [k]: v } })); }
  setN(n: number): void { this.form.update((f) => ({ ...f, n })); }
  setLauncher(l: Launcher): void { this.form.update((f) => ({ ...f, launcher: l })); }
  setModel(m: string): void { this.form.update((f) => ({ ...f, model: m })); }

  save(): void {
    this.saving.set(true);
    this.error.set('');
    this.api.saveJob(this.job().key, this.payload()).subscribe({
      next: (j) => { this.saving.set(false); this.savedJson.set(JSON.stringify(this.payload())); this.saved.emit(j); },
      error: (e) => { this.saving.set(false); this.error.set(apiError(e)); },
    });
  }
  runInApp(): void {
    this.running.set(true);
    this.error.set('');
    this.api.runJob(this.job().key, this.payload()).subscribe({
      next: (r) => { this.running.set(false); this.ran.emit(r); },
      error: (e) => { this.running.set(false); this.error.set(apiError(e)); },
    });
  }
}
