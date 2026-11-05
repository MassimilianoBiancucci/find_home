import { Injectable, inject } from '@angular/core';
import { AgentStart } from '../models';
import { ToastService } from './toast.service';

/** What to do with an agent start answer: the VS Code launcher hands back a vscode:// link and the prompt. */
export function vscodeHandoff(res: Partial<AgentStart> | null | undefined): { url: string; prompt: string } | null {
  return res?.open_url ? { url: res.open_url, prompt: res.prompt ?? '' } : null;
}

/**
 * Finishes an agent launch in the browser. CLI: a toast. VS Code: opens the vscode:// link (a Claude Code tab with
 * the prompt prefilled), copies the prompt as a fallback and tells the user to press Enter there.
 */
@Injectable({ providedIn: 'root' })
export class LaunchService {
  private toast = inject(ToastService);

  handle(res: AgentStart | null | undefined, what = 'Agent'): void {
    const h = vscodeHandoff(res);
    if (h) {
      this.open(h.url);
      if (h.prompt) this.copy(h.prompt);
      this.toast.show('Press Enter in VS Code to start the run', 'wait', 12000,
        h.prompt ? 'The prompt is also on your clipboard if the tab did not open.' : undefined);
    } else if (res) {
      this.toast.show(`${what} started (CLI)`, 'good');
    }
  }
  /** Separate so tests can replace it: navigating jsdom to vscode:// is not possible. */
  open(url: string): void { window.location.href = url; }
  copy(text: string): void { navigator.clipboard?.writeText(text).catch(() => {}); }
}
