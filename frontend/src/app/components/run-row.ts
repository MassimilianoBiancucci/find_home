import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ICON_PATHS, TimelineItem, fmtAgo } from '../run-format';
import { SiteLogo } from './site-logo';
import { StatusChip } from './status-chip';

/** One row of a runs timeline: kind icon on the rail, title, site logo, status, start + duration, counts, cost. */
@Component({
  selector: 'fh-run-row',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, SiteLogo, StatusChip],
  template: `
  @let it = item();
  <div class="fh-tl-row" [class.selected]="selected()" [class.child]="child()" [class]="'fh-tl-' + it.status" (click)="pick.emit(it)"
       tabindex="0" (keydown.enter)="pick.emit(it)">
    <span class="fh-tl-icon" [class]="'fh-tone-' + tone()"><svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="path()" /></svg></span>
    <div class="fh-tl-main">
      <div class="fh-tl-title">
        @if (it.site) { <fh-site-logo [slug]="it.site" size="sm" /> }
        <span class="fh-tl-name">{{ it.title }}</span>
        <fh-status-chip [status]="it.status" />
        @if (it.status === 'waiting') { <span class="fh-tl-note">waiting for you in VS Code</span> }
        @if (it.status === 'ended_no_handover') { <span class="fh-tl-note" title="The session ended without writing its handover summary">no handover</span> }
      </div>
      <div class="fh-tl-meta">
        <span [title]="it.started_at | date: 'medium'">{{ ago(it.started_at) }}</span>
        @if (it.duration) { <span>· {{ it.duration }}</span> }
        @if (it.sub) { <span class="text-truncate">· {{ it.sub }}</span> }
      </div>
    </div>
    <div class="fh-tl-side">
      @if (it.counts) { <span class="fh-tl-counts">{{ it.counts }}</span> }
      @if (it.cost || it.turns) { <span class="fh-tl-cost">{{ it.cost }}{{ it.cost && it.turns ? ' · ' : '' }}{{ it.turns ? it.turns + ' turns' : '' }}</span> }
      <ng-content />
      @if (it.children.length) {
        <button type="button" class="fh-tl-expand" [class.open]="expanded()" (click)="$event.stopPropagation(); toggle.emit(it)"
                [title]="expanded() ? 'Hide the runs it produced' : 'Show the runs it produced'">{{ it.children.length }} ▸</button>
      }
    </div>
  </div>`,
})
export class RunRow {
  readonly item = input.required<TimelineItem>();
  readonly selected = input(false);
  readonly expanded = input(false);
  readonly child = input(false);
  readonly pick = output<TimelineItem>();
  readonly toggle = output<TimelineItem>();
  protected ago = (iso: string) => fmtAgo(iso);
  protected path = () => ICON_PATHS[this.item().icon];
  protected tone = () => ({ script: 'cyan', browser: 'violet', job: 'info', onboarding: 'wait', evaluate: 'good', other: 'muted' } as const)[this.item().icon];
}
