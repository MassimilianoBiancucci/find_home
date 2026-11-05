import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AgentRun, RunsTimeline, Site } from '../models';
import { ApiService, apiError } from '../services/api.service';
import { SitesStore } from '../services/sites.store';
import { LiveRun, SiteCard } from './site-card';

/** Where a site belongs on the page: scannable now, still to onboard, or origin-only / disabled (collapsed). */
export function siteGroup(s: Site): 'ready' | 'pending' | 'other' {
  if (s.role === 'origin' || s.status === 'disabled') return 'other';
  return s.scan?.script?.enabled || s.scan?.browser?.enabled ? 'ready' : 'pending';
}

/** Runs in progress per site, from the Runs timeline. */
export function liveBySite(t: RunsTimeline): Map<string, LiveRun> {
  const out = new Map<string, LiveRun>();
  const live = (s: string) => s === 'running' || s === 'waiting';
  const agent = (a: AgentRun) => ({ id: a.id, type: 'agent' as const, status: a.status,
    label: a.status === 'waiting' ? 'waiting in VS Code' : 'agent running' });
  for (const a of t.agent_runs) {
    if (a.site_slug && live(a.status)) out.set(a.site_slug, agent(a));
    for (const s of a.scan_runs ?? []) if (live(s.status) && !out.has(s.site_slug)) out.set(s.site_slug, agent(a));
  }
  for (const s of t.scan_runs) if (live(s.status) && !out.has(s.site_slug))
    out.set(s.site_slug, { id: s.id, type: 'scan', status: s.status, label: 'scanning' });
  return out;
}

/** The site registry as cards: what can scan each site, why not, its listings, its last scan and the actions. */
@Component({
  selector: 'fh-sites',
  imports: [RouterLink, SiteCard],
  template: `
  <div class="fh-page-head">
    <h1>Sites</h1>
    <button class="btn btn-sm btn-primary" [disabled]="busy() || !scriptable()" (click)="scanAll()"
            [title]="scriptable() ? 'Scripted scan of every site that allows it' : 'No site can be scanned by script'">
      @if (busy()) { <span class="spinner-border spinner-border-sm me-1"></span> }Scan all scriptable ({{ scriptable() }})</button>
    <a class="btn btn-sm btn-outline-secondary" routerLink="/runs">Runs →</a>
    <span class="small text-body-secondary">Registry rules in <code>sites/README.md</code> · a site without a script is scanned by the browser agent.</span>
  </div>
  @if (error()) { <div class="alert alert-danger py-1 small" style="white-space:pre-wrap">{{ error() }}</div> }
  @if (lines().length) {
    <div class="fh-card mb-3"><div class="d-flex align-items-center"><b class="small">Scan all</b>
      <button class="btn-close btn-close-sm ms-auto" (click)="lines.set([])" aria-label="Dismiss"></button></div>
      <pre class="fh-pre fh-mono small mb-0">{{ lines().join('\n') }}</pre></div>
  }

  @if (ready().length) {
    <div class="fh-section-head">Scannable · {{ ready().length }}</div>
    <div class="fh-grid">
      @for (s of ready(); track s.slug) { <fh-site-card [site]="s" [live]="live().get(s.slug) ?? null" (launched)="changed()" /> }
    </div>
  }
  @if (pending().length) {
    <div class="fh-section-head">To onboard or repair · {{ pending().length }}</div>
    <div class="fh-grid">
      @for (s of pending(); track s.slug) { <fh-site-card [site]="s" [live]="live().get(s.slug) ?? null" (launched)="changed()" /> }
    </div>
  }
  @if (other().length) {
    <div class="fh-section-head">
      <button class="btn btn-sm btn-link p-0 text-decoration-none" (click)="showOther.set(!showOther())">
        {{ showOther() ? '▾' : '▸' }} Origin-only &amp; disabled · {{ other().length }}</button>
    </div>
    @if (showOther()) {
      <div class="fh-grid">
        @for (s of other(); track s.slug) { <fh-site-card [site]="s" [via]="store.aggregatorOf(s.slug)" (launched)="changed()" /> }
      </div>
    }
  }
  @if (!loading() && !store.sites().length) { <div class="fh-empty">No sites in the registry (sites/*/site.yaml).</div> }
  `,
})
export class SitesPage implements OnInit {
  private api = inject(ApiService);
  protected store = inject(SitesStore);
  protected lines = signal<string[]>([]);
  protected error = signal('');
  protected busy = signal(false);
  protected loading = signal(true);
  protected showOther = signal(false);
  protected live = signal(new Map<string, LiveRun>());
  protected ready = computed(() => this.store.sites().filter((s) => siteGroup(s) === 'ready'));
  protected pending = computed(() => this.store.sites().filter((s) => siteGroup(s) === 'pending'));
  protected other = computed(() => this.store.sites().filter((s) => siteGroup(s) === 'other'));
  protected scriptable = computed(() => this.store.sites().filter((s) => s.role !== 'origin' && s.scan?.script?.enabled).length);
  private timer?: ReturnType<typeof setTimeout>;

  constructor() { inject(DestroyRef).onDestroy(() => clearTimeout(this.timer)); }
  ngOnInit(): void { this.load(); this.poll(); }

  load(): void {
    this.api.sites().subscribe({
      next: (r) => { this.store.set(r.items); this.loading.set(false); this.error.set(''); },
      error: (e) => { this.error.set(apiError(e)); this.loading.set(false); },
    });
  }

  /** Live run chips: poll every 5 s only while something runs (or waits for you in VS Code). */
  poll(): void {
    clearTimeout(this.timer);
    this.api.runs({ limit: 20 }).subscribe({
      next: (t) => {
        const had = this.live().size;
        const live = liveBySite(t);
        this.live.set(live);
        if (had && live.size < had) this.load();                 // a run ended: fresh counts and last scan
        if (live.size) this.timer = setTimeout(() => this.poll(), 5000);
      },
      error: () => {},
    });
  }

  changed(): void { this.load(); setTimeout(() => this.poll(), 800); }

  scanAll(): void {
    this.busy.set(true);
    this.lines.set(['Scanning every scriptable site…']);
    this.api.scan('all', false).subscribe({
      next: (r) => { this.lines.set(r.results.map((x) => x.line).concat(r.results.length ? [] : ['no scriptable sites'])); this.busy.set(false); this.load(); },
      error: (e) => { this.error.set(apiError(e)); this.busy.set(false); this.lines.set([]); },
    });
  }
}
