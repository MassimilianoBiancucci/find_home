import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { AdStatusEvent, Listing, StatusEvent } from '../models';
import { ApiService } from '../services/api.service';
import { SitesStore } from '../services/sites.store';
import { AD_STATUS_LABEL, AdStatusBadge } from './ad-status-badge';
import { SiteLogo } from './site-logo';

const DAY = 86_400_000;
const W = 352;

/** "3 d", "5 h", "12 min", "just now": how long ago an ISO time was. */
export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const ms = Math.max(0, now - new Date(iso).getTime());
  const d = Math.floor(ms / DAY), h = Math.floor(ms / 3_600_000), m = Math.floor(ms / 60_000);
  return d >= 1 ? `${d} d` : h >= 1 ? `${h} h` : m >= 1 ? `${m} min` : 'just now';
}

/** One line of the history: when, what, and who did it. */
interface Moment { at: string; what: string; who?: string; tone: 'found' | 'ad' | 'closed' | 'status'; }

/** The history of a home, newest first: found on each site, the ad status changes, your status changes. */
export function moments(l: Listing, adEvents: AdStatusEvent[], events: StatusEvent[], siteName: (s: string) => string): Moment[] {
  const out: Moment[] = [];
  for (const s of l.ad_sources ?? []) if (s.first_seen) out.push({ at: s.first_seen, what: `Found on ${siteName(s.site)}`, tone: 'found' });
  for (const e of adEvents) {
    const to = e.to_status;
    out.push({ at: e.at, what: `${siteName(e.site_slug)}: ${AD_STATUS_LABEL[e.from_status ?? 'unknown'] ?? e.from_status} → ${AD_STATUS_LABEL[to] ?? to}`,
      who: e.actor === 'job' ? 'status check' : e.actor, tone: to === 'open' || to === 'unknown' ? 'ad' : 'closed' });
  }
  for (const e of events) if (e.from_status) out.push({ at: e.at, what: `${e.from_status} → ${e.to_status}`.replace(/_/g, ' '), who: e.actor, tone: 'status' });
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

/**
 * The clock at the end of a Candidates row (the ad is still open but its status was not confirmed for
 * `staleDays`), with a tooltip that explains it at a glance: how long since the last confirmation against the
 * limit, the ad on each site (status, last check and how, first and last seen by a scan), and the home's history
 * (found, ad status changes, your status changes; loaded from the listing on first hover, then kept).
 */
@Component({
  selector: 'fh-stale-tip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, AdStatusBadge, SiteLogo],
  template: `
  <span class="fh-stale" tabindex="0" aria-label="Ad status not confirmed recently" (mouseenter)="show()" (mouseleave)="hide()"
    (focus)="show()" (blur)="hide()">⏱</span>
  @if (pos(); as p) {
    @let l = listing();
    <div class="fh-st" role="tooltip" [style.left.px]="p.left" [style.top.px]="p.top">
      <div class="fh-st-head">
        <span class="fh-st-clock" aria-hidden="true">⏱</span>
        <div class="fh-st-big">
          @if (l.ad_checked_at) { <b>{{ ageDays() }} day{{ ageDays() === 1 ? '' : 's' }}</b><span>since the ad was last confirmed open</span> }
          @else { <b>Never confirmed</b><span>found {{ ago(l.first_seen_at) }} ago, its ad status never checked</span> }
        </div>
      </div>
      <div class="fh-st-bar" [title]="'Trusted for ' + staleDays() + ' days after a check'">
        <i [style.width.%]="fill()"></i><b [style.left.%]="50"></b>
      </div>
      <div class="fh-st-bar-k"><span>checked</span><span>limit {{ staleDays() }} d</span><span>{{ staleDays() * 2 }} d+</span></div>
      <div class="fh-st-note">It may have closed: the <b>Status</b> job (Jobs) checks the open ads again.</div>

      <div class="fh-st-h">On each site</div>
      @for (s of l.ad_sources ?? []; track s.site) {
        <div class="fh-st-site">
          <fh-site-logo [slug]="s.site" />
          <div class="fh-st-site-main">
            <div class="fh-st-site-top"><b>{{ sites.name(s.site) }}</b><fh-ad-status [status]="s.status" [site]="sites.name(s.site)" [checkedAt]="s.checked_at" /></div>
            <div class="fh-st-dim">
              {{ s.checked_at ? 'checked ' + ago(s.checked_at) + ' ago' : 'never checked' }}{{ s.rule ? ' · ' + s.rule : '' }}
            </div>
            @if (s.first_seen) {
              <div class="fh-st-dim">seen {{ s.first_seen | date: 'd MMM' }}{{ s.last_seen && (s.last_seen | date: 'd MMM') !== (s.first_seen | date: 'd MMM') ? ' → ' + (s.last_seen | date: 'd MMM') : '' }} by the scans</div>
            }
          </div>
        </div>
      }

      <div class="fh-st-h">History</div>
      @if (history(); as h) {
        <ul class="fh-st-tl">
          @for (m of h.slice(0, 6); track m.at + m.what) {
            <li [class]="'t-' + m.tone"><span class="fh-st-what">{{ m.what }}@if (m.who) { <i> · {{ m.who }}</i> }</span>
              <span class="fh-st-at">{{ m.at | date: 'd MMM, HH:mm' }}</span></li>
          }
          @if (h.length > 6) { <li class="fh-st-more">{{ h.length - 6 }} older on the listing page</li> }
        </ul>
      } @else { <div class="fh-st-dim">loading the history…</div> }
    </div>
  }`,
  styles: [`
    :host { display: inline-flex; }
    .fh-st { position: fixed; z-index: 2000; width: ${W}px; pointer-events: none; padding: 12px 14px; border-radius: 14px;
      font-size: .78rem; color: var(--bs-body-color); background: var(--bs-body-bg); text-align: left; white-space: normal;
      line-height: 1.35; font-weight: 400;
      border: 1px solid rgba(245, 159, 0, .6);
      box-shadow: 0 0 0 3px rgba(245, 159, 0, .14), 0 14px 34px -8px rgba(0, 0, 0, .55), 0 0 22px -6px rgba(245, 159, 0, .55);
      animation: fh-st-in .14s ease-out; }
    @keyframes fh-st-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
    .fh-st-head { display: flex; align-items: center; gap: 10px; }
    .fh-st-clock { flex: none; width: 38px; height: 38px; border-radius: 50%; display: grid; place-items: center; font-size: 1.15rem;
      background: radial-gradient(circle at 35% 30%, #ffe08a, #f59f00 70%); box-shadow: 0 0 0 3px rgba(245, 159, 0, .22), 0 0 14px rgba(245, 159, 0, .7); }
    .fh-st-big { display: flex; flex-direction: column; line-height: 1.2; min-width: 0; }
    .fh-st-big b { font-size: 1.25rem; font-weight: 800; color: #f59f00; }
    .fh-st-big span { color: var(--bs-secondary-color); }
    .fh-st-bar { position: relative; height: 8px; margin: 12px 0 3px; border-radius: 999px;
      background: color-mix(in srgb, var(--bs-secondary-color) 18%, transparent); }
    .fh-st-bar i { position: absolute; left: 0; top: 0; bottom: 0; border-radius: inherit;
      background: linear-gradient(90deg, #2fbf71 0%, #e0b23a 45%, #f59f00 60%, #ef5350 100%); background-size: ${W - 28}px 100%;
      box-shadow: 0 0 8px rgba(245, 159, 0, .6); }
    .fh-st-bar b { position: absolute; top: -3px; bottom: -3px; width: 2px; margin-left: -1px; border-radius: 1px;
      background: var(--bs-emphasis-color); opacity: .7; }
    .fh-st-bar-k { display: flex; justify-content: space-between; font-size: .66rem; color: var(--bs-secondary-color); }
    .fh-st-note { margin-top: 6px; color: var(--bs-secondary-color); }
    .fh-st-h { margin: 10px 0 4px; font-size: .66rem; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: #f59f00; }
    .fh-st-site { display: flex; gap: 8px; align-items: flex-start; padding: 5px 0; border-top: 1px dashed var(--bs-border-color); }
    .fh-st-site:first-of-type { border-top: 0; }
    .fh-st-site-main { flex: 1; min-width: 0; }
    .fh-st-site-top { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
    .fh-st-dim { color: var(--bs-secondary-color); font-size: .72rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .fh-st-tl { list-style: none; margin: 0; padding: 0 0 0 12px; border-left: 2px solid color-mix(in srgb, #f59f00 45%, transparent); }
    .fh-st-tl li { position: relative; display: flex; justify-content: space-between; gap: 8px; padding: 2px 0; }
    .fh-st-tl li::before { content: ''; position: absolute; left: -17px; top: 7px; width: 8px; height: 8px; border-radius: 50%;
      background: var(--c, #f59f00); box-shadow: 0 0 6px var(--c, #f59f00); }
    .fh-st-tl li.t-found { --c: #19b8e6; } .fh-st-tl li.t-ad { --c: #2fbf71; } .fh-st-tl li.t-closed { --c: #ef5350; } .fh-st-tl li.t-status { --c: #c43dff; }
    .fh-st-what { min-width: 0; overflow-wrap: anywhere; }
    .fh-st-what i { font-style: normal; color: var(--bs-secondary-color); }
    .fh-st-at { flex: none; color: var(--bs-secondary-color); font-variant-numeric: tabular-nums; }
    .fh-st-more { color: var(--bs-secondary-color); font-style: italic; }
    .fh-st-more::before { display: none; }
  `],
})
export class StaleTip {
  readonly listing = input.required<Listing>();
  /** agent.yaml ad_status.stale_after_days: how long a check is trusted. */
  readonly staleDays = input(7);
  protected sites = inject(SitesStore);
  private api = inject(ApiService);
  private el = inject(ElementRef<HTMLElement>);
  protected pos = signal<{ left: number; top: number } | null>(null);
  protected history = signal<Moment[] | null>(null);
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** The listings' histories, fetched once per session. */
  private static cache = new Map<string, { ad: AdStatusEvent[]; events: StatusEvent[] }>();
  protected ago = ago;

  protected ageDays = computed(() => {
    const at = this.listing().ad_checked_at;
    return at ? Math.floor((Date.now() - new Date(at).getTime()) / DAY) : 0;
  });
  /** The bar: the limit sits in the middle, twice the limit fills it. */
  protected fill = computed(() => {
    const l = this.listing(), at = l.ad_checked_at ?? l.first_seen_at;
    const days = (Date.now() - new Date(at).getTime()) / DAY;
    return Math.min(100, Math.max(4, (days / (this.staleDays() * 2)) * 100));
  });

  protected show(): void {
    const r = (this.el.nativeElement as HTMLElement).getBoundingClientRect();
    const left = r.left - W - 12 > 8 ? r.left - W - 12 : Math.min(window.innerWidth - W - 8, r.right + 12);
    const top = Math.max(8, Math.min(r.top - 40, window.innerHeight - 440));
    this.pos.set({ left, top });
    this.load();
  }
  protected hide(): void { this.pos.set(null); if (this.timer) clearTimeout(this.timer); this.timer = null; }

  private load(): void {
    const l = this.listing(), hit = StaleTip.cache.get(l.short_id);
    const build = (h: { ad: AdStatusEvent[]; events: StatusEvent[] }) =>
      this.history.set(moments(l, h.ad, h.events, (s) => this.sites.name(s)));
    if (hit) { build(hit); return; }
    this.history.set(null);
    this.timer = setTimeout(() => this.api.listing(l.short_id).subscribe({
      next: (d) => {
        const h = { ad: d.ad_status_events ?? [], events: d.events ?? [] };
        StaleTip.cache.set(l.short_id, h);
        if (this.pos()) build(h);
      },
      error: () => this.history.set([]),
    }), 150);
  }
}
