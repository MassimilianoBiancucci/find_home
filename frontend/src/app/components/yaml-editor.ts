import { Component, ElementRef, OnDestroy, afterNextRender, effect, inject, input, output, viewChild } from '@angular/core';
import { EditorView, basicSetup } from 'codemirror';
import { yaml } from '@codemirror/lang-yaml';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { Compartment, EditorState, Extension } from '@codemirror/state';
import { tags as t } from '@lezer/highlight';
import { ThemeService } from '../services/theme.service';

const darkTheme = EditorView.theme({
  '&': { backgroundColor: '#25252b', color: '#d4d4de' },
  '.cm-content': { caretColor: '#f0f0f5' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#f0f0f5' },
  '.cm-gutters': { backgroundColor: '#202026', color: '#6c6c7e', borderRight: '1px solid #34343c' },
  '.cm-activeLine': { backgroundColor: 'rgba(255, 255, 255, 0.04)' },
  '.cm-activeLineGutter': { backgroundColor: 'rgba(180, 92, 240, 0.14)', color: '#d8b4fe' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection':
    { backgroundColor: 'rgba(180, 92, 240, 0.3)' },
  '.cm-matchingBracket': { backgroundColor: 'rgba(180, 92, 240, 0.25)', outline: 'none' },
  '.cm-foldPlaceholder': { backgroundColor: '#34343c', border: 'none', color: '#b0b0c0' },
  '.cm-searchMatch': { backgroundColor: 'rgba(232, 148, 58, 0.3)' },
  '.cm-panels': { backgroundColor: '#202026', color: '#d4d4de' },
  '.cm-tooltip': { backgroundColor: '#2a2a31', border: '1px solid #3e3e48' },
}, { dark: true });

const darkHighlight = HighlightStyle.define([
  { tag: t.definition(t.propertyName), color: '#c9a2f5' },
  { tag: t.content, color: '#e4e4ec' },
  { tag: t.string, color: '#a5d6a7' },
  { tag: t.special(t.string), color: '#e8b27a' },
  { tag: t.lineComment, color: '#7f8698', fontStyle: 'italic' },
  { tag: [t.separator, t.punctuation, t.squareBracket, t.brace], color: '#8c8ca0' },
  { tag: [t.labelName, t.typeName], color: '#7cc7e8' },
  { tag: [t.keyword, t.meta, t.attributeValue], color: '#e8b27a' },
]);

/** CodeMirror 6 YAML editor. `value` sets the text; `changed` emits edits. Follows the app colour mode. */
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
  private theme = inject(ThemeService);
  private host = viewChild.required<ElementRef<HTMLDivElement>>('host');
  private view?: EditorView;
  private applying = false;
  private look = new Compartment();

  private lookFor(mode: string): Extension { return mode === 'dark' ? [darkTheme, syntaxHighlighting(darkHighlight)] : []; }

  constructor() {
    afterNextRender(() => {
      this.view = new EditorView({
        parent: this.host().nativeElement,
        state: EditorState.create({
          doc: this.value(),
          extensions: [basicSetup, yaml(), this.look.of(this.lookFor(this.theme.theme())), EditorView.updateListener.of((u) => {
            if (u.docChanged && !this.applying) this.changed.emit(u.state.doc.toString());
          })],
        }),
      });
    });
    effect(() => {
      const mode = this.theme.theme();
      this.view?.dispatch({ effects: this.look.reconfigure(this.lookFor(mode)) });
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
