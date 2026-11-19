import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { AdStatusBadge } from './ad-status-badge';

function make(inputs: Record<string, unknown>): HTMLElement {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ imports: [AdStatusBadge] });
  const f = TestBed.createComponent(AdStatusBadge);
  for (const [k, v] of Object.entries(inputs)) f.componentRef.setInput(k, v);
  f.detectChanges();
  return (f.nativeElement as HTMLElement).querySelector('span')!;
}

describe('fh-ad-status', () => {
  it('names the status in plain words, coloured by kind', () => {
    const let_ = make({ status: 'rented' });
    expect(let_.textContent).toBe('Let');
    expect(let_.className).toContain('fh-ad-rented');
    expect(make({ status: 'applications_closed' }).textContent).toBe('Applications closed');
    expect(make({ status: null }).textContent).toBe('Not checked');
  });

  it('puts the site, the evidence and the check time in the tooltip', () => {
    const el = make({ status: 'removed', site: 'Exempelsajten', checkedAt: '2026-11-09T10:00:00Z',
      evidence: { rule: 'redirect', value: 'https://example.invalid/borta' } });
    expect(el.title).toContain('Exempelsajten: Removed');
    expect(el.title).toContain('redirect: https://example.invalid/borta');
    expect(el.title).toContain('checked');
  });
});
