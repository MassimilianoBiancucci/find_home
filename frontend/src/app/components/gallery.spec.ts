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

  it('band mode starts folded to the thumbnails; a thumbnail unfolds it on that photo, only ⛶ opens the viewer', () => {
    const f = make({ photos, band: true });
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('.fh-gal-main')).toBeNull();
    const thumbs = el.querySelectorAll<HTMLButtonElement>('.fh-gal-thumbs.band .fh-gal-thumb');
    expect(thumbs.length).toBe(4);
    thumbs[2].click();
    f.detectChanges();
    const main = el.querySelector('.fh-gal-main img') as HTMLImageElement;
    expect(main.src).toContain('c.jpg');
    expect(el.querySelector('.fh-gal-thumbs.band')).toBeNull();
    main.click();
    f.detectChanges();
    expect(el.querySelector('.fh-gal-viewer')).toBeNull();
    (el.querySelector('.fh-gal-fs') as HTMLButtonElement).click();
    f.detectChanges();
    expect((el.querySelector('.fh-gal-vimg img') as HTMLImageElement).src).toContain('c.jpg');
    key('Escape'); f.detectChanges();
    (el.querySelector('.fh-gal-fold') as HTMLButtonElement).click();
    f.detectChanges();
    expect(el.querySelector('.fh-gal-main')).toBeNull();
  });

  it('shows the three plan kinds: an image, a PDF by its cached first page, a viewer page as a link card', () => {
    const plans = ['https://plans.example/p1', 'https://plans.example/p2.pdf', 'https://viewer.example/v/3', 'https://plans.example/p4.jpg'];
    const f = make({ photos, plans, plansMeta: [
      { url: plans[0], kind: 'pdf', preview: 'a'.repeat(40) }, { url: plans[1], kind: 'pdf' },
      { url: plans[2], kind: 'viewer' }, { url: plans[3], kind: 'image' }] });
    const el = f.nativeElement as HTMLElement;
    (el.querySelectorAll<HTMLButtonElement>('.fh-gal-tabs button'))[1].click();
    f.detectChanges();
    const at = (i: number) => { f.componentInstance['index'].set(i); f.detectChanges(); return el.querySelector('.fh-gal-main') as HTMLElement; };
    expect((at(0).querySelector('img') as HTMLImageElement).src).toContain('/api/floorplans/' + 'a'.repeat(40) + '.png');
    expect(at(0).querySelector('.fh-gal-orig')?.getAttribute('href')).toBe(plans[0]);
    expect(at(1).querySelector('.fh-gal-pdf')?.textContent).toContain('PDF floor plan');
    expect(at(2).querySelector('.fh-gal-pdf')?.textContent).toContain('Interactive floor plan');
    expect((at(3).querySelector('img') as HTMLImageElement).src).toContain('p4.jpg');
  });

  it('keeps a plan whose image fails as a link card, but drops a broken photo', () => {
    const plans = ['https://plans.example/gone.png'];
    const f = make({ photos, plans });
    const g = f.componentInstance as unknown as { broken(u: string): void };
    g.broken(plans[0]); g.broken(photos[0]);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    const tabs = el.querySelectorAll<HTMLButtonElement>('.fh-gal-tabs button');
    expect(tabs[0].textContent).toContain('3');
    tabs[1].click(); f.detectChanges();
    expect(el.querySelector('.fh-gal-main .fh-gal-pdf')?.textContent).toContain('Floor plan');
  });

  it('compact mode shows three thumbnails and the rest as +N', () => {
    const el = make({ photos, compact: true }).nativeElement as HTMLElement;
    expect(el.querySelectorAll('.fh-gal-strip .fh-gal-thumb').length).toBe(3);
    expect(el.querySelector('.fh-gal-more')?.textContent).toContain('+1');
  });
});
