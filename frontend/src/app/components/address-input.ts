import { Component, OnDestroy, inject, input, model, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subject, debounceTime, distinctUntilChanged, filter, switchMap, catchError, of } from 'rxjs';
import { AddressSuggestion } from '../models';
import { ApiService, apiError } from '../services/api.service';

/** Address field with suggestions (ORS / Photon via the API). Picking one emits the address and its coordinates. */
@Component({
  selector: 'fh-address-input',
  imports: [FormsModule],
  template: `
    <div class="fh-ai">
      <input class="form-control form-control-sm" [ngModel]="value()" (ngModelChange)="typed($event)"
             (focus)="open.set(true)" (blur)="closeSoon()" (keydown)="key($event)" [placeholder]="placeholder()" autocomplete="off" />
      @if (open() && (items().length || hint())) {
        <ul class="fh-ai-list">
          @for (s of items(); track $index; let i = $index) {
            <li [class.on]="i === cursor()" (mousedown)="pick(s)">{{ s.label }} <span class="fh-ai-src">{{ s.source }}</span></li>
          }
          @if (hint()) { <li class="fh-ai-hint">{{ hint() }}</li> }
        </ul>
      }
    </div>`,
  styles: [`
    .fh-ai { position: relative; }
    .fh-ai-list { position: absolute; z-index: 20; left: 0; right: 0; top: 100%; margin: 2px 0 0; padding: 4px 0; list-style: none;
      background: var(--bs-body-bg); border: 1px solid var(--bs-border-color); border-radius: 6px; box-shadow: 0 6px 18px rgba(0,0,0,.35);
      li { padding: 4px 10px; cursor: pointer; font-size: .85rem; &.on, &:hover { background: var(--fh-sel); } } }
    .fh-ai-src { float: right; font-size: .7rem; color: var(--bs-secondary-color); }
    .fh-ai-hint { color: var(--bs-secondary-color); cursor: default !important; font-style: italic; }
  `],
})
export class AddressInput implements OnDestroy {
  private api = inject(ApiService);
  readonly value = model<string | undefined>('');
  readonly placeholder = input('street, city');
  readonly picked = output<AddressSuggestion>();
  protected items = signal<AddressSuggestion[]>([]);
  protected open = signal(false);
  protected cursor = signal(-1);
  protected hint = signal('');
  private q$ = new Subject<string>();
  private sub = this.q$.pipe(
    debounceTime(350), distinctUntilChanged(), filter((q) => q.trim().length >= 4),
    switchMap((q) => this.api.suggestAddress(q).pipe(catchError((e) => { this.hint.set(apiError(e)); return of({ items: [] }); }))),
  ).subscribe((r) => { this.items.set(r.items); this.cursor.set(-1); if (r.items.length) this.hint.set(''); });

  protected typed(v: string): void { this.value.set(v); this.hint.set(''); this.q$.next(v); }
  protected pick(s: AddressSuggestion): void { this.value.set(s.label); this.items.set([]); this.open.set(false); this.picked.emit(s); }
  protected closeSoon(): void { setTimeout(() => this.open.set(false), 150); }
  protected key(e: KeyboardEvent): void {
    const n = this.items().length;
    if (!n) return;
    if (e.key === 'ArrowDown') { this.cursor.set((this.cursor() + 1) % n); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { this.cursor.set((this.cursor() - 1 + n) % n); e.preventDefault(); }
    else if (e.key === 'Enter' && this.cursor() >= 0) { this.pick(this.items()[this.cursor()]); e.preventDefault(); }
    else if (e.key === 'Escape') this.open.set(false);
  }
  ngOnDestroy(): void { this.sub.unsubscribe(); }
}
