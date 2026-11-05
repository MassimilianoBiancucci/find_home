import { DestroyRef, Injectable, TemplateRef, computed, signal } from '@angular/core';

/** `info`: help id for the corner ⓘ (default `bubble.<id>` / `panel.<title>`, see help.ts). */
export interface Bubble { id: string; title: string; tpl: TemplateRef<unknown>; badge?: string; info?: string; }
export interface RightPanel { title: string; tpl: TemplateRef<unknown>; info?: string; }

interface Persisted { left: number; right: number; leftOpen: boolean; rightOpen: boolean; collapsed: Record<string, boolean>; }

const KEY = 'fh-layout';
export const LEFT_MIN = 220, LEFT_MAX = 560, RIGHT_MIN = 280, RIGHT_MAX = 720;

/**
 * Three-box shell state (debug UI layout): box 1 = nav bubble + bubbles of the active page, box 2 = routed page,
 * box 3 = optional right panel of the active page. Widths and collapsed bubbles persist per browser.
 */
@Injectable({ providedIn: 'root' })
export class LayoutService {
  private readonly saved = this.read();
  readonly left = signal(this.saved.left);
  readonly right = signal(this.saved.right);
  readonly leftOpen = signal(this.saved.leftOpen);
  readonly rightOpen = signal(this.saved.rightOpen);
  readonly collapsed = signal<Record<string, boolean>>(this.saved.collapsed);
  readonly bubbles = signal<Bubble[]>([]);
  readonly panel = signal<RightPanel | null>(null);
  readonly showRight = computed(() => this.panel() !== null && this.rightOpen());

  /** A page publishes its bubbles and right panel; they are removed when the page is destroyed. */
  register(destroy: DestroyRef, bubbles: Bubble[], panel?: RightPanel): void {
    this.bubbles.set(bubbles);
    this.panel.set(panel ?? null);
    destroy.onDestroy(() => {
      if (this.bubbles() === bubbles) this.bubbles.set([]);
      if (panel && this.panel() === panel) this.panel.set(null);
    });
  }

  isCollapsed(id: string): boolean { return !!this.collapsed()[id]; }
  toggleBubble(id: string): void { this.collapsed.update((c) => ({ ...c, [id]: !c[id] })); this.save(); }
  setLeft(px: number): void { this.left.set(Math.round(Math.min(LEFT_MAX, Math.max(LEFT_MIN, px)))); this.save(); }
  setRight(px: number): void { this.right.set(Math.round(Math.min(RIGHT_MAX, Math.max(RIGHT_MIN, px)))); this.save(); }
  toggleLeft(): void { this.leftOpen.update((v) => !v); this.save(); }
  toggleRight(open?: boolean): void { this.rightOpen.update((v) => open ?? !v); this.save(); }
  reset(): void { this.left.set(300); this.right.set(380); this.save(); }

  private read(): Persisted {
    const def: Persisted = { left: 300, right: 380, leftOpen: true, rightOpen: true, collapsed: {} };
    try { return { ...def, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return def; }
  }

  private save(): void {
    const p: Persisted = { left: this.left(), right: this.right(), leftOpen: this.leftOpen(), rightOpen: this.rightOpen(),
      collapsed: this.collapsed() };
    try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* storage unavailable */ }
  }
}
