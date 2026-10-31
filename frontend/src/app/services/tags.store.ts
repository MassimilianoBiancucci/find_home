import { Injectable, computed, inject, signal } from '@angular/core';
import { TagsConfig } from '../models';
import { ApiService } from './api.service';

/** Statuses and feedback tags from config/tags.yaml, loaded once and refreshable. */
@Injectable({ providedIn: 'root' })
export class TagsStore {
  private api = inject(ApiService);
  readonly config = signal<TagsConfig | null>(null);
  readonly statuses = computed(() => this.config()?.statuses.default ?? ['new', 'shortlisted', 'rejected']);
  readonly positive = computed(() => Object.entries(this.config()?.tags.positive ?? {}).map(([k, v]) => ({ key: k, label: v.label })));
  readonly negative = computed(() => Object.entries(this.config()?.tags.negative ?? {}).map(([k, v]) => ({ key: k, label: v.label })));

  load(): void {
    this.api.config<TagsConfig>('tags').subscribe({ next: (f) => this.config.set(f.data), error: () => {} });
  }
  label(key: string): string {
    const t = this.config()?.tags;
    return t?.positive[key]?.label ?? t?.negative[key]?.label ?? key;
  }
}
