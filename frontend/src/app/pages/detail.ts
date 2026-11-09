import { Component, HostListener, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { fmtKr, fmtNum, fmtScore, petClass, petSourceLabel, scoreColor } from '../format';
import { GalleryComponent } from '../components/gallery';
import { InfoButton } from '../components/info';
import { PetBadge } from '../components/pet-badge';
import { SiteLogo } from '../components/site-logo';
import { ScoreTip } from '../components/score-tip';
import { HouseHome, HouseTransit, HouseTravel, HouseZone } from '../house/house-bubbles';
import { HouseTravelStore } from '../house/house-travel.store';
import { ZoneMinimap } from '../components/zone-minimap';
import { ValueScaleStore, valueOf } from '../value-scale';
import { HouseMap } from '../house/house-map';
import { CommuteRow, HouseLocation, Listing, ListingDetail } from '../models';
import { ApiService, apiError } from '../services/api.service';
import { CandidateOrderStore } from '../services/candidate-order.store';
import { SitesStore } from '../services/sites.store';
import { TagsStore } from '../services/tags.store';

@Component({
  selector: 'fh-detail',
  imports: [FormsModule, RouterLink, DatePipe, GalleryComponent, InfoButton, HouseHome, HouseZone, HouseTravel, HouseTransit, HouseMap, ScoreTip, ZoneMinimap, PetBadge, SiteLogo],
  template: `
  <nav class="fh-detail-nav" aria-label="Candidates">
    @let n = nav();
    <a class="btn btn-sm btn-outline-secondary" [class.disabled]="!n?.prev" [attr.aria-disabled]="!n?.prev"
       [routerLink]="n?.prev ? ['/candidates', n!.prev] : null" title="Previous home in the candidates list (k)">‹ Prev
       @if (n?.prev) { <span class="fh-mono small ms-1">{{ n!.prev }}</span> }</a>
    <span class="fh-detail-pos">@if (n) { {{ n.pos }} / {{ n.total }} in the candidates list }</span>
    <a class="btn btn-sm btn-outline-secondary" [class.disabled]="!n?.next" [attr.aria-disabled]="!n?.next"
       [routerLink]="n?.next ? ['/candidates', n!.next] : null" title="Next home in the candidates list (j)">
       @if (n?.next) { <span class="fh-mono small me-1">{{ n!.next }}</span> }Next ›</a>
  </nav>
  <div class="fh-page-head">
    <a routerLink="/candidates" class="btn btn-sm btn-outline-secondary">← Candidates</a>
    <h1 class="fh-mono">{{ shortId() }}</h1>
    @if (d(); as x) {
      <fh-pet-badge prefix="pets " [status]="x.listing.pet_status" [source]="x.listing.pet_source" [evidence]="x.listing.pet_evidence" />
      @if (x.listing.origin_site) { <fh-site-logo [slug]="x.listing.origin_site" [withName]="true" [title]="'First published on ' + sites.name(x.listing.origin_site)" /> }
      <select class="form-select form-select-sm w-auto" [ngModel]="x.listing.status" (ngModelChange)="setStatus($event)">
        @for (s of tags.statuses(); track s) { <option [value]="s">{{ s }}</option> }
      </select>
      @if (x.listing.canonical_url) { <a class="btn btn-sm btn-outline-primary" [href]="x.listing.canonical_url" target="_blank" rel="noopener">Open on site ↗</a> }
    }
  </div>
  @if (error()) { <div class="alert alert-danger py-1 small" style="white-space:pre-wrap">{{ error() }}</div> }
  @if (info()) { <div class="alert alert-info py-1 small">{{ info() }}</div> }

  @if (d(); as x) {
    <div class="row g-3">
      <div class="col-lg-7">
        <fh-gallery [photos]="x.listing.photo_urls" [plans]="x.listing.floorplan_urls" [link]="x.listing.canonical_url"
          [incomplete]="galleryIncomplete(x.listing)" [band]="true" />

        @let L = x.listing;
        <section class="fh-hcard fh-hcard-main">
          <header><h2>{{ L.title || L.address_raw }}</h2><span class="fh-hsub">{{ L.area }}{{ L.title && L.address_raw ? ' · ' + L.address_raw : '' }}</span></header>
          @let rr = values.rate(L, 'rent_sek'); @let rm = values.rate(L, 'rent_per_m2');
          @let ro = values.rate(L, 'rooms_rok'); @let rs = values.rate(L, 'size_m2');
          <div class="fh-facts">
            <div class="fh-fact" [style.--c]="rr?.colour" [title]="rr?.title ?? ''"><span class="fh-fact-l">Rent</span>
              <span class="fh-fact-v">{{ kr(L.rent_sek) }}</span><span class="fh-fact-n">per month</span></div>
            <div class="fh-fact" [style.--c]="rm?.colour" [title]="rm?.title ?? ''"><span class="fh-fact-l">Per m²</span>
              <span class="fh-fact-v">{{ kr(perM2(L)) }}</span><span class="fh-fact-n">per month</span></div>
            <div class="fh-fact" [style.--c]="ro?.colour" [title]="ro?.title ?? ''"><span class="fh-fact-l">Rooms</span>
              <span class="fh-fact-v">{{ num(L.rooms_rok) }} rok</span><span class="fh-fact-n">{{ L.has_sovalkov ? '+ sovalkov' : '\u00a0' }}</span></div>
            <div class="fh-fact" [style.--c]="rs?.colour" [title]="rs?.title ?? ''"><span class="fh-fact-l">Size</span>
              <span class="fh-fact-v">{{ num(L.size_m2, ' m²') }}</span><span class="fh-fact-n">&nbsp;</span></div>
            <div class="fh-fact"><span class="fh-fact-l">Floor</span>
              <span class="fh-fact-v">{{ L.floor ?? '?' }}</span><span class="fh-fact-n">{{ L.build_year ? 'built ' + L.build_year : '\u00a0' }}</span></div>
            <div class="fh-fact"><span class="fh-fact-l">Contract</span>
              <span class="fh-fact-v">{{ L.contract_type ? L.contract_type.replace('_', '-') : '?' }}</span><span class="fh-fact-n">{{ L.contract_end ? 'until ' + L.contract_end : '\u00a0' }}</span></div>
            <div class="fh-fact"><span class="fh-fact-l">Move in</span>
              <span class="fh-fact-v">{{ L.available_from ?? '?' }}</span><span class="fh-fact-n">&nbsp;</span></div>
          </div>
          <div class="fh-feats">
            @for (f of features(L); track f.label) {
              <span class="fh-feat" [class.yes]="f.v === true" [class.no]="f.v === false">{{ f.v === true ? '✓' : f.v === false ? '✕' : '?' }} {{ f.label }}</span>
            }
          </div>
          @if (L.description_excerpt) { <p class="fh-desc-text">{{ L.description_excerpt }}</p> }
        </section>

        @if (L.lat != null && L.lon != null) {
          <fh-house-map [lat]="L.lat" [lon]="L.lon" [shortId]="L.short_id" [loc]="loc()" [outside]="outside()" />
        }
        @if (loc(); as l) {
          <div class="row g-3">
            <div class="col-xl-6"><fh-house-home [loc]="l" [transit]="travel.results()[l.listing.short_id] ?? null" /></div>
            <div class="col-xl-6"><fh-house-zone [loc]="l" /></div>
          </div>
          <fh-house-travel [loc]="l" [collapsed]="true" /><fh-house-transit [loc]="l" [collapsed]="true" />
        } @else if (locError() && !outside()) {
          <div class="fh-hcard"><div class="fh-hnote">House analysis not available: {{ locError() }}</div></div>
        } @else if (!locError()) {
          <div class="fh-hcard"><div class="fh-hnote">Measuring the home from its address… (a few seconds the first time)</div></div>
        }

        <div class="card mb-3"><div class="card-body">
          <div class="d-flex align-items-center gap-2 mb-2">
            <h2 class="h6 m-0">Commute</h2><fh-info id="listing.commute" />
            <button class="btn btn-sm btn-outline-secondary" (click)="commute(true)">Dry run</button>
            <button class="btn btn-sm btn-outline-primary" [disabled]="commuteBusy()" (click)="computeCommute(x.listing)">Compute</button>
          </div>
          @if (commuteAsk(); as a) {
            <div class="alert alert-warning py-2 small mb-2">
              This home is outside the analysed zones, so there is no free estimate: computing its commute asks
              <b>{{ a.calls }} ResRobot call{{ a.calls === 1 ? '' : 's' }}</b> ({{ a.requests }} requests, {{ a.cached }} cached{{ a.estimated ? ', ' + a.estimated + ' estimated' : '' }}).
              <div class="d-flex gap-2 mt-2">
                <button class="btn btn-sm btn-warning" (click)="commuteAsk.set(null); commute(false)">Proceed ({{ a.calls }} call{{ a.calls === 1 ? '' : 's' }})</button>
                <button class="btn btn-sm btn-outline-secondary" (click)="commuteAsk.set(null); info.set('')">Cancel</button>
              </div>
            </div>
          }
          @if (!x.commute.length) { <div class="small text-body-secondary">Not computed for this config yet.</div> }
          @else {
            <div class="table-responsive"><table class="table table-sm small mb-0">
              <thead><tr><th>Point</th><th></th><th>Window</th><th>Day</th><th>Mode</th><th>Median</th><th>p90</th><th>Worst</th><th>Source</th></tr></thead>
              <tbody>
              @for (c of x.commute; track $index) {
                <tr>
                  <td>{{ c.point_id }}</td><td>{{ c.direction === 'to_point' ? '→' : '←' }}</td><td>{{ c.window_label }}</td>
                  <td>{{ c.day_type }}</td><td>{{ c.mode }}</td>
                  <td><b>{{ min(c.median_min) }}</b></td><td [class.text-warning]="spread(c)">{{ min(c.p90_min) }}</td><td>{{ min(c.worst_min) }}</td>
                  <td class="text-body-secondary">{{ c.provider === 'haversine' ? 'estimate' : c.provider }}</td>
                </tr>
              }
              </tbody>
            </table></div>
          }
        </div></div>

        @for (e of x.evaluations.slice(0, 1); track e.at) {
          <div class="card mb-3"><div class="card-body small">
            <h2 class="h6">Agent evaluation <span class="text-body-secondary">{{ e.at | date: 'short' }}</span></h2>
            <p>{{ e.summary }}</p>
            @if (e.pros.length) { <div>+ {{ e.pros.join(' · ') }}</div> }
            @if (e.cons.length) { <div>− {{ e.cons.join(' · ') }}</div> }
            @if (e.questions_for_landlord.length) { <div>? {{ e.questions_for_landlord.join(' · ') }}</div> }
          </div></div>
        }
      </div>

      <div class="col-lg-5">
        <div class="fh-hcard">
          <header><h2>Where</h2><span class="fh-hsub">{{ x.listing.area }}</span><fh-info id="listing.where" /></header>
          <fh-zone-minimap [lat]="x.listing.lat" [lon]="x.listing.lon" [zoneId]="x.listing.zone_id" [zoneName]="x.listing.zone_name" [height]="260"
            [interactive]="true" />
        </div>
        <section class="fh-hcard" [class.collapsed]="!scoreOpen()">
          <header><h2><button type="button" class="fh-hcard-tg" [attr.aria-expanded]="scoreOpen()" (click)="scoreOpen.set(!scoreOpen())">Score</button></h2>
            <fh-score-tip [total]="x.score?.total" [breakdown]="x.score?.breakdown" [rejected]="x.score?.rejected_by" />
            <fh-info id="score.total" />
          </header>
          @if (scoreOpen()) {
          @if (x.score_stale) { <div class="small text-warning">No score for the current config. <a href="" (click)="$event.preventDefault(); recompute()">Recompute</a></div> }
          @if (x.score?.rejected_by?.length) { <div class="small text-danger">Rejected by: {{ x.score!.rejected_by.join(', ') }}</div> }
          @for (g of breakdown(); track g.name) {
            <div class="d-flex small justify-content-between"><span>{{ g.name }} <span class="text-body-secondary">×{{ g.weight }}</span>
              <fh-info [id]="'score.' + g.name" [quiet]="true" [derivation]="g.detail ?? null" />
              @if (g.estimated) { <span class="fh-badge-est" title="Part of this value is estimated (Connectivity minutes): compute the transit routes to your points to make it exact">estimate</span> }</span>
              <span [title]="g.why" class="position-relative">{{ g.score == null ? 'n/a' : score(g.score) }}@if (g.estimated) { <i class="fh-est-dot inline"></i> }</span></div>
          }
          }
        </section>

        <div class="card mb-3"><div class="card-body">
          <div class="d-flex align-items-center gap-2 mb-2">
            <h2 class="h6 m-0">Pets</h2>
            <fh-pet-badge [status]="x.listing.pet_status" [source]="x.listing.pet_source" [evidence]="x.listing.pet_evidence" />
            <span class="small text-body-secondary">{{ x.listing.pet_source ? 'set by ' + petSource(x.listing.pet_source) : 'nobody has decided yet' }}</span>
          </div>
          @if (x.listing.pet_status === 'conflict') {
            <div class="small text-warning-emphasis mb-2">The sources disagree: your answer settles it.</div>
          }
          @if (x.listing.pet_evidence) { <div class="fh-quote mb-2" style="-webkit-line-clamp:4; max-width:none">“{{ x.listing.pet_evidence }}”</div> }
          <div class="d-flex flex-wrap gap-1 align-items-center">
            <span class="small text-body-secondary me-1">Your answer:</span>
            @for (p of petAnswers; track p) {
              <button class="btn btn-sm" [class]="x.listing.pet_source === 'user' && x.listing.pet_status === p ? 'btn-primary' : 'btn-outline-secondary'"
                      [disabled]="petBusy()" (click)="setPet(p)">{{ p }}</button>
            }
            @if (x.listing.pet_source === 'user') {
              <button class="btn btn-sm btn-link" [disabled]="petBusy()" (click)="setPet('unknown')" title="Forget your answer: the agent, the site and the rules decide again">clear</button>
            }
          </div>
          <input class="form-control form-control-sm mt-2" placeholder="note, e.g. what the landlord said (optional)" [(ngModel)]="petNote" title="Saved with the answer you click" />
        </div></div>

        <div class="card mb-3"><div class="card-body">
          <h2 class="h6">Feedback</h2>
          <div class="btn-group btn-group-sm mb-2">
            @for (p of polarities; track p) {
              <button class="btn" [class.btn-primary]="polarity === p" [class.btn-outline-secondary]="polarity !== p" (click)="polarity = p">{{ p }}</button>
            }
          </div>
          <div>
            @for (t of (polarity === 'dislike' ? tags.negative() : tags.positive()); track t.key) {
              <button class="btn btn-sm me-1 mb-1" [class.btn-primary]="picked.has(t.key)" [class.btn-outline-secondary]="!picked.has(t.key)" (click)="toggle(t.key)">{{ t.label }}</button>
            }
          </div>
          <textarea class="form-control form-control-sm mt-1" rows="2" placeholder="note" [(ngModel)]="note"></textarea>
          <button class="btn btn-sm btn-primary mt-2" (click)="sendFeedback()">Save feedback</button>
          @for (f of x.feedback; track f.at) {
            <div class="small mt-2">{{ f.polarity === 'like' ? '+' : f.polarity === 'dislike' ? '−' : '·' }} {{ f.tags.join(', ') }} {{ f.note }}
              <span class="text-body-secondary">{{ f.at | date: 'short' }}</span></div>
          }
        </div></div>

        <div class="card mb-3"><div class="card-body">
          <div class="d-flex align-items-center gap-2 mb-1"><h2 class="h6 m-0">Digest for agents</h2>
            <button class="btn btn-sm btn-outline-secondary" (click)="copy()">Copy</button></div>
          <pre class="fh-pre fh-mono">{{ digest() }}</pre>
        </div></div>

        <div class="card"><div class="card-body small">
          <h2 class="h6">Sources & timeline</h2>
          @if (x.listing.origin_site; as o) {
            <div class="d-flex align-items-center gap-2 mb-2">
              <fh-site-logo [slug]="o" size="md" />
              <div><div class="fw-semibold">{{ sites.name(o) }}</div><div class="text-body-secondary" style="font-size:0.74rem">first published here (origin)</div></div>
            </div>
          }
          @for (s of x.sources; track s.site_slug + s.external_id) {
            <div class="fh-src-row">
              <fh-site-logo [slug]="s.site_slug" />
              <span class="text-truncate">{{ sites.name(s.site_slug) }} ·
                @if (s.url) { <a [href]="s.url" target="_blank" rel="noopener" class="fh-mono">{{ s.external_id }} ↗</a> } @else { <span class="fh-mono">{{ s.external_id }}</span> }
                <span class="fh-chip fh-tone-muted ms-1">{{ s.source_method === 'agent_browser' ? 'browser' : s.source_method }}</span>
                @if (s.first_scan_run_id || s.scan_run_id) {
                  <a class="ms-1" style="font-size:0.74rem" [routerLink]="['/runs']" [queryParams]="{ scan: s.first_scan_run_id || s.scan_run_id }"
                     title="The scan run that found this source">run ↗</a>
                }</span>
              <span class="text-body-secondary text-end" style="font-size:0.74rem" [title]="'first seen ' + (s.first_seen_at | date: 'medium') + ', last seen ' + (s.last_seen_at | date: 'medium')">
                {{ s.first_seen_at | date: 'shortDate' }}{{ (s.last_seen_at | date: 'shortDate') !== (s.first_seen_at | date: 'shortDate') ? ' → ' + (s.last_seen_at | date: 'shortDate') : '' }}</span>
            </div>
          }
          <hr class="my-2" />
          @for (e of x.events; track e.at) {
            <div>{{ e.at | date: 'short' }} · {{ e.from_status ?? '∅' }} → {{ e.to_status }} ({{ e.actor }}) {{ e.note }}</div>
          }
        </div></div>
      </div>
    </div>
  }
  `,
})
export class DetailPage {
  readonly shortId = input.required<string>();
  private api = inject(ApiService);
  private router = inject(Router);
  private order = inject(CandidateOrderStore);
  /** Previous and next home of the candidates list, and this one's position in it. */
  protected nav = computed(() => this.order.around(this.shortId()));
  /** The score card shows only the total until opened. */
  protected scoreOpen = signal(false);
  protected tags = inject(TagsStore);
  protected sites = inject(SitesStore);
  protected petAnswers = ['yes', 'no', 'ask'] as const;
  protected petNote = '';
  protected petBusy = signal(false);
  protected petSource = petSourceLabel;
  protected d = signal<ListingDetail | null>(null);
  protected loc = signal<HouseLocation | null>(null);
  protected locError = signal('');
  /** The house analysis answered that the home is outside every mapped zone (the map still shows its position). */
  protected outside = computed(() => /outside every zone/.test(this.locError()));
  protected travel = inject(HouseTravelStore);
  protected values = inject(ValueScaleStore);
  /** The dry run's counts, waiting for "Proceed" (homes outside the analysed zones). */
  protected commuteAsk = signal<{ calls: number; requests: number; cached: number; estimated: number } | null>(null);
  protected commuteBusy = signal(false);
  protected digest = signal('');
  protected error = signal('');
  protected info = signal('');
  protected polarities = ['like', 'dislike', 'neutral'] as const;
  protected polarity: 'like' | 'dislike' | 'neutral' = 'like';
  protected picked = new Set<string>();
  protected note = '';
  protected kr = fmtKr; protected num = fmtNum; protected score = fmtScore; protected pet = petClass; protected color = scoreColor;
  protected breakdown = computed(() =>
    Object.entries(this.d()?.score?.breakdown ?? {}).map(([name, v]) => ({ name, ...v })));

  constructor() {
    // only the id drives a reload: load() reads other signals (loc), which must not re-trigger this effect
    effect(() => { const id = this.shortId(); untracked(() => this.load(id)); });
    this.values.load();
    this.sites.load();
  }

  load(id: string): void {
    this.order.ensure(id);
    this.commuteAsk.set(null);
    this.api.listing(id).subscribe({ next: (x) => { this.d.set(x); this.error.set(''); }, error: (e) => this.error.set(apiError(e)) });
    if (this.loc()?.listing.short_id !== id) { this.loc.set(null); this.locError.set(''); }
    this.api.listingLocation(id).subscribe({ next: (l) => this.loc.set(l), error: (e) => this.locError.set(apiError(e)) });
    this.api.digest(id, true).subscribe({ next: (t) => this.digest.set(t), error: () => {} });
  }
  /** Scans before the full-gallery fix kept 6 photos and no photo_count: the next browser scan fills them in. */
  galleryIncomplete(l: Listing): boolean { return l.photo_urls.length === 6 && l.attributes?.['photo_count'] == null; }
  protected perM2 = (l: Listing) => valueOf(l, 'rent_per_m2');
  /** Yes / no / unknown features, shown as ✓ / ✕ / ? chips. */
  protected features(l: Listing): { label: string; v: boolean | null }[] {
    return [{ label: 'lift', v: l.has_elevator ?? null }, { label: 'balcony', v: l.has_balcony ?? null },
      ...(l.has_sovalkov ? [{ label: 'sovalkov', v: true }] : [])];
  }

  /** j / k: next / previous home of the candidates list (not while typing, nor in the photo viewer). */
  @HostListener('document:keydown', ['$event'])
  onKey(ev: KeyboardEvent): void {
    const t = ev.target as HTMLElement;
    if (ev.metaKey || ev.ctrlKey || ev.altKey || ['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName) || document.querySelector('.fh-gal-viewer')) return;
    const to = ev.key === 'j' ? this.nav()?.next : ev.key === 'k' ? this.nav()?.prev : null;
    if (to) { ev.preventDefault(); this.router.navigate(['/candidates', to]); }
  }
  min(v: number | null): string { return v == null ? '–' : `${Math.round(v)}′`; }
  spread(c: CommuteRow): boolean { return (c.spread_min ?? 0) > 10; }
  toggle(k: string): void { this.picked.has(k) ? this.picked.delete(k) : this.picked.add(k); }

  setStatus(status: string): void {
    this.api.setStatus(this.shortId(), status).subscribe({
      next: (r) => { this.info.set(`${r.from} → ${r.to}`); this.load(this.shortId()); },
      error: (e) => this.error.set(apiError(e)),
    });
  }
  sendFeedback(): void {
    this.api.feedback(this.shortId(), this.polarity, [...this.picked], this.note || undefined).subscribe({
      next: () => { this.picked.clear(); this.note = ''; this.info.set('Feedback saved'); this.load(this.shortId()); },
      error: (e) => this.error.set(apiError(e)),
    });
  }
  /** Compute: a home outside the analysed zones first counts the calls (dry run) and asks before spending them. */
  computeCommute(l: Listing): void {
    if (l.zone_id || this.commuteAsk()) { this.commuteAsk.set(null); this.commute(false); return; }
    this.commuteBusy.set(true);
    this.info.set('Counting calls before computing (outside the analysed zones)…');
    this.api.computeCommute([this.shortId()], true).subscribe({
      next: (r) => {
        this.commuteBusy.set(false);
        const res: any = Object.values(r.results)[0] ?? {};
        if (res.error) { this.info.set(res.error); return; }
        this.info.set('');
        if (!res.calls) { this.commute(false); return; }                 // everything cached: nothing to ask
        this.commuteAsk.set({ calls: res.calls, requests: res.requests, cached: res.cached, estimated: res.estimated });
      },
      error: (e) => { this.commuteBusy.set(false); this.error.set(apiError(e)); },
    });
  }

  commute(dry: boolean): void {
    this.info.set(dry ? 'Counting calls…' : 'Computing commute…');
    this.api.computeCommute([this.shortId()], dry).subscribe({
      next: (r) => {
        const res = Object.values(r.results)[0] ?? {};
        this.info.set(res.error ? res.error : `${res.requests} requests · ${res.cached} cached · ${res.calls} ${dry ? 'would call' : 'calls'} · ${res.estimated} estimated`
          + (res.missing_coords?.length ? ` · no coordinates for ${res.missing_coords.join(', ')}` : ''));
        if (!dry) this.api.recompute([this.shortId()]).subscribe(() => this.load(this.shortId()));
      },
      error: (e) => this.error.set(apiError(e)),
    });
  }
  /** Your answer on the pets (wins over every other source); 'unknown' clears it. */
  setPet(status: 'yes' | 'no' | 'ask' | 'unknown'): void {
    this.petBusy.set(true);
    this.api.setPet(this.shortId(), status, this.petNote || undefined).subscribe({
      next: () => {
        this.petBusy.set(false);
        this.info.set(status === 'unknown' ? 'Your pet answer is cleared' : `Pets: ${status} (your answer)`);
        this.petNote = '';
        this.load(this.shortId());
      },
      error: (e) => { this.petBusy.set(false); this.error.set(apiError(e)); },
    });
  }
  recompute(): void { this.api.recompute([this.shortId()]).subscribe(() => this.load(this.shortId())); }
  copy(): void { navigator.clipboard?.writeText(this.digest()).then(() => this.info.set('Digest copied')); }
}
