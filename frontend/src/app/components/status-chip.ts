import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Tone, isLive, statusLabel, statusTone } from '../run-format';

/** A status pill coloured from the --fh-* tokens; running and waiting pulse. */
@Component({
  selector: 'fh-status-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="fh-chip" [class]="'fh-tone-' + toneOf()" [class.fh-chip-live]="live()" [title]="title() ?? ''">
    @if (live()) { <i class="fh-chip-dot"></i> }{{ label() ?? text() }}</span>`,
})
export class StatusChip {
  readonly status = input.required<string | null | undefined>();
  readonly label = input<string | null>(null);
  readonly title = input<string | null>(null);
  readonly tone = input<Tone | null>(null);
  protected toneOf = computed(() => this.tone() ?? statusTone(this.status()));
  protected live = computed(() => isLive(this.status()));
  protected text = computed(() => statusLabel(this.status()));
}
