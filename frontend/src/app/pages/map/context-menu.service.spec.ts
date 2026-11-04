import { DestroyRef } from '@angular/core';
import { describe, expect, it } from 'vitest';
import { ContextMenuService, MenuContext } from './context-menu.service';

class FakeDestroy implements Partial<DestroyRef> {
  private fns: (() => void)[] = [];
  onDestroy(fn: () => void) { this.fns.push(fn); return () => {}; }
  destroy() { this.fns.forEach((f) => f()); }
}

const at: MenuContext = { lat: 59.3, lon: 18.0, x: 10, y: 20, zone: null };

describe('ContextMenuService', () => {
  it('orders entries, drops a mode\'s entries when it is destroyed and runs an entry with the click context', () => {
    const menu = new ContextMenuService();
    const shell = new FakeDestroy(), mode = new FakeDestroy();
    const ran: MenuContext[] = [];
    menu.register(shell as unknown as DestroyRef, [
      { id: 'b', order: 20, label: () => 'B', run: () => undefined },
      { id: 'a', order: 10, label: () => 'A', run: (c) => ran.push(c) },
    ]);
    menu.register(mode as unknown as DestroyRef, [{ id: 'm', label: () => 'M', run: () => undefined }]);
    expect(menu.entries().map((e) => e.id)).toEqual(['a', 'b', 'm']);
    mode.destroy();
    expect(menu.entries().map((e) => e.id)).toEqual(['a', 'b']);

    menu.open(at);
    menu.setZone({ id: 'Z1', name: 'Example zone' });
    expect(menu.context()?.zone?.id).toBe('Z1');
    menu.run(menu.entries()[0]);
    expect(menu.context()).toBeNull();
    expect(ran[0].zone?.name).toBe('Example zone');
  });
});
