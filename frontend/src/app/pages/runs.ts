import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AgentProfile, AgentRun, ScanRun } from '../models';
import { ApiService, apiError } from '../services/api.service';

/** Scan and agent runs. "Run agent" spawns the external CLI from config/agent.yaml; its log streams here. */
@Component({
  selector: 'fh-runs',
  imports: [FormsModule, DatePipe],
  template: `
  <div class="fh-page-head">
    <h1>Runs</h1>
    <select class="form-select form-select-sm w-auto" [(ngModel)]="profile">
      @for (p of profiles(); track p.name) { <option [value]="p.name">{{ p.label || p.name }}</option> }
    </select>
    <button class="btn btn-sm btn-primary" [disabled]="!profile" (click)="start()">Run agent</button>
    <button class="btn btn-sm btn-outline-danger" [disabled]="!profile" (click)="cancel()">Cancel</button>
    <span class="small text-body-secondary">The agent CLI (claude / codex) must be installed and logged in on this machine.</span>
  </div>
  @if (error()) { <div class="alert alert-danger py-1 small">{{ error() }}</div> }
  <div class="row g-3">
    <div class="col-lg-6">
      <h2 class="h6">Agent runs</h2>
      <table class="table table-sm small"><tbody>
        @for (r of agentRuns(); track r.id) {
          <tr (click)="tail(r)" style="cursor:pointer" [style.background]="r.id === tailing() ? 'var(--fh-sel)' : null">
            <td>{{ r.started_at | date: 'short' }}</td><td>{{ r.profile }}</td>
            <td><span class="badge" [class.text-bg-success]="r.status === 'ok'" [class.text-bg-warning]="r.status === 'running'"
                [class.text-bg-danger]="r.status === 'error' || r.status === 'timeout'">{{ r.status }}</span></td>
            <td class="text-body-secondary">{{ r.summary?.slice(0, 80) }}</td>
          </tr>
        } @empty { <tr><td class="text-body-secondary">No agent runs yet.</td></tr> }
      </tbody></table>
      <h2 class="h6 mt-3">Scan runs</h2>
      <table class="table table-sm small"><tbody>
        @for (s of scanRuns(); track s.id) {
          <tr><td>{{ s.started_at | date: 'short' }}</td><td>{{ s.site_slug }}</td><td>{{ s.status }}</td>
            <td class="fh-mono">{{ counts(s) }}</td></tr>
        } @empty { <tr><td class="text-body-secondary">No scans yet.</td></tr> }
      </tbody></table>
    </div>
    <div class="col-lg-6">
      <h2 class="h6">Log {{ tailing() ? '· ' + tailing()!.slice(0, 8) : '' }}</h2>
      <pre class="fh-pre fh-mono" style="max-height:65vh; overflow:auto">{{ log().join('\n') || 'Select a run to follow its log.' }}</pre>
    </div>
  </div>
  `,
})
export class RunsPage implements OnInit, OnDestroy {
  private api = inject(ApiService);
  protected profiles = signal<AgentProfile[]>([]);
  protected agentRuns = signal<AgentRun[]>([]);
  protected scanRuns = signal<ScanRun[]>([]);
  protected log = signal<string[]>([]);
  protected tailing = signal<string | null>(null);
  protected error = signal('');
  protected profile = '';
  private es?: EventSource;
  private timer?: ReturnType<typeof setInterval>;

  ngOnInit(): void {
    this.api.profiles().subscribe({ next: (r) => { this.profiles.set(r.items); this.profile ||= r.items[0]?.name ?? ''; }, error: () => {} });
    this.refresh();
    this.timer = setInterval(() => this.refresh(), 5000);
  }
  refresh(): void {
    this.api.runs().subscribe({ next: (r) => { this.agentRuns.set(r.agent_runs); this.scanRuns.set(r.scan_runs); }, error: (e) => this.error.set(apiError(e)) });
  }
  counts(s: ScanRun): string {
    const c = s.counts as any;
    return c?.seen != null ? `${c.seen} seen · ${c.new ?? 0} new · ${c.changed ?? 0} changed` : (s.error ?? '');
  }
  start(): void {
    this.api.startAgent(this.profile).subscribe({
      next: (r) => { this.refresh(); this.tail({ id: r.id } as AgentRun); },
      error: (e) => this.error.set(apiError(e)),
    });
  }
  cancel(): void { this.api.cancelAgent(this.profile).subscribe(() => this.refresh()); }
  tail(r: AgentRun): void {
    this.es?.close();
    this.tailing.set(r.id);
    this.log.set([]);
    this.es = new EventSource(`/api/agent-runs/${r.id}/log`);
    this.es.onmessage = (ev) => {
      try { const m = JSON.parse(ev.data); this.log.update((l) => [...l.slice(-800), m.m]); }
      catch { this.log.update((l) => [...l, ev.data]); }
    };
    this.es.onerror = () => this.es?.close();
  }
  ngOnDestroy(): void { this.es?.close(); clearInterval(this.timer); }
}
