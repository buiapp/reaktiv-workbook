import { liveUpdateTiming, widgetBlocked } from './widget-config';
/**
 * Live nodes of the note editor: a note is one continuous document (like Outline), and
 * cell values and input widgets are inline nodes inside it that show current results.
 *
 * - `cellValue` — `{{ expression }}`: the value, plot, table, or embedded note.
 *   Typing `{{ total }}` turns into a live value once the cursor leaves the braces;
 *   double-click a value to edit its expression as text again.
 * - `sheetWidget` — `[Label: {{ x }}](#sheet-input:x?type=…)`: an interactive input.
 *
 * What they show comes from a {@link NoteNodeRenderer} supplied by the note component;
 * {@link LiveNodeViews.refresh} re-renders them when results change. Markdown ↔ node
 * conversion lives in markdown-conversion.ts.
 */
import { defineNodeSpec, defineNodeView, definePlugin, union } from 'prosekit/core';
import type { Node as ProseMirrorNode } from 'prosekit/pm/model';
import { Plugin, TextSelection } from 'prosekit/pm/state';
import type { EditorView, NodeView } from 'prosekit/pm/view';
import type { LiveNodeViews, NoteCellReference, NoteNodeRenderer, NoteWidgetModel } from './note-live-views';
import { findMath, renderMath } from './markdown-math';
import { Debouncer } from './debouncer';
import { cachedMermaid, renderMermaid } from './markdown-mermaid';
import { isRichWidget, renderRichWidget, stepValue, type WidgetValue } from './input-widgets';
import { CODE_LANGUAGES } from './code-highlight';

export type { NoteNodeRenderer, NoteWidgetModel } from './note-live-views';
export { LiveNodeViews } from './note-live-views';

/** Elements inside a live value that handle their own events. */
const INTERACTIVE_CONTENT = 'reaktiv-plotly, reaktiv-anywidget, input, select, button, textarea, .layout-toolbar';

/** Live elements updated in place when only their data changes. */
const LIVE_ELEMENTS = 'reaktiv-plotly, reaktiv-anywidget, reaktiv-html';

function withoutSpecs(html: string): string {
  return html.replace(/data-spec="[^"]*"/g, '');
}

/** Text `{{ expression }}` that becomes a live value. */
const EXPRESSION = /\{\{\s*([^{}]+?)\s*\}\}/g;

export function defineNoteNodes(renderer: NoteNodeRenderer, views: LiveNodeViews) {
  return union(
    defineNodeSpec({
      name: 'cellValue',
      inline: true,
      group: 'inline',
      atom: true,
      selectable: true,
      // Not draggable: dragging a slider or zooming a chart must not move the node.
      draggable: false,
      attrs: {
        expression: { default: '' },
        width: { default: null },
        height: { default: null },
        // 'wide' or 'full': wider than the text column (tables, charts, widgets, HTML).
        layout: { default: null },
      },
      parseDOM: [
        {
          tag: 'span[data-cell-value]',
          getAttrs: (element) => ({
            expression: (element as HTMLElement).getAttribute('data-cell-value') ?? '',
            width: numberAttribute(element as HTMLElement, 'data-width'),
            height: numberAttribute(element as HTMLElement, 'data-height'),
            layout: (element as HTMLElement).getAttribute('data-layout') || null,
          }),
        },
      ],
      toDOM: (node) => [
        'span',
        {
          'data-cell-value': node.attrs['expression'] as string,
          'data-width': node.attrs['width'] ?? undefined,
          'data-height': node.attrs['height'] ?? undefined,
          'data-layout': node.attrs['layout'] ?? undefined,
        },
      ],
    }),
    defineNodeSpec({
      name: 'sheetWidget',
      inline: true,
      group: 'inline',
      atom: true,
      selectable: true,
      // Not draggable: dragging a slider or zooming a chart must not move the node.
      draggable: false,
      attrs: {
        reference: { default: '' },
        label: { default: '' },
        query: { default: '' },
      },
      parseDOM: [
        {
          tag: 'span[data-sheet-widget]',
          getAttrs: (element) => ({
            reference: (element as HTMLElement).getAttribute('data-sheet-widget') ?? '',
            label: (element as HTMLElement).getAttribute('data-label') ?? '',
            query: (element as HTMLElement).getAttribute('data-query') ?? '',
          }),
        },
      ],
      toDOM: (node) => [
        'span',
        {
          'data-sheet-widget': node.attrs['reference'] as string,
          'data-label': node.attrs['label'] as string,
          'data-query': node.attrs['query'] as string,
        },
      ],
    }),
    defineNodeView({
      name: 'cellValue',
      constructor: (node, view, getPos) => new CellValueView(node, view, getPos, renderer, views),
    }),
    // Code blocks get a language picker; the highlighting itself is a decoration.
    defineNodeView({
      name: 'codeBlock',
      constructor: (node, view, getPos) => new CodeBlockView(node, view, getPos, renderer),
    }),
    defineNodeView({
      name: 'sheetWidget',
      constructor: (node, view, getPos) => new SheetWidgetView(node, view, getPos, renderer, views),
    }),
    // LaTeX math: `$…$` inline, `$$…$$` display.
    defineNodeSpec({
      name: 'mathInline',
      inline: true,
      group: 'inline',
      atom: true,
      selectable: true,
      attrs: { latex: { default: '' }, display: { default: false } },
      parseDOM: [
        {
          tag: 'span[data-math]',
          getAttrs: (element) => ({
            latex: (element as HTMLElement).getAttribute('data-math') ?? '',
            display: (element as HTMLElement).getAttribute('data-display') === 'true',
          }),
        },
      ],
      toDOM: (node) => [
        'span',
        { 'data-math': node.attrs['latex'] as string, 'data-display': node.attrs['display'] ? 'true' : undefined },
      ],
    }),
    defineNodeSpec({
      name: 'mathBlock',
      group: 'block',
      atom: true,
      selectable: true,
      attrs: { latex: { default: '' } },
      parseDOM: [
        {
          tag: 'div[data-math-block]',
          getAttrs: (element) => ({ latex: (element as HTMLElement).getAttribute('data-math-block') ?? '' }),
        },
      ],
      toDOM: (node) => ['div', { 'data-math-block': node.attrs['latex'] as string }],
    }),
    // Mermaid diagrams: ```mermaid fenced blocks.
    defineNodeSpec({
      name: 'mermaidBlock',
      group: 'block',
      atom: true,
      selectable: true,
      attrs: { source: { default: '' } },
      parseDOM: [
        {
          tag: 'div[data-mermaid]',
          getAttrs: (element) => ({ source: (element as HTMLElement).getAttribute('data-mermaid') ?? '' }),
        },
      ],
      toDOM: (node) => ['div', { 'data-mermaid': node.attrs['source'] as string }],
    }),
    defineNodeView({
      name: 'mermaidBlock',
      constructor: (node, view, getPos) => new MermaidView(node, view, getPos, renderer, views),
    }),
    defineNodeView({
      name: 'mathInline',
      constructor: (node, view, getPos) => new MathView(node, view, getPos, renderer, views),
    }),
    defineNodeView({
      name: 'mathBlock',
      constructor: (node, view, getPos) => new MathView(node, view, getPos, renderer, views),
    }),
    definePlugin(liveValuePlugin()),
  );
}

/**
 * Completed `{{ … }}` text becomes a live value as soon as the cursor is not inside it
 * (after typing the closing braces, pasting, or leaving an expression being edited).
 * Code blocks keep their text.
 */
const CONVERT_ALL = 'reaktiv-convert-live-values';

function liveValuePlugin(): Plugin {
  return new Plugin({
    props: {
      handleDOMEvents: {
        // Leaving the editor finishes an expression being edited, wherever the cursor is.
        blur: (view) => {
          view.dispatch(view.state.tr.setMeta(CONVERT_ALL, true));
          return false;
        },
      },
    },
    appendTransaction(transactions, _previous, state) {
      const force = transactions.some((transaction) => transaction.getMeta(CONVERT_ALL) === true);
      // Also on cursor moves: leaving an expression being edited turns it back into a value.
      if (!force && !transactions.some((transaction) => transaction.docChanged || transaction.selectionSet)) {
        return null;
      }
      const { cellValue, mathInline, mathBlock, mermaidBlock } = state.schema.nodes;
      if (cellValue === undefined) return null;
      const { from: cursor, empty } = state.selection;
      const editing = (from: number, to: number) => !force && empty && cursor > from && cursor < to;
      const replacements: Array<{ from: number; to: number; node: ProseMirrorNode }> = [];
      state.doc.descendants((node, position, parent) => {
        // A mermaid code block becomes a diagram once the cursor leaves it.
        if (node.type.name === 'codeBlock' && node.attrs['language'] === 'mermaid' && mermaidBlock !== undefined) {
          const to = position + node.nodeSize;
          const inside = !force && cursor >= position && cursor <= to;
          if (!inside && node.textContent.trim() !== '') {
            replacements.push({ from: position, to, node: mermaidBlock.create({ source: node.textContent.trim() }) });
          }
          return false;
        }
        if (node.type.spec.code) return false;
        if (!node.isText) return true;
        const text = node.text ?? '';
        const inCode = node.marks.some((mark) => mark.type.spec.code);
        const math = inCode || mathInline === undefined ? [] : findMath(text);
        for (const match of math) {
          const from = position + match.start;
          const to = position + match.end;
          if (editing(from, to)) continue;
          // `$$…$$` that is a whole paragraph becomes a math block.
          const whole = match.display && parent?.type.name === 'paragraph' && parent.textContent.trim() === text.slice(match.start, match.end).trim();
          if (whole && mathBlock !== undefined) {
            const $from = state.doc.resolve(from);
            replacements.push({ from: $from.before(), to: $from.after(), node: mathBlock.create({ latex: match.latex }) });
          } else {
            replacements.push({ from, to, node: mathInline!.create({ latex: match.latex, display: match.display }, null, node.marks) });
          }
        }
        for (const match of text.matchAll(EXPRESSION)) {
          const from = position + match.index;
          const to = from + match[0].length;
          // `{{ }}` inside math belongs to the formula.
          if (editing(from, to) || math.some((item) => match.index >= item.start && match.index < item.end)) continue;
          // Still typing a formula (`$… {{ x }}` with the cursor after it): wait for the `$`.
          const typingAfter = !force && empty && cursor >= to && cursor <= position + text.length;
          if (typingAfter && openDollar(text.slice(0, match.index))) continue;
          replacements.push({ from, to, node: cellValue.create({ expression: match[1].trim() }, null, node.marks) });
        }
        return false;
      });
      if (replacements.length === 0) return null;
      const transaction = state.tr;
      for (const item of replacements.sort((left, right) => right.from - left.from)) {
        transaction.replaceWith(item.from, item.to, item.node);
      }
      return transaction;
    },
  });
}

/** Whether text ends inside an inline formula that is not closed yet (`… $x + `). */
function openDollar(text: string): boolean {
  const closed = findMath(text).reduce((end, match) => Math.max(end, match.end), 0);
  const rest = text.slice(closed);
  return /(^|[^\\$])\$(?!\$)\S/.test(rest);
}

function createLayoutToolbar(choose: (layout: string | null) => void): HTMLElement {
  const toolbar = document.createElement('span');
  toolbar.className = 'layout-toolbar';
  toolbar.setAttribute('role', 'group');
  toolbar.setAttribute('aria-label', 'Width in the note');
  for (const [layout, label, title] of [
    ['', 'Normal', 'As wide as the text'],
    ['wide', 'Wide', 'Wider than the text'],
    ['full', 'Full', 'The full width of the note'],
  ] as const) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.title = title;
    button.dataset['layout'] = layout;
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      choose(layout || null);
    });
    toolbar.append(button);
  }
  return toolbar;
}

class CellValueView implements NodeView {
  readonly dom: HTMLElement;
  private lastHtml: string | null = null;
  /** Normal · Wide · Full, on hover while editing (also reachable over widgets' iframes). */
  private readonly toolbar = createLayoutToolbar((layout) => this.setLayout(layout));
  private readonly widgetButton = document.createElement('button');

  constructor(
    private node: ProseMirrorNode,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
    private readonly renderer: NoteNodeRenderer,
    private readonly views: LiveNodeViews,
  ) {
    this.dom = document.createElement('span');
    this.dom.className = 'cell-value-node';
    this.dom.contentEditable = 'false';
    this.widgetButton.type = 'button';
    this.widgetButton.className = 'reference-presentation';
    this.widgetButton.textContent = 'Show as widget';
    this.widgetButton.addEventListener('mousedown', event => event.preventDefault());
    this.widgetButton.addEventListener('click', event => {
      event.preventDefault(); event.stopPropagation(); this.showWidget();
    });
    this.dom.addEventListener('click', this.handleClick);
    this.dom.addEventListener('dblclick', this.handleDoubleClick);
    this.render();
    views.add(this);
  }

  render(): void {
    const expression = this.node.attrs['expression'] as string;
    const layout = this.node.attrs['layout'] as string | null;
    this.dom.classList.toggle('layout-wide', layout === 'wide');
    this.dom.classList.toggle('layout-full', layout === 'full');
    // Trimmed: the editor keeps whitespace (pre-wrap), so a trailing newline would break the line.
    const html = this.renderer
      .valueHtml(expression, this.node.attrs['width'] as number | null, this.node.attrs['height'] as number | null)
      .trim();
    this.dom.title = this.renderer.editable()
      ? `{{ ${expression} }} · click to show its cell · double-click to edit`
      : `{{ ${expression} }} · click to show its cell`;
    // The cells it reads: the app marks the value while they recompute (cell-activity.ts).
    this.dom.dataset['cells'] = this.renderer.references(expression).map((reference) => reference.cellId).join(' ');
    // Unchanged output keeps its DOM (an interactive chart is not redrawn on every edit).
    if (html === this.lastHtml) {
      this.updateToolbar();
      return;
    }
    const previous = this.lastHtml;
    this.lastHtml = html;
    // A live chart or widget whose data changed is updated in place, so it keeps its
    // state (a running widget, a zoomed chart) instead of being recreated.
    if (previous !== null && withoutSpecs(previous) === withoutSpecs(html) && this.updateSpecs(html)) {
      this.updateToolbar();
      return;
    }
    this.dom.innerHTML = html;
    this.dom.classList.toggle('block-value', /<(?:img|table|div|blockquote)\b/.test(html));
    this.updateToolbar();
  }

  /** The toolbar is shown for block values of a plain reference (where the layout is stored). */
  private updateToolbar(): void {
    const canShowWidget = this.canShowWidget();
    this.dom.tabIndex = canShowWidget ? 0 : -1;
    if (canShowWidget) {
      if (this.widgetButton.parentElement !== this.dom) this.dom.append(this.widgetButton);
    } else this.widgetButton.remove();
    const plain = /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?$/.test(this.node.attrs['expression'] as string);
    const show = this.renderer.editable() && plain && this.dom.classList.contains('block-value');
    if (!show) {
      this.toolbar.remove();
      return;
    }
    const layout = (this.node.attrs['layout'] as string | null) ?? '';
    for (const button of this.toolbar.querySelectorAll<HTMLButtonElement>('button')) {
      button.setAttribute('aria-pressed', String(button.dataset['layout'] === layout));
    }
    if (this.toolbar.parentElement !== this.dom) this.dom.append(this.toolbar);
  }

  private canShowWidget(): boolean {
    const expression = this.node.attrs['expression'] as string;
    return this.renderer.editable() && /^[A-Za-z_]\w*(?:[.!][A-Za-z_]\w*)?$/.test(expression)
      && this.renderer.widget('', expression, '') !== null;
  }

  private setLayout(layout: string | null): void {
    const position = this.getPos();
    if (position === undefined || !this.renderer.editable()) return;
    this.view.dispatch(this.view.state.tr.setNodeMarkup(position, undefined, { ...this.node.attrs, layout }));
  }

  update(node: ProseMirrorNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }

  private updateSpecs(html: string): boolean {
    const template = document.createElement('template');
    template.innerHTML = html;
    const next = [...template.content.querySelectorAll<HTMLElement>(LIVE_ELEMENTS)];
    const current = [...this.dom.querySelectorAll<HTMLElement>(LIVE_ELEMENTS)];
    if (next.length === 0 || next.length !== current.length) return false;
    next.forEach((element, index) => current[index].setAttribute('data-spec', element.getAttribute('data-spec') ?? ''));
    return true;
  }

  selectNode(): void {
    this.dom.classList.add('selected');
  }

  deselectNode(): void {
    this.dom.classList.remove('selected');
  }

  /** Interactive content (charts, embedded widgets) keeps its own mouse and key events. */
  stopEvent(event: Event): boolean {
    return (event.target as HTMLElement).closest(INTERACTIVE_CONTENT) !== null;
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy(): void {
    this.views.delete(this);
    if (cellPopover?.anchor === this.dom) hideCellPopover();
    this.cancelPopover();
  }

  private popoverTimer: ReturnType<typeof setTimeout> | null = null;

  private cancelPopover(): void {
    if (this.popoverTimer !== null) clearTimeout(this.popoverTimer);
    this.popoverTimer = null;
  }

  /**
   * Links inside a value never navigate. A click offers to show the cells the value comes
   * from in the cell view; Cmd/Ctrl+click goes straight to the cell.
   */
  private readonly handleClick = (event: MouseEvent): void => {
    const target = event.target as HTMLElement;
    const link = target.closest<HTMLAnchorElement>('a[href^="#cell-"]');
    if (link !== null) event.preventDefault();
    // A link inside a Markdown string value is followed, not a click on the value.
    else if (target.closest('.markdown-value a[href]') !== null) return;
    if (target.closest(INTERACTIVE_CONTENT) !== null) return;
    const references = this.renderer.references(this.node.attrs['expression'] as string);
    if (references.length === 0) return;
    if (event.metaKey || event.ctrlKey) {
      this.renderer.selectCell(references[0].cellId);
      return;
    }
    // After the double-click delay: a double-click edits the expression instead.
    this.cancelPopover();
    this.popoverTimer = setTimeout(() => {
      this.popoverTimer = null;
      if (!this.dom.isConnected) return;
      showCellPopover(this.dom, references, (cellId) => this.renderer.selectCell(cellId),
        this.canShowWidget() ? {label: 'Show as widget', run: () => this.showWidget()} : undefined);
    }, 220);
  };

  private showWidget(): void {
    const position = this.getPos();
    const reference = this.node.attrs['expression'] as string;
    const widget = this.renderer.widget('', reference, '');
    if (position === undefined || !this.renderer.editable() || widget === null) return;
    const node = this.view.state.schema.nodes['sheetWidget'].create(
      {reference, label: widget.label || reference, query: ''}, null, this.node.marks);
    this.view.dispatch(this.view.state.tr.replaceWith(position, position + this.node.nodeSize, node));
    this.view.focus();
  }

  /** Turn the value back into `{{ expression }}` text with the cursor inside it. */
  private readonly handleDoubleClick = (event: MouseEvent): void => {
    this.cancelPopover();
    hideCellPopover();
    const position = this.getPos();
    if (position === undefined || !this.renderer.editable()) return;
    event.preventDefault();
    const text = `{{ ${this.node.attrs['expression'] as string} }}`;
    const { state } = this.view;
    const transaction = state.tr.replaceWith(
      position,
      position + this.node.nodeSize,
      state.schema.text(text, this.node.marks),
    );
    transaction.setSelection(TextSelection.create(transaction.doc, position + text.length - 3));
    this.view.dispatch(transaction);
    this.view.focus();
  };
}

/** A code block with a language picker in its corner (it sets the fence language). */
class CodeBlockView implements NodeView {
  readonly dom: HTMLElement;
  readonly contentDOM: HTMLElement;
  private readonly picker: HTMLSelectElement;

  constructor(
    private node: ProseMirrorNode,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
    private readonly renderer: NoteNodeRenderer,
  ) {
    this.dom = document.createElement('div');
    this.dom.className = 'code-block-node';
    const pre = document.createElement('pre');
    this.contentDOM = document.createElement('code');
    pre.append(this.contentDOM);
    this.picker = document.createElement('select');
    this.picker.className = 'code-language';
    this.picker.contentEditable = 'false';
    this.picker.setAttribute('aria-label', 'Code language');
    this.picker.title = 'Language for syntax highlighting';
    this.picker.addEventListener('change', this.changeLanguage);
    this.dom.append(this.picker, pre);
    this.render();
  }

  private render(): void {
    const language = (this.node.attrs['language'] as string) ?? '';
    const options = CODE_LANGUAGES.some((option) => option.id === language)
      ? CODE_LANGUAGES
      : [...CODE_LANGUAGES, { id: language, name: language }];
    if (this.picker.options.length !== options.length) {
      this.picker.replaceChildren(
        ...options.map((option) => new Option(option.name, option.id)),
      );
    }
    this.picker.value = language;
    this.picker.disabled = !this.renderer.editable();
    this.contentDOM.className = language ? `language-${language}` : '';
    this.dom.dataset['language'] = language;
  }

  update(node: ProseMirrorNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }

  /** The picker handles its own clicks and keys. */
  stopEvent(event: Event): boolean {
    return event.target === this.picker;
  }

  ignoreMutation(mutation: MutationRecord | { type: 'selection'; target: Node }): boolean {
    return mutation.type !== 'selection' && !this.contentDOM.contains(mutation.target);
  }

  private readonly changeLanguage = (): void => {
    const position = this.getPos();
    if (position === undefined || !this.renderer.editable()) return;
    this.view.dispatch(
      this.view.state.tr.setNodeMarkup(position, undefined, { ...this.node.attrs, language: this.picker.value }),
    );
    this.view.focus();
  };
}

/** A Mermaid diagram; `{{ }}` in its source show current values. Double-click to edit. */
class MermaidView implements NodeView {
  readonly dom: HTMLElement;
  private shown = '';

  constructor(
    private node: ProseMirrorNode,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
    private readonly renderer: NoteNodeRenderer,
    private readonly views: LiveNodeViews,
  ) {
    this.dom = document.createElement('div');
    this.dom.className = 'mermaid-node';
    this.dom.contentEditable = 'false';
    this.dom.title = 'Double-click to edit the diagram';
    this.dom.addEventListener('dblclick', this.edit);
    this.render();
    views.add(this);
  }

  render(): void {
    const raw = this.node.attrs['source'] as string;
    const source = raw.includes('{{') ? this.renderer.interpolate(raw) : raw;
    const cached = cachedMermaid(source);
    if (cached !== undefined) {
      this.show(cached);
      return;
    }
    if (this.shown === '') this.show(`<pre class="mermaid-pending"><code></code></pre>`, raw);
    void renderMermaid(source).then((svg) => {
      // Still the current source? (values may have changed meanwhile)
      const latest = this.node.attrs['source'] as string;
      if ((latest.includes('{{') ? this.renderer.interpolate(latest) : latest) === source) this.show(svg);
    });
  }

  private show(html: string, pendingText?: string): void {
    if (html === this.shown) return;
    this.shown = html;
    this.dom.innerHTML = html;
    if (pendingText !== undefined) this.dom.querySelector('code')!.textContent = pendingText;
  }

  update(node: ProseMirrorNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }

  selectNode(): void {
    this.dom.classList.add('selected');
  }

  deselectNode(): void {
    this.dom.classList.remove('selected');
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy(): void {
    this.views.delete(this);
  }

  /** Back to a ```mermaid code block; it becomes a diagram again when the cursor leaves. */
  private readonly edit = (event: MouseEvent): void => {
    const position = this.getPos();
    const codeBlock = this.view.state.schema.nodes['codeBlock'];
    if (position === undefined || codeBlock === undefined || !this.renderer.editable()) return;
    event.preventDefault();
    const source = this.node.attrs['source'] as string;
    const { state } = this.view;
    const transaction = state.tr.replaceWith(
      position,
      position + this.node.nodeSize,
      codeBlock.create({ language: 'mermaid' }, state.schema.text(source)),
    );
    transaction.setSelection(TextSelection.create(transaction.doc, position + 1 + source.length));
    this.view.dispatch(transaction);
    this.view.focus();
  };
}

/** A formula rendered with KaTeX; `{{ }}` inside it show current values. */
class MathView implements NodeView {
  readonly dom: HTMLElement;
  private lastHtml = '';

  constructor(
    private node: ProseMirrorNode,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
    private readonly renderer: NoteNodeRenderer,
    private readonly views: LiveNodeViews,
  ) {
    const block = node.type.name === 'mathBlock';
    this.dom = document.createElement(block ? 'div' : 'span');
    this.dom.className = block ? 'math-node math-block' : 'math-node';
    this.dom.contentEditable = 'false';
    this.dom.title = 'Double-click to edit the formula';
    this.dom.addEventListener('dblclick', this.edit);
    this.render();
    views.add(this);
  }

  render(): void {
    const latex = this.node.attrs['latex'] as string;
    const display = this.node.type.name === 'mathBlock' || Boolean(this.node.attrs['display']);
    const html = renderMath(latex.includes('{{') ? this.renderer.interpolate(latex) : latex, display);
    if (html === this.lastHtml) return;
    this.lastHtml = html;
    this.dom.innerHTML = html;
  }

  update(node: ProseMirrorNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }

  selectNode(): void {
    this.dom.classList.add('selected');
  }

  deselectNode(): void {
    this.dom.classList.remove('selected');
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy(): void {
    this.views.delete(this);
  }

  /** Back to `$…$` text with the cursor inside; it turns into math again when left. */
  private readonly edit = (event: MouseEvent): void => {
    const position = this.getPos();
    if (position === undefined || !this.renderer.editable()) return;
    event.preventDefault();
    const latex = this.node.attrs['latex'] as string;
    const block = this.node.type.name === 'mathBlock';
    const delimiter = block || this.node.attrs['display'] ? '$$' : '$';
    const text = `${delimiter}${latex}${delimiter}`;
    const { state } = this.view;
    const content = block
      ? state.schema.nodes['paragraph'].create(null, state.schema.text(text))
      : state.schema.text(text, this.node.marks);
    const transaction = state.tr.replaceWith(position, position + this.node.nodeSize, content);
    const cursor = position + (block ? 1 : 0) + delimiter.length + latex.length;
    transaction.setSelection(TextSelection.create(transaction.doc, cursor));
    this.view.dispatch(transaction);
    this.view.focus();
  };
}

class SheetWidgetView implements NodeView {
  readonly dom: HTMLElement;
  /** Layout of the rendered control; a refresh with the same layout updates values only. */
  private layout = '';
  private dragging = false;
  private widget: NoteWidgetModel | null = null;
  private renderedType = '';
  private valueToolbar: HTMLElement | null = null;
  /** Values while dragging or typing: the cell updates with the widget's timing, and on commit. */
  private readonly debouncer = new Debouncer<WidgetValue>((value) => {
    if (this.widget !== null) this.renderer.changeWidget(this.widget, value);
  });

  constructor(
    private node: ProseMirrorNode,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
    private readonly renderer: NoteNodeRenderer,
    private readonly views: LiveNodeViews,
  ) {
    this.dom = document.createElement('span');
    this.dom.className = 'sheet-widget-node';
    this.dom.contentEditable = 'false';
    this.render();
    views.add(this);
  }

  render(): void {
    // Reattach the authoring toolbar after any control rebuild/update.
    this.renderControl();
    this.dom.tabIndex = this.renderer.editable() ? 0 : -1;
    if (!this.renderer.editable()) { this.valueToolbar?.remove(); return; }
    if (this.valueToolbar !== null) {
      if (this.valueToolbar.parentElement !== this.dom) this.dom.append(this.valueToolbar);
      return;
    }
    const toolbar = document.createElement('span'); toolbar.className = 'reference-presentation-toolbar';
    const button = document.createElement('button'); button.type = 'button';
    button.className = 'reference-presentation';
    button.textContent = 'Show value'; button.setAttribute('aria-label', 'Show as value');
    button.addEventListener('mousedown', event => event.preventDefault());
    button.addEventListener('click', event => {
      event.preventDefault(); event.stopPropagation();
      const position = this.getPos();
      if (position === undefined || !this.renderer.editable()) return;
      const node = this.view.state.schema.nodes['cellValue'].create(
        {expression: this.node.attrs['reference']}, null, this.node.marks);
      this.view.dispatch(this.view.state.tr.replaceWith(position, position + this.node.nodeSize, node));
      this.view.focus();
    });
    toolbar.append(button); this.valueToolbar = toolbar; this.dom.append(toolbar);
  }

  private renderControl(): void {
    const reference = this.node.attrs['reference'] as string;
    const widget = this.renderer.widget(
      this.node.attrs['label'] as string,
      reference,
      this.node.attrs['query'] as string,
    );
    this.widget = widget;
    this.dom.hidden = widget?.visible === false;
    this.dom.setAttribute('aria-busy', String(widget?.loading === true));
    this.dom.classList.toggle('linked-widget', widget?.linked === true);
    if (widget === null) {
      this.layout = '';
      const missing = document.createElement('span');
      missing.className = 'missing-value';
      missing.textContent = `Input not found: ${reference}`;
      this.dom.replaceChildren(missing);
      return;
    }
    const layout = JSON.stringify([widget.cellId, widget.type, widget.label, widget.min, widget.max, widget.step, widget.options, widget.disabled, widget.loading, widget.pressed, widget.placeholder, widget.buttonMode, widget.cancelWhileRunning, widget.actionState, widget.action, widget.actionArguments, widget.actionError, widget.rejected, widget.error, widget.linked, widget.debounce, this.renderer.interactive()]);
    if (isRichWidget(widget.type)) {
      this.renderRich(widget, layout);
      this.showError(widget);
      this.linkedAction(widget);
      return;
    }
    if (this.renderedType === widget.type && this.updateInPlace(widget)) { this.layout = layout; this.showError(widget); this.linkedAction(widget); return; }
    this.renderedType = widget.type;
    this.layout = layout;
    this.dom.replaceChildren(
      renderWidget(widget, this.renderer, {
        input: (value) => {
          // The current settings: a control is updated in place when they change.
          const current = this.widget ?? widget;
          const timing = liveUpdateTiming(current.type, current.debounce);
          if (timing !== null) this.debouncer.call(value, timing);
        },
        change: (value) => {
          this.debouncer.cancel();
          this.renderer.changeWidget(widget, value);
        },
        dragging: (active) => (this.dragging = active),
      }),
    );
    this.showError(widget);
    this.linkedAction(widget);
  }

  private showError(widget: NoteWidgetModel): void {
    this.dom.querySelector(':scope > .widget-config-error')?.remove();
    if (widget.error) {
      const error = document.createElement('span'); error.className = 'widget-config-error';
      error.setAttribute('role', 'status'); error.textContent = 'Widget: ' + widget.error; this.dom.append(error);
    }
  }

  private linkedAction(widget: NoteWidgetModel): void {
    let button = this.dom.querySelector<HTMLButtonElement>(':scope > .linked-reset');
    if (!widget.linkedOverridden || !this.renderer.resetLinked) { button?.remove(); return; }
    if (!button) {
      button = document.createElement('button'); button.type = 'button'; button.className = 'linked-reset';
      button.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11a9 9 0 1 1 9 9M3 4v7h7"/></svg>';
      button.title = 'Value overridden · Reset to derived value';
      button.setAttribute('aria-label', 'Reset ' + widget.label + ' to derived value');
      button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); this.renderer.resetLinked?.(this.widget!.cellId); });
      this.dom.append(button);
    }
    button.disabled = !this.renderer.interactive() || widgetBlocked(widget) || !!widget.error;
  }

  /** List, multiselect, long text, button: rebuilt only when what they show changed. */
  private renderRich(widget: NoteWidgetModel, layout: string): void {
    const signature = `${layout}\n${JSON.stringify(widget.value)}`;
    if (signature === this.layout) return;
    let root = this.dom.querySelector<HTMLElement>(':scope > .rich-widget');
    if (root === null || root.dataset['widgetType'] !== widget.type) {
      root = document.createElement('span');
      root.className = `sheet-widget rich-widget rich-${widget.type}`;
      root.dataset['widgetType'] = widget.type;
      const body = document.createElement('span');
      body.className = 'rich-widget-body';
      root.append(body);
      this.dom.replaceChildren(root);
    }
    this.layout = signature;
    const title = root.querySelector('.rich-widget-label');
    if (title) title.textContent = widget.label;
    renderRichWidget(
      root.querySelector<HTMLElement>('.rich-widget-body')!,
      { ...widget, disabled: !this.renderer.interactive() || widgetBlocked(widget) || !!widget.error },
      (value) => this.renderer.changeWidget(widget, value),
      () => this.renderer.invokeAction?.(widget),
    );
  }

  /** New values for the existing control; never moves a slider that is being dragged. */
  private updateInPlace(widget: NoteWidgetModel): boolean {
    const control = this.dom.querySelector<HTMLInputElement | HTMLSelectElement>('input, select');
    if (control === null) return false;
    control.disabled = !this.renderer.interactive() || widgetBlocked(widget) || !!widget.error;
    if (control.disabled) { this.debouncer.cancel(); this.dragging = false; }
    control.setAttribute('aria-label', widget.label);
    const label = this.dom.querySelector('.widget-label');
    if (label) label.textContent = widget.label;
    this.dom.querySelectorAll<HTMLButtonElement>('.widget-step').forEach(button => button.disabled = control.disabled);
    if (control instanceof HTMLSelectElement) updateSelectOptions(control, widget);
    if (control instanceof HTMLInputElement) {
      control.placeholder = widget.placeholder ?? '';
      for (const key of ['min', 'max', 'step'] as const) {
        if (widget[key] === null) control.removeAttribute(key); else control[key] = widget[key];
      }
    }
    if (!this.dragging && document.activeElement !== control) {
      if (control instanceof HTMLInputElement && control.type === 'checkbox') control.checked = Boolean(widget.value);
      else control.value = String(widget.value);
    }
    const readout = this.dom.querySelector('.widget-value');
    if (readout !== null && !this.dragging) { readout.textContent = widget.display; readout.setAttribute('title', widget.display); }
    return true;
  }

  update(node: ProseMirrorNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }

  selectNode(): void {
    this.dom.classList.add('selected');
  }

  deselectNode(): void {
    this.dom.classList.remove('selected');
  }

  /** The control handles its own events (typing, clicking, dragging a slider). */
  stopEvent(event: Event): boolean {
    return (event.target as HTMLElement).closest('input, select, label, textarea, button, .sheet-widget') !== null;
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy(): void {
    this.debouncer.cancel();
    this.views.delete(this);
  }
}

interface WidgetHandlers {
  /** A slider moved (while dragging). */
  input(value: string): void;
  /** The final value (release, or any other control's change). */
  change(value: WidgetValue): void;
  dragging(active: boolean): void;
}

function renderWidget(widget: NoteWidgetModel, renderer: NoteNodeRenderer, handlers: WidgetHandlers): HTMLElement {
  const label = document.createElement('label');
  label.className = widget.type === 'range' ? 'sheet-widget range-widget' : 'sheet-widget';
  const text = document.createElement('span');
  text.textContent = widget.label;
  text.className = 'widget-label';
  label.append(text);
  const disabled = !renderer.interactive() || widgetBlocked(widget) || !!widget.error;
  const emit = (event: Event) => {
    const control = event.target as HTMLInputElement | HTMLSelectElement;
    handlers.change(control instanceof HTMLInputElement && control.type === 'checkbox' ? control.checked : control.value);
  };
  if (widget.type === 'select') {
    const select = document.createElement('select');
    updateSelectOptions(select, widget);
    select.disabled = disabled;
    select.addEventListener('change', emit);
    label.append(select);
  } else {
    const input = document.createElement('input');
    input.type = widget.type;
    input.placeholder = widget.placeholder ?? '';
    input.setAttribute('aria-label', widget.label);
    if (widget.type === 'date') label.classList.add('compact-widget');
    if (widget.min !== null) input.min = widget.min;
    if (widget.max !== null) input.max = widget.max;
    if (widget.step !== null) input.step = widget.step;
    // Range inputs sanitize on assignment: establish bounds/precision before the value.
    if (widget.type === 'checkbox') input.checked = Boolean(widget.value);
    else input.value = String(widget.value);
    input.disabled = disabled;
    input.addEventListener('change', emit);
    // Text and number fields with a `debounce` update their cell while typing (the handler
    // checks the current setting).
    if (widget.type === 'text' || widget.type === 'number') {
      input.addEventListener('input', () => {
        if (widget.type !== 'number' || input.value.trim() !== '') handlers.input(input.value);
      });
    }
    let increase: HTMLElement | null = null;
    if (widget.type === 'range') {
      // ‹ and › step the slider by one step, like the arrow keys on a focused slider.
      const stepButton = (direction: -1 | 1) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'widget-step';
        button.textContent = direction < 0 ? '‹' : '›';
        button.setAttribute('aria-label', direction < 0 ? `Decrease ${widget.label}` : `Increase ${widget.label}`);
        button.disabled = disabled;
        button.addEventListener('click', (event) => {
          event.preventDefault();
          const next = stepValue(Number(input.value), direction, {
            min: widget.min === null ? undefined : Number(widget.min),
            max: widget.max === null ? undefined : Number(widget.max),
            step: widget.step === null ? undefined : Number(widget.step),
          });
          if (String(next) === input.value) return;
          input.value = String(next);
          const readout = label.querySelector('.widget-value');
          if (readout !== null) { readout.textContent = input.value; readout.setAttribute('title', input.value); }
          handlers.change(input.value);
        });
        return button;
      };
      label.append(stepButton(-1));
      increase = stepButton(1);
      // The readout follows the thumb at once; the cell updates through the debouncer.
      input.addEventListener('input', () => {
        const readout = label.querySelector('.widget-value');
        if (readout !== null) { readout.textContent = input.value; readout.setAttribute('title', input.value); }
        handlers.input(input.value);
      });
      input.addEventListener('pointerdown', () => handlers.dragging(true));
      const stop = () => handlers.dragging(false);
      input.addEventListener('pointerup', stop);
      input.addEventListener('pointercancel', stop);
      input.addEventListener('blur', stop);
    }
    label.append(input);
    if (increase !== null) label.append(increase);
  }
  // A checkbox and a date field already show their value.
  if (widget.type !== 'checkbox' && widget.type !== 'date') {
    const value = document.createElement('span');
    value.className = 'widget-value';
    value.textContent = widget.display;
    value.title = widget.display;
    label.append(value);
  }
  return label;
}

function updateSelectOptions(select: HTMLSelectElement, widget: NoteWidgetModel): void {
  const current = String(widget.value);
  const options = widget.options.includes(current) || current === '' ? widget.options : [current, ...widget.options];
  if (JSON.stringify([...select.options].map(option => [option.value, option.textContent])) === JSON.stringify(options.map(option => [option, widget.options.includes(option) ? option : `${option} (unavailable)`]))) return;
  select.replaceChildren(...options.map(option => {
    const node = new Option(widget.options.includes(option) ? option : `${option} (unavailable)`, option, false, option === current);
    node.disabled = !widget.options.includes(option); return node;
  }));
}

// --- "Show cell" popover of a live value ------------------------------------------------

let cellPopover: { element: HTMLElement; anchor: HTMLElement; close: () => void } | null = null;

export function hideCellPopover(): void {
  cellPopover?.close();
}

/** A small menu under a live value: the cells it reads, each opening in the cell view. */
function showCellPopover(
  anchor: HTMLElement,
  references: readonly NoteCellReference[],
  select: (cellId: string) => void,
  presentation?: {label: string; run: () => void},
): void {
  hideCellPopover();
  const element = document.createElement('div');
  element.className = 'cell-popover';
  element.setAttribute('role', 'menu');
  const title = document.createElement('span');
  title.className = 'cell-popover-title';
  title.textContent = references.length === 1 ? 'Show cell' : 'Show a cell';
  element.append(title);
  for (const reference of references) {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'menuitem');
    const name = document.createElement('strong');
    name.textContent = reference.label || reference.cellId;
    const detail = document.createElement('span');
    detail.textContent = [reference.label ? reference.cellId.replace('!', ' · ') : '', reference.display]
      .filter(Boolean)
      .join(' = ');
    const arrow = document.createElement('span');
    arrow.className = 'cell-popover-arrow';
    arrow.textContent = '→';
    button.append(name, detail, arrow);
    button.title = `Open ${reference.cellId} in the cell view`;
    button.addEventListener('click', () => {
      hideCellPopover();
      select(reference.cellId);
    });
    element.append(button);
  }
  if (presentation) {
    const button = document.createElement('button'); button.type = 'button';
    button.setAttribute('role', 'menuitem'); button.textContent = presentation.label;
    button.addEventListener('mousedown', event => event.preventDefault());
    button.addEventListener('click', () => { hideCellPopover(); presentation.run(); });
    element.append(button);
  }
  document.body.append(element);
  const rect = anchor.getBoundingClientRect();
  const width = element.offsetWidth;
  const height = element.offsetHeight;
  const below = Math.min(rect.bottom, window.innerHeight) + 6;
  element.style.top = `${below + height > window.innerHeight - 8 ? Math.max(8, rect.top - height - 6) : below}px`;
  element.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;

  const outside = (event: Event) => {
    if (!element.contains(event.target as Node)) close();
  };
  const key = (event: KeyboardEvent) => {
    if (event.key === 'Escape') close();
  };
  const close = () => {
    element.remove();
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', key, true);
    window.removeEventListener('scroll', close, true);
    window.removeEventListener('resize', close);
    if (cellPopover?.element === element) cellPopover = null;
  };
  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('keydown', key, true);
  window.addEventListener('scroll', close, true);
  window.addEventListener('resize', close);
  cellPopover = { element, anchor, close };
}

function numberAttribute(element: HTMLElement, name: string): number | null {
  const value = Number(element.getAttribute(name));
  return element.hasAttribute(name) && Number.isFinite(value) && value > 0 ? value : null;
}
