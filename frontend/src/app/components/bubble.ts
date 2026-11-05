import { Component, computed, inject, input } from '@angular/core';
import { LayoutService } from '../services/layout.service';
import { InfoButton } from './info';

/**
 * Collapsible "settings card" bubble of the left box; collapsed state persists per bubble id.
 * The corner ⓘ shows the help entry `info` (default `bubble.<id>`, shown only when the registry has it).
 */
@Component({
  selector: 'fh-bubble',
  imports: [InfoButton],
  template: `
    <section class="fh-bubble" [class.collapsed]="layout.isCollapsed(id())">
      <header (click)="layout.toggleBubble(id())">
        <span class="fh-bubble-title">{{ title() }}</span>
        @if (badge()) { <span class="fh-bubble-badge">{{ badge() }}</span> }
        <fh-info class="fh-bubble-info" [id]="helpId()" [quiet]="!info()" />
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
  readonly info = input<string | undefined>();
  protected helpId = computed(() => this.info() ?? `bubble.${this.id()}`);
}
