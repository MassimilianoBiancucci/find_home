import { Injectable, inject, signal } from '@angular/core';
import { HouseTrip, TransitPlan, TransitResult } from '../models';
import { ApiService, apiError } from '../services/api.service';

/** What a "Compute transit routes" button asks for: your points (locations.yaml) or the nearest services. */
export type TransitWhich = 'points' | 'services';
const KIND: Record<TransitWhich, HouseTrip['kind']> = { points: 'point', services: 'service' };

/** The merged itineraries of a listing with the trips of one kind replaced by a new answer. */
export function mergeTrips(old: TransitResult | undefined, which: TransitWhich, r: TransitResult): TransitResult {
  const keep = (old?.trips ?? []).filter((t) => t.kind !== KIND[which]);
  return { ...r, destinations: keep.length + r.trips.length, trips: [...keep, ...r.trips] };
}

/**
 * "Compute transit routes" state per listing, shared by the house page and the 3D house view: the call counts
 * (dry runs, no API calls) for your points and for the services, the itineraries once computed (both kinds merged),
 * whether the services' routes are drawn, and the route under the mouse. Results stay for the session; the server
 * caches them.
 */
@Injectable({ providedIn: 'root' })
export class HouseTravelStore {
  private api = inject(ApiService);
  /** Dry-run counts per `${id}|${which}`. */
  readonly plans = signal<Record<string, TransitPlan>>({});
  readonly results = signal<Record<string, TransitResult>>({});
  /** Which kinds were computed per listing. */
  readonly done = signal<Record<string, TransitWhich[]>>({});
  /** `${id}|${which}` while computing. */
  readonly busy = signal<string | null>(null);
  readonly error = signal('');
  /** Draw the services' transit routes on the maps (off: their walks are enough); on after computing them. */
  readonly showServices = signal(false);
  /** The trip (point_id, or service:<set>) under the mouse, on a map or in the list: drawn on top, glowing. */
  readonly hover = signal<string | null>(null);

  planFor(id: string, which: TransitWhich): TransitPlan | null { return this.plans()[`${id}|${which}`] ?? null; }
  isBusy(id: string, which: TransitWhich): boolean { return this.busy() === `${id}|${which}`; }
  isDone(id: string, which: TransitWhich): boolean { return (this.done()[id] ?? []).includes(which); }

  /** Count the calls (server dry run); called when the buttons are shown or hovered. */
  plan(id: string, which: TransitWhich): void {
    const k = `${id}|${which}`;
    if (this.plans()[k]) return;
    this.api.listingTransit(id, true, which).subscribe({
      next: (p) => this.plans.update((m) => ({ ...m, [k]: p })),
      error: () => {},
    });
  }

  /** Ask ResRobot for the itineraries of one kind (explicit user action). */
  compute(id: string, which: TransitWhich): void {
    if (this.busy()) return;
    const k = `${id}|${which}`;
    this.busy.set(k);
    this.error.set('');
    this.api.listingTransit(id, false, which).subscribe({
      next: (r) => {
        this.results.update((m) => ({ ...m, [id]: mergeTrips(m[id], which, r) }));
        this.plans.update((m) => ({ ...m, [k]: { ...r, calls: 0, cached: r.destinations } }));
        this.done.update((m) => ({ ...m, [id]: [...new Set([...(m[id] ?? []), which])] }));
        if (which === 'services') this.showServices.set(true);
        this.busy.set(null);
      },
      error: (e) => { this.error.set(apiError(e)); this.busy.set(null); },
    });
  }

  result(id: string): TransitResult | null { return this.results()[id] ?? null; }
}
