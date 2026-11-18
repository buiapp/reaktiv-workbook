/**
 * Types shared by the note editor and its live nodes (note-nodes.ts). Kept free of
 * ProseKit imports so the editor library stays out of the initial bundle.
 */
import type { WidgetType, WidgetValue } from './input-widgets';

export interface NoteWidgetModel {
  linked?: boolean;
  linkedOverridden?: boolean;
  cellId: string;
  type: WidgetType;
  label: string;
  disabled?: boolean;
  visible?: boolean;
  loading?: boolean;
  pressed?: boolean;
  placeholder?: string;
  buttonMode?: 'count' | 'toggle' | 'action';
  action?: string;
  cancelWhileRunning?: boolean;
  debounce?: number;
  actionState?: 'running' | 'cancelling';
  actionArguments?: Record<string, import('./sheet.types').ActionBinding>;
  actionError?: string;
  error?: string;
  value: WidgetValue;
  display: string;
  min: string | null;
  max: string | null;
  step: string | null;
  options: string[];
}

export interface NoteNodeRenderer {
  /** HTML of a live value (as the rendered note shows it). */
  valueHtml(expression: string, width: number | null, height: number | null): string;
  /** The widget for an input link, or null when its cell is missing or not an input. */
  widget(label: string, reference: string, query: string): NoteWidgetModel | null;
  resetLinked?(cellId: string): void;
  invokeAction?(widget: NoteWidgetModel): void;
  changeWidget(widget: NoteWidgetModel, value: WidgetValue): void;
  /** Open the cell a value comes from (Cmd/Ctrl+click, or the "Show cell" popover). */
  selectCell(cellId: string): void;
  /** The cells an expression reads, for the "Show cell" popover of a live value. */
  references(expression: string): NoteCellReference[];
  /** The note's text can be edited (editing mode): double-click turns values, formulas,
   * and diagrams back into their source; code blocks get a language picker. */
  editable(): boolean;
  /** Widgets can change their input cells (the workbook runs). True in reading mode too. */
  interactive(): boolean;
  /** Text with `{{ expression }}` replaced by current values (used inside math). */
  interpolate(text: string): string;
}

export interface NoteCellReference {
  cellId: string;
  /** The cell's label, or '' when it has none. */
  label: string;
  /** Short current value (or the error) to recognise the cell by. */
  display: string;
  kind?: string;
}

/** Node views currently on screen, re-rendered when values change. */
export class LiveNodeViews {
  private readonly views = new Set<{ render(): void }>();

  add(view: { render(): void }): void {
    this.views.add(view);
  }

  delete(view: { render(): void }): void {
    this.views.delete(view);
  }

  refresh(): void {
    for (const view of this.views) view.render();
  }
}
