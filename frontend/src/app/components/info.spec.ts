import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { Derivation, HELP } from '../help';
import { contributions } from './explain';
import { InfoButton } from './info';

describe('fh-info', () => {
  const make = (id: string, quiet = false) => {
    TestBed.configureTestingModule({ imports: [InfoButton] });
    const f = TestBed.createComponent(InfoButton);
    f.componentRef.setInput('id', id);
    f.componentRef.setInput('quiet', quiet);
    f.detectChanges();
    return f;
  };

  it('opens a popover with the entry title, formula and config keys', () => {
    const f = make('score.commute');
    const btn = f.nativeElement.querySelector('button.fh-info-btn') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    btn.click();
    f.detectChanges();
    const pop = f.nativeElement.querySelector('.fh-info-pop') as HTMLElement;
    expect(pop.textContent).toContain(HELP['score.commute'].title);
    expect(pop.querySelector('.fh-info-formula')).toBeTruthy();
    expect(pop.querySelectorAll('.fh-info-config code').length).toBe(HELP['score.commute'].config!.length);
  });

  it('opens upwards near the bottom of the screen, within the room above', () => {
    const f = make('listing.commute');
    const btn = f.nativeElement.querySelector('button.fh-info-btn') as HTMLButtonElement;
    const vh = window.innerHeight;
    btn.getBoundingClientRect = () => ({ top: vh - 40, bottom: vh - 24, left: 100, right: 116, width: 16, height: 16, x: 100, y: vh - 40, toJSON: () => ({}) });
    btn.click();
    f.detectChanges();
    const pop = f.nativeElement.querySelector('.fh-info-pop') as HTMLElement;
    expect(pop.style.top).toBe('');
    expect(pop.style.bottom).toBe('46px');
    expect(parseFloat(pop.style.maxHeight)).toBe(vh - 54);
  });

  it('renders nothing for an unknown id, and warns only when not quiet', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(make('no.such.entry', true).nativeElement.querySelector('button')).toBeNull();
    expect(warn).not.toHaveBeenCalled();
    TestBed.resetTestingModule();
    make('no.such.entry');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('contributions', () => {
  it('weights the rows with data and leaves the others out', () => {
    const d: Derivation = { label: 'Set', total: 0.7, rows: [
      { name: 'a', input: '4 min', score: 1, weight: 1 },
      { name: 'b', input: '12 min', score: 0.4, weight: 1 },
      { name: 'c', input: 'no data', score: null, weight: 2 },
    ] };
    const c = contributions(d);
    expect(c[0].share).toBeCloseTo(0.5);
    expect(c[1].share).toBeCloseTo(0.2);
    expect(c[2].share).toBeNull();
    expect((c[0].share ?? 0) + (c[1].share ?? 0)).toBeCloseTo(d.total!);
  });
});
