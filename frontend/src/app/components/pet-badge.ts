import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { petClass, petSourceLabel, petSourceMark } from '../format';

/** Pet status badge with a small mark of who set it (U you · A agent · S site · K rules) and the evidence on hover. */
@Component({
  selector: 'fh-pet-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="badge fh-pet" [class]="cls()" [title]="tip()">{{ prefix() }}{{ status() ?? 'unknown' }}@if (mark()) {<span class="fh-pet-src">{{ mark() }}</span>}</span>`,
})
export class PetBadge {
  readonly status = input<string | null | undefined>('unknown');
  readonly source = input<string | null | undefined>(null);
  readonly evidence = input<string | null | undefined>(null);
  readonly prefix = input('');
  protected cls = computed(() => petClass(this.status() ?? 'unknown'));
  protected mark = computed(() => petSourceMark(this.source()));
  protected tip = computed(() => {
    const st = this.status() ?? 'unknown';
    const head = st === 'conflict' ? 'Conflict: the sources disagree, check it yourself' : `Pets: ${st}`;
    return [head + (this.source() ? ` · set by ${petSourceLabel(this.source())}` : ''), this.evidence() ? `“${this.evidence()}”` : '']
      .filter(Boolean).join('\n');
  });
}
