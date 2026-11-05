import { Component, DestroyRef, OnChanges, computed, inject, input, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { PetBadge } from '../components/pet-badge';
import { RunRow } from '../components/run-row';
import { SiteLogo } from '../components/site-logo';
import { StatusChip } from '../components/status-chip';
import { Job, JobItem, JobRun, JobRunDetail } from '../models';
import { TimelineItem, isLive, jobCountsText, jobItem } from '../run-format';
import { ApiService, apiError } from '../services/api.service';
import { ToastService } from '../services/toast.service';
import { JobSettingsPanel } from './job-settings';

const OUTCOMES = ['changed', 'conflict', 'unchanged', 'skipped', 'error'];

/** One job: its executions (select one for its items, with undo) and, on the right, its settings and Run. */
@Component({
  selector: 'fh-job',
  imports: [RouterLink, PetBadge, RunRow, SiteLogo, StatusChip, JobSettingsPanel],
  template: `
  <div class="fh-page-head">
    <a routerLink="/jobs" class="btn btn-sm btn-outline-secondary">← Jobs</a>
    <h1>{{ job()?.label ?? key() }}</h1>
    @if (job(); as j) {
      <fh-status-chip [status]="j.kind" [label]="j.kind === 'agent' ? 'agent' : 'in-app'" />
      @if (!j.enabled) { <fh-status-chip status="disabled" /> }
    }
  </div>
  @if (error()) { <div class="alert alert-danger py-1 small" style="white-space:pre-wrap">{{ error() }}</div> }

  <div class="row g-4">
    <div class="col-lg-7 order-2 order-lg-1">
      <div class="fh-section-head mt-0">Executions · {{ runs().length }}</div>
      <div class="fh-timeline">
        @for (it of items(); track it.id) {
          <fh-run-row [item]="it" [selected]="selectedId() === it.id" (pick)="select(it.id)">
            @if (it.job?.agent_run_id) {
              <a class="small" [routerLink]="['/runs']" [queryParams]="{ agent: it.job!.agent_run_id }" (click)="$event.stopPropagation()">agent log →</a>
            }
          </fh-run-row>
          @if (selectedId() === it.id) {
            <div class="fh-tl-children" style="margin-left:22px">
              <div class="d-flex flex-wrap gap-1 align-items-center mb-2">
                <button class="fh-fchip" [class.active]="!outcome()" (click)="setOutcome('')">all {{ detail()?.counts?.['total'] ?? '' }}</button>
                @for (o of outcomes; track o) {
                  <button class="fh-fchip" [class.active]="outcome() === o" (click)="setOutcome(o)">{{ o }} {{ detail()?.counts?.[o] ?? '' }}</button>
                }
                @if (isLive(it.status)) { <button class="btn btn-sm btn-outline-danger ms-auto" (click)="cancel(it.id)">Cancel run</button> }
              </div>
              @if (detail()?.error) { <div class="fh-inline-err mb-2" style="max-width:none"><span>{{ detail()!.error }}</span></div> }
              @if (detail()?.summary) { <div class="small mb-2" style="white-space:pre-wrap">{{ detail()!.summary }}</div> }
              <div class="table-responsive">
                <table class="table table-sm fh-items align-middle mb-0">
                  <thead><tr><th>Listing</th><th>Pets</th><th>Evidence</th><th>Outcome</th><th></th></tr></thead>
                  <tbody>
                  @for (x of detail()?.items ?? []; track x.id) {
                    <tr>
                      <td class="text-nowrap">
                        @if (x.origin_site) { <fh-site-logo [slug]="x.origin_site" /> }
                        <a class="fh-mono ms-1" [routerLink]="['/candidates', x.short_id]">{{ x.short_id }}</a>
                        <div class="small text-body-secondary text-truncate" style="max-width:180px" [title]="x.title ?? ''">{{ x.area }}</div>
                      </td>
                      <td class="text-nowrap">
                        <fh-pet-badge [status]="x.before?.pet_status ?? 'unknown'" [source]="x.before?.pet_source" [evidence]="x.before?.pet_evidence" />
                        <span class="fh-arrow">→</span>
                        @if (x.after) { <fh-pet-badge [status]="x.after.pet_status" [source]="x.after.pet_source" [evidence]="x.after.pet_evidence" /> }
                        @else { <span class="text-body-secondary small">{{ x.state === 'queued' || x.state === 'leased' ? x.state : 'same' }}</span> }
                      </td>
                      <td>
                        @if (x.evidence) { <div class="fh-quote" [title]="x.evidence">“{{ x.evidence }}”</div> }
                        @if (x.page_url) { <a class="small" [href]="x.page_url" target="_blank" rel="noopener">page ↗</a> }
                      </td>
                      <td><fh-status-chip [status]="x.outcome ?? x.state" />
                        @if (x.note) { <div class="small text-body-secondary">{{ x.note }}</div> }</td>
                      <td class="text-end">
                        @if (x.after && x.state === 'done') {
                          <button class="btn btn-sm btn-outline-secondary" [disabled]="undoing() === x.id" (click)="undo(x)"
                                  title="Put back the value it had before this run">Undo</button>
                        }
                        @if (undoErr()[x.id]) { <div class="small text-danger">{{ undoErr()[x.id] }}</div> }
                      </td>
                    </tr>
                  } @empty { <tr><td colspan="5" class="text-body-secondary small">{{ loadingDetail() ? 'Loading…' : 'No items' + (outcome() ? ' with this outcome.' : '.') }}</td></tr> }
                  </tbody>
                </table>
              </div>
            </div>
          }
        } @empty { <div class="fh-empty">Not run yet: choose the listings on the right and press Run.</div> }
      </div>
    </div>

    <div class="col-lg-5 order-1 order-lg-2">
      <div class="fh-card fh-panel">
        <div class="fh-section mb-0">Settings</div>
        @if (job(); as j) { <fh-job-settings [job]="j" (saved)="onSaved($event)" (ran)="onRan($event)" /> }
      </div>
    </div>
  </div>
  `,
})
export class JobPage implements OnChanges {
  readonly key = input.required<string>();
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private toast = inject(ToastService);
  protected outcomes = OUTCOMES;
  protected job = signal<Job | null>(null);
  protected runs = signal<JobRun[]>([]);
  protected detail = signal<JobRunDetail | null>(null);
  protected selectedId = signal<string | null>(null);
  protected outcome = signal('');
  protected error = signal('');
  protected loadingDetail = signal(false);
  protected undoing = signal<number | null>(null);
  protected undoErr = signal<Record<number, string>>({});
  protected items = computed<TimelineItem[]>(() => this.runs().map(jobItem));
  protected isLive = isLive;
  protected jobCounts = jobCountsText;
  private timer?: ReturnType<typeof setTimeout>;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
    this.route.queryParamMap.subscribe((q) => { const r = q.get('run'); if (r && r !== this.selectedId()) this.select(r, false); });
  }

  ngOnChanges(): void { this.loadJob(); this.loadRuns(); }

  loadJob(): void {
    this.api.job(this.key()).subscribe({ next: (j) => this.job.set(j), error: (e) => this.error.set(apiError(e)) });
  }

  loadRuns(): void {
    clearTimeout(this.timer);
    this.api.jobRuns(this.key()).subscribe({
      next: (r) => {
        this.runs.set(r.items);
        this.error.set('');
        if (!this.selectedId() && r.items.length) this.select(r.items[0].id, false);
        const live = r.items.some((x) => isLive(x.status));
        if (live && this.selectedId()) this.loadDetail();
        if (live) this.timer = setTimeout(() => { this.loadRuns(); this.loadJob(); }, 5000);
      },
      error: (e) => this.error.set(apiError(e)),
    });
  }

  select(id: string, nav = true): void {
    if (this.selectedId() === id && nav) { this.selectedId.set(null); this.detail.set(null); return; }
    this.selectedId.set(id);
    this.outcome.set('');
    this.detail.set(null);
    this.loadDetail();
    if (nav) this.router.navigate([], { queryParams: { run: id }, replaceUrl: true });
  }
  setOutcome(o: string): void { this.outcome.set(o); this.loadDetail(); }

  loadDetail(): void {
    const id = this.selectedId();
    if (!id) return;
    this.loadingDetail.set(true);
    this.api.jobRun(id, this.outcome() || undefined).subscribe({
      next: (d) => { if (this.selectedId() === id) this.detail.set(d); this.loadingDetail.set(false); },
      error: (e) => { this.loadingDetail.set(false); this.error.set(apiError(e)); },
    });
  }

  undo(x: JobItem): void {
    this.undoing.set(x.id);
    this.api.undoJobItem(x.id).subscribe({
      next: () => { this.undoing.set(null); this.toast.show(`${x.short_id}: pet status put back`, 'good'); this.loadDetail(); },
      error: (e) => { this.undoing.set(null); this.undoErr.update((m) => ({ ...m, [x.id]: apiError(e) })); },
    });
  }
  cancel(id: string): void {
    this.api.cancelJobRun(id).subscribe({ next: () => this.loadRuns(), error: (e) => this.error.set(apiError(e)) });
  }
  onSaved(j: Job): void { this.job.set(j); this.toast.show('Settings saved', 'good', 3000); }
  onRan(res: unknown): void {
    const r = res as { run?: JobRun; note?: string };
    if (r?.run && !r.run.agent_run_id) this.toast.show(`${this.job()?.label}: ${jobCountsText(r.run.counts) || r.note || 'done'}`, 'good');
    this.selectedId.set(null);
    this.loadJob();
    this.loadRuns();
  }
}
