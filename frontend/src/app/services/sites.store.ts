import { Injectable, computed, inject, signal } from '@angular/core';
import { Site } from '../models';
import { ApiService } from './api.service';

/** The site registry (/api/sites), shared by every page that shows a site logo or name. Loaded once, refreshable. */
@Injectable({ providedIn: 'root' })
export class SitesStore {
  private api = inject(ApiService);
  private loading = false;
  readonly sites = signal<Site[]>([]);
  readonly bySlug = computed(() => new Map(this.sites().map((s) => [s.slug, s])));
  /** Slugs whose logo failed to load: they show the monogram without asking again. */
  readonly failedLogos = signal<ReadonlySet<string>>(new Set());

  load(force = false): void {
    if (this.loading || (!force && this.sites().length)) return;
    this.loading = true;
    this.api.sites().subscribe({
      next: (r) => { this.sites.set(r.items); this.loading = false; },
      error: () => { this.loading = false; },
    });
  }
  set(items: Site[]): void { this.sites.set(items); }
  name(slug?: string | null): string { return slug ? this.bySlug().get(slug)?.name ?? slug : ''; }
  /** The scanned site whose platforms bring this origin's homes (e.g. homeq → qasa), or null. */
  aggregatorOf(slug: string): Site | null {
    return this.sites().find((s) => s.slug !== slug && Object.values(s.platforms ?? {}).includes(slug)) ?? null;
  }
  logoFailed(slug: string): void { this.failedLogos.update((s) => new Set(s).add(slug)); }
}
