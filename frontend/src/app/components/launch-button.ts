import { ChangeDetectionStrategy, Component, ElementRef, HostListener, computed, inject, input, output, signal } from '@angular/core';
import { Observable } from 'rxjs';
import { AgentStart, JobRunStart, Launcher } from '../models';
import { ApiService, apiError } from '../services/api.service';
import { LaunchService } from '../services/launch.service';
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
      <span class="fh-split-via">{{ name(current()) }}</span>
    </button>
    @if (options().length > 1) {
      <button type="button" class="btn btn-sm fh-split-caret" [class]="btnClass()" [disabled]="disabled() || busy()" aria-label="Choose launcher"
              (click)="menu.set(!menu())">▾</button>
    }
    @if (menu()) {
      <div class="fh-menu" role="menu">
        @for (l of options(); track l) {
          <button type="button" class="fh-menu-item" role="menuitem" (click)="launch(l)">
            <b>{{ label() }} · {{ name(l) }}</b>@if (l === current()) { <span class="fh-chip fh-tone-violet ms-1">default</span> }
            <small>{{ hint(l) }}</small>
          </button>
        }
      </div>
    }
  </div>
  @if (error()) {
    <div class="fh-inline-err"><span>{{ error() }}</span><button type="button" class="btn-close btn-close-sm" aria-label="Dismiss" (click)="error.set('')"></button></div>
  }`,
  host: { class: 'fh-launch' },
})
export class LaunchButton {
  private api = inject(ApiService);
  private launcher = inject(LaunchService);
  private el = inject(ElementRef);
  private toast = inject(ToastService);
  readonly label = input('Run');
  readonly profile = input<string>('');
  readonly params = input<Record<string, unknown>>({});
  readonly launchers = input<Launcher[] | null | undefined>(null);
  readonly defaultLauncher = input<Launcher>('cli');
  readonly disabled = input(false);
  readonly reason = input<string | null>(null);
  readonly variant = input<'primary' | 'outline'>('primary');
  /** inline: the refusal shows under the button · toast: in a toast (fixed-size cards). */
  readonly errorMode = input<'inline' | 'toast'>('inline');
  readonly starter = input<((l: Launcher) => Observable<LaunchResult>) | null>(null);
  readonly started = output<{ launcher: Launcher; result: LaunchResult }>();

  protected busy = signal(false);
  protected menu = signal(false);
  protected error = signal('');
  private picked = signal<Launcher | null>(null);
  protected options = computed<Launcher[]>(() => this.launchers()?.length ? this.launchers()! : ['cli', 'vscode']);
  protected current = computed<Launcher>(() => {
    const p = this.picked() ?? this.defaultLauncher();
    return this.options().includes(p) ? p : this.options()[0];
  });
  protected btnClass = computed(() => (this.variant() === 'primary' ? 'btn-primary' : 'btn-outline-primary'));
  protected name = (l: Launcher) => LABEL[l] ?? l;
  protected hint = (l: Launcher) => HINT[l] ?? '';

  launch(l: Launcher): void {
    this.menu.set(false);
    this.picked.set(l);
    this.error.set('');
    this.busy.set(true);
    const call = this.starter() ? this.starter()!(l) : this.api.startAgent(this.profile(), this.params(), l);
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

  @HostListener('document:click', ['$event'])
  onDoc(ev: MouseEvent): void { if (this.menu() && !this.el.nativeElement.contains(ev.target)) this.menu.set(false); }
}
