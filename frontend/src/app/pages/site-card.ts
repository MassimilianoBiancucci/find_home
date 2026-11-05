import { ChangeDetectionStrategy, Component, OnChanges, computed, inject, input, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { LaunchButton } from '../components/launch-button';
import { PagesStepper } from '../components/pages-stepper';
import { Popover } from '../components/popover';
import { SiteLogo } from '../components/site-logo';
import { StatusChip } from '../components/status-chip';
import { Site } from '../models';
import { countsText, fmtAgo } from '../run-format';
import { ApiService, apiError } from '../services/api.service';
import { ToastService } from '../services/toast.service';

/** A run in progress for a site, from the Runs timeline. */
export interface LiveRun { id: string; type: 'agent' | 'scan'; status: string; label: string; }

/** The last scan's error text, if any (the run's error or the first error in its counts). */
export const lastScanError = (s: Site): string | null => s.last_error ?? (s.last_counts?.errors?.length ? s.last_counts.errors.join('\n') : null);

/**
 * One site as a fixed-size card (styles: .fh-site-card). Every section has its own fixed slot: header, chips,
 * capabilities, counts, last scan, notes, actions pinned at the bottom. Long text is clamped in its slot and
 * readable in full by click (fh-popover); errors show as a chip that opens the full text. A disabled action says
 * why in the capability row, never a silently greyed button.
 */
@Component({
  selector: 'fh-site-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, RouterLink, LaunchButton, PagesStepper, Popover, SiteLogo, StatusChip],
  template: `
  @let s = site();
  @let sc = s.scan;
  <article class="fh-card fh-card-brand fh-site-card" [class.fh-card-dim]="s.role === 'origin' || s.status === 'disabled'" [style.--brand]="s.brand?.colour">
    <!-- 1 header -->
    <div class="fh-card-head fh-slot-head">
      <fh-site-logo [slug]="s.slug" size="lg" />
      <div class="flex-grow-1" style="min-width:0">
        <a class="fh-card-title d-block" [href]="s.url" target="_blank" rel="noopener" [title]="s.url">{{ s.name }} <small>↗</small></a>
        <div class="fh-card-sub fh-mono text-truncate">{{ s.slug }}{{ s.method ? ' · ' + s.method : '' }}{{ s.auth && s.auth !== 'none' ? ' · auth ' + s.auth : '' }}</div>
      </div>
      @if (s.risk_note) {
        <fh-popover kind="icon" label="⚠" heading="Risk note" ariaLabel="Risk note" class="fh-risk">{{ s.risk_note }}</fh-popover>
      }
      <fh-popover kind="info" [heading]="s.name" ariaLabel="Everything about this site" [width]="380">
        <dl class="fh-kv mb-0">
          <dt>Status</dt><dd>{{ s.status }} · {{ s.role }}{{ s.last_verified ? ' · verified ' + s.last_verified : '' }}</dd>
          @if (s.risk_note) { <dt>Risk</dt><dd>{{ s.risk_note }}</dd> }
          @if (s.role !== 'origin') {
            <dt>Script</dt><dd>{{ sc?.script?.enabled ? 'on' : 'off: ' + (sc?.script?.reason ?? '–') }}</dd>
            <dt>Browser</dt><dd>{{ sc?.browser?.enabled ? 'on, up to ' + sc!.browser.max_pages + ' pages' : 'off: ' + (sc?.browser?.reason ?? '–') }}</dd>
          }
          @if (error()) { <dt>Last error</dt><dd class="text-danger" style="white-space:pre-wrap">{{ error() }}</dd> }
          <dt>Notes</dt><dd>{{ s.notes || '–' }}</dd>
        </dl>
      </fh-popover>
    </div>

    <!-- 2 chips -->
    <div class="fh-card-chips fh-slot-chips">
      <fh-status-chip [status]="s.status" [title]="s.last_verified ? 'Last verified ' + s.last_verified : null" />
      <fh-status-chip [status]="s.role" [label]="s.role === 'origin' ? 'origin only' : 'scanned'" />
      @for (k of s.kinds; track k) { <span class="fh-chip fh-tone-muted">{{ k }}</span> }
      @if (live(); as r) {
        <a class="ms-auto text-decoration-none" [routerLink]="['/runs']" [queryParams]="r.type === 'agent' ? { agent: r.id } : { scan: r.id }">
          <fh-status-chip [status]="r.status" [label]="r.label" title="Open the run on the Runs page" /></a>
      }
    </div>

    <!-- 3 capabilities (or where an origin's homes come from) -->
    <div class="fh-slot-caps">
      @if (s.role === 'origin') {
        <div class="fh-cap-line">
          @if (via(); as v) {
            Listings arrive through <fh-site-logo [slug]="v.slug" [withName]="true" />
            <a [routerLink]="['/candidates']" [queryParams]="{ origin: s.slug }">({{ s.origin_listings ?? 0 }})</a>
          } @else { Listings arrive through an aggregator ({{ s.origin_listings ?? 0 }}) }
        </div>
        <div class="fh-cap-line text-body-secondary">Never scanned: origin-only site</div>
      } @else {
        <div class="fh-cap" [class.on]="sc?.script?.enabled" [class.off]="!sc?.script?.enabled">
          <span class="fh-cap-mark">{{ sc?.script?.enabled ? '✓' : '✗' }}</span><span class="fh-cap-name">Script</span>
          @if (sc?.script?.enabled) { <span class="fh-cap-why text-truncate">scripted scan from the app ({{ s.method ?? 'http' }})</span> }
          @else { <fh-popover kind="text" class="fh-cap-why" [label]="sc?.script?.reason ?? 'off'" heading="Why no scripted scan">{{ sc?.script?.reason ?? '–' }}</fh-popover> }
        </div>
        <div class="fh-cap" [class.on]="sc?.browser?.enabled" [class.off]="!sc?.browser?.enabled">
          <span class="fh-cap-mark">{{ sc?.browser?.enabled ? '✓' : '✗' }}</span><span class="fh-cap-name">Browser</span>
          @if (sc?.browser?.enabled) { <span class="fh-cap-why text-truncate">agent in your Chrome, up to {{ sc!.browser.max_pages }} pages</span> }
          @else { <fh-popover kind="text" class="fh-cap-why" [label]="sc?.browser?.reason ?? 'off'" heading="Why no browser scan">{{ sc?.browser?.reason ?? '–' }}</fh-popover> }
        </div>
      }
    </div>

    <!-- 4 counts -->
    <div class="fh-stats fh-slot-stats">
      <a class="fh-stat" [routerLink]="['/candidates']" [queryParams]="{ site: s.slug }" title="Homes found on this site: open them in Candidates">
        <b>{{ s.known_listings ?? 0 }}</b><span>found here</span></a>
      <a class="fh-stat" [routerLink]="['/candidates']" [queryParams]="{ origin: s.slug }" title="Homes first published on this site (wherever they were found)">
        <b>{{ s.origin_listings ?? 0 }}</b><span>published here</span></a>
      <div class="fh-stat" title="New homes in the last scan"><b>{{ s.last_counts?.new ?? '–' }}</b><span>new last scan</span></div>
    </div>

    <!-- 5 last scan -->
    <div class="fh-slot-last">
      <span class="text-body-secondary">Last scan</span>
      @if (s.last_scan_at) {
        @if (error()) {
          <fh-popover kind="chip" tone="bad" label="Last scan failed" heading="Last scan error" [width]="420">
            <div style="white-space:pre-wrap">{{ error() }}</div></fh-popover>
        } @else { <fh-status-chip [status]="s.last_scan_status ?? 'ok'" /> }
        <span [title]="s.last_scan_at | date: 'medium'">{{ ago(s.last_scan_at) }}</span>
        @if (lastCounts()) { <span class="fh-mono text-truncate">{{ lastCounts() }}</span> }
        @if (s.last_scan_id) { <a class="ms-auto flex-none" [routerLink]="['/runs']" [queryParams]="{ scan: s.last_scan_id }">details →</a> }
      } @else { <span class="text-body-secondary fst-italic">{{ s.role === 'origin' ? '– (origin only)' : 'no scan yet' }}</span> }
    </div>

    <!-- 6 notes -->
    <div class="fh-slot-notes">
      <span class="fh-notes-text">{{ s.notes || 'No notes.' }}</span>
      @if (s.notes) { <fh-popover kind="text" label="more" heading="Notes" class="fh-notes-more">{{ s.notes }}</fh-popover> }
    </div>

    <!-- 7 actions, pinned at the bottom -->
    <div class="fh-card-foot fh-slot-foot">
      @if (s.role === 'origin') {
        <a class="btn btn-sm btn-outline-secondary" [routerLink]="['/candidates']" [queryParams]="{ origin: s.slug }">Its homes in Candidates →</a>
      } @else {
        <div class="fh-foot-row">
          <button class="btn btn-sm btn-primary" [disabled]="!sc?.script?.enabled || !!busy()" (click)="scan(false)"
                  [title]="sc?.script?.enabled ? 'Scripted scan now' : 'Not available: ' + sc?.script?.reason">
            @if (busy() === 'scan') { <span class="spinner-border spinner-border-sm me-1"></span> }Scan (script)</button>
          <button class="btn btn-sm btn-outline-secondary" [disabled]="!sc?.script?.enabled || !!busy()" (click)="scan(true)"
                  [title]="sc?.script?.enabled ? 'One page, nothing stored' : 'Not available: ' + sc?.script?.reason">
            @if (busy() === 'dry') { <span class="spinner-border spinner-border-sm me-1"></span> }Dry run</button>
        </div>
        <div class="fh-foot-row">
          @if (sc?.browser?.enabled) {
            <fh-pages-stepper [(value)]="pages" [max]="sc!.browser.max_pages" title="Result pages the agent reads" />
            <fh-launch-button label="Browser agent" profile="browser_scan" [params]="{ site: s.slug, pages: pages() }" errorMode="toast"
                              [disabled]="!!live()" [reason]="live() ? 'A run is already in progress for this site' : null"
                              (started)="launched.emit()" />
          }
          @if (canOnboard()) {
            <fh-launch-button label="Onboard" profile="site_onboarding" [params]="{ site: s.slug }" defaultLauncher="vscode" errorMode="toast"
                              [launchers]="['vscode', 'cli']" variant="outline" (started)="launched.emit()" />
          }
          @if (!sc?.browser?.enabled && !canOnboard()) { <span class="small text-body-secondary">No browser agent for this site.</span> }
        </div>
      }
    </div>
  </article>`,
})
export class SiteCard implements OnChanges {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  readonly site = input.required<Site>();
  readonly via = input<Site | null>(null);
  readonly live = input<LiveRun | null>(null);
  /** A scan finished or an agent started: the page reloads the sites and starts polling. */
  readonly launched = output<void>();
  protected busy = signal<'' | 'scan' | 'dry'>('');
  protected pages = signal(1);
  protected lastCounts = computed(() => countsText(this.site().last_counts));
  protected error = computed(() => lastScanError(this.site()));
  protected canOnboard = computed(() => this.site().role !== 'origin' && ['unverified', 'broken'].includes(this.site().status));
  protected ago = (iso: string) => fmtAgo(iso);
  private seeded = '';

  ngOnChanges(): void {
    const s = this.site();
    if (this.seeded !== s.slug) { this.seeded = s.slug; this.pages.set(s.scan?.browser?.default_pages ?? 1); }
  }

  /** The result goes to a toast (the card keeps its size); the card's last-scan slot updates on reload. */
  scan(dry: boolean): void {
    this.busy.set(dry ? 'dry' : 'scan');
    const name = this.site().name;
    this.api.scan(this.site().slug, dry).subscribe({
      next: (r) => {
        this.busy.set('');
        const failed = r.results.some((x) => x.error);
        this.toast.show(`${dry ? 'Dry run' : 'Scan'} · ${name}${failed ? ' failed' : ' done'}`, failed ? 'bad' : 'good', 10000,
          r.results.map((x) => x.line).join('\n'));
        this.launched.emit();
      },
      error: (e) => { this.busy.set(''); this.toast.show(`${dry ? 'Dry run' : 'Scan'} · ${name} refused`, 'bad', 12000, apiError(e)); },
    });
  }
}
