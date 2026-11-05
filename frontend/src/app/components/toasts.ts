import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ToastService } from '../services/toast.service';

/** Renders ToastService notices (mounted once in app.html). */
@Component({
  selector: 'fh-toasts',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="fh-toasts" aria-live="polite">
    @for (t of svc.toasts(); track t.id) {
      <div class="fh-toast" [class]="'fh-tone-' + t.tone">
        <div class="fh-grow"><div class="fw-semibold">{{ t.text }}</div>@if (t.detail) { <div class="small opacity-75">{{ t.detail }}</div> }</div>
        <button type="button" class="btn-close btn-close-sm" aria-label="Dismiss" (click)="svc.dismiss(t.id)"></button>
      </div>
    }
  </div>`,
})
export class Toasts { protected svc = inject(ToastService); }
