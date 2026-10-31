import { DestroyRef, TemplateRef } from '@angular/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { LEFT_MAX, LEFT_MIN, LayoutService } from './layout.service';

class FakeDestroy implements Partial<DestroyRef> {
  private fns: (() => void)[] = [];
  onDestroy(fn: () => void) { this.fns.push(fn); return () => {}; }
  destroy() { this.fns.forEach((f) => f()); }
}

const tpl = {} as TemplateRef<unknown>;

describe('LayoutService', () => {
  beforeEach(() => localStorage.clear());

  it('clamps and persists widths and collapsed bubbles', () => {
    const a = new LayoutService();
    a.setLeft(10);
    expect(a.left()).toBe(LEFT_MIN);
    a.setLeft(5000);
    expect(a.left()).toBe(LEFT_MAX);
    a.toggleBubble('map-layers');
    const b = new LayoutService();
    expect(b.left()).toBe(LEFT_MAX);
    expect(b.isCollapsed('map-layers')).toBe(true);
  });

  it('removes a page registration when the page is destroyed, not a newer one', () => {
    const s = new LayoutService();
    const first = new FakeDestroy();
    s.register(first as unknown as DestroyRef, [{ id: 'a', title: 'A', tpl }], { title: 'P', tpl });
    expect(s.showRight()).toBe(true);
    const second = new FakeDestroy();
    s.register(second as unknown as DestroyRef, [{ id: 'b', title: 'B', tpl }]);
    first.destroy();
    expect(s.bubbles().map((b) => b.id)).toEqual(['b']);
    second.destroy();
    expect(s.bubbles()).toEqual([]);
    expect(s.panel()).toBeNull();
  });
});
