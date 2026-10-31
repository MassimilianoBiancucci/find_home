import { Component, DestroyRef, TemplateRef, afterNextRender, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Router } from '@angular/router';
import { TransitLine } from '../../models';
import { ApiService } from '../../services/api.service';
import { LayoutService } from '../../services/layout.service';
import { blipUrl } from '../../components/map-icons';
import { MapStateService } from './map-state.service';
import { PoiLayersService } from './poi-layers.service';
import { TransitLayersService } from './transit-layers.service';
import { ProbeService } from './probe.service';
import { ProbePanel, SavedProbesList } from './probe-panel';

export interface LayerToggle { id: string; label: string; icon?: string; }

/** Explore mode: layers on/off (base + POI categories), legend, inspector for the clicked item and the test point. */
@Component({
  selector: 'fh-explore-mode',
  imports: [DecimalPipe, ProbePanel, SavedProbesList],
  template: `
  <ng-template #layersTpl>
    @for (t of toggles; track t.id) {
      <label class="fh-row">
        <input type="checkbox" class="form-check-input" [checked]="state.isVisible(t.id)" (change)="state.setVisible(t.id, !state.isVisible(t.id))" />
        @if (t.icon) { <img [src]="t.icon" width="20" height="20" alt="" /> }
        <span class="fh-grow">{{ t.label }}</span>
      </label>
    }
    <div class="fh-section mt-2">Places</div>
    @for (c of poi.categories(); track c.key) {
      <label class="fh-row" [class.text-body-secondary]="!c.fetched" [title]="c.fetched ? '' : 'not fetched yet: findhome geo fetch poi'">
        <input type="checkbox" class="form-check-input" [checked]="poi.isOn(c.key)" [disabled]="!c.fetched" (change)="poi.toggle(c.key)" />
        <img [src]="icon(c.icon, c.color)" width="20" height="20" alt="" />
        <span class="fh-grow">{{ c.label }}</span>
      </label>
    }
    @if (poi.error()) { <div class="small text-danger">{{ poi.error() }}</div> }
    <div class="fh-section mt-2">Transit</div>
    @if (transit.meta(); as m) {
      @if (!m.built) { <div class="small text-body-secondary">Not built yet: <code>findhome geo fetch transit</code></div> }
      @else {
        @for (t of m.modes; track t.mode) {
          <label class="fh-row">
            <input type="checkbox" class="form-check-input" [checked]="transit.isOn('transit-' + t.mode)" (change)="transit.toggle('transit-' + t.mode)" />
            <span class="fh-line" [style.background]="t.color"></span>
            <span class="fh-grow">{{ t.label }} <span class="text-body-secondary small">{{ t.count }}</span></span>
          </label>
        }
        <label class="fh-row">
          <input type="checkbox" class="form-check-input" [checked]="transit.isOn('transit-stations')" (change)="transit.toggle('transit-stations')" />
          <img [src]="icon('metro', '#0089ca')" width="20" height="20" alt="" />
          <span class="fh-grow">Stations <span class="text-body-secondary small">{{ m.stations }}</span></span>
        </label>
        <div class="small text-body-secondary">Source: {{ m.source === 'gtfs' ? 'SL GTFS (Trafiklab)' : 'OpenStreetMap routes' }}</div>
      }
    }
    @if (transit.error()) { <div class="small text-danger">{{ transit.error() }}</div> }
    <div class="fh-section mt-2">Commute</div>
    <label class="fh-row" title="Zones tinted by weighted commute minutes (Connectivity mode); hover a zone for its numbers">
      <input type="checkbox" class="form-check-input" [checked]="state.isVisible('connectivity-tint', false)" (change)="state.setVisible('connectivity-tint', !state.isVisible('connectivity-tint', false))" />
      <span class="fh-line" style="background:linear-gradient(90deg,#1f9d55,#d6c94a,#b0303a)"></span>
      <span class="fh-grow">Zone commute tint</span>
    </label>
  </ng-template>

  <ng-template #legendTpl>
    <div class="fh-row"><img [src]="icon('home', '#1f9d55')" width="20" alt="" /> listing, score ≥ .75</div>
    <div class="fh-row"><img [src]="icon('home', '#d69e2e')" width="20" alt="" /> score ≥ .5</div>
    <div class="fh-row"><img [src]="icon('home', '#e53e3e')" width="20" alt="" /> lower</div>
    <div class="fh-row"><img [src]="icon('home', '#888888')" width="20" alt="" /> unscored</div>
    <div class="fh-row"><img [src]="icon('target', '#b45cf0')" width="20" alt="" /> test point (right-click the map)</div>
    <div class="small text-body-secondary mt-1">Your points use their category icon and colour (Locations). Dashed lines: straight line to the nearest place you care about.</div>
  </ng-template>

  <ng-template #savedTpl><fh-saved-probes /></ng-template>

  <ng-template #panelTpl>
    @switch (sel()?.kind) {
      @case ('listing') {
        @let p = sel()!.props;
        <h6 class="mb-1">{{ p['short_id'] }} · {{ p['area'] ?? '' }}</h6>
        <dl class="fh-kv">
          <dt>Rent</dt><dd>{{ p['rent_sek'] ?? '?' }} kr</dd>
          <dt>Rooms</dt><dd>{{ p['rooms_rok'] ?? '?' }} rok</dd>
          <dt>Size</dt><dd>{{ p['size_m2'] ?? '?' }} m²</dd>
          <dt>Score</dt><dd>{{ p['score'] == null ? '–' : (p['score'] | number: '1.2-2') }}</dd>
          <dt>Pets</dt><dd>{{ p['pet_status'] }}</dd>
          <dt>Status</dt><dd>{{ p['status'] }}</dd>
        </dl>
        <div class="d-flex gap-2 mt-2">
          <button class="btn btn-sm btn-primary" (click)="open(p['short_id'])">Open listing</button>
          <button class="btn btn-sm btn-outline-secondary" (click)="probeAt(p['lat'], p['lon'])">Test point here</button>
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
          <button class="btn btn-sm btn-outline-secondary mt-2" (click)="probeAt(f.lngLat[1], f.lngLat[0])">Test point here</button>
        } @else if (f.kind === 'feature') {
          <h6 class="mb-1"><img [src]="icon(f.props['icon'], f.props['color'])" width="20" class="me-1" alt="" />{{ f.props['name'] ?? f.props['category_label'] }}</h6>
          <dl class="fh-kv">
            <dt>Type</dt><dd>{{ f.props['category_label'] }}</dd>
            @if (f.props['brand']) { <dt>Brand</dt><dd>{{ f.props['brand'] }}</dd> }
            @if (f.props['opening_hours']) { <dt>Hours</dt><dd>{{ f.props['opening_hours'] }}</dd> }
          </dl>
          <button class="btn btn-sm btn-outline-secondary mt-2" (click)="probeAt(f.lngLat[1], f.lngLat[0])">Test point here</button>
        }
      }
    }
    @if (sel()) { <hr class="my-3" /> }
    <fh-probe-panel />
  </ng-template>`,
  styles: [`
    .fh-line { display: inline-block; width: 18px; height: 4px; border-radius: 2px; box-shadow: 0 0 0 1px #0006; }
    .fh-ref { display: inline-block; min-width: 22px; padding: 0 5px; border-radius: 4px; color: #fff; font-weight: 700; font-size: .78rem;
      text-align: center; text-shadow: 0 1px 1px #0008; }
    .fh-stops { font-size: .82rem; padding-left: 1.4rem; margin: 0; columns: 2; }
  `],
})
export class ExploreMode {
  protected state = inject(MapStateService);
  protected poi = inject(PoiLayersService);
  protected transit = inject(TransitLayersService);
  private api = inject(ApiService);
  protected line = signal<TransitLine | null>(null);
  private probe = inject(ProbeService);
  private layout = inject(LayoutService);
  private router = inject(Router);
  private layersTpl = viewChild.required<TemplateRef<unknown>>('layersTpl');
  private legendTpl = viewChild.required<TemplateRef<unknown>>('legendTpl');
  private savedTpl = viewChild.required<TemplateRef<unknown>>('savedTpl');
  private panelTpl = viewChild.required<TemplateRef<unknown>>('panelTpl');
  protected sel = computed(() => this.state.selection());
  protected toggles: LayerToggle[] = [
    { id: 'listings', label: 'Listings', icon: blipUrl('home', '#1f9d55') },
    { id: 'listings-rejected', label: 'Rejected listings', icon: blipUrl('dot', '#e53e3e') },
    { id: 'points', label: 'Your points', icon: blipUrl('pin', '#990ae3') },
  ];

  constructor() {
    const destroy = inject(DestroyRef);
    effect(() => {
      const s = this.sel();
      untracked(() => {
        this.line.set(null);
        if (s?.kind === 'feature' && s.props['kind'] === 'line' && s.props['ref'])
          this.api.transitLine(s.props['mode'], s.props['ref']).subscribe({ next: (l) => this.line.set(l), error: () => {} });
      });
    });
    afterNextRender(() => this.layout.register(destroy, [
      { id: 'map-layers', title: 'Layers', tpl: this.layersTpl() },
      { id: 'map-legend', title: 'Legend', tpl: this.legendTpl() },
      { id: 'map-saved-probes', title: 'Test points (alpha)', tpl: this.savedTpl() },
    ], { title: 'Inspector', tpl: this.panelTpl() }));
  }

  protected icon(glyph: string | null | undefined, color: string | null | undefined): string { return blipUrl(glyph, color); }
  protected open(id: string): void { this.router.navigate(['/candidates', id]); }
  protected probeAt(lat: number, lon: number): void { this.probe.set(lat, lon); }
  protected stationLines(lines: Record<string, string[]>): { mode: string; label: string; color: string; refs: string[] }[] {
    const modes = this.transit.meta()?.modes ?? [];
    return Object.entries(lines ?? {}).map(([mode, refs]) => {
      const m = modes.find((x) => x.mode === mode);
      return { mode, label: m?.label ?? mode, color: m?.color ?? '#8a8aa0', refs };
    });
  }
}
