import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** A circle as a path, so every icon is a list of path data. */
const circle = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;

/** Line icons on a 24×24 grid, drawn with a 2px round stroke in the current colour. */
export const NAV_ICONS: Record<string, string[]> = {
  home: ['M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z'],
  map: ['M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z', 'M9 4v14', 'M15 6v14'],
  compass: [circle(12, 12, 9), 'm15.5 8.5-2.2 4.8-4.8 2.2 2.2-4.8z'],
  area: ['M4 8l7-5 9 5-2 10-9 3-5-6z', circle(11, 11, 0.6)],
  route: [circle(6, 18, 2), circle(18, 6, 2), 'M6 16v-3a4 4 0 0 1 4-4h4a4 4 0 0 0 4-4'],
  zone: ['M12 3l8 4.5v9L12 21l-8-4.5v-9z', circle(12, 12, 2.5)],
  pin: ['M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z', circle(12, 10, 2.5)],
  globe: [circle(12, 12, 9), 'M3 12h18', 'M12 3a14 14 0 0 1 0 18', 'M12 3a14 14 0 0 0 0 18'],
  pulse: ['M3 12h4l3-8 4 16 3-8h4'],
  jobs: ['M4 7h16v12H4z', 'M9 7V5h6v2', 'M4 12h16', 'M11 12v2h2v-2'],
  sliders: ['M4 6h10', 'M18 6h2', circle(16, 6, 2), 'M4 12h4', 'M12 12h8', circle(10, 12, 2), 'M4 18h12', 'M20 18h0', circle(18, 18, 2)],
};

/** One navigation icon by name (NAV_ICONS). */
@Component({
  selector: 'fh-nav-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<svg viewBox="0 0 24 24" [attr.width]="size()" [attr.height]="size()" fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">@for (d of paths(); track $index) { <path [attr.d]="d" /> }</svg>`,
  styles: [':host { display: inline-flex; } svg { display: block; }'],
})
export class NavIcon {
  readonly name = input.required<string>();
  readonly size = input(16);
  protected paths = computed(() => NAV_ICONS[this.name()] ?? []);
}
