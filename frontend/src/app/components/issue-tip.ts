import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, signal } from '@angular/core';
import { ISSUE_CLASS_LABEL, Issue } from '../issues';

/**
 * A listing's issues behind a warning trigger ("⚠ 3" badge in lists, "⚠" icon on the listing page). Hover, focus or
 * click shows the tape tooltip: a bright yellow panel in an animated yellow-black "police tape" border (still when
 * the system asks for reduced motion). Fixed-positioned, so table overflow never clips it.
 */
@Component({
  selector: 'fh-issue-tip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <button type="button" class="fh-issue-trigger" [class.fh-issue-icon]="mode() === 'icon'" [attr.aria-label]="aria()"
          [attr.aria-expanded]="open()" (mouseenter)="show()" (mouseleave)="hide()" (focus)="show()" (blur)="hide()"
          (click)="$event.stopPropagation(); open() ? hide() : show()">⚠@if (mode() === 'badge') {<span class="fh-issue-n">{{ issues().length }}</span>}</button>
  @if (open()) {
    <div class="fh-tape" role="tooltip" [style.top.px]="pos().top" [style.left.px]="pos().left">
      <div class="fh-tape-body">
        <div class="fh-tape-title">{{ issues().length }} issue{{ issues().length === 1 ? '' : 's' }}</div>
        <ul>
          @for (i of issues(); track i.code) {
            <li>
              <div class="fh-tape-row"><b>{{ i.label }}</b>
                @if (i.cls) { <span class="fh-tape-cls" [class.attn]="i.cls === 'attention'">{{ clsLabel[i.cls] }}</span> }</div>
              @if (i.detail) { <span class="fh-tape-detail">{{ i.detail }}</span> }
              @if (i.hint) { <div class="fh-tape-hint">{{ i.hint }}</div> }</li>
          }
        </ul>
      </div>
    </div>
  }`,
  host: { class: 'fh-issue-host' },
})
export class IssueTip {
  readonly issues = input<Issue[]>([]);
  readonly mode = input<'badge' | 'icon'>('badge');
  protected clsLabel = ISSUE_CLASS_LABEL;
  protected open = signal(false);
  protected pos = signal({ top: 0, left: 0 });
  protected aria = computed(() => `${this.issues().length} issues: ${this.issues().map((i) => i.label).join(', ')}`);
  private el = inject(ElementRef<HTMLElement>);

  protected show(): void {
    const r = (this.el.nativeElement as HTMLElement).getBoundingClientRect();
    const w = 320, vw = window.innerWidth, vh = window.innerHeight;
    const left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, vw - w - 8));
    const top = r.bottom + 220 > vh && r.top > vh / 2 ? Math.max(8, r.top - 8 - Math.min(260, 40 + 34 * this.issues().length)) : r.bottom + 6;
    this.pos.set({ top, left });
    this.open.set(true);
  }
  protected hide(): void { this.open.set(false); }
}
