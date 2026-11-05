import { Component, ElementRef, HostListener, computed, inject, input, isDevMode, signal } from '@angular/core';
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
        <div class="fh-info-pop" role="dialog" [style.top.px]="pos().top" [style.left.px]="pos().left" (click)="$event.stopPropagation()">
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
  protected pos = signal({ top: 0, left: 0 });
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
    const width = 320, vw = typeof window === 'undefined' ? 1024 : window.innerWidth;
    this.pos.set({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left - width / 2, vw - width - 8)) });
    this.open.set(true);
  }
  protected more(): void { this.open.set(false); this.dialog.set(true); }

  @HostListener('document:click', ['$event'])
  onDocClick(ev: Event): void { if (this.open() && !this.el.nativeElement.contains(ev.target as Node)) this.open.set(false); }
  @HostListener('document:keydown.escape')
  onEsc(): void { this.open.set(false); }
  @HostListener('window:scroll')
  onScroll(): void { this.open.set(false); }
}
