import { Injectable, inject, signal } from '@angular/core';
import { Listing } from './models';
import { ApiService } from './services/api.service';

export type ValueField = 'rent_sek' | 'size_m2' | 'rooms_rok' | 'rent_per_m2';
export interface ScaleField {
  better: 'low' | 'high'; limit: number | null; ideal: number | null; limit_key: string | null; ideal_key: string | null;
  /** Sorted values of the listings still in the running (scored, not rejected by a filter or by you). */
  values: number[];
}
/** Your move-in window from config/profile.yaml hard_filters (ISO dates, null when not set). */
export interface MoveInWindow { from: string | null; to: string | null; }
export interface ValueScale { n: number; fields: Record<ValueField, ScaleField>; move_in?: MoveInWindow; }
export interface ValueRating { score: number; colour: string; title: string; }

const UNIT: Record<ValueField, (v: number) => string> = {
  rent_sek: (v) => `${Math.round(v).toLocaleString('sv-SE')} kr`, size_m2: (v) => `${v} m²`,
  rooms_rok: (v) => `${v} rok`, rent_per_m2: (v) => `${Math.round(v)} kr/m²`,
};

/** A listing's value of a field (rent per m² derived). */
export function valueOf(l: Pick<Listing, 'rent_sek' | 'size_m2' | 'rooms_rok'>, f: ValueField): number | null {
  if (f === 'rent_per_m2') return l.rent_sek && l.size_m2 ? l.rent_sek / l.size_m2 : null;
  return (l[f] as number | null | undefined) ?? null;
}

/**
 * How good a value is, 0-1, and its colour: the mean of its percentile among the listings in the running (better
 * than N %) and its place between your limit and your ideal, when you set them. A value past your limit is red.
 */
export function rateValue(v: number | null | undefined, f: ValueField, s: ScaleField | undefined): ValueRating | null {
  if (v == null || !s || !s.values.length) return null;
  const n = s.values.length, below = s.values.filter((x) => x < v).length, same = s.values.filter((x) => x === v).length;
  const p = (below + same / 2) / n;
  const good = s.better === 'high' ? p : 1 - p;
  const fmt = UNIT[f];
  const parts = [`better than ${Math.round(good * 100)} % of the ${n} listings in the running`];
  if (s.limit != null) parts.push(`your ${s.better === 'high' ? 'minimum' : 'maximum'} ${fmt(s.limit)}`);
  if (s.ideal != null) parts.push(`ideal ${fmt(s.ideal)}`);
  const fails = s.limit != null && (s.better === 'high' ? v < s.limit : v > s.limit);
  let t: number | null = null;
  if (fails) t = 0;
  else if (s.ideal != null) {
    const meets = s.better === 'high' ? v >= s.ideal : v <= s.ideal;
    if (meets) t = 1;
    else if (s.limit != null && s.limit !== s.ideal) t = Math.max(0, Math.min(1, (v - s.limit) / (s.ideal - s.limit)));
  }
  const score = fails ? 0 : t == null ? good : (t + good) / 2;
  const colour = score >= 0.67 ? 'var(--fh-good)' : score >= 0.33 ? 'var(--fh-mid)' : 'var(--fh-bad)';
  return { score, colour, title: `${fmt(Math.round(v * 10) / 10)}: ${fails ? 'past your limit · ' : ''}${parts.join(' · ')}` };
}

/**
 * A move-in date against your window: inside it green, before it amber (you would pay two rents or wait), after it
 * red (the move_in_to hard filter rejects it). No window set: no colour. ISO dates compare as strings.
 */
export function rateMoveIn(date: string | null | undefined, w: MoveInWindow | null | undefined): ValueRating | null {
  if (!date || !w || (!w.from && !w.to)) return null;
  const d = date.slice(0, 10);
  const win = `your window ${w.from ?? '…'} → ${w.to ?? '…'} (config/profile.yaml)`;
  if (w.to && d > w.to) return { score: 0, colour: 'var(--fh-bad)', title: `${d}: after ${win}, rejected by move_in_to` };
  if (w.from && d < w.from) return { score: 0.5, colour: 'var(--fh-mid)', title: `${d}: before ${win}` };
  return { score: 1, colour: 'var(--fh-good)', title: `${d}: inside ${win}` };
}

/** The value scale, loaded once (and again after a recompute of the scores). */
@Injectable({ providedIn: 'root' })
export class ValueScaleStore {
  private api = inject(ApiService);
  readonly scale = signal<ValueScale | null>(null);
  private loaded = false;

  load(force = false): void {
    if (this.loaded && !force) return;
    this.loaded = true;
    this.api.listingScale().subscribe({ next: (s) => this.scale.set(s), error: () => { this.loaded = false; } });
  }

  rate(l: Pick<Listing, 'rent_sek' | 'size_m2' | 'rooms_rok'>, f: ValueField): ValueRating | null {
    return rateValue(valueOf(l, f), f, this.scale()?.fields[f]);
  }

  moveIn(l: Pick<Listing, 'available_from'>): ValueRating | null { return rateMoveIn(l.available_from, this.scale()?.move_in); }
}
