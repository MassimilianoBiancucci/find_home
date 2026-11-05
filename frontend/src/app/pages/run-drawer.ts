import { Component, OnChanges, OnDestroy, computed, inject, input, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { PetBadge } from '../components/pet-badge';
import { SiteLogo } from '../components/site-logo';
import { StatusChip } from '../components/status-chip';
import { ScanRunListing } from '../models';
import { TimelineItem, fmtCost, isLive, resumeUrl, runVerdict } from '../run-format';
import { ApiService, apiError } from '../services/api.service';

/** Detail of one run in the Runs drawer: header facts, handover, counts, cost, denials, the live log, its listings. */
@Component({
  selector: 'fh-run-drawer',
  imports: [DatePipe, RouterLink, PetBadge, SiteLogo, StatusChip],
  template: `
  @let it = item();
  <div class="d-flex flex-wrap gap-2 align-items-center mb-2">
    <fh-status-chip [status]="it.status" />
    @if (it.launcher) { <span class="fh-chip fh-tone-violet">{{ it.launcher === 'vscode' ? 'VS Code' : it.launcher }}</span> }
    @if (it.agent?.kind) { <span class="fh-chip fh-tone-muted">{{ it.agent!.kind }}</span> }
    @if (it.scan?.dry_run) { <span class="fh-chip fh-tone-off">dry run</span> }
    @if (it.site) { <fh-site-logo [slug]="it.site" [withName]="true" /> }
    @if (live() && it.type === 'agent') { <button class="btn btn-sm btn-outline-danger ms-auto" (click)="cancel()">Cancel run</button> }
    @if (live() && it.type === 'job') { <button class="btn btn-sm btn-outline-danger ms-auto" (click)="cancelJob()">Cancel job</button> }
  </div>
  @if (it.status === 'waiting') {
    <div class="alert alert-warning py-2 small">Waiting for you in VS Code: press Enter in the Claude Code tab that opened.
      If it did not open, start a new Claude Code tab and paste the prompt (it was copied when you launched).</div>
  }
  @if (it.status === 'ended_no_handover') {
    <div class="alert alert-secondary py-2 small">The session ended without writing its handover (<code>findhome run close</code>). What it did is in the log and its scan runs.</div>
  }
  @if (it.status === 'expired') {
    <div class="alert alert-secondary py-2 small">Nobody started this VS Code run in time; it expired.</div>
  }
  @if (error()) { <div class="alert alert-danger py-1 small" style="white-space:pre-wrap">{{ error() }}</div> }

  <dl class="fh-kv">
    @if (it.agent; as a) {
      <dt>Profile</dt><dd class="fh-mono">{{ a.profile }}</dd>
      @if (a.session_id) {
        <dt>Session</dt><dd><span class="fh-mono">{{ a.session_id.slice(0, 8) }}…</span>
          <a class="ms-2" [href]="resume(a.session_id)">Resume in VS Code ↗</a></dd>
      }
      @if (a.params && hasKeys(a.params)) { <dt>Params</dt><dd class="fh-mono">{{ json(a.params) }}</dd> }
      <dt>Folder</dt><dd class="fh-mono small text-break">{{ a.run_dir }}</dd>
      @if (a.exit_code != null) { <dt>Exit code</dt><dd>{{ a.exit_code }}</dd> }
    }
    @if (it.scan; as s) {
      <dt>Method</dt><dd>{{ s.method }} · by {{ s.trigger }}{{ s.pages ? ' · ' + s.pages + ' pages' : '' }}</dd>
      @if (s.agent_run_id) { <dt>Agent run</dt><dd><a href="" (click)="$event.preventDefault(); open.emit({ agent: s.agent_run_id })">{{ s.agent_run_id.slice(0, 8) }} →</a></dd> }
      @if (s.batch_id) { <dt>Batch</dt><dd class="fh-mono small text-break">{{ s.batch_id }}</dd> }
    }
    @if (it.job; as j) {
      <dt>Job</dt><dd><a [routerLink]="['/jobs', j.job_key]" [queryParams]="{ run: j.id }">{{ j.job_key }} →</a></dd>
      @if (j.agent_run_id) { <dt>Agent run</dt><dd><a href="" (click)="$event.preventDefault(); open.emit({ agent: j.agent_run_id })">{{ j.agent_run_id.slice(0, 8) }} →</a></dd> }
    }
    <dt>Started</dt><dd>{{ it.started_at | date: 'medium' }}</dd>
    @if (finished()) { <dt>Finished</dt><dd>{{ finished() | date: 'medium' }}{{ it.duration ? ' · ' + it.duration : '' }}</dd> }
    @if (it.cost || it.turns) { <dt>Cost</dt><dd>{{ it.cost || '–' }}{{ it.turns ? ' · ' + it.turns + ' turns' : '' }}</dd> }
  </dl>

  @if (counts().length) {
    <section class="fh-dsec"><h3>Counts</h3>
      <div class="d-flex flex-wrap gap-1">
        @for (c of counts(); track c[0]) { <span class="fh-chip" [class]="'fh-tone-' + countTone(c[0])">{{ c[1] }} {{ c[0].replace('_', ' ') }}</span> }
      </div>
    </section>
  }
  @if (errors().length) {
    <section class="fh-dsec"><h3>Errors</h3>
      @for (e of errors(); track $index) { <div class="fh-inline-err mb-1" style="max-width:none"><span>{{ e }}</span></div> }
    </section>
  }
  @if (it.agent; as a) {
    @if (verdict(a); as v) {
      <div class="fh-verdict" [class]="'fh-verdict fh-verdict-' + v.tone"><b>{{ v.title }}</b> {{ v.text }}</div>
    }
  }
  @if (it.agent?.summary) {
    <section class="fh-dsec"><h3>Handover</h3><div class="small" style="white-space:pre-wrap">{{ it.agent!.summary }}</div></section>
  }
  @if (denials().length) {
    <section class="fh-dsec"><h3>Permission denials · {{ denials().length }}</h3>
      @for (d of denials(); track $index) { <div class="small fh-mono text-break">{{ d.tool_name ?? 'tool' }} {{ d.tool_input ? json(d.tool_input).slice(0, 160) : '' }}</div> }
    </section>
  }
  @if (it.children.length) {
    <section class="fh-dsec"><h3>Runs it produced</h3>
      @for (c of it.children; track c.id) {
        <a href="" class="d-flex gap-2 align-items-center small py-1" (click)="$event.preventDefault(); open.emit(c.type === 'job' ? { job: c.id } : { scan: c.id })">
          <fh-status-chip [status]="c.status" /><span>{{ c.title }}</span><span class="text-body-secondary ms-auto">{{ c.counts }}</span></a>
      }
    </section>
  }

  @if (it.type === 'scan') {
    <section class="fh-dsec"><h3>Listings from this run · {{ listings().length }}</h3>
      @if (listings().length) {
        <div class="mb-1"><a [routerLink]="['/candidates']" [queryParams]="{ scan_run: it.id }">Open them in Candidates →</a></div>
        <div style="max-height:40vh; overflow:auto">
          @for (l of listings(); track l.short_id) {
            <div class="fh-src-row">
              @if (l.origin_site) { <fh-site-logo [slug]="l.origin_site" [title]="'first published on ' + l.origin_site" /> } @else { <span></span> }
              <span class="text-truncate"><a class="fh-mono" [routerLink]="['/candidates', l.short_id]">{{ l.short_id }}</a>
                {{ l.area }} <span class="text-body-secondary">{{ l.title }}</span></span>
              <span class="d-flex gap-1 align-items-center">@if (l.found_here) { <span class="fh-chip fh-tone-good" title="First seen in this run">new</span> }
                <fh-pet-badge [status]="l.pet_status" /></span>
            </div>
          }
        </div>
      } @else if (!loadingListings()) { <div class="small text-body-secondary">No listings linked to this run.</div> }
    </section>
  }

  @if (it.type === 'agent') {
    <section class="fh-dsec"><h3>Log {{ live() ? '· live' : '' }}</h3>
      <pre class="fh-log fh-mono mb-0">{{ log().join('\n') || (logDone() ? 'No log recorded for this run.' : 'Connecting…') }}</pre>
    </section>
  }`,
})
export class RunDrawer implements OnChanges, OnDestroy {
  private api = inject(ApiService);
  protected verdict = runVerdict;
  readonly item = input.required<TimelineItem>();
  /** Open another run in the drawer (a parent or a child). */
  readonly open = output<{ agent?: string; scan?: string; job?: string }>();
  readonly changed = output<void>();
  protected log = signal<string[]>([]);
  protected logDone = signal(false);
  protected listings = signal<ScanRunListing[]>([]);
  protected loadingListings = signal(false);
  protected error = signal('');
  private es?: EventSource;
  private shown = '';

  protected live = computed(() => isLive(this.item().status));
  protected finished = computed(() => {
    const it = this.item();
    return it.agent?.finished_at ?? it.scan?.finished_at ?? it.job?.finished_at ?? null;
  });
  protected counts = computed(() => {
    const it = this.item();
    const c = (it.scan?.counts ?? it.job?.counts ?? {}) as Record<string, unknown>;
    return Object.entries(c).filter(([k, v]) => typeof v === 'number' && k !== 'total' && (v > 0 || ['seen', 'new'].includes(k)))
      .map(([k, v]) => [k, v as number] as const);
  });
  protected errors = computed(() => {
    const s = this.item().scan;
    const list = (s?.counts?.errors as string[] | undefined) ?? [];
    return list.length ? list : s?.error ? [s.error] : this.item().job?.error ? [this.item().job!.error!] : [];
  });
  protected denials = computed(() => this.item().agent?.result?.permission_denials ?? []);
  protected resume = resumeUrl;
  protected json = (v: unknown) => JSON.stringify(v);
  protected hasKeys = (o: object) => Object.keys(o).length > 0;
  protected fmtCost = fmtCost;
  protected countTone = (k: string) => (k === 'new' || k === 'changed' ? 'good' : k.includes('error') ? 'bad' : k === 'conflict' ? 'mid' : 'muted');

  ngOnChanges(): void {
    const it = this.item();
    if (this.shown === it.type + it.id) return;          // same run refreshed by polling: keep the log stream
    this.shown = it.type + it.id;
    this.error.set('');
    this.es?.close();
    this.log.set([]);
    this.logDone.set(false);
    this.listings.set([]);
    if (it.type === 'agent') this.tail(it.id);
    if (it.type === 'scan') {
      this.loadingListings.set(true);
      this.api.scanRun(it.id).subscribe({
        next: (r) => { this.listings.set(r.listings ?? []); this.loadingListings.set(false); },
        error: (e) => { this.loadingListings.set(false); this.error.set(apiError(e)); },
      });
    }
  }

  private tail(id: string): void {
    this.es = new EventSource(`/api/agent-runs/${id}/log`);
    this.es.onmessage = (ev) => {
      try { const m = JSON.parse(ev.data); this.log.update((l) => [...l.slice(-800), m.m ?? ev.data]); }
      catch { this.log.update((l) => [...l, ev.data]); }
    };
    this.es.onerror = () => { this.es?.close(); this.logDone.set(true); };
  }

  cancel(): void {
    this.api.cancelAgent(this.item().id).subscribe({ next: () => this.changed.emit(), error: (e) => this.error.set(apiError(e)) });
  }
  cancelJob(): void {
    this.api.cancelJobRun(this.item().id).subscribe({ next: () => this.changed.emit(), error: (e) => this.error.set(apiError(e)) });
  }
  ngOnDestroy(): void { this.es?.close(); }
}
