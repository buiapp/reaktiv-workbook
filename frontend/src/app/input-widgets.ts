/**
 * Input widgets: controls bound to an input cell, in notes
 * (`[Label: {{ x }}](#sheet-input:x?type=…)`) and in grid tiles (`view.widget`).
 *
 * Simple types are a single native control (`number`, `range`, `checkbox`, `select`,
 * `text`, `date`). The *rich* types are built here as plain DOM, shared by notes and
 * tiles, and are what small apps are made of:
 *
 * - `textarea`    — multi-line text (a string)
 * - `list`        — add and remove strings (a list of strings)
 * - `multiselect` — tick any of the given options (a list of strings)
 * - `button`      — counts clicks (a number); cells that read it run on every click
 *
 * File/folder controls select path strings; they never upload or read file contents.
 * A widget sends a value through the shared input-write path ({@link widgetSource}).
 */
export const WIDGET_TYPES = [
  'checkbox',
  'number',
  'range',
  'select',
  'text',
  'textarea',
  'date',
  'list',
  'multiselect',
  'radio',
  'button',
  'file',
  'folder',
] as const;

export type WidgetType = (typeof WIDGET_TYPES)[number];
export type WidgetValue = string | number | boolean | string[];

/** One renderer registry is shared by Notes and worksheet tiles. Native controls stay with their adapters. */
export type RichWidgetBuilder = (model: RichWidgetModel, change: (value: WidgetValue) => void, invokeAction: (name: string) => void) => HTMLElement;
const RICH_WIDGET_BUILDERS: Partial<Record<WidgetType, RichWidgetBuilder>> = {
  textarea: buildTextarea, list: buildList, multiselect: buildMultiselect, radio: buildRadio,
  button: buildButton, file: buildPathControl, folder: buildPathControl,
};

export function isWidgetType(value: string): value is WidgetType {
  return (WIDGET_TYPES as readonly string[]).includes(value);
}

/** Types rendered by {@link renderRichWidget} instead of one native control. */
export function isRichWidget(type: string): boolean {
  return Object.hasOwn(RICH_WIDGET_BUILDERS, type);
}

/** The widget a value suggests when none is configured. */
export function inferWidgetType(value: unknown): WidgetType {
  if (typeof value === 'boolean') return 'checkbox';
  if (typeof value === 'number') return 'number';
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return 'list';
  if (typeof value === 'string' && value.includes('\n')) return 'textarea';
  return 'text';
}

/** A cell value as the list of strings a `list` / `multiselect` widget edits. */
export function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

/**
 * One step up or down for a slider: by `step` (default 1), within `min`/`max`, rounded
 * to the step's decimals so 0.1 + 0.2 stays 0.3.
 */
export function stepValue(
  current: number,
  direction: -1 | 1,
  { min, max, step }: { min?: number; max?: number; step?: number },
): number {
  const size = step !== undefined && Number.isFinite(step) && step > 0 ? step : 1;
  const decimals = (String(size).split('.')[1] ?? '').length;
  let next = Number(((Number.isFinite(current) ? current : 0) + direction * size).toFixed(decimals));
  if (min !== undefined && Number.isFinite(min)) next = Math.max(min, next);
  if (max !== undefined && Number.isFinite(max)) next = Math.min(max, next);
  return next;
}

/** Python source for a widget's new value (inputs store Python literals). */
export function widgetSource(value: WidgetValue, type: WidgetType, buttonMode: 'count' | 'toggle' | 'action' = 'count'): string | null {
  if (type === 'button' && buttonMode === 'action') return null;
  if (type === 'button' && buttonMode === 'toggle') return typeof value === 'boolean' ? (value ? 'True' : 'False') : null;
  if (type === 'checkbox') return value ? 'True' : 'False';
  if (type === 'number' || type === 'range' || type === 'button') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? String(parsed) : null;
  }
  if (type === 'list' || type === 'multiselect') {
    return `[${stringList(value).map(pythonString).join(', ')}]`;
  }
  return pythonString(String(value));
}

/**
 * A widget trait value as the source of an input cell (bound widgets): numbers,
 * text, booleans, None, and lists or dicts of those. Null when it has no literal form.
 */
export function pythonLiteral(value: unknown): string | null {
  if (value === null || value === undefined) return 'None';
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  if (typeof value === 'string') return pythonString(value);
  if (Array.isArray(value)) {
    const items = value.map(pythonLiteral);
    return items.includes(null) ? null : `[${items.join(', ')}]`;
  }
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const entries = Object.entries(value as Record<string, unknown>).map(
      ([key, item]) => [pythonString(key), pythonLiteral(item)] as const,
    );
    return entries.some(([, item]) => item === null) ? null : `{${entries.map(([key, item]) => `${key}: ${item}`).join(', ')}}`;
  }
  return null;
}

/** A double-quoted Python string literal (JSON escapes are valid Python escapes). */
function pythonString(text: string): string {
  return JSON.stringify(text);
}

/**
 * A widget replaces the value of an input cell and keeps the comment lines above it
 * (`# monthly rent` stays when the slider moves).
 */
export function withInputComments(previous: string, source: string): string {
  const comments: string[] = [];
  for (const line of previous.split('\n')) {
    if (!line.trim().startsWith('#')) break;
    comments.push(line);
  }
  // A cell that is only comments has no value to keep them above.
  if (comments.length === previous.split('\n').length) return source;
  return [...comments, source].join('\n');
}

export interface RichWidgetModel {
  type: WidgetType;
  /** Shown as the button text, and as the name in labels for assistive technology. */
  label: string;
  value: unknown;
  options: readonly string[];
  disabled: boolean;
  visible?: boolean;
  loading?: boolean;
  pressed?: boolean;
  placeholder?: string;
  buttonMode?: 'count' | 'toggle' | 'action';
  action?: string;
  cancelWhileRunning?: boolean;
  actionState?: 'running' | 'cancelling';
  actionError?: string;
  /** Text Python refused, shown with the reason in the field until corrected or Escape. */
  rejected?: { value: string; message: string };
}

/**
 * Build (or rebuild) a rich widget inside `host`. Rebuilding keeps what the user is
 * typing into a list's "add" field, and the focus, so results arriving meanwhile do
 * not interrupt them.
 */
export function renderRichWidget(
  host: HTMLElement,
  model: RichWidgetModel,
  change: (value: WidgetValue) => void,
  invokeAction: (name: string) => void = () => {},
): void {
  host.hidden = model.visible === false;
  host.setAttribute('aria-busy', String(model.loading === true));
  const focusedArea = host.querySelector<HTMLTextAreaElement>('textarea:focus');
  const areaDraft = focusedArea ? {value: focusedArea.value, start: focusedArea.selectionStart, end: focusedArea.selectionEnd} : null;
  const focusedRadio = host.querySelector<HTMLInputElement>('input[type=radio]:focus')?.value;
  const draftField = host.querySelector<HTMLInputElement>('.rw-add input');
  const draft = draftField?.value ?? '';
  const draftFocused = draftField !== null && document.activeElement === draftField;
  const effective = {...model, disabled: model.disabled || model.loading === true};
  const control = build(effective, value => {
    if (!effective.disabled && model.visible !== false) change(value);
  }, name => {if (!effective.disabled && model.visible !== false) invokeAction(name);});
  if (model.type !== 'button' && model.label) {
    const caption = element('span', 'rich-widget-label'); caption.textContent = model.label;
    host.replaceChildren(caption, control);
  } else host.replaceChildren(control);
  if (model.actionError) {
    const error = element('span', 'rw-action-error');
    error.setAttribute('role','alert');error.textContent=model.actionError;
    host.append(error);
  }
  const nextArea = host.querySelector<HTMLTextAreaElement>('textarea');
  if (areaDraft && nextArea && !effective.disabled && model.visible !== false) {
    nextArea.value = areaDraft.value;
    nextArea.focus();
    nextArea.setSelectionRange(areaDraft.start, areaDraft.end);
  }
  if (focusedRadio !== undefined && !effective.disabled && model.visible !== false) {
    const radios = [...host.querySelectorAll<HTMLInputElement>('input[type=radio]')];
    (radios.find(radio => radio.value === focusedRadio && !radio.disabled) ?? radios.find(radio => radio.checked && !radio.disabled) ?? radios.find(radio => !radio.disabled))?.focus();
  }
  const field = host.querySelector<HTMLInputElement>('.rw-add input');
  if (field !== null) {
    field.value = draft;
    if (draftFocused) field.focus();
  }
}

function build(model: RichWidgetModel, change: (value: WidgetValue) => void, invokeAction: (name:string)=>void): HTMLElement {
  const builder = RICH_WIDGET_BUILDERS[model.type];
  if (!builder) throw new Error(`No rich widget renderer for ${model.type}`);
  return builder(model, change, invokeAction);
}

/** Load host-specific controls only when used, keeping normal workbook startup small. */
function buildPathControl(model: RichWidgetModel, change: (value: WidgetValue) => void): HTMLElement {
  const root = element('div', 'rw-path');
  root.textContent = 'Loading picker…';
  void import('./path-widget').then(({renderPathWidget}) => {
    if (root.parentNode) renderPathWidget(root, model, change);
  }).catch(() => { if (root.parentNode) { root.textContent = 'Could not load path picker.'; root.setAttribute('role', 'alert'); } });
  return root;
}

function buildTextarea(model: RichWidgetModel, change: (value: WidgetValue) => void): HTMLElement {
  const area = element('textarea', 'rw-textarea');
  area.value = typeof model.value === 'string' ? model.value : String(model.value ?? '');
  area.rows = 3;
  area.placeholder = model.placeholder ?? '';
  area.disabled = model.disabled;
  area.setAttribute('aria-label', model.label);
  // Applied when leaving the field, or with Ctrl/Cmd+Enter.
  area.addEventListener('change', () => change(area.value));
  area.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      area.blur();
    }
  });
  return area;
}

function buildList(model: RichWidgetModel, change: (value: WidgetValue) => void): HTMLElement {
  const items = stringList(model.value);
  const root = element('div', 'rw-list');
  const list = element('ul');
  items.forEach((item, index) => {
    const row = element('li');
    const text = element('span');
    text.textContent = item;
    const remove = element('button', 'rw-remove');
    remove.type = 'button';
    remove.textContent = '×';
    remove.title = `Remove “${item}”`;
    remove.setAttribute('aria-label', `Remove ${item}`);
    remove.disabled = model.disabled;
    remove.addEventListener('click', () => change(items.filter((_, position) => position !== index)));
    row.append(text, remove);
    list.append(row);
  });
  if (items.length === 0) {
    const empty = element('li', 'rw-empty');
    empty.textContent = 'Nothing yet';
    list.append(empty);
  }
  const add = element('div', 'rw-add');
  const field = element('input');
  field.type = 'text';
  field.placeholder = model.placeholder ?? 'Add an item…';
  field.disabled = model.disabled;
  field.setAttribute('aria-label', `Add to ${model.label}`);
  const button = element('button');
  button.type = 'button';
  button.textContent = 'Add';
  button.disabled = model.disabled;
  const submit = () => {
    const text = field.value.trim();
    if (text === '') return;
    field.value = '';
    change([...items, text]);
  };
  field.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.isComposing) return;
    event.preventDefault();
    submit();
  });
  button.addEventListener('click', submit);
  add.append(field, button);
  root.append(list, add);
  return root;
}

function buildMultiselect(model: RichWidgetModel, change: (value: WidgetValue) => void): HTMLElement {
  const selected = new Set(stringList(model.value));
  const root = element('div', 'rw-options');
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', model.label);
  const missing = [...selected].filter(option => !model.options.includes(option));
  const choices = [...model.options, ...missing];
  for (const option of choices) {
    const label = element('label');
    const box = element('input');
    box.type = 'checkbox';
    box.checked = selected.has(option);
    box.disabled = model.disabled;
    box.addEventListener('change', () => {
      if (box.checked) selected.add(option);
      else selected.delete(option);
      // In the order of the options, so the value does not depend on click order.
      change(choices.filter((candidate) => selected.has(candidate)));
    });
    const text = element('span');
    text.textContent = option;
    if (missing.includes(option)) { text.textContent += ' (unavailable)'; label.className = 'rw-unavailable'; }
    label.append(box, text);
    root.append(label);
  }
  if (model.options.length === 0) {
    const empty = element('span', 'rw-empty');
    empty.textContent = 'No options configured';
    root.append(empty);
  }
  return root;
}

let radioGroup = 0;
function buildRadio(model: RichWidgetModel, change: (value: WidgetValue) => void): HTMLElement {
  const root = element('div', 'rw-options');
  root.setAttribute('role', 'radiogroup');
  root.setAttribute('aria-label', model.label);
  const name = `sheet-radio-${++radioGroup}`;
  const current = String(model.value ?? '');
  const missing = current !== '' && !model.options.includes(current);
  const choices = missing ? [...model.options, current] : model.options;
  for (const option of choices) {
    const label = element('label');
    const input = element('input');
    input.type = 'radio'; input.name = name; input.value = option;
    input.checked = current === option;
    input.disabled = model.disabled || (missing && option === current);
    input.addEventListener('change', () => { if (input.checked) change(option); });
    const text = element('span'); text.textContent = option;
    if (missing && option === current) { text.textContent += ' (unavailable)'; label.className = 'rw-unavailable'; }
    label.append(input, text); root.append(label);
  }
  if (model.options.length === 0) {
    const empty = element('span', 'rw-empty'); empty.textContent = 'No options configured'; root.append(empty);
  }
  return root;
}

function buildButton(model: RichWidgetModel, change: (value: WidgetValue) => void, invokeAction:(name:string)=>void): HTMLElement {
  const button = element('button', 'rw-button');
  button.type = 'button';
  const label = model.cancelWhileRunning && model.actionState ? model.actionState === 'cancelling' ? 'Cancelling…' : `Cancel ${model.label}` : model.label;
  button.textContent = label;
  button.setAttribute('aria-label',label);
  button.disabled = model.disabled;
  button.setAttribute('aria-busy', String(model.loading === true));
  if (model.pressed !== undefined || model.buttonMode === 'toggle') button.setAttribute('aria-pressed', String(model.pressed ?? Boolean(model.value)));
  button.classList.toggle('rw-loading', model.loading === true);
  let count = Number.isFinite(Number(model.value)) ? Number(model.value) : 0;
  let toggled = Boolean(model.value);
  button.title = model.cancelWhileRunning && model.actionState ? 'Request cancellation of this action' : model.buttonMode === 'action' || model.action ? `Run ${model.action ?? 'action'}` : model.buttonMode === 'toggle' ? 'Toggles the Boolean input' : 'Counts clicks: cells that read this input run again';
  button.addEventListener('click', () => {
    if (model.buttonMode === 'action' || model.action) { if (model.action) invokeAction(model.action); return; }
    if (model.buttonMode === 'toggle') { toggled = !toggled; if (model.pressed === undefined) button.setAttribute('aria-pressed', String(toggled)); change(toggled); }
    else change(++count);
  });
  return button;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = ''): HTMLElementTagNameMap[K] {
  const created = document.createElement(tag);
  if (className) created.className = className;
  return created;
}
