import { Component, OnInit, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { BubbleComponent } from './components/bubble';
import { InfoButton } from './components/info';
import { NavIcon } from './components/nav-icon';
import { Toasts } from './components/toasts';
import { Health } from './models';
import { ApiService } from './services/api.service';
import { LayoutService } from './services/layout.service';
import { TagsStore } from './services/tags.store';
import { ThemeService } from './services/theme.service';

/** A page in the Pages menu: its icon (NAV_ICONS) and the two colours of its bright badge. */
interface NavLink { path: string; label: string; icon: string; hue: [string, string]; }
interface NavItem extends NavLink { key: string; children?: NavLink[]; }

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, NgTemplateOutlet, BubbleComponent, InfoButton, NavIcon, Toasts],
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
    { path: '/candidates', label: 'Candidates', key: 'C', icon: 'home', hue: ['#ff6ad5', '#c43dff'] },
    { path: '/map', label: 'Map', key: 'M', icon: 'map', hue: ['#6ff3ff', '#19b8e6'], children: [
      { path: '/map/explore', label: 'Explore', icon: 'compass', hue: ['#6ff3ff', '#19b8e6'] },
      { path: '/map/area', label: 'Area', icon: 'area', hue: ['#d68bff', '#a020f0'] },
      { path: '/map/connectivity', label: 'Connectivity', icon: 'route', hue: ['#7ab8ff', '#2f6bff'] },
      { path: '/map/zone', label: 'Zone', icon: 'zone', hue: ['#ffc46b', '#f08c00'] },
    ] },
    { path: '/locations', label: 'Locations', key: 'L', icon: 'pin', hue: ['#5cf2a0', '#16c172'] },
    { path: '/sites', label: 'Sites', key: 'S', icon: 'globe', hue: ['#8f9bff', '#6a5cff'] },
    { path: '/runs', label: 'Runs', key: 'R', icon: 'pulse', hue: ['#ff8fb1', '#ff2d78'] },
    { path: '/jobs', label: 'Jobs', key: 'J', icon: 'jobs', hue: ['#ffd36b', '#ffa51f'] },
    { path: '/settings', label: 'Settings', key: 'G', icon: 'sliders', hue: ['#c9c9d6', '#8a8aa0'] },
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
