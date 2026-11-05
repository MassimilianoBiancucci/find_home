import { Component, HostListener, computed, input, output } from '@angular/core';
import { Derivation, help } from '../help';

/** Contribution of each row and the weighted total, on the derivation's scale (0..1 or 0..100). */
export function contributions(d: Derivation): { name: string; input: string; score: number | null; weight: number; share: number | null; sub?: boolean }[] {
  // sub-rows detail the row above them (e.g. the points of the reach): shown, not added to the total
  const den = d.rows.reduce((a, r) => a + (r.score == null || r.sub ? 0 : r.weight), 0);
  return d.rows.map((r) => ({ ...r, share: r.score == null || r.sub || !den ? null : (r.score * r.weight) / den }));
}

/** The derivation table: input → score × weight → contribution, then the total. */
@Component({
  selector: 'fh-derivation',
  template: `
    @if (derivation(); as d) {
      <table class="table table-sm small mb-1 fh-deriv">
        <thead><tr><th>{{ d.label }}</th><th>Measured</th><th class="text-end">Score</th><th class="text-end">Weight</th><th class="text-end">Adds</th></tr></thead>
        <tbody>
          @for (r of rows(); track r.name) {
            <tr [class.text-body-secondary]="r.score == null || r.sub" [class.fh-deriv-sub]="r.sub">
              <td>{{ r.name }}</td><td>{{ r.input }}</td>
              <td class="text-end">{{ r.score == null ? 'n/a' : r.score.toFixed(2) }}</td>
              <td class="text-end">{{ r.weight }}</td>
              <td class="text-end">{{ r.share == null ? '–' : share(r.share) }}</td>
            </tr>
          }
        </tbody>
        <tfoot><tr><th colspan="4">Total</th><th class="text-end">{{ total(d) }}</th></tr></tfoot>
      </table>
      @if (d.note) { <div class="small text-body-secondary">{{ d.note }}</div> }
      <div class="small text-body-secondary">Rows without data (n/a) are left out and the other weights renormalise.</div>
    }`,
})
export class DerivationTable {
  readonly derivation = input<Derivation | null | undefined>(null);
  protected rows = computed(() => { const d = this.derivation(); return d ? contributions(d) : []; });
  /** Row scores are 0..1; on a 0-100 derivation the contributions and the total are shown in points. */
  protected share(v: number): string { return this.derivation()?.scale === 100 ? (100 * v).toFixed(1) : v.toFixed(2); }
  protected total(d: Derivation): string {
    if (d.total == null) return 'n/a';
    return d.scale === 100 ? d.total.toFixed(0) : d.total.toFixed(2);
  }
}

/** Inline "How is this calculated?" section: the help text, formula, config keys and the derivation. */
@Component({
  selector: 'fh-explain',
  imports: [DerivationTable],
  template: `
    @if (entry(); as e) {
      <details class="fh-explain">
        <summary>How is this calculated?</summary>
        <p class="small mb-1">{{ e.long ?? e.short }}</p>
        @if (e.formula) { <div class="fh-info-formula mb-1">{{ e.formula }}</div> }
        <fh-derivation [derivation]="derivation()" />
        @if (e.config?.length) { <div class="fh-info-config">@for (c of e.config; track c) { <code>{{ c }}</code> }</div> }
      </details>
    }`,
})
export class ExplainInline {
  readonly helpId = input.required<string>();
  readonly derivation = input<Derivation | null | undefined>(null);
  protected entry = computed(() => help(this.helpId()));
}

/** Large dialog with the same content as the inline section; opened from an ⓘ popover's "More…". */
@Component({
  selector: 'fh-explain-dialog',
  imports: [DerivationTable],
  template: `
    @if (entry(); as e) {
      <div class="fh-explain-backdrop" (click)="closed.emit()">
        <div class="fh-explain-dialog" role="dialog" aria-modal="true" [attr.aria-label]="e.title" (click)="$event.stopPropagation()">
          <div class="d-flex align-items-center mb-2">
            <h2 class="h6 m-0">{{ e.title }}</h2>
            <button type="button" class="btn-close ms-auto" aria-label="Close" (click)="closed.emit()"></button>
          </div>
          <p class="small">{{ e.short }}</p>
          @if (e.long) { <p class="small">{{ e.long }}</p> }
          @if (e.formula) { <div class="fh-info-formula mb-2">{{ e.formula }}</div> }
          <fh-derivation [derivation]="derivation()" />
          @if (e.config?.length) { <div class="small mt-2">Configured in:</div>
            <div class="fh-info-config">@for (c of e.config; track c) { <code>{{ c }}</code> }</div> }
          @if (e.guide) { <div class="small text-body-secondary mt-2">More in <code>{{ e.guide }}</code>.</div> }
          @if (e.engineer?.length) {
            <details class="fh-eng mt-2" open><summary class="small">For the developer</summary>
              <ul>@for (n of e.engineer; track $index) { <li>{{ n }}</li> }</ul></details>
          }
        </div>
      </div>
    }`,
})
export class ExplainDialog {
  readonly helpId = input.required<string>();
  readonly derivation = input<Derivation | null | undefined>(null);
  readonly closed = output<void>();
  protected entry = computed(() => help(this.helpId()));
  @HostListener('document:keydown.escape')
  onEsc(): void { this.closed.emit(); }
}
