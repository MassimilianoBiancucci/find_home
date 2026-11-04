import { Component, OnInit, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { BubbleComponent } from './components/bubble';
import { Health } from './models';
import { ApiService } from './services/api.service';
import { LayoutService } from './services/layout.service';
import { TagsStore } from './services/tags.store';
import { ThemeService } from './services/theme.service';

interface NavItem { path: string; label: string; key: string; children?: { path: string; label: string }[]; }

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, NgTemplateOutlet, BubbleComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit {
  protected theme = inject(ThemeService);
  protected layout = inject(LayoutService);
  private api = inject(ApiService);
  private tags = inject(TagsStore);
  protected health = signal<Health | null>(null);
  protected apiDown = signal(false);

  protected readonly nav: NavItem[] = [
    { path: '/candidates', label: 'Candidates', key: 'C' },
    { path: '/map', label: 'Map', key: 'M', children: [
      { path: '/map/explore', label: 'Explore' }, { path: '/map/area', label: 'Area' },
      { path: '/map/connectivity', label: 'Connectivity' }, { path: '/map/zone', label: 'Zone' },
    ] },
    { path: '/locations', label: 'Locations', key: 'L' },
    { path: '/sites', label: 'Sites', key: 'S' },
    { path: '/runs', label: 'Runs', key: 'R' },
    { path: '/settings', label: 'Settings', key: 'G' },
  ];

  ngOnInit(): void {
    this.tags.load();
    this.api.health().subscribe({
      next: (h) => { this.health.set(h); this.apiDown.set(false); },
      error: (e) => { this.health.set(e?.error?.status ? e.error : null); this.apiDown.set(!e?.error?.status); },
    });
  }

  /** Drag a handle: the left box follows the pointer; the right box keeps its distance to the window edge. */
  protected drag(ev: PointerEvent, side: 'left' | 'right'): void {
    ev.preventDefault();
    const shell = (ev.target as HTMLElement).closest('.fh-shell') as HTMLElement;
    const rect = shell.getBoundingClientRect();
    document.body.style.cursor = 'col-resize';
    const move = (e: PointerEvent) => side === 'left'
      ? this.layout.setLeft(e.clientX - rect.left)
      : this.layout.setRight(rect.right - e.clientX);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.cursor = '';
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
}
