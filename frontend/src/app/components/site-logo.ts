import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { SitesStore } from '../services/sites.store';

/** Two letters of a site name for the fallback monogram: "HomeQ" → "HQ", "Blocket Bostad" → "BB", "qasa" → "QA". */
export function monogram(name: string): string {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (words.length > 1) return (words[0][0] + words[1][0]).toUpperCase();
  const w = words[0] ?? '?';
  const caps = w.slice(1).match(/\p{Lu}/u);
  return (w[0] + (caps ? caps[0] : w[1] ?? '')).toUpperCase();
}

/** A site's logo (/api/sites/{slug}/logo: a file or the favicon) with a monogram in the brand colour when it fails. */
@Component({
  selector: 'fh-site-logo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="fh-logo" [class]="'fh-logo-' + size()" [class.has-img]="loaded() && !failed()" [title]="tip()" [style.--brand]="colour()">
    <span class="fh-logo-mono">{{ mono() }}</span>
    @if (!failed()) { <img [src]="'/api/sites/' + slug() + '/logo'" alt="" [class.on]="loaded()" (load)="loaded.set(true)" (error)="store.logoFailed(slug())" /> }
  </span>@if (withName()) { <span class="fh-logo-name">{{ name() }}</span> }`,
  host: { class: 'fh-logo-host' },
})
export class SiteLogo {
  protected store = inject(SitesStore);
  readonly slug = input.required<string>();
  readonly size = input<'sm' | 'md' | 'lg'>('sm');
  readonly title = input<string | null>(null);
  readonly withName = input(false);
  protected site = computed(() => this.store.bySlug().get(this.slug()));
  protected name = computed(() => this.site()?.name ?? this.slug());
  protected colour = computed(() => this.site()?.brand?.colour ?? 'var(--fh-muted)');
  protected failed = computed(() => this.store.failedLogos().has(this.slug()));
  protected mono = computed(() => monogram(this.name()));
  protected tip = computed(() => this.title() ?? this.name());
  /** The monogram shows until the logo has loaded (and stays when it fails). */
  protected loaded = signal(false);
  constructor() { this.store.load(); }
}
