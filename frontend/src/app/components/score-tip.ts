import { Component, computed, input, signal } from '@angular/core';
import { fmtScore, scoreColor } from '../format';
import { ScorePart } from '../models';
import { ExplainDialog } from './explain';
import { Derivation } from '../help';

/** Rows of a score breakdown: each group with its score, weight, share of the total and reason. */
export function scoreRows(breakdown: Record<string, ScorePart> | null | undefined) {
  const parts = Object.entries(breakdown ?? {}).map(([name, p]) => ({ name, ...p }));
  const den = parts.reduce((a, p) => a + (p.score == null ? 0 : p.weight), 0);
  return parts.map((p) => ({ ...p, share: p.score == null || !den ? null : (p.score * p.weight) / den }));
}

/**
 * A listing's total score with a hover card listing every score group (score, weight, contribution, reason) and
 * the hard filters that rejected it. Click opens the full explanation.
 */
@Component({
  selector: 'fh-score-tip',
  imports: [ExplainDialog],
  template: `
    <span class="fh-stip" tabindex="0" (mouseenter)="open($event)" (mouseleave)="show.set(false)" (focus)="open($event)" (blur)="show.set(false)"
      (click)="$event.stopPropagation(); dialog.set(true)">
      @if (rejected()?.length) { <span class="badge text-bg-danger">rejected</span> }
      @else { <strong [style.color]="colour(total())">{{ fmt(total()) }}</strong>
        @if (estimated().length) { <i class="fh-est-dot inline" [title]="'Partly estimated: ' + estimated().join(', ')"></i> } }
    </span>
    @if (show() && rows().length) {
      <div class="fh-info-pop fh-stip-pop" [style.top.px]="pos().top" [style.left.px]="pos().left">
        <div class="fh-info-title">Score {{ fmt(total()) }} <span class="text-body-secondary fw-normal">= Σ weight × group / Σ weight</span></div>
        @if (rejected()?.length) { <div class="text-danger small mb-1">Rejected by: {{ rejected()!.join(', ') }}</div> }
        <table class="fh-stip-table">
          @for (r of rows(); track r.name) {
            <tr [class.text-body-secondary]="r.score == null">
              <td>{{ r.name }}@if (r.estimated) { <i class="fh-est-dot inline" title="part of this value is estimated"></i> }</td><td class="text-end">{{ r.score == null ? 'n/a' : fmt(r.score) }}</td>
              <td class="text-end">×{{ r.weight }}</td><td class="text-end">{{ r.share == null ? '' : '+' + fmt(r.share) }}</td>
            </tr>
            <tr class="fh-stip-why"><td colspan="4">{{ r.why }}</td></tr>
          }
        </table>
        @if (estimated().length) { <div class="small mt-1" style="color:#ff9f40">● estimated: {{ estimated().join(', ') }} (Connectivity minutes, not a ResRobot trip from this home)</div> }
        <div class="small text-body-secondary mt-1">Click for details · weights in config/profile.yaml</div>
      </div>
    }
    @if (dialog()) { <fh-explain-dialog helpId="score.total" [derivation]="derivation()" (closed)="dialog.set(false)" /> }`,
  host: { class: 'fh-stip-host' },
})
export class ScoreTip {
  readonly total = input<number | null | undefined>(null);
  readonly breakdown = input<Record<string, ScorePart> | null | undefined>(null);
  readonly rejected = input<string[] | null | undefined>(null);
  protected show = signal(false);
  protected dialog = signal(false);
  protected pos = signal({ top: 0, left: 0 });
  protected rows = computed(() => scoreRows(this.breakdown()));
  /** Groups whose value uses an approximation (the orange dot). */
  protected estimated = computed(() => this.rows().filter((r) => r.estimated && r.score != null).map((r) => r.name));
  protected fmt = fmtScore;
  protected colour = scoreColor;
  protected derivation = computed<Derivation>(() => ({
    label: 'Score group', total: this.total() ?? null,
    rows: this.rows().map((r) => ({ name: r.name + (r.estimated ? ' (estimate)' : ''), input: r.why, score: r.score, weight: r.weight })),
    note: this.rejected()?.length ? `Rejected by the hard filters: ${this.rejected()!.join(', ')}` : undefined,
  }));

  protected open(ev: Event): void {
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    const vw = typeof window === 'undefined' ? 1024 : window.innerWidth, vh = typeof window === 'undefined' ? 768 : window.innerHeight;
    const top = r.bottom + 6 + 320 > vh ? Math.max(8, r.top - 326) : r.bottom + 6;
    this.pos.set({ top, left: Math.max(8, Math.min(r.left, vw - 340)) });
    this.show.set(true);
  }
}
