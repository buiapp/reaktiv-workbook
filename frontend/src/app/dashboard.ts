import { WIDGET_STATES, isWidgetDebounce } from './widget-config';
/**
 * Dashboard tiles in the grid: a cell can render its content (plot, table, note,
 * widget, KPI) and span several grid cells. Pure helpers; the app wires them up.
 */
import { cellPosition, columnLabel } from './cell-selection';
import { qualifyCellId, splitCellId } from './sheet-file';
import type { CellDefinition, CellWidget, ResolvedCellWidget } from './sheet.types';
import { inferWidgetType } from './input-widgets';

export { widgetSource } from './input-widgets';

export type Span = [columns: number, rows: number];

/** The span a cell covers, clamped to the grid. */
export function spanOf(
  definition: Pick<CellDefinition, 'id' | 'view'>,
  columnCount: number,
  rowCount: number,
): Span {
  const [column, row] = cellPosition(definition.id);
  const [columns, rows] = definition.view?.span ?? [1, 1];
  return [
    Math.max(1, Math.min(columns, columnCount - column + 1)),
    Math.max(1, Math.min(rows, rowCount - row + 1)),
  ];
}

/** Cells hidden under another cell's span, mapped to the spanning (anchor) cell. */
export function coveredCells(
  definitions: readonly Pick<CellDefinition, 'id' | 'view'>[],
  columnCount: number,
  rowCount: number,
): ReadonlyMap<string, string> {
  const covered = new Map<string, string>();
  for (const definition of definitions) {
    if (definition.view?.span === undefined) continue;
    const [columns, rows] = spanOf(definition, columnCount, rowCount);
    const [column, row] = cellPosition(definition.id);
    for (let rowOffset = 0; rowOffset < rows; rowOffset++) {
      for (let columnOffset = 0; columnOffset < columns; columnOffset++) {
        if (rowOffset === 0 && columnOffset === 0) continue;
        covered.set(
          qualifyCellId(
            splitCellId(definition.id)[0],
            `${columnLabel(column + columnOffset)}${row + rowOffset}`,
          ),
          definition.id,
        );
      }
    }
  }
  return covered;
}

/**
 * Largest span up to the requested size whose area holds no other filled cell and no
 * other tile, so resizing never hides content.
 */
export function clampSpan(
  anchorId: string,
  requested: Span,
  isOccupied: (cellId: string) => boolean,
  columnCount: number,
  rowCount: number,
): Span {
  const [column, row] = cellPosition(anchorId);
  const free = (columns: number, rows: number) => {
    for (let rowOffset = 0; rowOffset < rows; rowOffset++) {
      for (let columnOffset = 0; columnOffset < columns; columnOffset++) {
        const id = qualifyCellId(
          splitCellId(anchorId)[0],
          `${columnLabel(column + columnOffset)}${row + rowOffset}`,
        );
        if (id !== anchorId && isOccupied(id)) return false;
      }
    }
    return true;
  };
  let columns = 1;
  const maxColumns = Math.min(requested[0], columnCount - column + 1);
  const maxRows = Math.min(requested[1], rowCount - row + 1);
  while (columns < maxColumns && free(columns + 1, 1)) columns += 1;
  let rows = 1;
  while (rows < maxRows && free(columns, rows + 1)) rows += 1;
  return [columns, rows];
}

/** The widget a rendered input shows: the configured one, or one inferred from the value. */
export function widgetFor(value: unknown, configured?: CellWidget): ResolvedCellWidget {
  if (configured !== undefined) return {
    type: configured.type,
    ...(typeof configured.min === 'number' ? { min: configured.min } : {}),
    ...(typeof configured.max === 'number' ? { max: configured.max } : {}),
    ...(typeof configured.step === 'number' ? { step: configured.step } : {}),
    ...(Array.isArray(configured.options) ? { options: configured.options } : {}),
    ...(typeof configured.label === 'string' ? {label: configured.label} : {}),
    ...(typeof configured.placeholder === 'string' ? {placeholder: configured.placeholder} : {}),
    ...Object.fromEntries(WIDGET_STATES.filter(key => typeof configured[key] === 'boolean').map(key => [key, configured[key]])),
    ...(configured.buttonMode ? {buttonMode: configured.buttonMode} : {}),
    ...(configured.action ? {action:configured.action,buttonMode:'action' as const} : {}),
    ...(configured.cancelWhileRunning !== undefined ? {cancelWhileRunning:configured.cancelWhileRunning} : {}),
    ...(configured.actionArguments ? {actionArguments:configured.actionArguments} : {}),
    ...(isWidgetDebounce(configured.debounce) ? {debounce: configured.debounce} : {}),
  };
  return { type: inferWidgetType(value) };
}

/** Short KPI text for a scalar value; null when the value is not a scalar. */
export function kpiText(value: unknown, display: string): string | null {
  if (typeof value === 'number' || typeof value === 'boolean') return display;
  if (typeof value === 'string' && value.length <= 40 && !value.includes('\n')) return value;
  return null;
}
