import { Component, DestroyRef, ElementRef, HostListener, computed, inject, input, isDevMode, signal } from '@angular/core';
import { Derivation, help } from '../help';
import { ExplainDialog } from './explain';

/**
 * ⓘ button with a popover: title, short text, formula and the config keys behind a value. "More…" opens the
 * explanation dialog (long text and, when given, the derivation with the actual numbers).
 * Texts come from the help registry (help.ts); an unknown id renders nothing.
 */
@Component({
  selector: 'fh-info',
  imports: [ExplainDialog],
  template: `
    @if (entry(); as e) {
      <button type="button" class="fh-info-btn" [attr.aria-label]="'About: ' + e.title" [attr.aria-expanded]="open()"
        (click)="toggle($event)">ⓘ</button>
      @if (open()) {
        <div class="fh-info-pop" role="dialog" [style.top.px]="pos().top" [style.bottom.px]="pos().bottom" [style.left.px]="pos().left"
          [style.max-height.px]="pos().maxH" (click)="$event.stopPropagation()">
          <div class="fh-info-title">{{ e.title }}</div>
          <div class="fh-info-text">{{ e.short }}</div>
          @if (e.formula) { <div class="fh-info-formula">{{ e.formula }}</div> }
          @if (e.config?.length) {
            <div class="fh-info-config">@for (c of e.config; track c) { <code>{{ c }}</code> }</div>
          }
          @if (e.long || derivation() || e.engineer?.length) {
            <button type="button" class="btn btn-link btn-sm p-0 mt-1" (click)="more()">How is this calculated? →</button>
          }
        </div>
      }
      @if (dialog()) { <fh-explain-dialog [helpId]="id()" [derivation]="derivation()" (closed)="dialog.set(false)" /> }
    }`,
  host: { class: 'fh-info', '(click)': '$event.stopPropagation()' },
})
export class InfoButton {
  readonly id = input.required<string>();
  /** Optional numbers for the dialog. */
  readonly derivation = input<Derivation | null | undefined>(null);
  /** Do not warn about a missing entry (used by bubbles, where the ⓘ is optional). */
  readonly quiet = input(false);
  protected open = signal(false);
  protected dialog = signal(false);
  /** Below the button, or above it when there is more room there (an ⓘ near the bottom of the screen). */
  protected pos = signal<{ top: number | null; bottom: number | null; left: number; maxH: number }>({ top: 0, bottom: null, left: 0, maxH: 400 });
  private el = inject(ElementRef<HTMLElement>);
  protected entry = computed(() => {
    const e = help(this.id());
    if (!e && !this.quiet() && isDevMode()) console.warn(`fh-info: no help entry "${this.id()}" in help.ts`);
    return e;
  });

  protected toggle(ev: MouseEvent): void {
    ev.stopPropagation();
    if (this.open()) { this.open.set(false); return; }
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    const width = 320, vw = window.innerWidth, vh = window.innerHeight;
    const left = Math.max(8, Math.min(r.left - width / 2, vw - width - 8));
    const below = vh - r.bottom - 14, above = r.top - 14;
    const up = below < 260 && above > below;
    this.pos.set({ top: up ? null : r.bottom + 6, bottom: up ? vh - r.top + 6 : null, left, maxH: Math.max(120, up ? above : below) });
    this.open.set(true);
  }

  constructor() {
    // the page scrolls inside a box, not the window: close on any scroll outside the popover (capture phase)
    const onScroll = (ev: Event) => { if (this.open() && !(this.el.nativeElement as HTMLElement).contains(ev.target as Node)) this.open.set(false); };
    document.addEventListener('scroll', onScroll, true);
    inject(DestroyRef).onDestroy(() => document.removeEventListener('scroll', onScroll, true));
  }
  protected more(): void { this.open.set(false); this.dialog.set(true); }

  @HostListener('document:click', ['$event'])
  onDocClick(ev: Event): void { if (this.open() && !this.el.nativeElement.contains(ev.target as Node)) this.open.set(false); }
  @HostListener('document:keydown.escape')
  onEsc(): void { this.open.set(false); }
}
