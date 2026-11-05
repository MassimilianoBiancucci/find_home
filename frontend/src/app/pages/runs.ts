import { Component, DestroyRef, ElementRef, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Drawer } from '../components/drawer';
import { RunRow } from '../components/run-row';
import { SiteLogo } from '../components/site-logo';
import { AgentProfile, AgentRun, ScanRun } from '../models';
import { TimelineItem, isLive, jobItem, timeline } from '../run-format';
import { ApiService, apiError } from '../services/api.service';
import { LaunchService } from '../services/launch.service';
import { SitesStore } from '../services/sites.store';
import { RunDrawer } from './run-drawer';

interface Filters { site: string; kind: string; status: string; launcher: string; }
const KINDS = ['scan', 'job', 'onboarding', 'evaluate', 'other'];
const STATUSES = ['running', 'waiting', 'ok', 'error', 'partial', 'cancelled', 'ended_no_handover', 'expired'];
const LAUNCHERS = ['cli', 'vscode', 'manual'];

/** Find a run (agent, scan or job, nested or not) in the timeline. */
export function findRun(items: TimelineItem[], ref: { agent?: string; scan?: string; job?: string }): TimelineItem | null {
  for (const it of items) {
    if ((ref.agent && it.type === 'agent' && it.id === ref.agent) || (ref.scan && it.type === 'scan' && it.id === ref.scan)
      || (ref.job && it.type === 'job' && it.id === ref.job)) return it;
    const c = findRun(it.children, ref);
    if (c) return c;
  }
  return null;
}

/**
 * Every run as one timeline: agent runs (expandable to the scan and job runs they produced) and scripted scans.
 * A drawer shows the selected run with its log and listings. Site and job launches start from their own pages;
 * the other agent profiles sit in the "Other agents" menu.
 */
@Component({
  selector: 'fh-runs',
  imports: [RouterLink, Drawer, RunRow, RunDrawer, SiteLogo],
  template: `
  <div class="fh-page-head">
    <h1>Runs</h1>
    <button class="btn btn-sm btn-outline-secondary" (click)="refresh()">Refresh</button>
    <div class="fh-split" [class.open]="menu()">
      <button class="btn btn-sm btn-outline-primary" (click)="menu.set(!menu())">Other agents ▾</button>
      @if (menu()) {
        <div class="fh-menu" role="menu">
          @for (p of otherProfiles(); track p.name) {
            @for (l of p.launchers ?? ['cli']; track l) {
              <button class="fh-menu-item" role="menuitem" (click)="start(p, l)">
                <b>{{ p.label || p.name }}</b> <span class="fh-chip fh-tone-muted">{{ l === 'vscode' ? 'VS Code' : 'CLI' }}</span>
                <small>{{ p.prompt_file ?? p.name }} · {{ p.command }} · timeout {{ p.timeout_min }} min</small></button>
            }
          } @empty { <div class="fh-menu-item text-body-secondary">No other profiles in config/agent.yaml</div> }
        </div>
      }
    </div>
    <a class="btn btn-sm btn-outline-secondary" routerLink="/sites">Sites</a>
    <a class="btn btn-sm btn-outline-secondary" routerLink="/jobs">Jobs</a>
    <span class="small text-body-secondary ms-auto">{{ items().length }} runs{{ liveCount() ? ' · ' + liveCount() + ' in progress' : '' }}</span>
  </div>
  @if (error()) { <div class="alert alert-danger py-1 small" style="white-space:pre-wrap">{{ error() }}</div> }

  <div class="fh-filters">
    <div class="fh-fgroup"><label>Site</label>
      @for (s of siteOptions(); track s) {
        <button class="fh-fchip" [class.active]="f().site === s" (click)="setFilter('site', s)"><fh-site-logo [slug]="s" [withName]="true" /></button>
      }
    </div>
    <div class="fh-fgroup"><label>Kind</label>
      @for (k of kinds; track k) { <button class="fh-fchip" [class.active]="f().kind === k" (click)="setFilter('kind', k)">{{ k }}</button> }
    </div>
    <div class="fh-fgroup"><label>Status</label>
      @for (k of statuses; track k) { <button class="fh-fchip" [class.active]="f().status === k" (click)="setFilter('status', k)">{{ k.replace('_', ' ').replace('_', ' ') }}</button> }
    </div>
    <div class="fh-fgroup"><label>Launcher</label>
      @for (k of launchers; track k) { <button class="fh-fchip" [class.active]="f().launcher === k" (click)="setFilter('launcher', k)">{{ k === 'vscode' ? 'VS Code' : k }}</button> }
    </div>
    @if (anyFilter()) { <button class="btn btn-sm btn-link" (click)="clearFilters()">Clear filters</button> }
  </div>

  <div class="fh-timeline">
    @for (it of items(); track it.type + it.id) {
      <fh-run-row [item]="it" [selected]="isSelected(it)" [expanded]="expanded().has(it.id)" (pick)="select($event)" (toggle)="toggle($event)" />
      @if (expanded().has(it.id)) {
        <div class="fh-tl-children">
          @for (c of it.children; track c.type + c.id) { <fh-run-row [item]="c" [child]="true" [selected]="isSelected(c)" (pick)="select($event)" /> }
        </div>
      }
    } @empty {
      @if (!loading()) { <div class="fh-empty">No runs{{ anyFilter() ? ' match these filters' : ' yet: start a scan from Sites' }}.</div> }
    }
  </div>

  <fh-drawer [open]="!!selected()" [title]="selected()?.title ?? ''" (closed)="close()">
    @if (selected(); as s) { <fh-run-drawer [item]="s" (open)="openRef($event)" (changed)="refresh()" /> }
  </fh-drawer>
  `,
})
export class RunsPage implements OnInit {
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private launch = inject(LaunchService);
  private el = inject(ElementRef);
  protected sites = inject(SitesStore);
  protected kinds = KINDS; protected statuses = STATUSES; protected launchers = LAUNCHERS;
  protected profiles = signal<AgentProfile[]>([]);
  protected agentRuns = signal<AgentRun[]>([]);
  protected scanRuns = signal<ScanRun[]>([]);
  protected f = signal<Filters>({ site: '', kind: '', status: '', launcher: '' });
  protected expanded = signal<ReadonlySet<string>>(new Set());
  protected ref = signal<{ agent?: string; scan?: string; job?: string }>({});
  protected error = signal('');
  protected loading = signal(true);
  protected menu = signal(false);
  private timer?: ReturnType<typeof setTimeout>;
  /** A job run with no agent (in-app job) is not in the timeline: opened by link, it is loaded on its own. */
  private extraJob = signal<TimelineItem | null>(null);

  protected all = computed(() => timeline(this.agentRuns(), this.scanRuns(), {
    profileLabel: (n) => this.profiles().find((p) => p.name === n)?.label?.replace(/^.*? - /, '') ?? n,
    siteName: (s) => this.sites.name(s),
  }));
  protected items = computed(() => {
    const l = this.f().launcher;
    return l ? this.all().filter((it) => (it.launcher ?? (it.type === 'scan' ? '' : 'cli')) === l) : this.all();
  });
  protected selected = computed(() => {
    const ref = this.ref();
    const x = this.extraJob();
    return findRun(this.all(), ref) ?? (ref.job && x?.id === ref.job ? x : null);
  });
  protected liveCount = computed(() => this.all().filter((it) => isLive(it.status) || it.children.some((c) => isLive(c.status))).length);
  protected siteOptions = computed(() => this.sites.sites().filter((s) => s.role !== 'origin').map((s) => s.slug));
  protected anyFilter = computed(() => Object.values(this.f()).some(Boolean));
  /** Profiles that need no parameter (site / job ones start from Sites and Jobs). */
  protected otherProfiles = computed(() => this.profiles().filter((p) => !Object.values(p.params ?? {}).some((x) => x.required)));

  constructor() { inject(DestroyRef).onDestroy(() => clearTimeout(this.timer)); }

  ngOnInit(): void {
    this.sites.load();
    this.api.profiles().subscribe({ next: (r) => this.profiles.set(r.items), error: () => {} });
    this.route.queryParamMap.subscribe((q) => {
      const ref = { agent: q.get('agent') ?? undefined, scan: q.get('scan') ?? undefined, job: q.get('job') ?? undefined };
      this.ref.set(ref);
      const site = q.get('site') ?? '';
      if (site !== this.f().site) { this.f.update((f) => ({ ...f, site })); }
      this.refresh();
    });
  }

  refresh(): void {
    clearTimeout(this.timer);
    const { site, kind, status } = this.f();
    this.api.runs({ limit: 50, site, kind, status }).subscribe({
      next: (r) => {
        this.agentRuns.set(r.agent_runs);
        this.scanRuns.set(r.scan_runs);
        this.loading.set(false);
        this.error.set('');
        this.ensureSelectedVisible();
        // poll fast only while something runs or waits for you; slowly otherwise (runs started elsewhere)
        this.timer = setTimeout(() => this.refresh(), this.liveCount() ? 5000 : 30000);
      },
      error: (e) => { this.error.set(apiError(e)); this.loading.set(false); },
    });
  }

  /** A run opened by link (?scan= / ?agent=) that sits inside an agent run: expand its parent. */
  private ensureSelectedVisible(): void {
    const ref = this.ref();
    if (!ref.agent && !ref.scan && !ref.job) return;
    for (const it of this.all()) {
      if (it.children.some((c) => (c.type === 'scan' && c.id === ref.scan) || (c.type === 'job' && c.id === ref.job)))
        this.expanded.update((s) => new Set(s).add(it.id));
    }
    if (!this.selected() && ref.job) this.loadJob(ref.job);
  }

  /** A job run not in the timeline (no agent): show it from its own endpoint. */
  private loadJob(id: string): void {
    this.api.jobRun(id).subscribe({
      next: (j) => this.extraJob.set(jobItem(j)),
      error: () => {},
    });
  }

  setFilter(k: keyof Filters, v: string): void {
    this.f.update((f) => ({ ...f, [k]: f[k] === v ? '' : v }));
    if (k !== 'launcher') { this.loading.set(true); this.refresh(); }
  }
  clearFilters(): void { this.f.set({ site: '', kind: '', status: '', launcher: '' }); this.refresh(); }

  isSelected(it: TimelineItem): boolean { const s = this.selected(); return !!s && s.type === it.type && s.id === it.id; }
  select(it: TimelineItem): void { this.openRef({ [it.type]: it.id }); }
  openRef(ref: { agent?: string; scan?: string; job?: string }): void {
    this.router.navigate([], { queryParams: { agent: ref.agent ?? null, scan: ref.scan ?? null, job: ref.job ?? null }, queryParamsHandling: 'merge' });
  }
  close(): void { this.openRef({}); }
  toggle(it: TimelineItem): void {
    this.expanded.update((s) => { const n = new Set(s); n.has(it.id) ? n.delete(it.id) : n.add(it.id); return n; });
  }

  start(p: AgentProfile, launcher: 'cli' | 'vscode'): void {
    this.menu.set(false);
    this.api.startAgent(p.name, {}, launcher).subscribe({
      next: (r) => { this.launch.handle(r, p.label ?? p.name); this.openRef({ agent: r.id }); this.refresh(); },
      error: (e) => this.error.set(apiError(e)),
    });
  }

  @HostListener('document:click', ['$event'])
  onDoc(ev: MouseEvent): void {
    const split = (this.el.nativeElement as HTMLElement).querySelector('.fh-page-head .fh-split');
    if (this.menu() && split && !split.contains(ev.target as Node)) this.menu.set(false);
  }
}
