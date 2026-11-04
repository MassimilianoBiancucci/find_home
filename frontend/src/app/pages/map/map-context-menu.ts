import { Component, HostListener, inject } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ContextMenuService } from './context-menu.service';

/** The floating right-click menu over the map; positioned at the click, closed by Esc or a click elsewhere. */
@Component({
  selector: 'fh-map-context-menu',
  imports: [DecimalPipe],
  template: `
  @if (menu.context(); as c) {
    <div class="fh-cm-backdrop" (click)="menu.close()" (contextmenu)="$event.preventDefault(); menu.close()"></div>
    <div class="fh-cm" role="menu" [style.left.px]="c.x" [style.top.px]="c.y">
      <div class="fh-cm-head">{{ c.zone?.name ?? 'Outside the zones' }}
        <span>{{ c.lat | number: '1.4-4' }}, {{ c.lon | number: '1.4-4' }}</span></div>
      @for (e of menu.entries(); track e.id) {
        <button type="button" role="menuitem" class="fh-cm-item" [disabled]="e.enabled && !e.enabled(c)" (click)="menu.run(e)">{{ e.label(c) }}</button>
      }
    </div>
  }`,
  styles: [`
    .fh-cm-backdrop { position: absolute; inset: 0; z-index: 4; }
    .fh-cm { position: absolute; z-index: 5; min-width: 200px; padding: 4px; border-radius: 8px; background: var(--fh-panel);
      border: 1px solid var(--bs-border-color); box-shadow: 0 8px 24px rgba(0, 0, 0, .35); font-size: .85rem; }
    .fh-cm-head { padding: 4px 8px 6px; font-weight: 600; border-bottom: 1px solid var(--bs-border-color); margin-bottom: 4px;
      span { display: block; font-weight: 400; font-size: .75rem; color: var(--bs-secondary-color); } }
    .fh-cm-item { display: block; width: 100%; text-align: left; border: 0; background: none; padding: 5px 8px; border-radius: 5px;
      color: inherit; &:hover:not(:disabled) { background: var(--fh-hover); } &:disabled { opacity: .45; } }
  `],
})
export class MapContextMenu {
  protected menu = inject(ContextMenuService);
  @HostListener('document:keydown.escape') onEsc(): void { this.menu.close(); }
}
