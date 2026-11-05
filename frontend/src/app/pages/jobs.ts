import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { LaunchButton } from '../components/launch-button';
import { StatusChip } from '../components/status-chip';
import { Job, Launcher } from '../models';
import { fmtAgo, jobCountsText } from '../run-format';
import { ApiService, apiError } from '../services/api.service';
import { ToastService } from '../services/toast.service';

/** The jobs: batch work over a subset of listings (pet wording rules in the app, pet checks by the agent). */
@Component({
  selector: 'fh-jobs',
  imports: [DatePipe, RouterLink, LaunchButton, StatusChip],
  template: `
  <div class="fh-page-head">
    <h1>Jobs</h1>
    <a class="btn btn-sm btn-outline-secondary" routerLink="/runs">Runs →</a>
    <span class="small text-body-secondary">A job works on a subset of listings you choose; every change it makes can be undone per listing.</span>
  </div>
  @if (error()) { <div class="alert alert-danger py-1 small" style="white-space:pre-wrap">{{ error() }}</div> }
  <div class="fh-grid">
    @for (j of jobs(); track j.key) {
      <article class="fh-card fh-card-brand" [style.--brand]="j.kind === 'agent' ? 'var(--fh-violet)' : 'var(--fh-cyan)'">
        <div class="fh-card-head">
          <div class="flex-grow-1" style="min-width:0">
            <a class="fh-card-title d-block" [routerLink]="['/jobs', j.key]">{{ j.label }}</a>
            <div class="fh-card-sub fh-mono">{{ j.key }}</div>
          </div>
          <fh-status-chip [status]="j.kind" [label]="j.kind === 'agent' ? 'agent' : 'in-app'" />
          @if (!j.enabled) { <fh-status-chip status="disabled" /> }
        </div>
        <p class="small text-body-secondary mb-0 fh-clamp3">{{ j.description }}</p>
        <div class="fh-stats">
          <div class="fh-stat"><b>{{ j.runs ?? 0 }}</b><span>runs</span></div>
          <div class="fh-stat" [title]="'Failed runs among the last 10'"><b [style.color]="j.recent_errors ? 'var(--fh-bad)' : null">{{ j.recent_errors ?? 0 }}</b><span>recent errors</span></div>
          <div class="fh-stat"><b>{{ j.settings.n }}</b><span>N per run</span></div>
        </div>
        <div class="d-flex align-items-center gap-2 small flex-wrap">
          <span class="text-body-secondary">Last run</span>
          @if (j.last_run; as r) {
            <fh-status-chip [status]="r.status" />
            <span [title]="r.started_at | date: 'medium'">{{ ago(r.started_at) }}</span>
            <span class="fh-mono">{{ counts(r.counts) }}</span>
          } @else { <span>never</span> }
          @if (j.running) { <fh-status-chip status="running" class="ms-auto" /> }
        </div>
        <div class="fh-card-foot">
          @if (j.kind === 'agent') {
            <fh-launch-button label="Run" [defaultLauncher]="j.settings.launcher ?? 'cli'" [starter]="starter(j)"
                              [disabled]="!j.enabled || !!j.running" [reason]="j.running ? 'Already running' : 'Job disabled'" (started)="ran(j)" />
          } @else {
            <button class="btn btn-sm btn-primary" [disabled]="!j.enabled || !!j.running || busy() === j.key" (click)="runInApp(j)">
              @if (busy() === j.key) { <span class="spinner-border spinner-border-sm me-1"></span> }Run</button>
          }
          <a class="btn btn-sm btn-outline-secondary" [routerLink]="['/jobs', j.key]">Open →</a>
        </div>
      </article>
    } @empty { @if (!loading()) { <div class="fh-empty">No jobs defined.</div> } }
  </div>
  `,
  styles: `.fh-clamp3 { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }`,
})
export class JobsPage implements OnInit {
  private api = inject(ApiService);
  private router = inject(Router);
  private toast = inject(ToastService);
  protected jobs = signal<Job[]>([]);
  protected loading = signal(true);
  protected error = signal('');
  protected busy = signal('');
  protected ago = (iso: string) => fmtAgo(iso);
  protected counts = jobCountsText;
  private timer?: ReturnType<typeof setTimeout>;

  constructor() { inject(DestroyRef).onDestroy(() => clearTimeout(this.timer)); }
  ngOnInit(): void { this.load(); }

  load(): void {
    clearTimeout(this.timer);
    this.api.jobs().subscribe({
      next: (r) => {
        this.jobs.set(r.items); this.loading.set(false); this.error.set('');
        if (r.items.some((j) => j.running)) this.timer = setTimeout(() => this.load(), 5000);
      },
      error: (e) => { this.error.set(apiError(e)); this.loading.set(false); },
    });
  }
  private starters = new Map<string, (l: Launcher) => ReturnType<ApiService['runJob']>>();
  /** One starter per job (a stable input for the launch button). */
  starter(j: Job) {
    if (!this.starters.has(j.key)) this.starters.set(j.key, (l: Launcher) => this.api.runJob(j.key, undefined, l));
    return this.starters.get(j.key)!;
  }
  ran(j: Job): void { this.router.navigate(['/jobs', j.key]); }
  runInApp(j: Job): void {
    this.busy.set(j.key);
    this.api.runJob(j.key).subscribe({
      next: (r) => { this.busy.set(''); this.toast.show(`${j.label}: ${jobCountsText(r.run.counts) || r.note || 'done'}`, 'good'); this.load(); },
      error: (e) => { this.busy.set(''); this.error.set(apiError(e)); },
    });
  }
}
