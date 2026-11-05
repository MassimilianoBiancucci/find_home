import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { fmtKr, fmtNum, fmtScore, petClass, scoreColor } from '../format';
import { GalleryComponent } from '../components/gallery';
import { InfoButton } from '../components/info';
import { HouseHome, HouseTravel, HouseZone } from '../house/house-bubbles';
import { HouseTravelStore } from '../house/house-travel.store';
import { CommuteRow, HouseLocation, Listing, ListingDetail } from '../models';
import { ApiService, apiError } from '../services/api.service';
import { TagsStore } from '../services/tags.store';

@Component({
  selector: 'fh-detail',
  imports: [FormsModule, RouterLink, DatePipe, GalleryComponent, InfoButton, HouseHome, HouseZone, HouseTravel],
  template: `
  <div class="fh-page-head">
    <a routerLink="/candidates" class="btn btn-sm btn-outline-secondary">← Candidates</a>
    <h1 class="fh-mono">{{ shortId() }}</h1>
    @if (d(); as x) {
      <span class="badge" [class]="pet(x.listing.pet_status)">pets {{ x.listing.pet_status }}</span>
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
          [incomplete]="galleryIncomplete(x.listing)" />
        @if (loc(); as l) {
          <div class="row g-3">
            <div class="col-xl-6"><fh-house-home [loc]="l" [transit]="travel.results()[l.listing.short_id] ?? null" /></div>
            <div class="col-xl-6"><fh-house-zone [loc]="l" /></div>
          </div>
          <fh-house-travel [loc]="l" />
        } @else if (locError()) {
          <div class="fh-hcard"><div class="fh-hnote">House analysis not available: {{ locError() }}</div></div>
        } @else {
          <div class="fh-hcard"><div class="fh-hnote">Measuring the home from its address… (a few seconds the first time)</div></div>
        }
        <div class="card mb-3"><div class="card-body">
          <h2 class="h6">{{ x.listing.title || x.listing.address_raw }}</h2>
          <div class="mb-2">{{ x.listing.area }} · {{ x.listing.address_raw }}</div>
          <div class="d-flex flex-wrap gap-3 small">
            <span><b>{{ kr(x.listing.rent_sek) }}</b>/month</span>
            <span>{{ num(x.listing.rooms_rok) }} rok{{ x.listing.has_sovalkov ? ' + sovalkov' : '' }}</span>
            <span>{{ num(x.listing.size_m2, ' m²') }}</span>
            <span>floor {{ x.listing.floor ?? '?' }}{{ x.listing.has_elevator ? ', lift' : '' }}{{ x.listing.has_balcony ? ', balcony' : '' }}</span>
            <span>{{ x.listing.contract_type ?? 'contract ?' }}{{ x.listing.contract_end ? ' → ' + x.listing.contract_end : '' }}</span>
            @if (x.listing.available_from) { <span>from {{ x.listing.available_from }}</span> }
          </div>
          @if (x.listing.pet_evidence) { <div class="small mt-2">Pets: “{{ x.listing.pet_evidence }}”</div> }
          @if (x.listing.description_excerpt) { <p class="small text-body-secondary mt-2 mb-0">{{ x.listing.description_excerpt }}</p> }
        </div></div>

        <div class="card mb-3"><div class="card-body">
          <div class="d-flex align-items-center gap-2 mb-2">
            <h2 class="h6 m-0">Commute</h2><fh-info id="listing.commute" />
            <button class="btn btn-sm btn-outline-secondary" (click)="commute(true)">Dry run</button>
            <button class="btn btn-sm btn-outline-primary" (click)="commute(false)">Compute</button>
          </div>
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
        <div class="card mb-3"><div class="card-body">
          <h2 class="h6">Score
            @if (x.score?.total != null) { <span [style.color]="color(x.score?.total)">{{ score(x.score?.total) }}</span> }
            <fh-info id="score.total" />
          </h2>
          @if (x.score_stale) { <div class="small text-warning">No score for the current config. <a href="" (click)="$event.preventDefault(); recompute()">Recompute</a></div> }
          @if (x.score?.rejected_by?.length) { <div class="small text-danger">Rejected by: {{ x.score!.rejected_by.join(', ') }}</div> }
          @for (g of breakdown(); track g.name) {
            <div class="d-flex small justify-content-between"><span>{{ g.name }} <span class="text-body-secondary">×{{ g.weight }}</span> <fh-info [id]="'score.' + g.name" [quiet]="true" /></span>
              <span [title]="g.why">{{ g.score == null ? 'n/a' : score(g.score) }}</span></div>
          }
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
          @for (s of x.sources; track s.site_slug + s.external_id) {
            <div>{{ s.site_slug }} · <a [href]="s.url" target="_blank" rel="noopener">{{ s.external_id }}</a> · {{ s.source_method }}</div>
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
  protected tags = inject(TagsStore);
  protected d = signal<ListingDetail | null>(null);
  protected loc = signal<HouseLocation | null>(null);
  protected locError = signal('');
  protected travel = inject(HouseTravelStore);
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

  constructor() { effect(() => this.load(this.shortId())); }

  load(id: string): void {
    this.api.listing(id).subscribe({ next: (x) => { this.d.set(x); this.error.set(''); }, error: (e) => this.error.set(apiError(e)) });
    if (this.loc()?.listing.short_id !== id) { this.loc.set(null); this.locError.set(''); }
    this.api.listingLocation(id).subscribe({ next: (l) => this.loc.set(l), error: (e) => this.locError.set(apiError(e)) });
    this.api.digest(id, true).subscribe({ next: (t) => this.digest.set(t), error: () => {} });
  }
  /** Scans before the full-gallery fix kept 6 photos and no photo_count: the next browser scan fills them in. */
  galleryIncomplete(l: Listing): boolean { return l.photo_urls.length === 6 && l.attributes?.['photo_count'] == null; }
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
  recompute(): void { this.api.recompute([this.shortId()]).subscribe(() => this.load(this.shortId())); }
  copy(): void { navigator.clipboard?.writeText(this.digest()).then(() => this.info.set('Digest copied')); }
}
