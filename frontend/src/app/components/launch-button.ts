import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, HostListener, computed, inject, input, output, signal } from '@angular/core';
import { Observable } from 'rxjs';
import { AgentStart, JobRunStart, Launcher } from '../models';
import { ApiService, apiError } from '../services/api.service';
import { LaunchService } from '../services/launch.service';
import { MODEL_HINT, MODEL_LABEL, ProfilesStore } from '../services/profiles.store';
import { ToastService } from '../services/toast.service';

export type LaunchResult = AgentStart | JobRunStart;
const LABEL: Record<Launcher, string> = { cli: 'CLI', vscode: 'VS Code' };
const HINT: Record<Launcher, string> = {
  cli: 'Runs in the background on this machine; the log streams on the Runs page',
  vscode: 'Opens a Claude Code tab in VS Code with the prompt ready: press Enter there',
};

/**
 * Split button that starts an agent: the main part uses the default launcher, the menu picks CLI or VS Code.
 * VS Code answers open their vscode:// link (LaunchService); refusals (409: CLI missing, already running) show inline.
 * `starter` replaces the default POST /api/agent-runs (e.g. a job run that also starts its agent).
 */
@Component({
  selector: 'fh-launch-button',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="fh-split" [class.open]="menu()">
    <button type="button" class="btn btn-sm" [class]="btnClass()" [disabled]="disabled() || busy()" [title]="disabled() ? (reason() ?? '') : hint(current())"
            (click)="launch(current())">
      @if (busy()) { <span class="spinner-border spinner-border-sm me-1"></span> }{{ label() }}
      <span class="fh-split-via">{{ name(current()) }}@if (model(); as m) { · {{ modelName(m) }} }</span>
    </button>
    @if (options().length > 1 || modelChoices()) {
      <button type="button" class="btn btn-sm fh-split-caret" [class]="btnClass()" [disabled]="disabled() || busy()" aria-label="Choose launcher"
              (click)="toggle()">▾</button>
    }
    @if (menu(); as pos) {
      <div class="fh-menu" role="menu" [style.top.px]="pos.top" [style.bottom.px]="pos.bottom" [style.left.px]="pos.left">
        @if (modelChoices(); as mc) {
          <div class="fh-menu-head">Model</div>
          <div class="fh-menu-models">
            @for (m of mc.choices; track m) {
              <button type="button" class="fh-fchip" [class.active]="m === model()" [title]="modelHint(m)"
                      (click)="pickModel(m); $event.stopPropagation()">{{ modelName(m) }}</button>
            }
          </div>
          <div class="fh-menu-sep"></div>
        }
        @for (l of options(); track l) {
          <button type="button" class="fh-menu-item" role="menuitem" (click)="launch(l)">
            <b>{{ label() }} · {{ name(l) }}@if (model(); as m) { · {{ modelName(m) }} }</b>@if (l === current()) { <span class="fh-chip fh-tone-violet ms-1">default</span> }
            <small>{{ hint(l) }}</small>
          </button>
        }
      </div>
    }
  </div>
  @if (error()) {
    <div class="fh-inline-err"><span>{{ error() }}</span><button type="button" class="btn-close btn-close-sm" aria-label="Dismiss" (click)="error.set('')"></button></div>
  }`,
  host: { class: 'fh-launch', '[class.fh-block]': 'block()' },
})
export class LaunchButton {
  private api = inject(ApiService);
  private launcher = inject(LaunchService);
  private el = inject(ElementRef);
  private toast = inject(ToastService);
  private profiles = inject(ProfilesStore);
  readonly label = input('Run');
  readonly profile = input<string>('');
  readonly params = input<Record<string, unknown>>({});
  readonly launchers = input<Launcher[] | null | undefined>(null);
  readonly defaultLauncher = input<Launcher>('cli');
  readonly disabled = input(false);
  readonly reason = input<string | null>(null);
  readonly variant = input<'primary' | 'outline'>('primary');
  /** Fill the width of its container (card footers: every control the same size). */
  readonly block = input(false);
  /** inline: the refusal shows under the button · toast: in a toast (fixed-size cards). */
  readonly errorMode = input<'inline' | 'toast'>('inline');
  readonly starter = input<((l: Launcher) => Observable<LaunchResult>) | null>(null);
  readonly started = output<{ launcher: Launcher; result: LaunchResult }>();

  protected busy = signal(false);
  /** Open menu position. The menu is fixed to the viewport, so a card that clips its overflow cannot hide it. */
  protected menu = signal<{ top: number | null; bottom: number | null; left: number } | null>(null);
  protected error = signal('');
  private picked = signal<Launcher | null>(null);
  protected options = computed<Launcher[]>(() => this.launchers()?.length ? this.launchers()! : ['cli', 'vscode']);
  protected current = computed<Launcher>(() => {
    const p = this.picked() ?? this.defaultLauncher();
    return this.options().includes(p) ? p : this.options()[0];
  });
  /** Model choices of the profile (null: the profile has none, or a custom starter decides, e.g. a job's settings). */
  protected modelChoices = computed(() => (this.starter() ? null : this.profiles.models(this.profile())));
  private pickedModel = signal<string | null>(null);
  protected model = computed<string | null>(() => {
    const mc = this.modelChoices();
    if (!mc) return null;
    const m = this.pickedModel() ?? readModel(this.memoKey());
    return m && mc.choices.includes(m) ? m : mc.default;
  });
  protected modelName = (m: string) => MODEL_LABEL[m] ?? m;
  protected modelHint = (m: string) => MODEL_HINT[m] ?? '';
  private memoKey = computed(() => `fh.model.${this.profile()}.${String(this.params()['site'] ?? '')}`);
  protected btnClass = computed(() => (this.variant() === 'primary' ? 'btn-primary' : 'btn-outline-primary'));
  protected name = (l: Launcher) => LABEL[l] ?? l;
  protected hint = (l: Launcher) => HINT[l] ?? '';

  constructor() {
    this.profiles.load();
    const close = () => this.menu.set(null);
    window.addEventListener('scroll', close, true);       // any scrolling container moves the button away
    window.addEventListener('resize', close);
    inject(DestroyRef).onDestroy(() => { window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); });
  }

  toggle(): void {
    if (this.menu()) { this.menu.set(null); return; }
    const r = (this.el.nativeElement as HTMLElement).querySelector('.fh-split')!.getBoundingClientRect();
    const width = 270, room = 150;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    const below = window.innerHeight - r.bottom >= room;
    this.menu.set(below ? { top: r.bottom + 4, bottom: null, left } : { top: null, bottom: window.innerHeight - r.top + 4, left });
  }

  launch(l: Launcher): void {
    this.menu.set(null);
    this.picked.set(l);
    this.error.set('');
    this.busy.set(true);
    const params = this.model() ? { ...this.params(), model: this.model() } : this.params();
    const call = this.starter() ? this.starter()!(l) : this.api.startAgent(this.profile(), params, l);
    call.subscribe({
      next: (res) => {
        this.busy.set(false);
        const agent = 'run' in res ? res.agent : res;
        if (agent) this.launcher.handle(agent, this.label());
        this.started.emit({ launcher: l, result: res });
      },
      error: (e) => {
        this.busy.set(false);
        if (this.errorMode() === 'toast') this.toast.show(`${this.label()} not started`, 'bad', 12000, apiError(e));
        else this.error.set(apiError(e));
      },
    });
  }

  pickModel(m: string): void {
    this.pickedModel.set(m);
    try { localStorage.setItem(this.memoKey(), m); } catch { /* private window: keep it for this page only */ }
  }

  @HostListener('document:click', ['$event'])
  onDoc(ev: MouseEvent): void { if (this.menu() && !this.el.nativeElement.contains(ev.target)) this.menu.set(null); }

  @HostListener('document:keydown.escape')
  onEsc(): void { this.menu.set(null); }
}

function readModel(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
