import { Component, inject, input } from '@angular/core';
import { LayoutService } from '../services/layout.service';

/** Collapsible "settings card" bubble of the left box; collapsed state persists per bubble id. */
@Component({
  selector: 'fh-bubble',
  template: `
    <section class="fh-bubble" [class.collapsed]="layout.isCollapsed(id())">
      <header (click)="layout.toggleBubble(id())">
        <span class="fh-bubble-title">{{ title() }}</span>
        @if (badge()) { <span class="fh-bubble-badge">{{ badge() }}</span> }
        <span class="fh-bubble-chev">▾</span>
      </header>
      @if (!layout.isCollapsed(id())) { <div class="fh-bubble-body"><ng-content /></div> }
    </section>`,
})
export class BubbleComponent {
  protected layout = inject(LayoutService);
  readonly id = input.required<string>();
  readonly title = input.required<string>();
  readonly badge = input<string | undefined>();
}
