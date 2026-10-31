import { Component, OnInit, inject, signal } from '@angular/core';
import { YamlEditor } from '../components/yaml-editor';
import { ApiService, apiError } from '../services/api.service';
import { TagsStore } from '../services/tags.store';

const SCORING = ['profile', 'locations', 'time_model', 'poi', 'tags'];

/** Raw YAML editing for every config file, validated by the server before it is written (comments kept). */
@Component({
  selector: 'fh-settings',
  imports: [YamlEditor],
  template: `
  <div class="fh-page-head">
    <h1>Settings</h1>
    <span class="small text-body-secondary">config hash <code>{{ hash() }}</code></span>
    <button class="btn btn-sm btn-outline-secondary" (click)="validate()">Validate all</button>
    <button class="btn btn-sm btn-outline-primary" (click)="recompute()">Recompute scores</button>
  </div>
  <ul class="nav nav-tabs mb-2">
    @for (f of files(); track f) {
      <li class="nav-item"><a class="nav-link" href="" [class.active]="f === current()" (click)="$event.preventDefault(); open(f)">{{ f }}.yaml</a></li>
    }
  </ul>
  @if (error()) { <div class="alert alert-danger py-1 small" style="white-space:pre-wrap">{{ error() }}</div> }
  @if (info()) { <div class="alert alert-success py-1 small">{{ info() }}</div> }
  <div class="d-flex gap-2 mb-2 align-items-center">
    <button class="btn btn-sm btn-primary" [disabled]="!dirty()" (click)="save()">Save {{ current() }}.yaml</button>
    <button class="btn btn-sm btn-outline-secondary" [disabled]="!dirty()" (click)="open(current())">Discard</button>
    @if (scoring(current())) { <span class="small text-body-secondary">Changes here alter the config hash: scores become stale until recomputed.</span> }
  </div>
  <fh-yaml-editor [value]="text()" (changed)="edited = $event; dirty.set(true)" />
  `,
})
export class SettingsPage implements OnInit {
  private api = inject(ApiService);
  private tags = inject(TagsStore);
  protected files = signal<string[]>([]);
  protected current = signal('profile');
  protected text = signal('');
  protected hash = signal('');
  protected dirty = signal(false);
  protected error = signal('');
  protected info = signal('');
  protected edited = '';

  ngOnInit(): void {
    this.api.configStatus().subscribe({
      next: (s) => { this.files.set(s.files); this.hash.set(s.config_hash ?? ''); if (s.errors.length) this.error.set(s.errors.join('\n')); },
      error: (e) => this.error.set(apiError(e)),
    });
    this.open('profile');
  }
  scoring(f: string): boolean { return SCORING.includes(f); }

  open(name: string): void {
    this.current.set(name);
    this.api.config(name).subscribe({
      next: (f) => { this.text.set(f.text); this.edited = f.text; this.dirty.set(false); this.info.set(''); },
      error: (e) => this.error.set(apiError(e)),
    });
  }
  save(): void {
    this.api.putConfig(this.current(), this.edited).subscribe({
      next: (r) => {
        this.hash.set(r.config_hash); this.dirty.set(false); this.error.set('');
        this.info.set(`Saved ${this.current()}.yaml`); this.text.set(this.edited);
        if (this.current() === 'tags') this.tags.load();
      },
      error: (e) => this.error.set(apiError(e)),
    });
  }
  validate(): void {
    this.api.validate().subscribe({
      next: (r) => r.valid ? (this.info.set('All config files are valid'), this.error.set('')) : this.error.set(r.errors.join('\n')),
      error: (e) => this.error.set(apiError(e)),
    });
  }
  recompute(): void {
    this.api.recompute().subscribe({ next: (r) => this.info.set(`Scored ${r.scored} listings under ${r.config_hash}`), error: (e) => this.error.set(apiError(e)) });
  }
}
