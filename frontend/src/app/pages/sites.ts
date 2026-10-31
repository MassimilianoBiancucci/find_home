import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Site } from '../models';
import { ApiService, apiError } from '../services/api.service';

@Component({
  selector: 'fh-sites',
  imports: [DatePipe],
  template: `
  <div class="fh-page-head">
    <h1>Sites</h1>
    <button class="btn btn-sm btn-outline-primary" (click)="scan('all', false)">Scan all active</button>
    <span class="small text-body-secondary">Add or repair sites with the agent: <code>prompts/site_onboarding.md</code> · registry rules in <code>sites/README.md</code></span>
  </div>
  @if (error()) { <div class="alert alert-danger py-1 small" style="white-space:pre-wrap">{{ error() }}</div> }
  @if (lines().length) { <pre class="fh-pre fh-mono mb-3">{{ lines().join('\n') }}</pre> }
  <div class="table-responsive"><table class="table table-sm align-middle">
    <thead><tr><th>Site</th><th>Status</th><th>Method</th><th>Auth</th><th>Last scan</th><th>Notes</th><th></th></tr></thead>
    <tbody>
    @for (s of sites(); track s.slug) {
      <tr>
        <td><a [href]="s.url" target="_blank" rel="noopener">{{ s.name }}</a><div class="small text-body-secondary fh-mono">{{ s.slug }}</div></td>
        <td><span class="badge" [class.text-bg-success]="s.status === 'active'" [class.text-bg-secondary]="s.status === 'unverified'"
              [class.text-bg-danger]="s.status === 'broken'" [class.text-bg-dark]="s.status === 'disabled'">{{ s.status }}</span></td>
        <td>{{ s.method ?? '–' }}</td><td>{{ s.auth }}</td>
        <td class="small">{{ s.last_scan_at ? (s.last_scan_at | date: 'short') : '–' }}
          @if (s.last_error) { <div class="text-danger">{{ s.last_error }}</div> }</td>
        <td class="small text-body-secondary" style="max-width:380px">{{ s.notes }}</td>
        <td class="text-nowrap">
          <button class="btn btn-sm btn-outline-secondary" [disabled]="!s.method || busy()" (click)="scan(s.slug, true)">Dry run</button>
          <button class="btn btn-sm btn-primary ms-1" [disabled]="s.status !== 'active' || busy()" (click)="scan(s.slug, false)">Scan</button>
        </td>
      </tr>
    }
    </tbody>
  </table></div>
  `,
})
export class SitesPage implements OnInit {
  private api = inject(ApiService);
  protected sites = signal<Site[]>([]);
  protected lines = signal<string[]>([]);
  protected error = signal('');
  protected busy = signal(false);

  ngOnInit(): void { this.load(); }
  load(): void { this.api.sites().subscribe({ next: (r) => this.sites.set(r.items), error: (e) => this.error.set(apiError(e)) }); }

  scan(site: string, dry: boolean): void {
    this.busy.set(true);
    this.lines.set([`${dry ? 'Dry run' : 'Scanning'} ${site}…`]);
    this.api.scan(site, dry).subscribe({
      next: (r) => { this.lines.set(r.results.map((x) => x.line).concat(r.results.length ? [] : ['no active sites'])); this.busy.set(false); this.load(); },
      error: (e) => { this.error.set(apiError(e)); this.busy.set(false); this.lines.set([]); },
    });
  }
}
