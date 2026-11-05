import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, HostListener, inject, input, signal } from '@angular/core';
import { Tone } from '../run-format';

/**
 * Click-to-open popover for text that does not fit its slot (an error, a reason, notes). The trigger is a chip,
 * an ⓘ, an icon or a truncated text; it is a real button (focusable, Enter/Space), so it works by tap and keyboard,
 * not only on hover. Click outside, Esc or scrolling closes it. The body is the projected content.
 *
 *   <fh-popover kind="chip" tone="bad" label="Last scan failed" heading="Last scan error">{{ error }}</fh-popover>
 *   <fh-popover kind="text" [label]="reason" heading="Why the script is off">{{ reason }}</fh-popover>
 */
@Component({
  selector: 'fh-popover',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <button type="button" class="fh-pop-trigger" [class]="'fh-pop-' + kind() + (kind() === 'chip' ? ' fh-chip fh-tone-' + tone() : '')"
          [attr.aria-expanded]="open()" [attr.aria-label]="ariaLabel() || heading() || label()" [title]="hint()" (click)="toggle($event)">
    @switch (kind()) {
      @case ('info') { ⓘ }
      @case ('icon') { {{ label() }} }
      @case ('chip') { <span class="fh-pop-dot"></span>{{ label() }} }
      @default { <span class="fh-pop-text">{{ label() }}</span> }
    }
  </button>
  @if (open()) {
    <div class="fh-info-pop fh-pop" role="dialog" [attr.aria-label]="heading() || label()" [style.top.px]="pos().top" [style.bottom.px]="pos().bottom" [style.left.px]="pos().left"
         [style.width.px]="width()" (click)="$event.stopPropagation()">
      @if (heading()) { <div class="fh-info-title">{{ heading() }}</div> }
      <div class="fh-info-text fh-pop-body"><ng-content /></div>
    </div>
  }`,
  host: { class: 'fh-pop-host', '(click)': '$event.stopPropagation()' },
})
export class Popover {
  readonly label = input('');
  readonly heading = input('');
  readonly kind = input<'chip' | 'info' | 'icon' | 'text'>('info');
  readonly tone = input<Tone>('bad');
  readonly ariaLabel = input('');
  readonly hint = input('Click for the full text');
  readonly width = input(340);
  protected open = signal(false);
  protected pos = signal<{ top: number | null; bottom: number | null; left: number }>({ top: 0, bottom: null, left: 0 });
  private el = inject(ElementRef<HTMLElement>);

  constructor() {
    // the page scrolls inside a box, not the window: close on any scroll (capture phase)
    const onScroll = (ev: Event) => { if (this.open() && !(this.el.nativeElement as HTMLElement).contains(ev.target as Node)) this.open.set(false); };
    document.addEventListener('scroll', onScroll, true);
    inject(DestroyRef).onDestroy(() => document.removeEventListener('scroll', onScroll, true));
  }

  protected toggle(ev: MouseEvent): void {
    ev.stopPropagation();
    if (this.open()) { this.open.set(false); return; }
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    const w = Math.min(this.width(), window.innerWidth - 16), vh = window.innerHeight;
    const left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 8));
    const above = r.bottom + 220 > vh && r.top > vh / 2;          // near the bottom: open upwards
    this.pos.set({ top: above ? null : r.bottom + 6, bottom: above ? vh - r.top + 6 : null, left });
    this.open.set(true);
  }

  @HostListener('document:click', ['$event'])
  onDocClick(ev: Event): void { if (this.open() && !this.el.nativeElement.contains(ev.target as Node)) this.open.set(false); }
  @HostListener('document:keydown.escape')
  onEsc(): void { this.open.set(false); }
}
