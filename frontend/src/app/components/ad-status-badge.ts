import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { AdStatus } from '../models';

export const AD_STATUS_LABEL: Record<AdStatus, string> = {
  open: 'Open', applications_closed: 'Applications closed', rented: 'Let', removed: 'Removed', not_found: 'Not found',
  unknown: 'Not checked',
};

/** Whether an ad on one site can still be applied for: a glowing pill, the evidence and check time on hover. */
@Component({
  selector: 'fh-ad-status',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="fh-ad" [class]="'fh-ad fh-ad-' + (status() ?? 'unknown')" [title]="tip()">{{ label() }}</span>`,
})
export class AdStatusBadge {
  readonly status = input<AdStatus | null | undefined>('unknown');
  readonly site = input<string | null | undefined>(null);
  readonly checkedAt = input<string | null | undefined>(null);
  readonly evidence = input<Record<string, unknown> | null | undefined>(null);
  protected label = computed(() => AD_STATUS_LABEL[this.status() ?? 'unknown'] ?? this.status());
  protected tip = computed(() => {
    const ev = this.evidence() ?? {};
    const rule = ev['rule'] ? `${ev['rule']}${ev['value'] ? `: ${ev['value']}` : ''}` : '';
    return [`${this.site() ? this.site() + ': ' : ''}${this.label()}`, rule,
      this.checkedAt() ? `checked ${new Date(this.checkedAt()!).toLocaleString('sv-SE')}` : 'never checked']
      .filter(Boolean).join('\n');
  });
}
