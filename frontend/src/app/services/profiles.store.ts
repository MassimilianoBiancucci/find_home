import { Injectable, inject, signal } from '@angular/core';
import { AgentProfile } from '../models';
import { ApiService } from './api.service';

/** Agent profiles (/api/agent-profiles), loaded once: which parameters a launch may pass (e.g. the model). */
@Injectable({ providedIn: 'root' })
export class ProfilesStore {
  private api = inject(ApiService);
  private loading = false;
  readonly profiles = signal<AgentProfile[]>([]);

  load(): void {
    if (this.loading || this.profiles().length) return;
    this.loading = true;
    this.api.profiles().subscribe({ next: (r) => { this.profiles.set(r.items); this.loading = false; }, error: () => { this.loading = false; } });
  }
  /** The model choices of a profile and its default, or null when the profile has no model parameter. */
  models(profile: string): { choices: string[]; default: string } | null {
    const p = this.profiles().find((x) => x.name === profile)?.params?.['model'];
    return p?.choices?.length ? { choices: p.choices, default: String(p.default ?? p.choices[0]) } : null;
  }
}

export const MODEL_LABEL: Record<string, string> = { haiku: 'Haiku', sonnet: 'Sonnet', opus: 'Opus' };
export const MODEL_HINT: Record<string, string> = {
  haiku: 'fastest and cheapest; fine for strictly procedural steps',
  sonnet: 'balanced: reliable on page interaction (date pickers, paging)',
  opus: 'most capable: onboarding, unusual pages',
};
