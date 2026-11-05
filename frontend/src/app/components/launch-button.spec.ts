import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiService } from '../services/api.service';
import { LaunchService, vscodeHandoff } from '../services/launch.service';
import { ToastService } from '../services/toast.service';
import { LaunchButton } from './launch-button';
import { StatusChip } from './status-chip';

describe('fh-launch-button', () => {
  const make = (starter: () => any, launchers = ['cli', 'vscode'], def = 'cli') => {
    TestBed.configureTestingModule({ imports: [LaunchButton], providers: [{ provide: ApiService, useValue: {} }] });
    const launch = TestBed.inject(LaunchService);
    const open = vi.spyOn(launch, 'open').mockImplementation(() => {});
    const copy = vi.spyOn(launch, 'copy').mockImplementation(() => {});
    const f = TestBed.createComponent(LaunchButton);
    f.componentRef.setInput('label', 'Browser agent');
    f.componentRef.setInput('starter', vi.fn(starter));
    f.componentRef.setInput('launchers', launchers);
    f.componentRef.setInput('defaultLauncher', def);
    f.detectChanges();
    return { f, open, copy, toast: TestBed.inject(ToastService), el: f.nativeElement as HTMLElement };
  };

  it('opens the vscode:// link, copies the prompt and asks to press Enter', () => {
    const { f, open, copy, toast, el } = make(() => of({ id: 'r1', profile: 'browser_scan', launcher: 'vscode', status: 'waiting',
      prompt: 'Scan qasa', open_url: 'vscode://anthropic.claude-code/open?prompt=x' }), ['cli', 'vscode'], 'vscode');
    (el.querySelector('button') as HTMLButtonElement).click();
    f.detectChanges();
    expect(open).toHaveBeenCalledWith('vscode://anthropic.claude-code/open?prompt=x');
    expect(copy).toHaveBeenCalledWith('Scan qasa');
    expect(toast.toasts()[0].text).toContain('Press Enter in VS Code');
  });

  it('starts with the CLI by default without opening anything', () => {
    const { f, open, toast, el } = make(() => of({ id: 'r2', profile: 'browser_scan', launcher: 'cli', status: 'running' }));
    expect(el.querySelector('.fh-split-via')?.textContent).toBe('CLI');
    (el.querySelector('button') as HTMLButtonElement).click();
    f.detectChanges();
    expect(open).not.toHaveBeenCalled();
    expect(toast.toasts()[0].text).toContain('started (CLI)');
  });

  it('picks VS Code from the menu and shows a 409 refusal inline', () => {
    const starter = () => throwError(() => ({ status: 409, error: { detail: 'claude CLI not found on PATH' } }));
    const { f, el } = make(starter);
    (el.querySelector('.fh-split-caret') as HTMLButtonElement).click();
    f.detectChanges();
    const items = el.querySelectorAll<HTMLButtonElement>('.fh-menu-item');
    expect(items.length).toBe(2);
    items[1].click();
    f.detectChanges();
    expect(el.querySelector('.fh-inline-err')?.textContent).toContain('claude CLI not found on PATH');
    expect(el.querySelector('.fh-split-via')?.textContent).toBe('VS Code');
  });

  it('job answers hand their agent over too', () => {
    expect(vscodeHandoff({ open_url: 'vscode://x', prompt: 'p' })).toEqual({ url: 'vscode://x', prompt: 'p' });
    expect(vscodeHandoff({ status: 'running' })).toBeNull();
  });
});

describe('fh-status-chip', () => {
  it('colours by status and pulses while running', () => {
    TestBed.configureTestingModule({ imports: [StatusChip] });
    const f = TestBed.createComponent(StatusChip);
    f.componentRef.setInput('status', 'running');
    f.detectChanges();
    const chip = f.nativeElement.querySelector('.fh-chip') as HTMLElement;
    expect(chip.classList).toContain('fh-tone-run');
    expect(chip.querySelector('.fh-chip-dot')).toBeTruthy();
    f.componentRef.setInput('status', 'error');
    f.detectChanges();
    expect(chip.classList).toContain('fh-tone-bad');
    expect(chip.classList).toContain('fh-chip');
    expect(chip.querySelector('.fh-chip-dot')).toBeNull();
  });
});
