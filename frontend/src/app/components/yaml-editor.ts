import { Component, ElementRef, OnDestroy, afterNextRender, effect, input, output, viewChild } from '@angular/core';
import { EditorView, basicSetup } from 'codemirror';
import { yaml } from '@codemirror/lang-yaml';
import { EditorState } from '@codemirror/state';

/** CodeMirror 6 YAML editor. `value` sets the text; `changed` emits edits. */
@Component({
  selector: 'fh-yaml-editor',
  template: `<div #host class="fh-cm"></div>`,
  styles: [`.fh-cm { border: 1px solid var(--bs-border-color); border-radius: 6px; overflow: hidden; }
            :host ::ng-deep .cm-editor { height: calc(100vh - 230px); min-height: 300px; font-size: 13px; }
            :host ::ng-deep .cm-editor.cm-focused { outline: none; }`],
})
export class YamlEditor implements OnDestroy {
  readonly value = input<string>('');
  readonly changed = output<string>();
  private host = viewChild.required<ElementRef<HTMLDivElement>>('host');
  private view?: EditorView;
  private applying = false;

  constructor() {
    afterNextRender(() => {
      this.view = new EditorView({
        parent: this.host().nativeElement,
        state: EditorState.create({
          doc: this.value(),
          extensions: [basicSetup, yaml(), EditorView.updateListener.of((u) => {
            if (u.docChanged && !this.applying) this.changed.emit(u.state.doc.toString());
          })],
        }),
      });
    });
    effect(() => {
      const text = this.value();
      if (this.view && text !== this.view.state.doc.toString()) {
        this.applying = true;
        this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: text } });
        this.applying = false;
      }
    });
  }

  ngOnDestroy(): void { this.view?.destroy(); }
}
