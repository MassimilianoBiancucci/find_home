import { Component, DestroyRef, TemplateRef, afterNextRender, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Listing, ListingDetail, TransitLine } from '../../models';
import { ScoreTip } from '../../components/score-tip';
import { GalleryComponent } from '../../components/gallery';
import { ApiService } from '../../services/api.service';
import { LayoutService } from '../../services/layout.service';
import { blipUrl, houseUrl } from '../../components/map-icons';
import { MapStateService } from './map-state.service';
import { TransitLayersService } from './transit-layers.service';
import { ListingCard as ListingCardView } from '../../components/listing-card';
import { ValueScaleStore } from '../../value-scale';
import { SitesStore } from '../../services/sites.store';
import { CandidateFilters, CandidateFiltersStore, applyAll } from '../candidate-filters';
import { ExploreColour, ExploreFilters, ExploreHeatService, ExploreSettings } from './explore-heat';
import { ZoneFillService } from './zone-fill.service';

/** What the listing panel shows from the fetched listing: photos and the score breakdown. */
type ListingCard = Pick<Listing, 'photo_urls' | 'floorplan_urls' | 'canonical_url'> & { score: ListingDetail['score'] };

/** Explore mode: the listing filters shared with Candidates drive the house markers; legend, heatmaps (the layers are
 *  the shell's drawer under the map); a house's
 *  card on hover, pinned in the Inspector on click. */
@Component({
  selector: 'fh-explore-mode',
  imports: [GalleryComponent, ScoreTip, ExploreColour, ExploreFilters, ExploreSettings, ListingCardView, CandidateFilters],
  template: `
  <ng-template #legendTpl>
    <div class="fh-row"><img [src]="house('#1f9d55')" width="22" alt="" /> listing, score ≥ .75</div>
    <div class="fh-row"><img [src]="house('#d69e2e')" width="22" alt="" /> score ≥ .5</div>
    <div class="fh-row"><img [src]="house('#e53e3e')" width="22" alt="" /> lower</div>
    <div class="fh-row"><img [src]="house('#888888')" width="22" alt="" /> unscored</div>
    <div class="small text-body-secondary mt-1">Glowing: still <b>new</b> (until you change its status) with the ad open; the others have no light.</div>
    <div class="small text-body-secondary mt-1">Hover a house for its card; click it to pin the card in the Inspector.</div>
    <div class="small text-body-secondary mt-1">Your points use their category icon and colour (Locations). Dashed lines: straight line to the nearest place you care about.</div>
  </ng-template>

  <ng-template #listFiltersTpl>
    <div class="d-flex flex-wrap gap-1 mb-2">
      <button type="button" class="fh-rej-toggle fh-closed-toggle" [class.on]="fs.hideClosed()" (click)="fs.hideClosed.update((v) => !v); loadRows()"
        [title]="fs.hideClosed() ? 'Homes whose ad is closed on every site are hidden: click to show them' : 'Closed ads are shown: click to hide them'">
        <span class="fh-rej-dot"></span>{{ fs.hideClosed() ? 'Closed hidden' : 'Hide closed' }}</button>
    </div>
    <fh-candidate-filters [count]="shown()" />
    <div class="small text-body-secondary mt-1">The same filters as the Candidates list: set them here or there. Rejected homes are a layer (Layers, under the map).</div>
  </ng-template>
  <ng-template #colourTpl><fh-explore-colour /></ng-template>
  <ng-template #filtersTpl><fh-explore-filters /></ng-template>
  <ng-template #heatSettingsTpl><fh-explore-settings /></ng-template>

  <ng-template #panelTpl>
    @switch (sel()?.kind) {
      @case ('listing') {
        @let p = sel()!.props;
        <div class="fh-ltip-pinned"><fh-listing-card [listing]="rowOf(p['short_id'])" /></div>
        @if (photos(); as ph) { <fh-gallery class="mt-2 d-block" [compact]="true" [photos]="ph.photo_urls" [plans]="ph.floorplan_urls" [link]="ph.canonical_url" />
          <div class="mt-2"><span class="small text-body-secondary me-1">Score</span>
            <fh-score-tip [total]="ph.score?.total ?? p['score']" [breakdown]="ph.score?.breakdown" [rejected]="ph.score?.rejected_by" /></div> }
        @let row = rowOf(p['short_id']);
        <div class="d-flex flex-wrap gap-2 mt-2">
          <button class="fh-btn-glow" (click)="open(p['short_id'])">Open listing</button>
          <button class="fh-btn-ghost" [disabled]="!row?.zone_id" (click)="zoneView(row!)"
            [title]="row?.zone_id ? 'The zone view focused on this home: its walks, routes and the zone around it' : 'Outside the analysed zones: no zone view'">⌖ Zone view</button>
          <button class="fh-btn-ghost" (click)="state.selection.set(null)">Unpin</button>
        </div>
      }
      @case ('point') {
        @let p = sel()!.props;
        <h6 class="mb-1"><img [src]="icon(p['icon'], p['color'])" width="20" class="me-1" alt="" />{{ p['label'] }}</h6>
        <dl class="fh-kv"><dt>Category</dt><dd>{{ p['category'] }}</dd><dt>Weight</dt><dd>{{ p['weight'] }}</dd></dl>
        @if (p['notes']) { <p class="small text-body-secondary mt-2 mb-0">{{ p['notes'] }}</p> }
      }
      @case ('feature') {
        @let f = sel()!;
        @if (f.kind === 'feature' && f.props['kind'] === 'line') {
          <h6 class="mb-1"><span class="fh-ref" [style.background]="f.props['colour']">{{ f.props['ref'] ?? '–' }}</span> {{ f.props['name'] }}</h6>
          @if (line(); as l) {
            <div class="small text-body-secondary mb-1">{{ l.length_km }} km · {{ l.stations.length }} stations</div>
            <ol class="fh-stops">@for (s of l.stations; track s) { <li>{{ s }}</li> }</ol>
          }
        } @else if (f.kind === 'feature' && f.props['kind'] === 'station') {
          <h6 class="mb-1"><img [src]="icon(f.props['icon'], f.props['color'])" width="20" class="me-1" alt="" />{{ f.props['name'] }}</h6>
          @for (entry of stationLines(f.props['lines']); track entry.mode) {
            <div class="d-flex flex-wrap gap-1 align-items-center small mb-1"><span class="text-body-secondary me-1">{{ entry.label }}</span>
              @for (r of entry.refs; track r) { <span class="fh-ref" [style.background]="entry.color">{{ r }}</span> }</div>
          }
        } @else if (f.kind === 'feature') {
          <h6 class="mb-1"><img [src]="icon(f.props['icon'], f.props['color'])" width="20" class="me-1" alt="" />{{ f.props['name'] ?? f.props['category_label'] }}</h6>
          <dl class="fh-kv">
            <dt>Type</dt><dd>{{ f.props['category_label'] }}</dd>
            @if (f.props['brand']) { <dt>Brand</dt><dd>{{ f.props['brand'] }}</dd> }
            @if (f.props['opening_hours']) { <dt>Hours</dt><dd>{{ f.props['opening_hours'] }}</dd> }
          </dl>
        }
      }
    }
    @if (!sel()) { <div class="small text-body-secondary">Hover a house for its card, click it to pin it here. Click a station, a line or a place for its details.</div> }
  </ng-template>
  <div class="fh-ltip" [class.off]="!hover()" [style.top.px]="hover()?.top ?? -1000" [style.left.px]="hover()?.left ?? -1000">
    <fh-listing-card [listing]="hover()?.row" />
  </div>`,
  styles: [`
    .fh-ref { display: inline-block; min-width: 22px; padding: 0 5px; border-radius: 4px; color: #fff; font-weight: 700; font-size: .78rem;
      text-align: center; text-shadow: 0 1px 1px #0008; }
    .fh-stops { font-size: .82rem; padding-left: 1.4rem; margin: 0; columns: 2; }
  `],
})
export class ExploreMode {
  protected state = inject(MapStateService);
  protected transit = inject(TransitLayersService);
  private api = inject(ApiService);
  protected line = signal<TransitLine | null>(null);
  /** Photos of the selected listing: the map features do not carry them, so they are fetched once per listing. */
  protected photos = signal<ListingCard | null>(null);
  private photoCache = new Map<string, ListingCard>();
  protected fs = inject(CandidateFiltersStore);
  /** The homes as the Candidates list loads them (lat/lon, score, rejected_by …), by short id, for the cards. */
  private rows = signal<Listing[]>([]);
  private byId = computed(() => new Map(this.rows().map((r) => [r.short_id, r])));
  /** The homes the shared filters keep: the markers. */
  private kept = computed(() => applyAll(this.rows(), this.fs.filters(), this.fs.cats()));
  protected shown = computed(() => this.kept().filter((r) => !r.rejected_by?.length).length);
  protected hover = signal<{ row: Listing; top: number; left: number } | null>(null);
  private hoverTimer: ReturnType<typeof setTimeout> | null = null;
  private layout = inject(LayoutService);
  private router = inject(Router);
  private legendTpl = viewChild.required<TemplateRef<unknown>>('legendTpl');
  private listFiltersTpl = viewChild.required<TemplateRef<unknown>>('listFiltersTpl');
  private colourTpl = viewChild.required<TemplateRef<unknown>>('colourTpl');
  private filtersTpl = viewChild.required<TemplateRef<unknown>>('filtersTpl');
  private heatSettingsTpl = viewChild.required<TemplateRef<unknown>>('heatSettingsTpl');
  protected heat = inject(ExploreHeatService);
  private fill = inject(ZoneFillService);
  private panelTpl = viewChild.required<TemplateRef<unknown>>('panelTpl');
  protected sel = computed(() => this.state.selection());

  constructor() {
    const destroy = inject(DestroyRef);
    effect(() => {
      const s = this.sel();
      untracked(() => {
        this.line.set(null);
        this.photos.set(null);
        if (s?.kind === 'listing' && s.props['short_id']) this.loadPhotos(String(s.props['short_id']));
        if (s?.kind === 'feature' && s.props['kind'] === 'line' && s.props['ref'])
          this.api.transitLine(s.props['mode'], s.props['ref']).subscribe({ next: (l) => this.line.set(l), error: () => {} });
      });
    });
    afterNextRender(() => this.layout.register(destroy, [
      { id: 'candidate-filters', title: 'Listing filters', tpl: this.listFiltersTpl() },
      { id: 'explore-colour', title: 'Colour zones by', tpl: this.colourTpl() },
      { id: 'explore-filters', title: 'Heatmap listing filters', tpl: this.filtersTpl() },
      { id: 'explore-heat-settings', title: 'Heatmap settings', tpl: this.heatSettingsTpl() },
      { id: 'map-legend', title: 'Legend', tpl: this.legendTpl() },
    ], { title: 'Inspector', tpl: this.panelTpl() }));
    // the zone heatmap: redraw after a style reload, drop it when leaving Explore
    effect(() => { if (this.state.styleReady() && this.heat.view()) untracked(() => this.heat.draw()); });
    destroy.onDestroy(() => this.fill.clear());
    // the markers: the homes the shared filters keep, redrawn on every filter change and after a style reload
    effect(() => {
      const kept = this.kept();
      if (this.state.styleReady()) untracked(() => this.state.setData('listings', toGeo(kept)));
    });
    this.loadRows();
    inject(ValueScaleStore).load();                 // the card's value colours
    inject(SitesStore).load();
    effect(() => { const map = this.state.map(); if (map) untracked(() => this.bindHover(map)); });
    destroy.onDestroy(() => {
      this.unbind?.();
      this.api.mapListings().subscribe({ next: (g) => this.state.setData('listings', g), error: () => {} });   // the other modes show every home
    });
    const view = inject(ActivatedRoute).snapshot.queryParamMap.get('view');
    if (view && view !== this.heat.view()) this.heat.setView(view);
  }

  protected icon(glyph: string | null | undefined, color: string | null | undefined): string { return blipUrl(glyph, color); }
  protected house = houseUrl;
  private loadPhotos(id: string): void {
    const hit = this.photoCache.get(id);
    if (hit) { this.photos.set(hit); return; }
    this.api.listing(id).subscribe({
      next: (d) => {
        const ph: ListingCard = { photo_urls: d.listing.photo_urls, floorplan_urls: d.listing.floorplan_urls, canonical_url: d.listing.canonical_url, score: d.score };
        this.photoCache.set(id, ph);
        if (this.sel()?.props['short_id'] === id) this.photos.set(ph);
      },
      error: () => {},
    });
  }
  protected open(id: string): void { this.router.navigate(['/candidates', id]); }
  /** The zone view focused on a home (/map/zone/:zone?listing=…): the home on top, with its walks and routes. */
  protected zoneView(l: Listing): void {
    if (l.zone_id) this.router.navigate(['/map/zone', l.zone_id], { queryParams: { listing: l.short_id } });
  }
  /** The homes the Candidates list would load (rejected ones too: they are their own layer), closed per the toggle. */
  loadRows(): void {
    this.api.listings({ closed: this.fs.hideClosed() ? 'exclude' : 'include' }).subscribe({
      next: (r) => { this.rows.set(r.items); this.fs.base.set(r.items.filter((l) => !l.rejected_by?.length)); },
      error: () => {},
    });
  }
  protected rowOf(id: string): Listing | null { return this.byId().get(id) ?? null; }

  private unbind: (() => void) | null = null;
  /** Hovering a house shows its card next to the pointer (the Candidates hover card). */
  private bindHover(map: import('maplibre-gl').Map): void {
    this.unbind?.();
    const move = (e: any) => {
      const id = e.features?.[0]?.properties?.['short_id'];
      const row = id ? this.byId().get(id) : null;
      if (!row) return;
      if (this.hover()?.row.short_id === row.short_id) return;
      if (this.hoverTimer) clearTimeout(this.hoverTimer);
      const x = e.originalEvent.clientX, y = e.originalEvent.clientY;
      this.hoverTimer = setTimeout(() => {
        const w = 380, h = 470, vw = window.innerWidth, vh = window.innerHeight;
        this.hover.set({ row, left: x + 24 + w < vw ? x + 24 : Math.max(8, x - w - 24), top: Math.max(8, Math.min(y - 60, vh - h - 8)) });
      }, 120);
    };
    const leave = () => { if (this.hoverTimer) clearTimeout(this.hoverTimer); this.hoverTimer = null; this.hover.set(null); };
    const layers = ['listings', 'listings-halo', 'listings-rejected'];
    for (const l of layers) { map.on('mousemove', l, move); map.on('mouseleave', l, leave); }
    map.on('click', leave);
    this.unbind = () => { for (const l of layers) { map.off('mousemove', l, move); map.off('mouseleave', l, leave); } map.off('click', leave); leave(); };
  }
  protected stationLines(lines: Record<string, string[]>): { mode: string; label: string; color: string; refs: string[] }[] {
    const modes = this.transit.meta()?.modes ?? [];
    return Object.entries(lines ?? {}).map(([mode, refs]) => {
      const m = modes.find((x) => x.mode === mode);
      return { mode, label: m?.label ?? mode, color: m?.color ?? '#8a8aa0', refs };
    });
  }
}

/** Listing rows as the map's listing features (the properties the marker layers read). */
export function toGeo(rows: Listing[]): { type: 'FeatureCollection'; features: unknown[] } {
  return { type: 'FeatureCollection', features: rows.filter((r) => r.lat != null && r.lon != null).map((r) => ({
    type: 'Feature', geometry: { type: 'Point', coordinates: [r.lon, r.lat] },
    properties: { short_id: r.short_id, status: r.status, ad_open: r.ad_open ?? true, rent_sek: r.rent_sek, rooms_rok: r.rooms_rok, size_m2: r.size_m2,
      pet_status: r.pet_status, area: r.area, score: r.score ?? null, rejected_by: r.rejected_by ?? [] },
  })) };
}
