import { Injectable, inject, signal } from '@angular/core';
import { TransitPlan, TransitResult } from '../models';
import { ApiService, apiError } from '../services/api.service';

/**
 * "Compute transit routes" state per listing, shared by the house page and the 3D house view: the call count
 * (dry run, no API calls) and the itineraries once computed. Results stay for the session; the server caches them.
 */
@Injectable({ providedIn: 'root' })
export class HouseTravelStore {
  private api = inject(ApiService);
  readonly plans = signal<Record<string, TransitPlan>>({});
  readonly results = signal<Record<string, TransitResult>>({});
  readonly busy = signal<string | null>(null);
  readonly error = signal('');

  /** Count the calls (server dry run); called when the button is shown or hovered. */
  plan(id: string): void {
    if (this.plans()[id]) return;
    this.api.listingTransit(id, true).subscribe({
      next: (p) => this.plans.update((m) => ({ ...m, [id]: p })),
      error: () => {},
    });
  }

  /** Ask ResRobot for the itineraries (explicit user action). */
  compute(id: string): void {
    if (this.busy()) return;
    this.busy.set(id);
    this.error.set('');
    this.api.listingTransit(id, false).subscribe({
      next: (r) => {
        this.results.update((m) => ({ ...m, [id]: r }));
        this.plans.update((m) => ({ ...m, [id]: { ...r, calls: 0, cached: r.destinations } }));
        this.busy.set(null);
      },
      error: (e) => { this.error.set(apiError(e)); this.busy.set(null); },
    });
  }

  result(id: string): TransitResult | null { return this.results()[id] ?? null; }
}
