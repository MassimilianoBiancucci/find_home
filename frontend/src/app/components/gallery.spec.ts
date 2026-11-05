import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { GalleryComponent } from './gallery';

const photos = ['https://img.example/a.jpg', 'https://img.example/b.jpg', 'https://img.example/c.jpg', 'https://img.example/d.jpg'];

function make(inputs: Record<string, unknown>) {
  TestBed.configureTestingModule({ imports: [GalleryComponent] });
  const f = TestBed.createComponent(GalleryComponent);
  for (const [k, v] of Object.entries(inputs)) f.componentRef.setInput(k, v);
  f.detectChanges();
  return f;
}
const key = (k: string) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k }));

describe('fh-gallery', () => {
  it('says so when there are no photos', () => {
    const el = make({ photos: [] }).nativeElement as HTMLElement;
    expect(el.querySelector('.fh-gal-empty')).toBeTruthy();
    expect(el.textContent).not.toContain('Floor plans');
  });

  it('shows the floor plans tab only when there are plans, and switches to them', () => {
    expect((make({ photos }).nativeElement as HTMLElement).textContent).not.toContain('Floor plans');
    TestBed.resetTestingModule();
    const f = make({ photos, plans: ['https://img.example/plan.png'] });
    const tabs = (f.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('.fh-gal-tabs button');
    expect(tabs.length).toBe(2);
    tabs[1].click();
    f.detectChanges();
    const main = (f.nativeElement as HTMLElement).querySelector('.fh-gal-main img') as HTMLImageElement;
    expect(main.src).toContain('plan.png');
  });

  it('opens the viewer, moves with the arrow keys (wrapping) and closes with Esc', () => {
    const f = make({ photos });
    ((f.nativeElement as HTMLElement).querySelector('.fh-gal-main img') as HTMLImageElement).click();
    f.detectChanges();
    const img = () => (f.nativeElement as HTMLElement).querySelector('.fh-gal-vimg img') as HTMLImageElement;
    expect(img().src).toContain('a.jpg');
    key('ArrowLeft'); f.detectChanges();
    expect(img().src).toContain('d.jpg');
    key('ArrowRight'); key('ArrowRight'); f.detectChanges();
    expect(img().src).toContain('b.jpg');
    key('Escape'); f.detectChanges();
    expect((f.nativeElement as HTMLElement).querySelector('.fh-gal-viewer')).toBeNull();
  });

  it('compact mode shows three thumbnails and the rest as +N', () => {
    const el = make({ photos, compact: true }).nativeElement as HTMLElement;
    expect(el.querySelectorAll('.fh-gal-strip .fh-gal-thumb').length).toBe(3);
    expect(el.querySelector('.fh-gal-more')?.textContent).toContain('+1');
  });
});
