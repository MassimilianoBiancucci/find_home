import { Component, DestroyRef, TemplateRef, afterNextRender, inject, viewChild } from '@angular/core';
import { LayoutService } from '../../services/layout.service';

/** Placeholder mode until its sub-plan lands: says what it will do. */
@Component({
  selector: 'fh-pending-mode',
  template: `<ng-template #tpl><div class="small text-body-secondary">Coming in the enhance-map task.</div></ng-template>`,
})
export class PendingMode {
  private layout = inject(LayoutService);
  private tpl = viewChild.required<TemplateRef<unknown>>('tpl');

  constructor() {
    const destroy = inject(DestroyRef);
    afterNextRender(() => this.layout.register(destroy, [{ id: 'map-pending', title: 'Mode', tpl: this.tpl() }]));
  }
}
