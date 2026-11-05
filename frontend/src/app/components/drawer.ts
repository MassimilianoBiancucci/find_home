import { ChangeDetectionStrategy, Component, HostListener, input, output } from '@angular/core';

/** Right-side panel over the page (full width on phones). Esc or the backdrop closes it. */
@Component({
  selector: 'fh-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  @if (open()) {
    <div class="fh-drawer-backdrop" (click)="closed.emit()"></div>
    <aside class="fh-drawer" role="dialog" [attr.aria-label]="title()" [style.--fh-drawer-w]="width()">
      <header class="fh-drawer-head">
        <div class="fh-drawer-title"><ng-content select="[drawer-title]" />{{ title() }}</div>
        <button type="button" class="btn-close" aria-label="Close" (click)="closed.emit()"></button>
      </header>
      <div class="fh-drawer-body"><ng-content /></div>
    </aside>
  }`,
})
export class Drawer {
  readonly open = input(false);
  readonly title = input('');
  readonly width = input('600px');
  readonly closed = output<void>();
  @HostListener('document:keydown.escape') onEsc(): void { if (this.open()) this.closed.emit(); }
}
