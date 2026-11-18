import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { cellReferenceRanges, editorResultText, type EditorLanguageService } from './editor-intelligence';
import type { EditorView as EditorViewType } from '@codemirror/view';

/** Presentation only: captured by the owner when changing editor documents. */
export interface PythonEditorPosition {
  top: number;
  left: number;
  anchor: number;
  head: number;
}

export interface PythonCompletion {
  label: string;
  /** Present only for workbook references, never Python builtins. */
  cellId?: string;
  valueType?: string;
  detail?: string;
  info?: string;
  type?: Completion['type'];
  boost?: number;
  apply?: string;
}

@Component({
  selector: 'app-python-editor',
  template: '<div #mount class="editor-mount"></div>',
  host: { '[class.resizable]': 'resizable', '[class.console-prompt]': 'consoleMode' },
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    /* Drag the bottom-right corner to resize; CodeMirror fills the host. */
    :host(.resizable) {
      min-height: 64px;
      overflow: hidden;
      resize: vertical;
    }
    :host(.single-line.resizable) {
      min-height: 32px;
    }
    .editor-mount {
      height: 100%;
    }
    .editor-mount ::ng-deep .cm-editor {
      height: 100%;
      border: 1px solid var(--theme-line, light-dark(#d9ddd5, #2d2f2b));
      border-radius: 7px;
      background: var(--theme-paper, light-dark(white, #0c0c0c));
      font:
        11px/1.55 ui-monospace,
        SFMono-Regular,
        Menlo,
        monospace;
    }
    :host(.console-prompt) .editor-mount ::ng-deep .cm-editor {
      border: 0;
      border-radius: 0;
      background: transparent;
      font-size: 12px;
    }
    :host(.console-prompt) .editor-mount ::ng-deep .cm-editor.cm-focused { box-shadow: none; }
    :host(.console-prompt) .editor-mount ::ng-deep .cm-content { padding: 6px 0; }
    .editor-mount ::ng-deep .cm-editor.cm-focused {
      border-color: light-dark(#8ca847, #5a720c);
      outline: none;
      box-shadow: 0 0 0 3px rgb(199 243 107 / 24%);
    }
    .editor-mount ::ng-deep .cm-panels {
      background: var(--theme-panel, light-dark(#f7f8f5, #121211));
      color: var(--theme-ink, light-dark(#20231f, #daddd9));
    }
    .editor-mount ::ng-deep .cm-search {
      padding: 8px 28px 8px 8px;
      font: 12px/1.5 system-ui, sans-serif;
    }
    .editor-mount ::ng-deep .cm-search label {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font: inherit;
    }
    .editor-mount ::ng-deep .cm-search .cm-textfield,
    .editor-mount ::ng-deep .cm-search .cm-button {
      background: var(--theme-panel, light-dark(#fff, #1c1e1a));
      color: inherit;
      border: 1px solid light-dark(#cbd0c5, #42483c);
      border-radius: 4px;
      padding: 3px 6px;
      font: inherit;
    }
    .editor-mount ::ng-deep .cm-searchMatch { background: light-dark(#ffe598, #695317); }
    .editor-mount ::ng-deep .cm-searchMatch-selected { background: light-dark(#ffc45c, #876028); }
    .editor-mount ::ng-deep .cm-scroller {
      overflow: auto;
    }
    .editor-mount ::ng-deep .cm-content {
      padding: 9px 10px;
      caret-color: var(--theme-ink, light-dark(#20231f, #daddd9));
    }
    .editor-mount ::ng-deep .cm-line {
      padding: 0;
    }
    .editor-mount ::ng-deep .cm-gutters {
      border-right: 1px solid light-dark(#e4e7e0, #242522);
      color: light-dark(#989e94, #646961);
      background: var(--theme-panel, light-dark(#f7f8f5, #121211));
    }
    :host(.single-line) .editor-mount ::ng-deep .cm-editor {
      border-radius: 6px;
    }
    :host(.single-line) .editor-mount ::ng-deep .cm-content {
      padding: 6px 9px;
    }
    :host(.single-line) .editor-mount ::ng-deep .cm-gutters {
      display: none;
    }
    .editor-mount ::ng-deep .cm-lineNumbers .cm-gutterElement {
      min-width: 2.2em;
      padding: 0 6px 0 4px;
    }
    .editor-mount ::ng-deep .cm-cursor {
      border-left-color: light-dark(#20231f, #eef0ec);
    }
    .editor-mount ::ng-deep .cm-selectionBackground,
    .editor-mount ::ng-deep .cm-focused .cm-selectionBackground,
    .editor-mount ::ng-deep .cm-content ::selection {
      background: light-dark(#d7e8b8, #3a4a22) !important;
    }
    .editor-mount ::ng-deep .cm-cell-reference {
      text-decoration: underline dotted light-dark(#6d977d, #83ad91);
      text-underline-offset: 3px;
      cursor: pointer;
    }
    .editor-mount ::ng-deep .cm-activeLine {
      background: rgb(199 243 107 / 12%);
    }
    .editor-mount ::ng-deep .cm-activeLineGutter {
      color: light-dark(#40463c, #b5bbb2);
      background: rgb(199 243 107 / 28%);
    }
  `,
})
export class PythonEditorComponent implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('mount', { static: true }) private mount?: ElementRef<HTMLDivElement>;
  @Input() value = '';
  @Input() searchEnabled = false;
  @Input() position?: PythonEditorPosition;
  private pendingPosition?: PythonEditorPosition;
  private showSearch?: () => void;
  @Input() singleLine = false;
  /** REPL prompt: Enter submits, Shift+Enter inserts a line, arrows recall commands. */
  @Input() consoleMode = false;
  @Input() autoFocus = false;
  @Output() readonly historyStep = new EventEmitter<number>();
  @Output() readonly cancelCommand = new EventEmitter<void>();
  /** Syntax used for highlighting and indentation. */
  @Input() language: 'python' | 'markdown' = 'python';
  /** Show a resize handle so the editor height can be dragged. */
  @Input() resizable = true;
  @Input() ariaLabel = 'Python source';
  @Input() placeholder = '';
  @Input() completions: readonly PythonCompletion[] = [];
  /** Show the source without allowing edits (e.g. while the kernel is not running). */
  @Input() readOnly = false;
  /** Findings to underline, by line of the source (type checking). */
  @Input() diagnostics: readonly EditorDiagnostic[] = [];
  @Output() readonly valueChange = new EventEmitter<string>();
  @Output() readonly commit = new EventEmitter<void>();
  /** Focus entered (true) or left (false) the editor. */
  @Output() readonly focusChange = new EventEmitter<boolean>();

  @Input() referencesEnabled = false;
  @Input() languageService: EditorLanguageService | null = null;
  @Output() readonly referenceNavigate = new EventEmitter<string>();
  private refreshReferences?: () => void;
  private signatureTimer?: ReturnType<typeof setTimeout>;
  private requestGeneration = 0;
  private view?: EditorViewType;
  private readOnlyState?: {
    compartment: InstanceType<typeof import('@codemirror/state').Compartment>;
    extension: (readOnly: boolean) => import('@codemirror/state').Extension;
  };
  private refreshLayout?: () => void;
  private refreshPlaceholder?: () => void;
  private applyingExternalValue = false;
  private destroyed = false;

  async ngAfterViewInit(): Promise<void> {
    const [
      { python },
      { markdown },
      { autocompletion, completionStatus, acceptCompletion, closeCompletion },
      { indentWithTab, insertNewlineAndIndent },
      { indentUnit, HighlightStyle, syntaxHighlighting, syntaxTree },
      { tags },
      { EditorState, Prec, Compartment },
      { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, Decoration, ViewPlugin, hoverTooltip, hasHoverTooltips, closeHoverTooltips, showTooltip, tooltips, placeholder },
      { minimalSetup },
      { search, searchKeymap, openSearchPanel },
    ] = await Promise.all([
      import('@codemirror/lang-python'),
      import('@codemirror/lang-markdown'),
      import('@codemirror/autocomplete'),
      import('@codemirror/commands'),
      import('@codemirror/language'),
      import('@lezer/highlight'),
      import('@codemirror/state'),
      import('@codemirror/view'),
      import('codemirror'),
      import('@codemirror/search'),
    ]);
    if (this.destroyed) {
      return;
    }
    const placeholderCompartment = new Compartment();
    this.refreshPlaceholder = () => this.view?.dispatch({ effects: placeholderCompartment.reconfigure(placeholder(this.placeholder)) });
    const readOnlyCompartment = new Compartment();
    const readOnlyExtension = (readOnly: boolean) => [
      EditorState.readOnly.of(readOnly),
      EditorView.editable.of(!readOnly),
    ];
    this.readOnlyState = { compartment: readOnlyCompartment, extension: readOnlyExtension };
    const applyCell = () => {
      this.commit.emit();
      return true;
    };
    const submitKeymap = () => Prec.highest(
      keymap.of([
        ...(this.consoleMode ? [
          { key: 'Enter', run: (view: EditorViewType) => completionStatus(view.state) === 'active' ? acceptCompletion(view) : applyCell() },
          { key: 'Shift-Enter', run: insertNewlineAndIndent },
          ...(['ArrowUp', 'ArrowDown'] as const).map(key => ({ key, run: (view: EditorViewType) => {
            if (completionStatus(view.state) !== null || this.readOnly) return false;
            const cursor = view.state.selection.main;
            const line = view.state.doc.lineAt(cursor.head);
            if (!cursor.empty || (key === 'ArrowUp' ? line.number !== 1 : line.number !== view.state.doc.lines)) return false;
            this.historyStep.emit(key === 'ArrowUp' ? -1 : 1);
            return true;
          } })),
          { key: 'Ctrl-c', run: (view: EditorViewType) => {
            if (!view.state.selection.main.empty) return false;
            this.cancelCommand.emit();
            return true;
          } },
        ] : [{ key: 'Shift-Enter', run: applyCell }]),
        { key: 'Mod-Enter', run: applyCell },
        ...(this.singleLine ? [{ key: 'Enter', run: applyCell }] : []),
      ]),
    );
    const layoutCompartment = new Compartment();
    const layoutExtension = () => [
      submitKeymap(),
      ...(this.singleLine || this.consoleMode ? [] : [lineNumbers(), highlightActiveLine(), highlightActiveLineGutter()]),
      ...(this.singleLine ? [] : [EditorView.lineWrapping]),
    ];
    this.refreshLayout = () => this.view?.dispatch({effects: layoutCompartment.reconfigure(layoutExtension())});
    const referenceCompartment = new Compartment();
    const signatureCompartment = new Compartment();
    const ranges = (view: EditorViewType) => this.language === 'python' && this.referencesEnabled
      ? cellReferenceRanges(syntaxTree(view.state), view.state.doc.toString(), this.completions) : [];
    const referencePlugin = () => ViewPlugin.fromClass(class {
      decorations;
      constructor(view: EditorViewType) { this.decorations = this.make(view); }
      make(view: EditorViewType) {
        return Decoration.set(ranges(view).map(range => Decoration.mark({class: 'cm-cell-reference', attributes: {'data-cell-id': range.cell.cellId!}}).range(range.from, range.to)), true);
      }
      update(update: import('@codemirror/view').ViewUpdate) {
        if (update.docChanged || update.viewportChanged) this.decorations = this.make(update.view);
      }
    }, {decorations: plugin => plugin.decorations});
    this.refreshReferences = () => this.view?.dispatch({ effects: referenceCompartment.reconfigure(referencePlugin()) });
    const position = (view: EditorViewType, pos: number) => {
      const line = view.state.doc.lineAt(pos);
      return {line: line.number - 1, character: pos - line.from};
    };
    const tooltip = (text: string, cellId?: string) => {
      const dom = document.createElement('div');
      dom.className = 'cm-cell-tooltip';
      dom.tabIndex = 0;
      dom.setAttribute('role', 'region');
      dom.setAttribute('aria-label', 'Python documentation');
      dom.textContent = text;
      dom.addEventListener('keydown', event => {
        if (event.key !== 'Escape' || !this.view) return;
        event.preventDefault();
        event.stopPropagation();
        clearTimeout(this.signatureTimer);
        this.requestGeneration++;
        signatureShown = false;
        closeCompletion(this.view);
        this.view.dispatch({effects: [signatureCompartment.reconfigure([]), closeHoverTooltips]});
        this.view.focus();
      });
      if (cellId) {
        const button = document.createElement('button');
        button.textContent = 'Go to cell';
        button.onclick = () => this.referenceNavigate.emit(cellId);
        dom.append(button);
      }
      return {dom};
    };
    let signatureShown = false;
    const scheduleSignature = (view: EditorViewType, explicit = false) => {
      clearTimeout(this.signatureTimer);
      const generation = ++this.requestGeneration;
      signatureShown = false;
      view.dispatch({effects: signatureCompartment.reconfigure([])});
      if (!this.languageService || this.language !== 'python' || !view.hasFocus) return;
      const source = view.state.doc.toString(), pos = view.state.selection.main.head;
      // Automatic hints use a cheap call heuristic. Explicit requests let
      // Pyright decide, including blank continuation lines in multiline calls.
      const before = source.slice(0, pos);
      if (!explicit && (!before.includes('(') || /[)\n]\s*$/.test(before))) return;
      this.signatureTimer = setTimeout(async () => {
        try {
          const reply = await this.languageService?.({source, position: position(view, pos), action: 'signatureHelp'});
          if (this.destroyed || generation !== this.requestGeneration || view.state.doc.toString() !== source) return;
          const text = editorResultText(reply?.result);
          if (text) {
            signatureShown = true;
            view.dispatch({effects: signatureCompartment.reconfigure(showTooltip.of({pos, above: true, create: () => tooltip(text)}))});
          }
        } catch { /* Completion is optional; errors never affect cell execution. */ }
      }, explicit ? 0 : 300);
    };
    this.view = new EditorView({
      parent: this.mount?.nativeElement,
      state: EditorState.create({
        doc: this.value,
        extensions: [
          minimalSetup,
          ...(this.searchEnabled ? [search({ top: true }), keymap.of(searchKeymap)] : []),
          readOnlyCompartment.of(readOnlyExtension(this.readOnly)),
          this.language === 'markdown' ? markdown() : python(),
          indentUnit.of(this.language === 'markdown' ? '  ' : '    '),
          // Theme-aware token colours (light-dark pairs follow the app's colour scheme);
          // CodeMirror's default style only suits light backgrounds.
          syntaxHighlighting(
            HighlightStyle.define([
              { tag: tags.keyword, color: 'light-dark(#7a2fa8, #c99af0)' },
              { tag: [tags.string, tags.special(tags.string)], color: 'light-dark(#a33a2a, #f0a07f)' },
              { tag: [tags.number, tags.bool, tags.null], color: 'light-dark(#11708a, #6fcde0)' },
              { tag: tags.comment, color: 'light-dark(#8a7a4a, #a79e7c)', fontStyle: 'italic' },
              {
                tag: [tags.function(tags.definition(tags.variableName)), tags.definition(tags.className)],
                color: 'light-dark(#2052c4, #8db4ff)',
              },
              { tag: tags.className, color: 'light-dark(#8a5b08, #e0b765)' },
              { tag: [tags.operator, tags.punctuation], color: 'light-dark(#5e645b, #a3a89f)' },
              { tag: tags.heading, fontWeight: '700', color: 'light-dark(#20231f, #eef0ec)' },
              { tag: tags.strong, fontWeight: '700' },
              { tag: tags.emphasis, fontStyle: 'italic' },
              { tag: [tags.link, tags.url], color: 'light-dark(#4d6fbf, #8fa9eb)' },
              { tag: [tags.monospace, tags.quote], color: 'light-dark(#5b6a2e, #b4c77a)' },
              { tag: [tags.processingInstruction, tags.meta], color: 'light-dark(#989e94, #7c8178)' },
            ]),
          ),
          // Popovers must escape resizable hosts, which clip their contents.
          placeholderCompartment.of(placeholder(this.placeholder)),
          tooltips({parent: document.body, position: 'fixed'}),
          EditorView.theme({
            '.cm-placeholder': { color: 'var(--theme-muted, light-dark(#7a7a73, #8f8f88))', whiteSpace: 'pre-wrap' },
            '.cm-tooltip': {
              zIndex: '1000', color: 'var(--theme-ink, light-dark(#20231f, #daddd9))',
              backgroundColor: 'light-dark(#fbfcf9, #1b1c1a)',
              border: '1px solid light-dark(#c2c8be, #3f433d)',
              font: '11px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace',
              maxWidth: 'min(480px, calc(100vw - 24px))', boxSizing: 'border-box', overflowWrap: 'anywhere',
            },
            '.cm-tooltip-autocomplete': {maxHeight: 'min(280px, calc(100vh - 24px))', borderRadius: '8px', overflow: 'visible', boxShadow: '0 12px 30px rgb(30 35 28 / 18%)'},
            '.cm-tooltip-autocomplete > ul': {maxHeight: 'min(280px, calc(100vh - 24px))', overscrollBehavior: 'contain'},
            '.cm-tooltip-hover, .cm-tooltip.cm-cell-tooltip, .cm-tooltip.cm-completionInfo': {maxHeight: 'min(320px, calc(100vh - 32px))', overflow: 'auto', overscrollBehavior: 'contain'},
            '.cm-tooltip-autocomplete ul li[aria-selected]': {color: 'light-dark(#20231f, #eef0ec)', backgroundColor: 'light-dark(#e3efcb, #34401f)'},
            '.cm-completionDetail': {color: 'var(--theme-muted, light-dark(#70756d, #898d87))'},
            '.cm-cell-tooltip': {padding: '8px 10px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere'},
            '.cm-cell-tooltip button': {display: 'block', marginTop: '6px', cursor: 'pointer', color: 'inherit', background: 'transparent', border: '0', textDecoration: 'underline'},
          }),
          referenceCompartment.of(referencePlugin()),
          signatureCompartment.of([]),
          hoverTooltip(async (view, pos) => {
            if (this.language !== 'python') return null;
            const reference = ranges(view).find(range => pos >= range.from && pos <= range.to);
            const source = view.state.doc.toString();
            const candidates = this.completions;
            let text = reference ? `${reference.cell.label} · ${reference.cell.cellId}\n${reference.cell.valueType || reference.cell.detail || ''}` : '';
            try {
              const reply = await this.languageService?.({source, position: position(view, pos), action: 'hover'});
              const inferred = editorResultText(reply?.result);
              if (inferred) text = reference ? `${reference.cell.label} · ${reference.cell.cellId}\n${inferred}` : inferred;
            } catch { /* Keep the reference tooltip without the language server. */ }
            if (!text || this.destroyed || candidates !== this.completions || view.state.doc.toString() !== source) return null;
            return {pos: reference?.from ?? pos, end: reference?.to, above: true, create: () => tooltip(text, reference?.cell.cellId)};
          }),
          EditorView.domEventHandlers({mousedown: (event) => {
            if (!(event.metaKey || event.ctrlKey)) return false;
            const target = (event.target as HTMLElement).closest('[data-cell-id]');
            const id = target?.getAttribute('data-cell-id');
            if (!id) return false;
            event.preventDefault();
            this.referenceNavigate.emit(id);
            return true;
          }}),
          autocompletion({
            activateOnTyping: true,
            // Tab/Enter are deliberate acceptance, including immediately after opening.
            interactionDelay: 0,
            override: [async (context) => {
              const fallback = pythonCompletionSource(context, this.completions);
              if (!this.languageService || this.language !== 'python') return fallback;
              const node = syntaxTree(context.state).resolveInner(context.pos, -1);
              if (['String', 'Comment'].includes(node.name)) return null;
              try {
                const source = context.state.doc.toString(), line = context.state.doc.lineAt(context.pos);
                const candidates = this.completions;
                const reply = await this.languageService({source, position: {line: line.number - 1, character: context.pos - line.from}, action: 'completion'});
                if (context.aborted || this.destroyed || candidates !== this.completions) return null;
                if (!reply?.available) return fallback;
                const word = context.matchBefore(/[A-Za-z_][A-Za-z0-9_]*/);
                const options: Completion[] = (reply.completions ?? []).map(item => ({
                  label: item.label, detail: item.detail || fallback?.options.find(c => c.label === item.label)?.detail,
                  apply: item.apply, type: item.kind === 2 || item.kind === 3 ? 'function' : item.kind === 7 ? 'class' : item.kind === 9 ? 'namespace' : 'variable',
                  info: async () => {
                    const resolved = await this.languageService?.({source, position: {line: line.number - 1, character: context.pos - line.from}, action: 'completionResolve', completionKey: item.key});
                    return tooltip(editorResultText(resolved?.result) || item.detail || '').dom;
                  },
                }));
                const seen = new Set(options.map(item => item.label));
                for (const item of fallback?.options ?? []) if (!seen.has(item.label)) options.push(item);
                return {from: word?.from ?? context.pos, options, validFor: /^[A-Za-z_][A-Za-z0-9_]*$/};
              } catch { return fallback; }
            }],
          }),
          layoutCompartment.of(layoutExtension()),
          // Familiar editor keys: complete first, otherwise indent. Shift+Tab outdents.
          // CodeMirror keeps Escape-then-Tab available for leaving the editor.
          Prec.high(keymap.of([
            {key: 'Tab', run: acceptCompletion},
            indentWithTab,
            {key: 'Mod-Shift-Space', run: view => { scheduleSignature(view, true); return true; }},
            {key: 'Escape', run: view => {
              const visible = signatureShown || hasHoverTooltips(view.state);
              clearTimeout(this.signatureTimer);
              this.requestGeneration++;
              signatureShown = false;
              if (visible) view.dispatch({effects: [signatureCompartment.reconfigure([]), closeHoverTooltips]});
              return visible;
            }},
          ])),
          EditorView.contentAttributes.of({
            'aria-label': this.ariaLabel,
            spellcheck: 'false',
            autocapitalize: 'off',
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !this.applyingExternalValue) {
              this.valueChange.emit(update.state.doc.toString());
            }
            if (update.docChanged || update.selectionSet) {
              // Dispatch after this update finishes; CodeMirror forbids nested updates.
              queueMicrotask(() => { if (!this.destroyed && this.view === update.view) scheduleSignature(update.view); });
            }
            if (update.focusChanged) {
              this.focusChange.emit(update.view.hasFocus);
              if (!update.view.hasFocus) {
                ++this.requestGeneration; clearTimeout(this.signatureTimer);
                queueMicrotask(() => { if (!this.destroyed) update.view.dispatch({effects: signatureCompartment.reconfigure([])}); });
              }
            }
          }),
        ],
      }),
    });
    this.showSearch = () => { if (this.view && this.searchEnabled) openSearchPanel(this.view); };
    if (this.position) this.restorePosition(this.position);
    void this.showDiagnostics();
    if (this.autoFocus) this.focus();
  }

  ngOnChanges(changes?: SimpleChanges): void {
    if (this.view === undefined) {
      return;
    }
    if (changes?.['completions'] || changes?.['languageService'] || changes?.['readOnly']) {
      ++this.requestGeneration;
      clearTimeout(this.signatureTimer);
    }
    if (changes?.['singleLine']) this.refreshLayout?.();
    if (changes?.['placeholder']) this.refreshPlaceholder?.();
    this.refreshReferences?.();
    void this.showDiagnostics();
    if (this.readOnlyState !== undefined) {
      this.view.dispatch({
        effects: this.readOnlyState.compartment.reconfigure(this.readOnlyState.extension(this.readOnly)),
      });
    }
    if (this.autoFocus) this.focus();
    const current = this.view.state.doc.toString();
    if (current === this.value) {
      if (changes?.['position'] && this.position) this.restorePosition(this.position);
      return;
    }
    this.applyingExternalValue = true;
    this.view.dispatch({ changes: { from: 0, to: current.length, insert: this.value }, ...(this.consoleMode ? { selection: { anchor: this.value.length }, scrollIntoView: true } : {}) });
    this.applyingExternalValue = false;
    if (changes?.['position'] && this.position) this.restorePosition(this.position);
  }

  openSearch(): void { this.showSearch?.(); }

  capturePosition(): PythonEditorPosition | undefined {
    if (this.pendingPosition) return this.pendingPosition;
    const view = this.view;
    if (!view) return undefined;
    const { anchor, head } = view.state.selection.main;
    return { top: view.scrollDOM.scrollTop, left: view.scrollDOM.scrollLeft, anchor, head };
  }

  private restorePosition(position: PythonEditorPosition): void {
    const view = this.view;
    if (!view) return;
    this.pendingPosition = position;
    const clamp = (offset: number) => Math.max(0, Math.min(offset, view.state.doc.length));
    view.dispatch({ selection: { anchor: clamp(position.anchor), head: clamp(position.head) } });
    // Wait for CodeMirror's new document layout; setting scrollTop before layout
    // can clamp a long action's saved offset to the previous short document.
    view.requestMeasure({
      key: this,
      read: () => position,
      write: saved => {
        if (this.pendingPosition !== saved || this.destroyed) return;
        view.scrollDOM.scrollTop = saved.top;
        view.scrollDOM.scrollLeft = saved.left;
        this.pendingPosition = undefined;
      },
    });
  }

  /**
   * Insert text at the cursor (replacing a selection), e.g. a cell reference picked by
   * clicking the sheet. After an identifier or `)`, a `, ` separator is added first.
   */
  insertAtCursor(text: string): void {
    const view = this.view;
    if (view === undefined || this.readOnly) return;
    const { from, to } = view.state.selection.main;
    const before = view.state.doc.sliceString(Math.max(0, from - 1), from);
    const insert = /[\w)\]]/.test(before) ? `, ${text}` : text;
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + insert.length },
      scrollIntoView: true,
    });
    view.focus();
  }

  focus(): void {
    this.view?.focus();
  }

  private shownDiagnostics: readonly EditorDiagnostic[] | null = null;

  /** Underline the findings (the lint module loads only when there is something to show). */
  private async showDiagnostics(): Promise<void> {
    if (this.diagnostics === this.shownDiagnostics || (this.diagnostics.length === 0 && this.shownDiagnostics === null)) {
      return;
    }
    this.shownDiagnostics = this.diagnostics;
    const { setDiagnostics } = await import('@codemirror/lint');
    const view = this.view;
    if (view === undefined || this.destroyed || this.shownDiagnostics !== this.diagnostics) return;
    const doc = view.state.doc;
    view.dispatch(
      setDiagnostics(
        view.state,
        this.diagnostics.map((item) => {
          const line = doc.line(Math.min(Math.max(1, item.line), doc.lines));
          const start = line.from + (line.text.length - line.text.trimStart().length);
          return { from: start, to: Math.max(start, line.to), severity: item.severity, message: item.message };
        }),
      ),
    );
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    ++this.requestGeneration;
    clearTimeout(this.signatureTimer);
    this.view?.destroy();
  }
}

export interface EditorDiagnostic {
  /** 1-based line of the editor's source. */
  line: number;
  severity: 'error' | 'warning' | 'info';
  message: string;
}

export function pythonCompletionSource(
  context: CompletionContext,
  completions: readonly PythonCompletion[],
): CompletionResult | null {
  const word = context.matchBefore(/[A-Za-z_][A-Za-z0-9_]*/);
  if (word === null && !context.explicit) return null;
  if (word !== null && word.from === word.to && !context.explicit) return null;
  return {
    from: word?.from ?? context.pos,
    options: (() => {
      const before = context.state.doc.sliceString(0, word?.from ?? context.pos);
      const qualifier = before.match(/([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\.$/)?.[1];
      return qualifier ? completions.filter(c => c.label.startsWith(`${qualifier}.`) && !c.label.slice(qualifier.length + 1).includes('.')).map(c => ({...c, label: c.label.slice(qualifier.length + 1), apply: c.apply?.slice(qualifier.length + 1)})) : completions.filter(c => !c.label.includes('.'));
    })(),
    validFor: /^[A-Za-z_][A-Za-z0-9_]*$/,
  };
}
