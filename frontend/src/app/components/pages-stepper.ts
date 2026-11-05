import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';

/** 1…max number picker with − / + buttons (result pages for a browser scan, N for a job). */
@Component({
  selector: 'fh-pages-stepper',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="fh-stepper" [class.disabled]="disabled()" [title]="title()">
    <button type="button" [disabled]="disabled() || value() <= min()" (click)="set(value() - 1)" aria-label="fewer">−</button>
    <input type="number" [min]="min()" [max]="max()" [value]="value()" [disabled]="disabled()" (change)="set(+$any($event.target).value)" />
    <button type="button" [disabled]="disabled() || value() >= max()" (click)="set(value() + 1)" aria-label="more">+</button>
    @if (unit()) { <span class="fh-stepper-unit">{{ unit() }}</span> }
  </span>`,
})
export class PagesStepper {
  readonly value = model(1);
  readonly min = input(1);
  readonly max = input(20);
  readonly unit = input('pages');
  readonly title = input('');
  readonly disabled = input(false);
  set(v: number): void {
    const x = Math.round(Number.isFinite(v) ? v : this.min());
    this.value.set(Math.min(this.max(), Math.max(this.min(), x)));
  }
}
