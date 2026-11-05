import { Injectable, signal } from '@angular/core';

export interface Toast { id: number; text: string; tone: 'info' | 'good' | 'bad' | 'wait'; detail?: string; }

/** Short notices in the bottom-right corner (components/toasts.ts renders them). */
@Injectable({ providedIn: 'root' })
export class ToastService {
  private next = 1;
  readonly toasts = signal<Toast[]>([]);

  show(text: string, tone: Toast['tone'] = 'info', ms = 6000, detail?: string): number {
    const id = this.next++;
    this.toasts.update((t) => [...t.slice(-3), { id, text, tone, detail }]);
    if (ms > 0) setTimeout(() => this.dismiss(id), ms);
    return id;
  }
  dismiss(id: number): void { this.toasts.update((t) => t.filter((x) => x.id !== id)); }
}
