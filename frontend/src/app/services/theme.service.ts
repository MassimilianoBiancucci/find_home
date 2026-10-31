import { Injectable, signal } from '@angular/core';

type Theme = 'dark' | 'light';

/** Bootstrap colour mode on <html data-bs-theme>; remembered per browser when storage is available. */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly theme = signal<Theme>(this.read());

  constructor() { this.apply(this.theme()); }

  toggle(): void {
    const next: Theme = this.theme() === 'dark' ? 'light' : 'dark';
    this.theme.set(next);
    this.apply(next);
    try { localStorage.setItem('fh-theme', next); } catch { /* storage unavailable */ }
  }

  private read(): Theme {
    try {
      const saved = localStorage.getItem('fh-theme');
      if (saved === 'dark' || saved === 'light') return saved;
    } catch { /* storage unavailable */ }
    return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  private apply(theme: Theme): void { document.documentElement.setAttribute('data-bs-theme', theme); }
}
