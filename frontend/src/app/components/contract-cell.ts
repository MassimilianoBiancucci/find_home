import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Listing } from '../models';

const W = 300;
const mo = (n: number) => `${n} month${n === 1 ? '' : 's'}`;

/** How long a stay from `from` to `to` is, in words: "5 months", "6 weeks", "10 days". */
export function stayLength(from: string | null | undefined, to: string | null | undefined): string {
  if (!from || !to) return '';
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
  if (days < 0) return '';
  if (days < 21) return `${days} day${days === 1 ? '' : 's'}`;
  if (days < 61) return `${Math.round(days / 7)} weeks`;
  return mo(Math.round(days / 30.44));
}

/** A listing's contract terms as short lines (the ad's wording on hover), from attributes.contract_terms. */
export function contractLines(l: Listing): { label: string; raw?: string | null; tone?: 'bad' | 'good' }[] {
  const a = (l.attributes ?? {}) as Record<string, any>;     // eslint-disable-line @typescript-eslint/no-explicit-any
  const t = a['contract_terms'] ?? {};
  const ext = String(t.extension_raw ?? '').toLowerCase();
  return [
    t.short_term ? { label: 'Short-term contract', tone: 'bad' as const } : null,
    ext ? (ext.includes('false') ? { label: 'Cannot be extended', raw: t.extension_raw, tone: 'bad' as const }
      : ext.includes('true') ? { label: t.max_total_months ? `Can be extended, max ${mo(t.max_total_months)}` : 'Can be extended', raw: t.extension_raw, tone: 'good' as const }
      : { label: t.max_total_months ? `Extension, max ${mo(t.max_total_months)}` : 'Extension: see the wording', raw: t.extension_raw }) : null,
    t.guaranteed_months != null || t.guaranteed_raw ? { label: `Guaranteed ${t.guaranteed_months != null ? mo(t.guaranteed_months) : '(see the wording)'}`, raw: t.guaranteed_raw } : null,
    t.estimated_months != null || t.estimated_raw ? { label: `Estimated ${t.estimated_months != null ? mo(t.estimated_months) : '(see the wording)'}`, raw: t.estimated_raw } : null,
    t.notice_months != null || t.notice_raw ? { label: `Notice ${t.notice_months != null ? mo(t.notice_months) : '(see the wording)'}`, raw: t.notice_raw } : null,
    a['open_ended'] ? { label: 'Open-ended (until further notice)', tone: 'good' as const } : null,
  ].filter((x): x is { label: string; raw?: string | null; tone?: 'bad' | 'good' } => !!x);
}

/**
 * The Contract cell of the Candidates list: only the type (first-hand, second-hand), and an orange dot when the
 * contract ends on a set date. Hovering it shows the contract: type, fixed term or not, from → to and its length, and
 * the terms the ad states (extension, guaranteed months, notice …), with the ad's wording on each.
 */
@Component({
  selector: 'fh-contract-cell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe],
  template: `
  @let l = listing();
  <span class="fh-ct" tabindex="0" (mouseenter)="show()" (mouseleave)="pos.set(null)" (focus)="show()" (blur)="pos.set(null)"
    [attr.aria-label]="type() + (fixed() ? ', fixed term until ' + l.contract_end : '')">{{ type() }}@if (fixed()) {<i class="fh-ct-dot" aria-hidden="true"></i>}</span>
  @if (pos(); as p) {
    <div class="fh-ct-tip" role="tooltip" [style.left.px]="p.left" [style.top.px]="p.top">
      <div class="fh-ct-head">
        <span class="fh-chipf t-contract sel">{{ l.contract_type ? type() : 'type unknown' }}</span>
        @if (fixed()) { <span class="fh-ct-fixed">● Fixed term</span> } @else { <span class="fh-ct-open">no end date given</span> }
      </div>
      <div class="fh-ct-dates">
        <div><span>From</span><b>{{ start() ? (start()! | date: 'd MMM y') : '–' }}</b></div>
        <div class="fh-ct-arrow" aria-hidden="true">→</div>
        <div><span>To</span><b [class.fh-ct-end]="fixed()">{{ l.contract_end ? (l.contract_end | date: 'd MMM y') : 'open' }}</b></div>
        @if (length()) { <div class="fh-ct-len"><span>Length</span><b>{{ length() }}</b></div> }
      </div>
      @if (lines().length) {
        <ul class="fh-ct-terms">
          @for (t of lines(); track t.label) {
            <li [class]="'t-' + (t.tone ?? 'plain')"><b>{{ t.label }}</b>@if (t.raw) { <div class="fh-ct-raw">“{{ t.raw }}”</div> }</li>
          }
        </ul>
      }
      @if (fixed()) { <div class="fh-ct-note">You would have to move again when it ends: listed in the issues too.</div> }
    </div>
  }`,
  styles: [`
    :host { display: inline-flex; }
    .fh-ct { display: inline-flex; align-items: center; gap: 5px; cursor: help; white-space: nowrap; border-bottom: 1px dotted transparent; }
    .fh-ct:hover, .fh-ct:focus-visible { border-bottom-color: currentColor; outline: none; }
    .fh-ct-dot { width: 8px; height: 8px; border-radius: 50%; background: #ff9f1a; box-shadow: 0 0 0 2px rgba(255, 159, 26, .25), 0 0 7px #ff9f1a; }
    .fh-ct-tip { position: fixed; z-index: 2000; width: ${W}px; pointer-events: none; padding: 11px 13px; border-radius: 14px;
      text-align: left; white-space: normal; font-size: .78rem; line-height: 1.35; color: var(--bs-body-color); background: var(--bs-body-bg);
      border: 1px solid rgba(25, 184, 230, .55);
      box-shadow: 0 0 0 3px rgba(25, 184, 230, .13), 0 14px 34px -8px rgba(0, 0, 0, .55), 0 0 22px -8px rgba(25, 184, 230, .6);
      animation: fh-ct-in .14s ease-out; }
    @keyframes fh-ct-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
    .fh-ct-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .fh-ct-fixed { padding: 1px 9px; border-radius: 999px; font-size: .72rem; font-weight: 800; color: #fff;
      background: linear-gradient(135deg, #ffc46b 0%, #ff9f1a 50%, #f07b00 100%); box-shadow: 0 3px 10px -3px rgba(255, 159, 26, .8); }
    .fh-ct-open { font-size: .72rem; color: var(--bs-secondary-color); }
    .fh-ct-dates { display: flex; align-items: flex-end; gap: 8px; margin: 10px 0 2px; padding: 8px 10px; border-radius: 10px;
      background: color-mix(in srgb, var(--bs-secondary-color) 10%, transparent); }
    .fh-ct-dates > div:not(.fh-ct-arrow) { display: flex; flex-direction: column; }
    .fh-ct-dates span { font-size: .64rem; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--bs-secondary-color); }
    .fh-ct-dates b { font-size: .86rem; white-space: nowrap; }
    .fh-ct-dates b.fh-ct-end { color: #ff9f1a; }
    .fh-ct-arrow { color: var(--bs-secondary-color); padding-bottom: 1px; }
    .fh-ct-len { margin-left: auto; text-align: right; }
    .fh-ct-terms { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
    .fh-ct-terms li { padding-left: 14px; position: relative; }
    .fh-ct-terms li::before { content: ''; position: absolute; left: 2px; top: 6px; width: 6px; height: 6px; border-radius: 50%; background: #19b8e6; }
    .fh-ct-terms li.t-bad::before { background: #ff9f1a; } .fh-ct-terms li.t-good::before { background: #2fbf71; }
    .fh-ct-raw { color: var(--bs-secondary-color); font-size: .7rem; font-style: italic; overflow-wrap: anywhere; }
    .fh-ct-note { margin-top: 8px; color: var(--bs-secondary-color); font-size: .72rem; }
  `],
})
export class ContractCell {
  readonly listing = input.required<Listing>();
  private el = inject(ElementRef<HTMLElement>);
  protected pos = signal<{ left: number; top: number } | null>(null);
  protected type = computed(() => this.listing().contract_type?.replace('_', '-') ?? '');
  protected fixed = computed(() => !!this.listing().contract_end);
  /** The contract's start, else the move-in date. */
  protected start = computed(() => this.listing().contract_start ?? this.listing().available_from ?? null);
  protected length = computed(() => (this.fixed() ? stayLength(this.start(), this.listing().contract_end) : ''));
  protected lines = computed(() => contractLines(this.listing()));

  protected show(): void {
    const r = (this.el.nativeElement as HTMLElement).getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left - 20, window.innerWidth - W - 8));
    const below = r.bottom + 8, above = r.top - 8 - 240;
    this.pos.set({ left, top: below + 240 < window.innerHeight ? below : Math.max(8, above) });
  }
}
