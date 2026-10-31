import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Health } from './models';
import { ApiService } from './services/api.service';
import { TagsStore } from './services/tags.store';
import { ThemeService } from './services/theme.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit {
  protected theme = inject(ThemeService);
  private api = inject(ApiService);
  private tags = inject(TagsStore);
  protected health = signal<Health | null>(null);
  protected apiDown = signal(false);

  protected readonly nav = [
    { path: '/candidates', label: 'Candidates', key: 'C' },
    { path: '/map', label: 'Map', key: 'M' },
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
}
