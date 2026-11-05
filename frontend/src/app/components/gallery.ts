import { Component, HostListener, computed, effect, input, signal, untracked } from '@angular/core';
import { InfoButton } from './info';

type Tab = 'photos' | 'plans';

/**
 * Photo gallery of a listing: Photos / Floor plans tabs, a main image with a thumbnail strip, and a full-screen
 * viewer (arrow keys, Esc, swipe, double-click for 1:1). Images load lazily from the listing site's own URLs.
 * `compact` shows only a strip of three thumbnails (map panel); a click opens the viewer.
 */
@Component({
  selector: 'fh-gallery',
  imports: [InfoButton],
  template: `
  @if (compact()) {
    @if (all().length) {
      <div class="fh-gal-strip">
        @for (u of all().slice(0, 3); track u; let i = $index) {
          <button type="button" class="fh-gal-thumb" (click)="openViewer('photos', i)" [attr.aria-label]="'Photo ' + (i + 1)">
            <img [src]="u" loading="lazy" decoding="async" alt="" (error)="broken(u)" />
            @if (i === 2 && all().length > 3) { <span class="fh-gal-more">+{{ all().length - 3 }}</span> }
          </button>
        }
      </div>
    }
  } @else {
    <section class="fh-gal">
      <header class="fh-gal-head">
        <div class="fh-gal-tabs" role="tablist">
          <button type="button" role="tab" [class.active]="tab() === 'photos'" [attr.aria-selected]="tab() === 'photos'" (click)="setTab('photos')">
            Photos <span>{{ shown('photos').length }}</span></button>
          @if (shown('plans').length) {
            <button type="button" role="tab" [class.active]="tab() === 'plans'" [attr.aria-selected]="tab() === 'plans'" (click)="setTab('plans')">
              Floor plans <span>{{ shown('plans').length }}</span></button>
          }
        </div>
        <fh-info id="gallery" />
        @if (list().length) { <button type="button" class="fh-gal-fs" title="Full screen" (click)="openViewer(tab(), index())">⛶</button> }
      </header>
      @if (list().length) {
        <div class="fh-gal-main" [class.plan]="tab() === 'plans'">
          @if (isPdf(list()[index()])) {
            <a class="fh-gal-pdf" [href]="list()[index()]" target="_blank" rel="noopener">PDF floor plan ↗<small>opens in a new tab</small></a>
          } @else {
          <img [src]="list()[index()]" decoding="async" [alt]="(tab() === 'plans' ? 'Floor plan ' : 'Photo ') + (index() + 1)"
            (click)="openViewer(tab(), index())" (error)="broken(list()[index()])" />
          }
          @if (list().length > 1) {
            <button type="button" class="fh-gal-nav prev" aria-label="Previous" (click)="step(-1)">‹</button>
            <button type="button" class="fh-gal-nav next" aria-label="Next" (click)="step(1)">›</button>
          }
          <span class="fh-gal-count">{{ index() + 1 }} / {{ list().length }}</span>
        </div>
        @if (list().length > 1) {
          <div class="fh-gal-thumbs">
            @for (u of list(); track u; let i = $index) {
              <button type="button" class="fh-gal-thumb" [class.active]="i === index()" (click)="index.set(i)" [attr.aria-label]="'Show ' + (i + 1)">
                @if (isPdf(u)) { <span class="fh-gal-pdf-thumb">PDF</span> } @else { <img [src]="u" loading="lazy" decoding="async" alt="" (error)="broken(u)" /> }
              </button>
            }
          </div>
        }
      } @else {
        <div class="fh-gal-empty">No photos for this listing.</div>
      }
      @if (incomplete()) { <div class="fh-gal-hint">Gallery may be incomplete: it fills in at the next browser scan.</div> }
    </section>
  }

  @if (viewer()) {
    <div class="fh-gal-viewer" role="dialog" aria-modal="true" aria-label="Photo viewer" (click)="backdrop()"
      (pointerdown)="swipeStart($event)" (pointerup)="swipeEnd($event)">
      <div class="fh-gal-vbar" (click)="$event.stopPropagation()">
        <span>{{ viewer()!.tab === 'plans' ? 'Floor plan' : 'Photo' }} {{ viewer()!.i + 1 }} / {{ vlist().length }}</span>
        @if (link()) { <a [href]="link()" target="_blank" rel="noopener">Open on site ↗</a> }
        <button type="button" class="btn-close btn-close-white ms-auto" aria-label="Close" (click)="closeViewer()"></button>
      </div>
      <div class="fh-gal-vimg" [class.actual]="actual()" (click)="$event.stopPropagation()" (dblclick)="actual.set(!actual())">
        <img [src]="vlist()[viewer()!.i]" decoding="async" alt="" />
      </div>
      @if (vlist().length > 1) {
        <button type="button" class="fh-gal-vnav prev" aria-label="Previous" (click)="$event.stopPropagation(); vstep(-1)">‹</button>
        <button type="button" class="fh-gal-vnav next" aria-label="Next" (click)="$event.stopPropagation(); vstep(1)">›</button>
      }
      @for (u of neighbours(); track u) { <img class="fh-gal-preload" [src]="u" alt="" aria-hidden="true" /> }
    </div>
  }`,
  styles: [`
    :host { display: block; }
    .fh-gal { border-radius: 10px; padding: 8px 10px 10px; margin-bottom: 1rem; border: 1px solid var(--bs-border-color);
      background: var(--fh-sub); box-shadow: 0 1px 3px rgba(0,0,0,.08); }
    :host-context([data-bs-theme='dark']) .fh-gal {
      background: linear-gradient(180deg, rgba(255,255,255,.04) 0%, transparent 45%, rgba(0,0,0,.1) 100%), linear-gradient(160deg, #2c2c33 0%, #222228 100%);
      border-color: #44444e; border-top-color: #55555f; box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 2px 8px rgba(0,0,0,.35); }
    .fh-gal-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .fh-gal-tabs { display: flex; gap: 4px; }
    .fh-gal-tabs button { border: 1px solid var(--bs-border-color); background: transparent; color: var(--bs-secondary-color);
      border-radius: 999px; padding: 1px 10px; font-size: .78rem; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; }
    .fh-gal-tabs button span { font-weight: 400; opacity: .8; margin-left: 2px; }
    .fh-gal-tabs button.active { color: var(--fh-on-accent); background: var(--fh-accent-fill); border-color: transparent; }
    :host-context([data-bs-theme='dark']) .fh-gal-tabs button.active { color: #1c1c22; text-shadow: 0 1px 0 rgba(255,255,255,.5); }
    .fh-gal-fs { margin-left: auto; border: 0; background: none; color: var(--bs-secondary-color); font-size: 1.05rem; }
    .fh-gal-head fh-info + .fh-gal-fs { margin-left: 4px; }
    .fh-gal-head fh-info { margin-left: auto; }
    .fh-gal-main { position: relative; border-radius: 8px; overflow: hidden; background: #111116; aspect-ratio: 16 / 10;
      box-shadow: inset 0 0 0 1px rgba(255,255,255,.06); }
    .fh-gal-main img { width: 100%; height: 100%; object-fit: cover; cursor: zoom-in; display: block; }
    .fh-gal-main.plan { background: #f4f4f6; } .fh-gal-main.plan img { object-fit: contain; }
    .fh-gal-nav { position: absolute; top: 50%; transform: translateY(-50%); width: 34px; height: 34px; border-radius: 50%;
      border: 1px solid rgba(255,255,255,.35); background: rgba(20,20,26,.55); color: #fff; font-size: 1.3rem; line-height: 1; }
    .fh-gal-nav.prev { left: 8px; } .fh-gal-nav.next { right: 8px; }
    .fh-gal-nav:hover { background: rgba(153,10,227,.75); }
    .fh-gal-count { position: absolute; right: 8px; bottom: 8px; padding: 1px 8px; border-radius: 999px; font-size: .75rem;
      color: #fff; background: rgba(20,20,26,.6); }
    .fh-gal-thumbs, .fh-gal-strip { display: flex; gap: 6px; margin-top: 8px; overflow-x: auto; padding-bottom: 2px; }
    .fh-gal-strip { margin-top: 6px; }
    .fh-gal-thumb { position: relative; flex: none; width: 72px; height: 50px; padding: 0; border-radius: 6px; overflow: hidden;
      border: 2px solid transparent; background: #1a1a20; }
    .fh-gal-strip .fh-gal-thumb { width: 33%; flex: 1; height: 64px; }
    .fh-gal-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .fh-gal-thumb.active { border-color: var(--fh-violet); box-shadow: 0 0 0 1px rgba(255,255,255,.5); }
    .fh-gal-more { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #fff;
      font-weight: 700; background: rgba(20,20,26,.6); }
    .fh-gal-empty { padding: 24px; text-align: center; color: var(--bs-secondary-color); font-size: .86rem; }
    .fh-gal-hint { margin-top: 6px; font-size: .78rem; color: var(--bs-secondary-color); }
    .fh-gal-viewer { position: fixed; inset: 0; z-index: 2200; background: rgba(8,8,12,.94); display: flex; flex-direction: column;
      touch-action: pan-y; }
    .fh-gal-vbar { display: flex; align-items: center; gap: 16px; padding: 10px 16px; color: #ddd; font-size: .86rem; }
    .fh-gal-vbar a { color: #c9a8ff; }
    .fh-gal-vimg { flex: 1; display: flex; align-items: center; justify-content: center; overflow: hidden; padding: 0 56px 24px; }
    .fh-gal-vimg img { max-width: 100%; max-height: 100%; object-fit: contain; cursor: zoom-in; }
    .fh-gal-vimg.actual { overflow: auto; align-items: flex-start; justify-content: flex-start; }
    .fh-gal-vimg.actual img { max-width: none; max-height: none; cursor: zoom-out; }
    .fh-gal-vnav { position: absolute; top: 50%; transform: translateY(-50%); width: 44px; height: 44px; border-radius: 50%;
      border: 1px solid rgba(255,255,255,.3); background: rgba(40,40,48,.7); color: #fff; font-size: 1.6rem; line-height: 1; }
    .fh-gal-vnav.prev { left: 12px; } .fh-gal-vnav.next { right: 12px; }
    .fh-gal-preload { display: none; }
    .fh-gal-pdf { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
      font-weight: 600; color: #1c1c22; text-decoration: none; small { font-weight: 400; color: #555; } }
    .fh-gal-pdf-thumb { display: flex; align-items: center; justify-content: center; height: 100%; color: #ddd; font-size: .72rem; font-weight: 700; }
  `],
})
export class GalleryComponent {
  readonly photos = input<string[]>([]);
  readonly plans = input<string[]>([]);
  readonly compact = input(false);
  /** The ad's page, linked from the viewer. */
  readonly link = input<string | null | undefined>(null);
  readonly incomplete = input(false);

  protected tab = signal<Tab>('photos');
  protected index = signal(0);
  protected viewer = signal<{ tab: Tab; i: number } | null>(null);
  protected actual = signal(false);
  private failed = signal<Set<string>>(new Set());
  private x0: number | null = null;
  private swiped = false;

  /** Photos and plans without the images that failed to load (ad removed, URL gone). */
  protected shown = (t: Tab) => (t === 'photos' ? this.photos() : this.plans()).filter((u) => !this.failed().has(u));
  protected list = computed(() => this.shown(this.tab()));
  protected all = computed(() => this.shown('photos'));
  protected vlist = computed(() => { const v = this.viewer(); return v ? this.shown(v.tab) : []; });
  protected neighbours = computed(() => {
    const v = this.viewer(), l = this.vlist();
    return v && l.length > 1 ? [l[(v.i + 1) % l.length], l[(v.i - 1 + l.length) % l.length]] : [];
  });

  constructor() {
    // a new listing (other photo list) starts at the first photo
    effect(() => { this.photos(); this.plans(); untracked(() => { this.index.set(0); this.tab.set('photos'); this.failed.set(new Set()); }); });
  }

  /** Some sites publish floor plans as PDF documents: shown as a link, not an image. */
  protected isPdf(u: string | undefined): boolean { return !!u && /\.pdf($|\?)/i.test(u); }
  protected setTab(t: Tab): void { this.tab.set(t); this.index.set(0); }
  protected step(d: number): void { const n = this.list().length; if (n) this.index.set((this.index() + d + n) % n); }
  protected broken(u: string): void {
    if (this.failed().has(u)) return;
    this.failed.update((s) => new Set(s).add(u));
    this.index.set(Math.min(this.index(), Math.max(0, this.list().length - 1)));
  }

  openViewer(tab: Tab, i: number): void {
    const u = this.shown(tab)[i];
    if (this.isPdf(u)) { window.open(u, '_blank', 'noopener'); return; }
    this.actual.set(false);
    this.viewer.set({ tab, i });
  }
  protected closeViewer(): void { this.viewer.set(null); }
  /** A click on the dark backdrop closes the viewer, unless it ends a swipe. */
  protected backdrop(): void { if (this.swiped) this.swiped = false; else this.closeViewer(); }
  protected vstep(d: number): void {
    const v = this.viewer(), n = this.vlist().length;
    if (v && n) { this.actual.set(false); this.viewer.set({ ...v, i: (v.i + d + n) % n }); }
  }
  protected swipeStart(e: PointerEvent): void { this.x0 = e.clientX; }
  protected swipeEnd(e: PointerEvent): void {
    if (this.x0 == null) return;
    const dx = e.clientX - this.x0;
    this.x0 = null;
    this.swiped = Math.abs(dx) > 50;
    if (this.swiped && !this.actual()) this.vstep(dx < 0 ? 1 : -1);
  }

  @HostListener('document:keydown', ['$event'])
  onKey(e: KeyboardEvent): void {
    if (!this.viewer()) return;
    if (e.key === 'Escape') this.closeViewer();
    else if (e.key === 'ArrowRight') this.vstep(1);
    else if (e.key === 'ArrowLeft') this.vstep(-1);
    else return;
    e.preventDefault();
    e.stopPropagation();
  }
}
