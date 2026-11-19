import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { IssueTip } from './issue-tip';

const issues = [
  { code: 'move_in_missing', label: 'No move-in date', cls: 'not_in_source' as const, hint: 'Ask the landlord.' },
  { code: 'photos_missing', label: 'No photos', cls: 'check_extraction' as const, hint: 'Run Complete details.' },
];

function make(inputs: Record<string, unknown>) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ imports: [IssueTip] });
  const f = TestBed.createComponent(IssueTip);
  for (const [k, v] of Object.entries(inputs)) f.componentRef.setInput(k, v);
  f.detectChanges();
  return f;
}

describe('fh-issue-tip', () => {
  it('shows a count badge and opens the tape tooltip on hover', () => {
    const f = make({ issues });
    const el = f.nativeElement as HTMLElement;
    const btn = el.querySelector('button')!;
    expect(btn.textContent).toContain('2');
    expect(el.querySelector('.fh-tape')).toBeNull();
    btn.dispatchEvent(new MouseEvent('mouseenter'));
    f.detectChanges();
    const tape = el.querySelector('.fh-tape')!;
    expect(tape.querySelector('.fh-tape-body')!.textContent).toContain('No move-in date');
    expect(tape.textContent).toContain('check the extraction');
    expect(tape.getAttribute('role')).toBe('tooltip');
    btn.dispatchEvent(new MouseEvent('mouseleave'));
    f.detectChanges();
    expect(el.querySelector('.fh-tape')).toBeNull();
  });

  it('is an icon without a count on the listing page', () => {
    const btn = (make({ issues, mode: 'icon' }).nativeElement as HTMLElement).querySelector('button')!;
    expect(btn.classList).toContain('fh-issue-icon');
    expect(btn.textContent!.trim()).toBe('⚠');
  });
});
