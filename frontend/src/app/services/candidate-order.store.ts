import { Injectable, inject, signal } from '@angular/core';
import { ApiService } from './api.service';

const KEY = 'fh.candidates.order';

/**
 * The order of the candidates list as you last saw it (status, search and scope filters applied), so a listing's
 * page can step to the previous and next home of that list. Kept in sessionStorage so a reload keeps it. A
 * listing that is not in the list (opened from the map or by its URL) falls back to the unfiltered list.
 */
@Injectable({ providedIn: 'root' })
export class CandidateOrderStore {
  private api = inject(ApiService);
  readonly ids = signal<string[]>(read());
  private loading = false;

  set(ids: string[]): void {
    this.ids.set(ids);
    try { sessionStorage.setItem(KEY, JSON.stringify(ids)); } catch { /* this tab only */ }
  }

  /** Makes sure `id` is in the list: loads the unfiltered candidates order when it is not. */
  ensure(id: string): void {
    if (this.loading || this.ids().includes(id)) return;
    this.loading = true;
    this.api.listings().subscribe({
      next: (r) => { this.loading = false; this.set(r.items.map((l) => l.short_id)); },
      error: () => { this.loading = false; },
    });
  }

  /** The neighbours of `id` in the list, and its 1-based position. */
  around(id: string): { prev: string | null; next: string | null; pos: number; total: number } | null {
    const ids = this.ids(), i = ids.indexOf(id);
    if (i < 0) return null;
    return { prev: i > 0 ? ids[i - 1] : null, next: i < ids.length - 1 ? ids[i + 1] : null, pos: i + 1, total: ids.length };
  }
}

function read(): string[] {
  try { const v = JSON.parse(sessionStorage.getItem(KEY) ?? '[]'); return Array.isArray(v) ? v : []; }
  catch { return []; }
}
