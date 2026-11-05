import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { Popover } from './popover';

@Component({ imports: [Popover], template: `<fh-popover kind="chip" tone="bad" label="Last scan failed" heading="Last scan error">full error text</fh-popover>` })
class Host {}

describe('fh-popover', () => {
  it('opens on click with the full text and closes on Esc and outside clicks', () => {
    TestBed.configureTestingModule({ imports: [Host] });
    const f = TestBed.createComponent(Host);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    const btn = el.querySelector('button.fh-pop-trigger') as HTMLButtonElement;
    expect(btn.textContent).toContain('Last scan failed');
    expect(btn.classList).toContain('fh-tone-bad');
    expect(el.querySelector('.fh-pop')).toBeNull();
    btn.click();
    f.detectChanges();
    expect(el.querySelector('.fh-pop')?.textContent).toContain('full error text');
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    f.detectChanges();
    expect(el.querySelector('.fh-pop')).toBeNull();
    btn.click();
    f.detectChanges();
    document.body.click();
    f.detectChanges();
    expect(el.querySelector('.fh-pop')).toBeNull();
  });
});
