import { remapWidgetActionBindings } from './widget-action';
import { WIDGET_SETTINGS, WIDGET_STATES, isWidgetDebounce, isWidgetExpression, widgetExpression } from './widget-config';
import { normalizeNoteParents } from './note-tree';
import type {
  CellDefinition,
  ActionDefinition,
  CellView,
  GraphResult,
  SheetDocument,
  SheetSnapshot,
} from './sheet.types';

/** First-sheet cells are plain coordinates; other sheets prefix them: "Budget!A1". */
export const DEFAULT_SHEET_NAME = 'Sheet1';

/** "Budget!A1" → ["Budget", "A1"]; first-sheet ids have an empty sheet. */
export function splitCellId(cellId: string): [string, string] {
  const index = cellId.lastIndexOf('!');
  return index < 0 ? ['', cellId] : [cellId.slice(0, index), cellId.slice(index + 1)];
}

export function qualifyCellId(sheet: string, coordinate: string): string {
  return sheet ? `${sheet}!${coordinate}` : coordinate;
}

/** How a cell on `fromSheet` writes a reference to `targetId`: "A1" or "Budget.A1". */
export function relativeReference(fromSheet: string, targetId: string, firstSheet: string): string {
  const [sheet, coordinate] = splitCellId(targetId);
  return sheet === fromSheet ? coordinate : `${sheet || firstSheet}.${coordinate}`;
}
const PYTHON_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const PYTHON_IMPORT =
  /^(?:import\s+[A-Za-z_][A-Za-z0-9_.]*(?:\s+as\s+[A-Za-z_][A-Za-z0-9_]*)?(?:\s*,\s*[A-Za-z_][A-Za-z0-9_.]*(?:\s+as\s+[A-Za-z_][A-Za-z0-9_]*)?)*|from\s+[A-Za-z_][A-Za-z0-9_.]*\s+import\s+[A-Za-z_][A-Za-z0-9_]*(?:\s+as\s+[A-Za-z_][A-Za-z0-9_]*)?(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*(?:\s+as\s+[A-Za-z_][A-Za-z0-9_]*)?)*)$/;
const PYTHON_KEYWORDS = new Set([
  'False',
  'None',
  'True',
  'and',
  'as',
  'assert',
  'async',
  'await',
  'break',
  'case',
  'class',
  'continue',
  'def',
  'del',
  'elif',
  'else',
  'except',
  'finally',
  'for',
  'from',
  'global',
  'if',
  'import',
  'in',
  'is',
  'lambda',
  'match',
  'nonlocal',
  'not',
  'or',
  'pass',
  'raise',
  'return',
  'try',
  'while',
  'with',
  'yield',
]);

/** A label or coordinate, qualified when the target belongs to another sheet. */
export function cellReference(fromSheet: string, cell: Pick<CellDefinition, 'id' | 'name'>, firstSheet: string): string {
  const [sheet, coordinate] = splitCellId(cell.id);
  const reference = cell.name || coordinate;
  return sheet === fromSheet ? reference : `${sheet || firstSheet}.${reference}`;
}

export function createSheetDocument(
  name: string,
  columns: number,
  rows: number,
  cells: CellDefinition[],
  packages: string[] = [],
  layout: SheetDocument['layout'] = {
    columnWidths: {},
    rowHeights: {},
    zoom: 1,
    noteZoom: 1,
  },
  variables: Record<string, string> = {},
  imports: string[] = [],
  snapshot?: SheetSnapshot,
  kernel: {
    saveOutputs?: boolean;
    kernel?: SheetDocument['environment']['kernel'];
    python?: string;
    sheetName?: string;
    sheets?: SheetDocument['sheets'];
    code?: string;
    actions?: SheetDocument['actions'];
  } = {},
): SheetDocument {
  const code = normalizeCode(kernel.code ?? '');
  const namedCells = cells.map((definition) => {
    const view = normalizeView(definition.view);
    const annotation = (definition.kind === 'formula' || definition.kind === 'linked') ? normalizeAnnotation(definition.annotation) : '';
    const { view: _view, annotation: _annotation, params: _params, computation: _computation, saveValue: _saveValue, ...rest } = definition;
    return {
      ...rest,
      name: validPythonName(definition.name) ? definition.name : undefined,
      ...(definition.kind === 'input' && definition.saveValue === false ? { saveValue: false } : {}),
      ...(view !== undefined ? { view } : {}),
      ...(annotation ? { annotation } : {}),
      ...(definition.kind === 'resource' && definition.params !== undefined ? { params: definition.params } : {}),
      ...(definition.kind === 'linked' && definition.computation !== undefined ? { computation: definition.computation } : {}),
    };
  });
  return {
    format: 'reaktiv-workbook',
    version: 4,
    ...(kernel.saveOutputs === false ? {saveOutputs:false} : {}),
    name,
    grid: { columns, rows },
    environment: {
      packages: normalizePackages(packages),
      imports: normalizeImports(imports),
      variables: normalizeVariables(variables),
      ...(code ? { code } : {}),
      ...(kernel.kernel === 'local' ? { kernel: 'local' as const } : {}),
      ...(kernel.python ? { python: kernel.python } : {}),
    },
    layout: {
      columnWidths: { ...layout.columnWidths },
      rowHeights: { ...layout.rowHeights },
      zoom: layout.zoom,
      noteZoom: layout.noteZoom ?? 1,
      ...(layout.noteOrder?.length ? { noteOrder: [...new Set(layout.noteOrder)] } : {}),
      ...(Object.keys(layout.noteParents ?? {}).length ? { noteParents: normalizeNoteParents(namedCells, layout.noteParents) } : {}),
    },
    cells: namedCells,
    ...(kernel.actions?.length ? {actions: structuredClone(kernel.actions)} : {}),
    ...(snapshot !== undefined ? { snapshot } : {}),
    ...(kernel.sheetName && kernel.sheetName !== DEFAULT_SHEET_NAME ? { sheetName: kernel.sheetName } : {}),
    ...(kernel.sheets?.length
      ? {
          sheets: kernel.sheets.map((sheet) => ({
            name: sheet.name,
            grid: { ...sheet.grid },
            layout: {
              columnWidths: { ...sheet.layout.columnWidths },
              rowHeights: { ...sheet.layout.rowHeights },
            },
          })),
        }
      : {}),
  };
}

const SNAPSHOT_VALUE_LIMIT = 20_000;

/**
 * Outputs worth keeping to read notes without running the graph: displays, tables,
 * plots, and image artifacts; large raw values are dropped. Mirrors
 * `make_snapshot` in python/reaktiv_workbook/model.py.
 */
export function makeSnapshot(graph: Pick<GraphResult, 'cells' | 'dependencies' | 'widgetDependencies' | 'sourceDependencies' | 'dependencyStates'>, savedAt = new Date()): SheetSnapshot {
  return {
    savedAt: savedAt.toISOString(),
    cells: graph.cells.map((cell) => {
      const kept: SheetSnapshot['cells'][number] = {
        id: cell.id,
        display: cell.display,
        valueType: cell.valueType,
        error: cell.error,
        value: undefined,
      };
      if (cell.linkedOverride !== undefined) kept.linkedOverride = cell.linkedOverride;
      if (cell.color !== undefined) kept.color = cell.color;
      if (cell.colorError !== undefined) kept.colorError = cell.colorError;
      if (cell.colorDependencies !== undefined) kept.colorDependencies = cell.colorDependencies;
      if (cell.widget !== undefined) kept.widget = cell.widget;
      if (cell.widgetError !== undefined) kept.widgetError = cell.widgetError;
      if (cell.table !== undefined) kept.table = cell.table;
      if (cell.richOutput !== undefined) kept.richOutput = cell.richOutput;
      if (cell.artifact?.mimeType.startsWith('image/')) kept.artifact = cell.artifact;
      if (cell.valueType !== 'markdown') {
        const serialized = JSON.stringify(cell.value ?? null);
        if (serialized.length <= SNAPSHOT_VALUE_LIMIT) kept.value = cell.value;
      }
      if (kept.value === undefined) delete kept.value;
      return kept;
    }),
    dependencies: { ...graph.dependencies },
    sourceDependencies: graph.sourceDependencies,
    dependencyStates: graph.dependencyStates,
    ...(graph.widgetDependencies ? { widgetDependencies: graph.widgetDependencies } : {}),
  };
}

/** Drop defaults so a plain cell has no view; mirrors `normalize_view` in model.py. */
export function normalizeView(view: CellView | undefined): CellView | undefined {
  if (view === undefined) return undefined;
  const normalized: CellView = {};
  if (view.display === 'rendered') normalized.display = 'rendered';
  const [columns, rows] = view.span ?? [1, 1];
  const clamp = (value: number) => Math.max(1, Math.min(50, Math.round(value)));
  if (clamp(columns) !== 1 || clamp(rows) !== 1) normalized.span = [clamp(columns), clamp(rows)];
  if (view.page === false) normalized.page = false;
  if (typeof view.markdown === 'boolean') normalized.markdown = view.markdown;
  if (view.color?.expr.trim()) normalized.color = {expr: view.color.expr.trim()};
  if (view.widget !== undefined) {
    const widget: NonNullable<CellView['widget']> = { type: view.widget.type };
    for (const key of ['min', 'max', 'step'] as const) {
      const value = view.widget[key];
      if ((typeof value === 'number' && Number.isFinite(value)) || typeof value === 'string') widget[key] = value;
    }
    if (view.widget.options?.length) widget.options = typeof view.widget.options === 'string' ? view.widget.options : [...view.widget.options];
    for (const key of ['label', 'placeholder'] as const) {
      const value = view.widget[key];
      if (typeof value === 'string' || isWidgetExpression(value)) widget[key] = value;
    }
    for (const key of WIDGET_STATES) {
      const value = view.widget[key];
      if (typeof value === 'boolean' || isWidgetExpression(value)) widget[key] = value;
    }
    if (typeof view.widget.cancelWhileRunning === 'boolean') widget.cancelWhileRunning = view.widget.cancelWhileRunning;
    if (isWidgetDebounce(view.widget.debounce)) widget.debounce = view.widget.debounce;
    if (view.widget.buttonMode) widget.buttonMode = view.widget.buttonMode;
    if (view.widget.action !== undefined) {widget.action=view.widget.action;widget.buttonMode='action';}
    if (view.widget.actionArguments !== undefined) widget.actionArguments=structuredClone(view.widget.actionArguments);
    normalized.widget = widget;
  }
  return Object.keys(normalized).length === 0 ? undefined : normalized;
}

export function normalizeAnnotation(annotation: string | undefined): string {
  return (annotation ?? '').trim().split(/\s+/).filter(Boolean).join(' ');
}

function rewritePython(
  source: string,
  identifiers?: Map<string, string>,
  selfCalls?: Map<string, string>,
): string {
  let result = '';
  let index = 0;
  // Open parentheses: inside a call, `name=` is a keyword argument, never a cell reference.
  let parentheses = 0;
  while (index < source.length) {
    if (source[index] === '#') {
      const end = source.indexOf('\n', index);
      const next = end < 0 ? source.length : end;
      result += source.slice(index, next);
      index = next;
      continue;
    }
    const stringMatch = /^(?:[rRuUbBfF]{0,2})(?:"""|'''|"|')/.exec(source.slice(index));
    if (stringMatch !== null) {
      const literal = readString(source, index, stringMatch[0]);
      result += /[fF]/.test(stringMatch[0].slice(0, -1))
        ? rewriteFString(literal.text, identifiers, selfCalls)
        : literal.text;
      index = literal.end;
      continue;
    }
    if (selfCalls !== undefined) {
      const call = /^self\.([A-Za-z_][A-Za-z0-9_]*)(?:\.value)?\(\)/.exec(source.slice(index));
      if (call !== null && selfCalls.has(call[1])) {
        result += selfCalls.get(call[1]);
        index += call[0].length;
        continue;
      }
    }
    const handle = /^(?:self\.)?cells\.([A-Za-z_][A-Za-z0-9_]*)(?:\.([A-Za-z_][A-Za-z0-9_]*))?/.exec(source.slice(index));
    if (handle && !/\.\s*$/.test(result)) {
      const full = handle[0];
      const local = `${handle[0].startsWith('self.') ? 'self.' : ''}cells.${handle[1]}`;
      const key = identifiers?.has(full) ? full : identifiers?.has(local) ? local : null;
      if (key) { result += identifiers!.get(key); index += key.length; continue; }
    }
    const identifier = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(index));
    if (identifier !== null) {
      // `obj.name` is an attribute, never a cell reference.
      const afterDot = /\.\s*$/.test(result);
      // The longest mapped dotted name wins: `self.Sheet.member` before `self.Sheet`.
      const dotted = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+/.exec(source.slice(index));
      if (!afterDot && dotted !== null && identifiers !== undefined) {
        const parts = dotted[0].split('.');
        let matched: string | null = null;
        for (let length = parts.length; length >= 2 && matched === null; length -= 1) {
          const candidate = parts.slice(0, length).join('.');
          if (identifiers.has(candidate)) matched = candidate;
        }
        if (matched !== null) {
          result += identifiers.get(matched);
          index += matched.length;
          continue;
        }
      }
      const keyword = parentheses > 0 && /^\s*=(?!=)/.test(source.slice(index + identifier[0].length));
      result += afterDot || keyword ? identifier[0] : (identifiers?.get(identifier[0]) ?? identifier[0]);
      index += identifier[0].length;
      continue;
    }
    if (source[index] === '(') parentheses += 1;
    else if (source[index] === ')') parentheses = Math.max(0, parentheses - 1);
    result += source[index++];
  }
  return result;
}

function readString(source: string, start: number, opening: string): { text: string; end: number } {
  const quote = /("""|'''|"|')$/.exec(opening)![1];
  let index = start + opening.length;
  while (index < source.length) {
    if (source[index] === '\\') {
      index += 2;
      continue;
    }
    if (source.startsWith(quote, index)) {
      index += quote.length;
      return { text: source.slice(start, index), end: index };
    }
    index++;
  }
  return { text: source.slice(start), end: source.length };
}

function rewriteFString(
  literal: string,
  identifiers?: Map<string, string>,
  selfCalls?: Map<string, string>,
): string {
  return literal.replace(
    /(?<!\{)\{(?!\{)([\s\S]*?)(?<!\})\}(?!\})/g,
    (_match, expression: string) => `{${rewritePython(expression, identifiers, selfCalls)}}`,
  );
}

function withoutBoundReferences<T>(source: string, references: Map<string, T>, locals: string[] = []): Map<string, T> {
  const bound = new Set<string>(locals);
  for (const match of source.matchAll(
    /(?:^|\n)\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?::[^=\n]+)?=(?!=)/g,
  )) {
    bound.add(match[1]);
  }
  // Bare tuple assignments cannot span physical lines. Requiring horizontal
  // whitespace avoids mistaking multiline call arguments followed by name= for
  // a tuple assignment. Multiline tuple targets must have closing parentheses.
  for (const pattern of [
    /(?:^|\n)[ \t]*([A-Za-z_][A-Za-z0-9_]*(?:[ \t]*,[ \t]*\*?[A-Za-z_][A-Za-z0-9_]*)+)[ \t]*,?[ \t]*=(?!=)/g,
    /(?:^|\n)[ \t]*\(\s*([A-Za-z_][A-Za-z0-9_]*(?:\s*,\s*\*?[A-Za-z_][A-Za-z0-9_]*)+)\s*,?\s*\)[ \t]*=(?!=)/g,
  ]) {
    for (const match of source.matchAll(pattern)) {
      for (const name of match[1].split(',')) bound.add(name.replace('*', '').trim());
    }
  }
  // Loop targets (`for name in`, `for a, b in`), `with … as name`, `except … as name`, `name :=`.
  for (const match of source.matchAll(/\bfor\s+\(?([A-Za-z_][A-Za-z0-9_\s,]*?)\)?\s+in\b/g)) {
    for (const name of match[1].split(',')) if (PYTHON_NAME.test(name.trim())) bound.add(name.trim());
  }
  for (const match of source.matchAll(/\bas\s+([A-Za-z_][A-Za-z0-9_]*)\s*[:,)]/g)) {
    bound.add(match[1]);
  }
  for (const match of source.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*:=/g)) {
    bound.add(match[1]);
  }
  // Lambda parameters are local too (including update(lambda count: count + 1)).
  for (const match of source.matchAll(/\blambda\s+([^:\n]*):/g)) {
    for (const parameter of match[1].split(',')) {
      const name = parameter.replace(/=.*$/s, '').replace(/^\*+/, '').trim();
      if (PYTHON_NAME.test(name)) bound.add(name);
    }
  }
  // Functions and classes defined in the cell, and function parameters.
  for (const match of source.matchAll(/\b(?:def|class)\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*\(([^)]*)\))?/g)) {
    bound.add(match[1]);
    if (!/^\s*def\b/.test(source.slice(match.index, match.index + 4))) continue;
    for (const parameter of (match[2] ?? '').split(',')) {
      const name = parameter.replace(/[:=].*$/s, '').replace(/^\*+/, '').trim();
      if (PYTHON_NAME.test(name)) bound.add(name);
    }
  }
  for (const match of source.matchAll(/(?:^|\n)\s*(?:from\s+\S+\s+)?import\s+([^\n]+)/g)) {
    for (const imported of match[1].split(',')) {
      const parts = imported.trim().split(/\s+as\s+/);
      const name = (parts[1] ?? parts[0].split('.')[0]).trim();
      if (PYTHON_NAME.test(name)) bound.add(name);
    }
  }
  const expanded = new Map(references);
  // Renames/moves rewrite explicit handles as well as ordinary value reads.
  // Generated model reads (self.member()) must leave handles intact.
  for (const [reference, value] of references) {
    if (typeof value === 'string' && !value.startsWith('self.') && !reference.startsWith('cells.')) {
      expanded.set(`cells.${reference}`, `cells.${value}` as T);
    }
  }
  return new Map([...expanded].filter(([reference]) => !bound.has(reference.split('.')[0])));
}

function validPythonName(value: string | undefined): boolean {
  return value !== undefined && PYTHON_NAME.test(value) && !PYTHON_KEYWORDS.has(value);
}

/** Editor aliases are mapped to stable cell IDs before Python generates file members. */
export function cellMemberNames(cells: CellDefinition[], reserved: readonly string[] = []): Map<string, string> {
  const names = new Map<string, string>();
  const used = new Set(
    [...cells.map((cell) => cell.name).filter((name): name is string => Boolean(name)), ...reserved],
  );
  const assigned = new Set<string>(reserved);
  for (const cell of cells) {
    if (cell.name && !assigned.has(cell.name)) {
      names.set(cell.id, cell.name);
      assigned.add(cell.name);
      continue;
    }
    const base = cell.id.toLowerCase().replace('!', '_');
    let candidate = validPythonName(base) && !used.has(base) ? base : `cell_${base}`;
    let suffix = 2;
    while (used.has(candidate)) candidate = `cell_${base}_${suffix++}`;
    names.set(cell.id, candidate);
    used.add(candidate);
  }
  return names;
}

/** Canonical workbook-owned action paths, with one local member namespace per sheet. */
export function workbookCellMemberNames(cells: CellDefinition[], firstSheet: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const prefix of new Set(cells.map(cell => splitCellId(cell.id)[0]))) {
    const group = cells.filter(cell => splitCellId(cell.id)[0] === prefix);
    const local = cellMemberNames(group.map(cell => ({...cell, id: splitCellId(cell.id)[1]})), ['workbook', 'dispose', 'start_members']);
    for (const cell of group) result.set(cell.id, `${prefix || firstSheet}.${local.get(splitCellId(cell.id)[1])}`);
  }
  return result;
}

/** Reference maps may contain completion aliases for cells the action never uses. */
export function actionReferencesCells(source: string, references: Record<string, string>, ids: ReadonlySet<string>): boolean {
  const replacements = new Map(Object.entries(references).filter(([,id]) => ids.has(id))
    .map(([member]) => [`self.${member}`, '__deleted_cell__']));
  return rewritePython(source, replacements) !== source;
}

/**
 * Actions may use the cell spelling `self.workbook.Sheet.member` (in an action `self` is the
 * workbook). Stored and refactored actions use `self.Sheet.member`, as saved files do.
 */
export function canonicalActionSource(source: string): string {
  return rewritePython(source, new Map([['self.workbook', 'self']]));
}

/** Rename worksheet handles in action code, preserving comments and ordinary strings. */
export function rewriteActionWorksheet(source: string, previous: string, next: string): string {
  return rewritePython(source, new Map([
    [`self.${previous}`, `self.${next}`], [`self.cells.${previous}`, `self.cells.${next}`], [`cells.${previous}`, `cells.${next}`],
  ]));
}

export function rewriteWidgetView(view: CellView | undefined, rewrite: (source: string) => string, rename:(id:string)=>string=(id)=>id): CellView | undefined {
  if (view?.color) view = {...view, color: {expr: rewrite(view.color.expr)}};
  if (!view?.widget) return view;
  const widget = { ...view.widget };
  for (const key of WIDGET_SETTINGS) {
    const value = widget[key];
    const expression = widgetExpression(key, value);
    if (expression !== null) {
      const updated = isWidgetExpression(value) ? {expr: rewrite(expression)} : rewrite(expression);
      Object.assign(widget, {[key]: updated});
    }
  }
  return remapWidgetActionBindings({ ...view, widget },rename);
}

export function renameCell(
  cells: CellDefinition[],
  cellId: string,
  newName: string,
  firstSheet = DEFAULT_SHEET_NAME,
): CellDefinition[] {
  const target = cells.find((cell) => cell.id === cellId);
  if (target === undefined) throw new Error(`Cell ${cellId} does not exist.`);
  const oldName = target.name;
  if (oldName === newName) return cells.map((cell) => ({ ...cell }));
  const [targetSheet, coordinate] = splitCellId(cellId);
  return cells.map((cell) => {
    const [sheet] = splitCellId(cell.id);
    const qualifiedOld = `${targetSheet || firstSheet}.${oldName}`;
    const qualifiedNew = `${targetSheet || firstSheet}.${newName || coordinate}`;
    const references = new Map([[`${targetSheet || firstSheet}.${coordinate}`, qualifiedNew]]);
    if (oldName) references.set(qualifiedOld, qualifiedNew);
    if (sheet === targetSheet) {
      references.set(coordinate, newName || coordinate);
      if (oldName) references.set(oldName, newName || coordinate);
    }
    const rewrite = (text: string, locals: string[] = []) => {
      const scoped = withoutBoundReferences(text, references, locals);
      const rewritten = rewritePython(text, scoped);
      if (newName && sheet === targetSheet && rewritten !== text &&
          !withoutBoundReferences(text, new Map([[newName, newName]]), locals).has(newName))
        throw new Error(`Cannot refactor ${cellId}: label ${newName} is shadowed in ${cell.id}. Choose another label.`);
      return rewritten;
    };
    let source = cell.source;
    if (references.size > 0 && cell.kind === 'markdown') {
      source = source.replace(/\{\{([\s\S]*?)\}\}/g, (_match, expression: string) => {
        const rewritten = rewrite(expression);
        return `{{${rewritten}}}`;
      });
    } else if (references.size > 0) {
      source = rewrite(source);
    }
    if (cell.kind === 'markdown') {
      for (const alias of new Set([coordinate, ...(oldName ? [oldName] : [])])) {
        for (const prefix of ['sheet-input:', 'note-']) {
          if (sheet === targetSheet)
            source = source.replace(new RegExp(`#${prefix}${alias}(?=[?)\\s"'#]|$)`, 'g'), `#${prefix}${newName || coordinate}`);
          const qualified = `${targetSheet || firstSheet}.${alias}`;
          source = source.replace(new RegExp(`#${prefix}${qualified.replaceAll('.', '\\.')}(?=[?)\\s"'#]|$)`, 'g'), `#${prefix}${qualifiedNew}`);
        }
      }
    }
    return {
      ...cell,
      source,
      params: cell.params === undefined ? undefined : rewrite(cell.params),
      computation: cell.computation === undefined ? undefined : rewrite(cell.computation, ['source', 'previous']),
      name: cell.id === cellId ? newName || undefined : cell.name,
      view: rewriteWidgetView(cell.view, expression => rewrite(expression)),
    };
  });
}

/** One plan for GUI and MCP label changes, including workbook-owned actions. */
export function refactorCellLabel(document: SheetDocument, id: string, label: string): SheetDocument {
  const target = document.cells.find(cell => cell.id === id);
  if (!target) throw new Error('Unknown cell.');
  const [sheet, coordinate] = splitCellId(id), first = document.sheetName ?? DEFAULT_SHEET_NAME;
  if (label && (!validPythonName(label) || label === 'cells' || [first, ...(document.sheets ?? []).map(tab => tab.name)].includes(label)))
    throw new Error('Choose a valid Python label that is not reserved or a worksheet name.');
  if (label && document.cells.some(cell => cell.id !== id && splitCellId(cell.id)[0] === sheet && cell.name === label))
    throw new Error(`Label ${label} is already used on this worksheet.`);
  if ((target.name ?? '') === label) return document;
  const cells = renameCell(document.cells, id, label, first), members = cellMemberNames(cells);
  const scopedBefore = workbookCellMemberNames(document.cells, first), scopedAfter = workbookCellMemberNames(cells, first);
  const aliases = [coordinate, ...(target.name ? [target.name] : [])];
  const replacements = new Map<string, string>([[`self.${scopedBefore.get(id)}`, `self.${scopedAfter.get(id)}`]]);
  for (const alias of aliases) {
    replacements.set(`self.cells.${sheet || first}.${alias}`, `self.cells.${sheet || first}.${label || coordinate}`);
    replacements.set(`cells.${sheet || first}.${alias}`, `cells.${sheet || first}.${label || coordinate}`);
    if (!sheet) {
      replacements.set(`self.cells.${alias}`, `self.cells.${label || coordinate}`);
      replacements.set(`cells.${alias}`, `cells.${label || coordinate}`);
    }
  }
  const actions = (document.actions ?? []).map((action): ActionDefinition => {
    const mapping = new Map(replacements), references: Record<string, string> = {};
    for (const [member, cellId] of Object.entries(action.references ?? {})) {
      const renamed = cellId === id ? (member.includes('.') ? scopedAfter.get(id)! : members.get(id)!) : member;
      if (renamed !== member && action.references?.[renamed] && action.references[renamed] !== id)
        throw new Error(`Cannot refactor label: member ${renamed} is ambiguous in action ${action.name}.`);
      mapping.set(`self.${member}`, `self.${renamed}`);
      references[renamed] = cellId;
    }
    const source = rewritePython(action.source, mapping);
    // The lightweight cell lexer cannot resolve a nested receiver named self.
    // Refuse the transaction instead of rewriting another object's attributes.
    if (source !== action.source && [...action.source.matchAll(/\b(?:def\s+\w+\s*\([^)]*\bself\b|lambda\s+[^:]*\bself\b)/g)].length > 1)
      throw new Error(`Cannot safely refactor action ${action.name}: a nested function shadows self. Update that action first.`);
    return {...action, source, references};
  });
  return {...document, cells, actions};
}

/** `ScenarioB` / `scenario b` → `scenario_b`: the label suffix for a sheet's copies. */
export function labelSuffix(sheetName: string): string {
  return (
    sheetName
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .replace(/[^A-Za-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase() || 'copy'
  );
}

/**
 * Labels for copies that do not clash: `candidate(name, 1)`, then `candidate(name, 2)`, …
 * until one is free (not a label, sheet, or earlier copy) and a valid Python name.
 */
export function uniqueLabels(
  names: Iterable<string>,
  taken: Set<string>,
  candidate: (name: string, attempt: number) => string,
): Map<string, string> {
  const labels = new Map<string, string>();
  for (const name of names) {
    let label = candidate(name, 1);
    for (let attempt = 2; taken.has(label) || !validPythonName(label); attempt++) label = candidate(name, attempt);
    taken.add(label);
    labels.set(name, label);
  }
  return labels;
}

/**
 * Copies with new labels: their own labels change, and so do references to them in code,
 * `{{ … }}`, input widgets, and note links (the same token rewriter as label renames).
 * `extra` adjusts each rewritten Python expression further (Duplicate sheet: `Old.A1`).
 */
export function relabelCells(
  cells: readonly CellDefinition[],
  labels: ReadonlyMap<string, string>,
  extra: (source: string, locals?: readonly string[]) => string = (source) => source,
): CellDefinition[] {
  const rewrite = (source: string) =>
    extra(labels.size === 0 ? source : rewritePython(source, withoutBoundReferences(source, new Map(labels))));
  return cells.map((cell) => {
    let source = cell.source;
    if (cell.kind === 'markdown') {
      source = source.replace(/\{\{([\s\S]*?)\}\}/g, (_match, expression: string) => `{{${rewrite(expression)}}}`);
      for (const [oldName, newName] of labels) {
        source = source
          .replace(new RegExp(`#sheet-input:${oldName}(?=[?)])`, 'g'), `#sheet-input:${newName}`)
          .replace(new RegExp(`#note-${oldName}(?=[)\\s"'#]|$)`, 'g'), `#note-${newName}`);
      }
    } else {
      source = rewrite(source);
    }
    const copy: CellDefinition = { ...cell, source, ...(cell.params !== undefined ? {params: rewrite(cell.params)} : {}), ...(cell.computation !== undefined ? {computation: extra(rewritePython(cell.computation, withoutBoundReferences(cell.computation, new Map(labels), ['source', 'previous'])), ['source', 'previous'])} : {}), name: cell.name ? (labels.get(cell.name) ?? cell.name) : cell.name };
    if (cell.view !== undefined) copy.view = rewriteWidgetView(structuredClone(cell.view), rewrite);
    return copy;
  });
}

/**
 * Copy the cells of one sheet onto a new sheet.
 * Bare coordinates and labels mean "this sheet", so they stay. The copies refer
 * to each other using the same labels. References to
 * other sheets stay; cells elsewhere keep pointing at the original.
 */
export function duplicateSheet(
  cells: CellDefinition[],
  from: { prefix: string; name: string },
  to: { prefix: string; name: string },
  sheetNames: readonly string[],
): { copies: CellDefinition[]; labels: Map<string, string> } {
  const originals = cells.filter((cell) => splitCellId(cell.id)[0] === from.prefix);
  const labels = new Map<string, string>();
  // `Old.A1` naming the copied sheet itself, and qualified note links, follow the copy.
  const selfReference = new RegExp(`(?<![\\w.])${from.name}\\.(?=[A-Za-z_][A-Za-z0-9_]*\\b)`, 'g');
  const qualifiedLink = from.prefix ? new RegExp(`#(sheet-input:|cell-|note-)${from.prefix}!`, 'g') : null;
  const copies = relabelCells(originals, labels, (source, locals = []) => locals.includes(from.name) ? source : source.replace(selfReference, `${to.name}.`)).map(
    (cell) => ({
      ...cell,
      id: qualifyCellId(to.prefix, splitCellId(cell.id)[1]),
      view:remapWidgetActionBindings(cell.view,id=>originals.some(original=>original.id===id) ? qualifyCellId(to.prefix,splitCellId(id)[1]) : id),
      source:
        cell.kind === 'markdown' && qualifiedLink !== null ? cell.source.replace(qualifiedLink, `#$1${to.prefix}!`) : cell.source,
    }),
  );
  return { copies, labels };
}

/** Marks clipboard text that holds cells (`copiedCellsDocument`): a small workbook file. */
export function isCopiedCells(text: string | undefined | null): boolean {
  return typeof text === 'string' && /^#\s*\/\/\/\s*script\b/.test(text.trimStart()) && /@(?:sheet|workbook|workbook_config)\(/.test(text);
}

/**
 * Cells as clipboard text: a small workbook in the file
 * format, written by the same writer as files, with the cells moved to the first sheet (their
 * coordinates kept). Other windows read it back with the file reader.
 */
export function copiedCellsDocument(cells: readonly CellDefinition[]): SheetDocument {
  const plain = cells.map((cell) => ({ ...cell, id: splitCellId(cell.id)[1], view:remapWidgetActionBindings(cell.view,id=>cells.some(original=>original.id===id) ? splitCellId(id)[1] : id) }));
  const extent = plain.map((cell) => cellCoordinates(cell.id));
  const columns = Math.max(1, ...extent.map(([column]) => column));
  const rows = Math.max(1, ...extent.map(([, row]) => row));
  return createSheetDocument('Copied cells', columns, rows, plain, [], { columnWidths: {}, rowHeights: {}, zoom: 1 });
}

function cellCoordinates(cellId: string): [number, number] {
  const match = /^([A-Z]+)([1-9][0-9]*)$/.exec(splitCellId(cellId)[1]);
  if (match === null) throw new Error(`Invalid cell id: ${cellId}`);
  let column = 0;
  for (const character of match[1]) column = column * 26 + character.charCodeAt(0) - 64;
  return [column, Number(match[2])];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizePackages(packages: string[]): string[] {
  const normalized = packages.map((item) => item.trim());
  if (normalized.some((item) => item === '' || item.includes('\n') || item.includes('\r'))) {
    throw new Error('Package requirements must be non-empty single lines.');
  }
  return [...new Set(normalized)];
}

/** Mirrors `normalize_code` in model.py (Python validates the syntax). */
function normalizeCode(code: string): string {
  if (typeof code !== 'string') throw new Error('Shared code must be text.');
  const lines = code.replace(/\r\n?/g, '\n').split('\n');
  const indents = lines.filter((line) => line.trim() !== '').map((line) => /^[ \t]*/.exec(line)![0].length);
  const common = indents.length === 0 ? 0 : Math.min(...indents);
  return lines
    .map((line) => line.slice(common))
    .join('\n')
    .replace(/^\n+/, '')
    .trimEnd();
}

function normalizeImports(imports: string[]): string[] {
  if (!Array.isArray(imports)) throw new Error('Document global imports must be an array.');
  const normalized = imports.map((statement) => statement.trim());
  if (
    normalized.some(
      (statement) =>
        statement === '' ||
        statement.includes('\n') ||
        statement.includes('\r') ||
        !PYTHON_IMPORT.test(statement),
    )
  ) {
    throw new Error('Global modules must contain one Python import statement per line.');
  }
  return [...new Set(normalized)];
}

function normalizeVariables(variables: Record<string, string>): Record<string, string> {
  if (!isRecord(variables)) throw new Error('Document environment variables must be an object.');
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(variables)) {
    if (!PYTHON_NAME.test(key)) throw new Error(`Invalid environment variable name: ${key}`);
    if (typeof value !== 'string' || value.includes('\n') || value.includes('\r')) {
      throw new Error(`Environment variable ${key} must be a single-line string.`);
    }
    normalized[key] = value;
  }
  return normalized;
}

function parseSizes(
  value: unknown,
  minimum: number,
  maximum: number,
  label: string,
): Record<string, number> {
  if (!isRecord(value)) throw new Error(`Document ${label}s must be an object.`);
  const result: Record<string, number> = {};
  for (const [key, size] of Object.entries(value)) {
    if (typeof size !== 'number' || !Number.isInteger(size) || size < minimum || size > maximum) {
      throw new Error(`The ${label} for ${key} must be between ${minimum} and ${maximum}.`);
    }
    result[key] = size;
  }
  return result;
}
