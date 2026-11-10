import { Component, DestroyRef, HostListener, OnDestroy, OnInit, TemplateRef, afterNextRender, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { DatePipe, DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { fmtKr, fmtNum, fmtScore, petClass, scoreColor } from '../format';
import { PetBadge } from '../components/pet-badge';
import { ScoreTip } from '../components/score-tip';
import { SiteLogo } from '../components/site-logo';
import { ZoneMinimap } from '../components/zone-minimap';
import { ValueScaleStore, valueOf } from '../value-scale';
import { indexColour } from '../house/house-bubbles';
import { Listing, RecomputeStatus } from '../models';
import { ApiService, apiError } from '../services/api.service';
import { CandidateOrderStore } from '../services/candidate-order.store';
import { LayoutService } from '../services/layout.service';
import { CandidateFilters, CandidateFiltersStore, SortKey, applyAll, sortRows } from './candidate-filters';
import { SitesStore } from '../services/sites.store';
import { TagsStore } from '../services/tags.store';

type Picker = { mode: 'like' | 'dislike'; tags: Set<string>; note: string } | null;

/**
 * Fast triage table. Keys: j/k move · Enter open · s shortlist · r reject (tag picker) · l like (tag picker)
 * · a archive · / search. Changes are posted immediately.
 */
@Component({
  selector: 'fh-candidates',
  imports: [FormsModule, RouterLink, CandidateFilters, ScoreTip, ZoneMinimap, DecimalPipe, DatePipe, PetBadge, SiteLogo, NgTemplateOutlet],
  template: `
  <div class="fh-page-head">
    <h1>Candidates</h1>
    <select class="form-select form-select-sm w-auto" [(ngModel)]="status" (ngModelChange)="load()">
      <option value="">all statuses</option>
      @for (s of tags.statuses(); track s) { <option [value]="s">{{ s }}</option> }
    </select>
    <input #search class="form-control form-control-sm w-auto" placeholder="search (/)" [(ngModel)]="q" (keyup.enter)="load()" />
    <button type="button" class="fh-rej-toggle" [class.on]="fs.hideRejected()" [attr.aria-pressed]="fs.hideRejected()" (click)="toggleRejected()"
      [title]="fs.hideRejected() ? 'Rejected homes are hidden: click to show them' : 'Rejected homes are shown: click to hide them'">
      <span class="fh-rej-dot"></span>{{ fs.hideRejected() ? 'Rejected hidden' : 'Hide rejected' }}</button>
    <button class="btn btn-sm btn-outline-primary" [disabled]="!!recomputing()" (click)="recompute()"
            title="Every home: its transport and services scores from the exact address (when missing), then all scores">
      @if (recomputing(); as rc) { <span class="spinner-border spinner-border-sm me-1"></span>{{ recomputeLabel(rc) }} }
      @else { Recompute scores }</button>
    <span class="small text-body-secondary ms-auto">
      <span class="fh-kbd">j</span>/<span class="fh-kbd">k</span> move · <span class="fh-kbd">←</span>/<span class="fh-kbd">→</span> page · <span class="fh-kbd">⏎</span> open ·
      <span class="fh-kbd">s</span> shortlist · <span class="fh-kbd">l</span> like · <span class="fh-kbd">r</span> reject · <span class="fh-kbd">a</span> archive
    </span>
  </div>
  @if (scope().length) {
    <div class="d-flex flex-wrap gap-2 mb-2">
      @for (c of scope(); track c.key) {
        <span class="fh-filter-on">
          @if (c.slug) { <fh-site-logo [slug]="c.slug" /> }{{ c.label }}
          <button type="button" (click)="clearScope(c.key)" [attr.aria-label]="'Remove filter ' + c.label" title="Remove this filter">✕</button></span>
      }
    </div>
  }
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

  <ng-template #filtersTpl><fh-candidate-filters [count]="rows().length" /></ng-template>
  @if (!all().length && !loading()) {
    <div class="fh-empty">No listings yet. Ingest the sample with
      <code>scripts/findhome ingest listings -f backend/tests/fixtures/listings_sample.json</code>, or run a scan from Sites.</div>
  } @else {
    <ng-template #pager>
      <div class="fh-pager">
        <button type="button" class="fh-btn-nav" [disabled]="page() === 0" (click)="goPage(page() - 1)"
                aria-label="Previous page"><span class="fh-nav-arrow" aria-hidden="true">‹</span>Prev</button>
        <span class="fh-pager-mid">
          Page <b>{{ page() + 1 }}</b> / {{ pages() }} · {{ rows().length }} homes ·
          <select class="form-select form-select-sm d-inline-block w-auto" [ngModel]="pageSize()" (ngModelChange)="setPageSize(+$event)"
                  aria-label="Homes per page">
            @for (n of pageSizes; track n) { <option [value]="n">{{ n }}</option> }
          </select> per page
        </span>
        <button type="button" class="fh-btn-nav next" [disabled]="page() >= pages() - 1" (click)="goPage(page() + 1)"
                aria-label="Next page">Next<span class="fh-nav-arrow" aria-hidden="true">›</span></button>
      </div>
    </ng-template>
    <ng-container [ngTemplateOutlet]="pager" />
    @if (!rows().length) {
      <div class="fh-empty">No home matches the filters. <a href="" (click)="$event.preventDefault(); fs.clear()">Reset the filters</a></div>
    }
    <ng-template #th let-key let-label="label" let-tip="tip" let-cls="cls">
      <th [class]="cls" [attr.aria-sort]="fs.sort().key === key ? (fs.sort().dir === 1 ? 'ascending' : 'descending') : null">
        <button type="button" class="fh-sort" [class.on]="fs.sort().key === key" [title]="tip || ('Sort by ' + label)" (click)="sortBy(key)">{{ label }}@if (fs.sort().key === key) { <i>{{ fs.sort().dir === 1 ? '▲' : '▼' }}</i> }</button>
      </th>
    </ng-template>
    <div class="table-responsive">
    <table class="table table-sm table-hover align-middle">
      <thead><tr><th>Id</th>
        @for (c of columns; track c.key) { <ng-container *ngTemplateOutlet="th; context: { $implicit: c.key, label: c.label, tip: c.tip, cls: c.cls }" /> }
      </tr></thead>
      <tbody>
        @for (r of pageRows(); track r.short_id; let j = $index) {
          @let i = page() * pageSize() + j;
          <tr [style.background]="i === cursor() ? 'var(--fh-sel)' : null" (click)="cursor.set(i)" (dblclick)="open(r)"
            (mouseenter)="hoverIn(r, $event)" (mouseleave)="hoverOut()">
            <td class="fh-mono text-nowrap"><a [routerLink]="['/candidates', r.short_id]">{{ r.short_id }}</a></td>
            <td>
              <fh-score-tip [total]="r.score" [breakdown]="r.breakdown" [rejected]="r.rejected_by" />
              @if (r.score_stale) { <span class="text-body-secondary small" title="no score for the current config"> ·stale</span> }
            </td>
            <td class="fh-idx" [style.color]="idx(r.house_transport)" [title]="houseTitle(r, 'transport')">{{ int(r.house_transport) }}@if (r.house_estimated) { <i class="fh-est-dot inline"></i> }</td>
            <td class="fh-idx" [style.color]="idx(r.house_services)" [title]="houseTitle(r, 'services')">{{ int(r.house_services) }}</td>
            <td>{{ r.status }}</td>
            <td>@if (r.origin_site) { <fh-site-logo class="me-1" [slug]="r.origin_site" [title]="originTip(r)" /> }{{ r.area }} <span class="text-body-secondary small">{{ r.address_raw }}</span></td>
            @let ro = values.rate(r, 'rooms_rok'); @let rs = values.rate(r, 'size_m2');
            @let rr = values.rate(r, 'rent_sek'); @let rm = values.rate(r, 'rent_per_m2'); @let mv = values.moveIn(r);
            <td class="text-nowrap" [style.color]="mv?.colour" [title]="mv?.title ?? (r.available_from ? '' : 'The ad gives no move-in date')">
              {{ r.available_from ? (r.available_from | date: 'd MMM y') : '–' }}</td>
            <td [style.color]="ro?.colour" [title]="ro?.title ?? ''">{{ num(r.rooms_rok) }}{{ r.has_sovalkov ? '+alkov' : '' }}</td>
            <td [style.color]="rs?.colour" [title]="rs?.title ?? ''">{{ num(r.size_m2) }}</td>
            <td class="text-nowrap" [style.color]="rr?.colour" [title]="rr?.title ?? ''">{{ kr(r.rent_sek) }}</td>
            <td [style.color]="rm?.colour" [title]="rm?.title ?? ''" class="small">{{ perM2(r) == null ? '' : (perM2(r)! | number: '1.0-0') }}</td>
            <td><fh-pet-badge [status]="r.pet_status" [source]="r.pet_source" [evidence]="r.pet_evidence" /></td>
            <td class="small">{{ r.contract_type?.replace('_', '-') ?? '' }}{{ r.contract_end ? ' → ' + r.contract_end : '' }}</td>
          </tr>
        }
      </tbody>
    </table>
    </div>
    <ng-container [ngTemplateOutlet]="pager" />
    @if (values.scale(); as sc) {
      <div class="small text-body-secondary">Move in is coloured against your move-in window in config/profile.yaml: green inside, amber before, red after.
        Rooms, m², rent and kr/m² are coloured against the {{ sc.n }} listings still in the running
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
        <span>Pets</span><span><fh-pet-badge [status]="t.pet_status" [source]="t.pet_source" />
          @if (t.pet_evidence) { <span class="text-body-secondary"> “{{ t.pet_evidence }}”</span> }</span>
        @if (t.origin_site) { <span>Origin</span><span><fh-site-logo [slug]="t.origin_site" [withName]="true" /></span> }
        <span>Move in</span><span [style.color]="values.moveIn(t)?.colour">{{ t.available_from ? (t.available_from | date: 'd MMM y') : '?' }}</span>
        <span>Contract</span><span>{{ t.contract_type?.replace('_', '-') ?? '?' }}{{ t.contract_end ? ' → ' + t.contract_end : '' }}</span>
        <span>Status</span><span>{{ t.status }} · seen {{ t.first_seen_at | date: 'mediumDate' }}</span>
        @if (t.rejected_by?.length) { <span>Rejected by</span><span class="text-danger">{{ t.rejected_by!.join(', ') }}</span> }
        @else if (topGroups(t).length) { <span>Best for</span><span>{{ topGroups(t).join(' · ') }}</span> }
      </div>
    }
  </div>
  `,
})
export class CandidatesPage implements OnInit, OnDestroy {
  private api = inject(ApiService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  protected sites = inject(SitesStore);
  protected tags = inject(TagsStore);
  private order = inject(CandidateOrderStore);
  /** Scope from the link that opened the page (?origin= / ?site= / ?scan_run=), shown as removable chips. */
  protected origin = signal('');
  protected site = signal('');
  protected scanRun = signal('');
  protected scope = computed(() => [
    ...(this.origin() ? [{ key: 'origin', slug: this.origin(), label: `First published on ${this.sites.name(this.origin())}` }] : []),
    ...(this.site() ? [{ key: 'site', slug: this.site(), label: `Found on ${this.sites.name(this.site())}` }] : []),
    ...(this.scanRun() ? [{ key: 'scan_run', slug: '', label: `From scan run ${this.scanRun().slice(0, 8)}` }] : []),
  ]);
  protected cursor = signal(0);
  protected loading = signal(false);
  protected error = signal('');
  protected message = signal('');
  protected picker = signal<Picker>(null);
  protected selected = computed(() => this.rows()[this.cursor()]);
  /** The homes from the server (status, search, scope and "hide rejected" applied); `rows` adds the ranges and the sort. */
  protected all = signal<Listing[]>([]);
  protected fs = inject(CandidateFiltersStore);
  protected rows = computed(() => sortRows(applyAll(this.all(), this.fs.filters(), this.fs.cats()), this.fs.sort()));
  private layout = inject(LayoutService);
  private filtersTpl = viewChild.required<TemplateRef<unknown>>('filtersTpl');
  /** The sortable columns, in table order. */
  protected columns: { key: SortKey; label: string; tip?: string; cls?: string }[] = [
    { key: 'score', label: 'Score' },
    { key: 'transport', label: 'Transport', cls: 'text-center', tip: 'The home\'s transport score, 0-100, from its exact address: walks to rail and bus, lines and departures nearby. Click to sort.' },
    { key: 'services', label: 'Services', cls: 'text-center', tip: 'The home\'s services score, 0-100, from its exact address: walks to groceries, pharmacy, gym, park, vet and how many are near. Click to sort.' },
    { key: 'status', label: 'Status' }, { key: 'area', label: 'Area / address' },
    { key: 'move_in', label: 'Move in', tip: 'The move-in date the ad gives, against your window in config/profile.yaml (move_in_from → move_in_to): green inside, amber before, red after (rejected). Click to sort.' },
    { key: 'rooms', label: 'Rooms' }, { key: 'size', label: 'm²' }, { key: 'rent', label: 'Rent' }, { key: 'per_m2', label: 'kr/m²' },
    { key: 'pets', label: 'Pets' }, { key: 'contract', label: 'Contract' },
  ];
  /** Pages: the cursor decides the page, so j / k and the selection move across pages too. */
  protected pageSizes = [25, 50, 100, 200];
  protected pageSize = signal(readPageSize());
  protected pages = computed(() => Math.max(1, Math.ceil(this.rows().length / this.pageSize())));
  protected page = computed(() => Math.min(Math.floor(this.cursor() / this.pageSize()), this.pages() - 1));
  protected pageRows = computed(() => this.rows().slice(this.page() * this.pageSize(), (this.page() + 1) * this.pageSize()));
  protected recomputing = signal<RecomputeStatus | null>(null);
  private poll?: ReturnType<typeof setInterval>;
  protected status = '';
  protected q = '';
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
    return l.zone_id ? 'Not measured yet: press Recompute scores (or open the listing)' : 'Outside the analysed zones: not measured';
  }
  protected kr = fmtKr; protected num = fmtNum; protected score = fmtScore; protected pet = petClass; protected color = scoreColor;

  constructor() {
    const destroy = inject(DestroyRef);
    afterNextRender(() => this.layout.register(destroy, [{ id: 'candidate-filters', title: 'Filters', tpl: this.filtersTpl() }]));
    // the order you see is the order the listing page steps through; a new filter or sort starts at the top
    effect(() => { const ids = this.rows().map((l) => l.short_id); untracked(() => this.order.set(ids)); });
    effect(() => { this.fs.filters(); this.fs.cats(); this.fs.sort(); untracked(() => this.cursor.set(0)); });
  }
  protected sortBy(key: SortKey): void { this.fs.sortBy(key); }
  protected toggleRejected(): void { this.fs.hideRejected.update((v) => !v); this.load(true); }

  ngOnInit(): void {
    this.api.recomputeStatus().subscribe({ next: (st) => { if (st.running) this.follow(st); }, error: () => {} });
    this.sites.load();
    this.values.load();
    this.route.queryParamMap.subscribe((q) => {
      this.origin.set(q.get('origin') ?? '');
      this.site.set(q.get('site') ?? '');
      this.scanRun.set(q.get('scan_run') ?? '');
      this.load();
    });
  }
  protected clearScope(key: string): void { this.router.navigate([], { queryParams: { [key]: null }, queryParamsHandling: 'merge' }); }
  /** "HomeQ · found on Qasa": where the home was first published and the site we found it on. */
  protected originTip(l: Listing): string {
    const o = l.origin_site!;
    const found = (l.found_on ?? []).map((s) => this.sites.name(s));
    const via = found.length ? found.join(', ')
      : (this.sites.bySlug().get(o)?.role === 'origin' ? this.sites.aggregatorOf(o)?.name : null) ?? this.sites.name(o);
    return `${this.sites.name(o)} · found on ${via}`;
  }

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

  /** Reloads; `pulse` opens the Filters charts for a moment so they animate to the new homes. */
  load(pulse = false): void {
    this.loading.set(true);
    this.api.listings({ status: this.status || undefined, q: this.q || undefined, includeRejected: !this.fs.hideRejected(),
      origin: this.origin() || undefined, site: this.site() || undefined, scanRun: this.scanRun() || undefined }).subscribe({
      next: (res) => {
        this.all.set(res.items); this.fs.base.set(res.items); this.cursor.set(0); this.loading.set(false); this.error.set('');
        if (pulse) this.fs.flash();
      },
      error: (e) => { this.error.set(apiError(e)); this.loading.set(false); },
    });
  }

  goPage(p: number): void {
    const n = Math.min(Math.max(p, 0), this.pages() - 1);
    this.cursor.set(Math.min(n * this.pageSize(), Math.max(this.rows().length - 1, 0)));
    document.querySelector<HTMLElement>('.fh-page-head')?.scrollIntoView?.({ block: 'start' });   // the bottom pager leaves you at the top
  }
  setPageSize(n: number): void {
    const first = this.page() * this.pageSize();
    this.pageSize.set(n);
    try { localStorage.setItem('fh.candidates.pageSize', String(n)); } catch { /* per page only */ }
    this.cursor.set(Math.min(first, Math.max(this.rows().length - 1, 0)));
  }

  /** Every home in the background: missing house analyses (transport, services), then all scores. */
  recompute(): void {
    this.api.recomputeAll().subscribe({ next: (st) => this.follow(st), error: (e) => this.error.set(apiError(e)) });
  }
  recomputeLabel(st: RecomputeStatus): string {
    const of = st.total ? ` ${st.done}/${st.total}` : '';
    return st.phase === 'geocoding' ? `Locating homes${of}` : st.phase === 'analysing' ? `Transport & services${of}`
      : st.phase === 'scoring' ? `Scoring${of}` : 'Starting…';
  }
  private follow(st: RecomputeStatus): void {
    this.recomputing.set(st);
    clearInterval(this.poll);
    this.poll = setInterval(() => this.api.recomputeStatus().subscribe({
      next: (s) => {
        if (s.running) { this.recomputing.set(s); return; }
        clearInterval(this.poll);
        this.recomputing.set(null);
        if (s.error) { this.error.set(`Recompute failed: ${s.error}`); return; }
        const r = s.result;
        if (r) this.message.set(`Scored ${r.scored} (${r.rejected} rejected by hard filters) · transport & services computed for `
          + `${r.analysed} homes${r.failed ? ` (${r.failed} outside the analysed zones or without data)` : ''}`
          + (r.geocoded ? ` · ${r.geocoded} located` : ''));
        this.load();
        this.values.load(true);
      },
      error: () => {},
    }), 1500);
  }
  ngOnDestroy(): void { clearInterval(this.poll); }

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
    this.all.update((rows) => rows.map((x) => (x.short_id === r.short_id ? { ...x, status } : x)));
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
      case 'ArrowRight': this.goPage(this.page() + 1); break;
      case 'ArrowLeft': this.goPage(this.page() - 1); break;
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

function readPageSize(): number {
  try { const n = Number(localStorage.getItem('fh.candidates.pageSize')); return [25, 50, 100, 200].includes(n) ? n : 50; }
  catch { return 50; }
}
