import { DestroyRef, Injectable, computed, signal } from '@angular/core';
import { ZoneRef } from '../../models';

/** Where the map was right-clicked: coordinates, screen position inside the map, and the zone under it (when known). */
export interface MenuContext { lat: number; lon: number; x: number; y: number; zone: ZoneRef | null; }
export interface MenuEntry {
  id: string;
  label: (ctx: MenuContext) => string;
  run: (ctx: MenuContext) => void;
  enabled?: (ctx: MenuContext) => boolean;
  order?: number;            // lower first; shell entries use 10, 20, ...
}

/** The map's right-click menu. The shell registers the base entries; modes add theirs while they are active. */
@Injectable({ providedIn: 'root' })
export class ContextMenuService {
  private registered = signal<MenuEntry[]>([]);
  readonly context = signal<MenuContext | null>(null);
  readonly entries = computed(() => [...this.registered()].sort((a, b) => (a.order ?? 50) - (b.order ?? 50)));

  register(destroy: DestroyRef, entries: MenuEntry[]): void {
    this.registered.update((all) => [...all.filter((e) => !entries.some((n) => n.id === e.id)), ...entries]);
    destroy.onDestroy(() => this.registered.update((all) => all.filter((e) => !entries.includes(e))));
  }

  open(ctx: MenuContext): void { this.context.set(ctx); }
  /** Fill in the zone once the lookup answers (the menu opens at once, without waiting). */
  setZone(zone: ZoneRef | null): void { this.context.update((c) => (c ? { ...c, zone } : c)); }
  close(): void { this.context.set(null); }

  run(e: MenuEntry): void {
    const ctx = this.context();
    this.close();
    if (ctx) e.run(ctx);
  }
}
