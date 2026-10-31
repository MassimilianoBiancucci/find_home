import { Component, DestroyRef, TemplateRef, afterNextRender, computed, inject, viewChild } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Router } from '@angular/router';
import { LayoutService } from '../../services/layout.service';
import { MapStateService } from './map-state.service';

export interface LayerToggle { id: string; label: string; swatch?: string; }

/** Explore mode: base layers on/off, legend, and an inspector for whatever is clicked. */
@Component({
  selector: 'fh-explore-mode',
  imports: [DecimalPipe],
  template: `
  <ng-template #layersTpl>
    @for (t of toggles; track t.id) {
      <label class="fh-row">
        <input type="checkbox" class="form-check-input" [checked]="state.isVisible(t.id)" (change)="state.setVisible(t.id, !state.isVisible(t.id))" />
        @if (t.swatch) { <span class="fh-swatch" [style.background]="t.swatch"></span> }
        <span class="fh-grow">{{ t.label }}</span>
      </label>
    }
  </ng-template>

  <ng-template #legendTpl>
    <div class="fh-row"><span class="fh-swatch" style="background:var(--fh-good)"></span> score ≥ .75</div>
    <div class="fh-row"><span class="fh-swatch" style="background:var(--fh-mid)"></span> score ≥ .5</div>
    <div class="fh-row"><span class="fh-swatch" style="background:var(--fh-bad)"></span> lower</div>
    <div class="fh-row"><span class="fh-swatch" style="background:#888"></span> unscored</div>
    <div class="fh-row"><span class="fh-swatch" style="background:#990ae3;border-color:#000"></span> your points (category colour)</div>
  </ng-template>

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
        <button class="btn btn-sm btn-primary mt-2" (click)="open(p['short_id'])">Open listing</button>
      }
      @case ('point') {
        @let p = sel()!.props;
        <h6 class="mb-1"><span class="fh-swatch me-1" [style.background]="p['color']"></span>{{ p['label'] }}</h6>
        <dl class="fh-kv"><dt>Category</dt><dd>{{ p['category'] }}</dd><dt>Weight</dt><dd>{{ p['weight'] }}</dd></dl>
        @if (p['notes']) { <p class="small text-body-secondary mt-2 mb-0">{{ p['notes'] }}</p> }
      }
      @default { <div class="fh-empty small">Click a listing or one of your points.</div> }
    }
  </ng-template>`,
})
export class ExploreMode {
  protected state = inject(MapStateService);
  private layout = inject(LayoutService);
  private router = inject(Router);
  private layersTpl = viewChild.required<TemplateRef<unknown>>('layersTpl');
  private legendTpl = viewChild.required<TemplateRef<unknown>>('legendTpl');
  private panelTpl = viewChild.required<TemplateRef<unknown>>('panelTpl');
  protected sel = computed(() => this.state.selection());
  protected toggles: LayerToggle[] = [
    { id: 'listings', label: 'Listings', swatch: '#1f9d55' },
    { id: 'listings-rejected', label: 'Rejected listings', swatch: '#e53e3e' },
    { id: 'points', label: 'Your points', swatch: '#990ae3' },
  ];

  constructor() {
    const destroy = inject(DestroyRef);
    afterNextRender(() => this.layout.register(destroy, [
      { id: 'map-layers', title: 'Layers', tpl: this.layersTpl() },
      { id: 'map-legend', title: 'Legend', tpl: this.legendTpl() },
    ], { title: 'Inspector', tpl: this.panelTpl() }));
  }

  protected open(id: string): void { this.router.navigate(['/candidates', id]); }
}
