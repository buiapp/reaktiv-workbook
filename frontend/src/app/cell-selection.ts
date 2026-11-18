/**
 * Grid selection geometry and "collect cells into a list" — pure helpers so the app
 * shell only wires them to signals and keyboard events.
 *
 * Cells here are signals, not spreadsheet storage: collecting selected cells creates
 * one computed cell whose value is a list (or dict) of the selected cells' values,
 * referenced by name, so it keeps working when cells move.
 */

import { qualifyCellId, relativeReference, splitCellId } from './sheet-file';

export type CollectionMode = 'list' | 'dict';

export interface CollectableCell {
  id: string;
  kind: string;
  name?: string;
}

export interface CollectionTarget {
  id: string;
  /** Rows / columns the grid must grow by before `id` exists. */
  addRows: number;
  addColumns: number;
}

export function columnLabel(index: number): string {
  let label = '';
  while (index > 0) {
    index -= 1;
    label = String.fromCharCode(65 + (index % 26)) + label;
    index = Math.floor(index / 26);
  }
  return label;
}

/** Column and row of a cell id; a sheet prefix ("Budget!A1") is ignored. */
export function cellPosition(cellId: string): [number, number] {
  const match = /^([A-Z]+)([1-9][0-9]*)$/.exec(splitCellId(cellId)[1]);
  if (match === null) throw new Error(`Invalid cell coordinate: ${cellId}`);
  let column = 0;
  for (const character of match[1]) column = column * 26 + character.charCodeAt(0) - 64;
  return [column, Number(match[2])];
}

export function rectangularSelection(anchorId: string, targetId: string): ReadonlySet<string> {
  const [anchorColumn, anchorRow] = cellPosition(anchorId);
  const [targetColumn, targetRow] = cellPosition(targetId);
  const [sheet] = splitCellId(anchorId);
  const selected = new Set<string>();
  for (let row = Math.min(anchorRow, targetRow); row <= Math.max(anchorRow, targetRow); row++) {
    for (
      let column = Math.min(anchorColumn, targetColumn);
      column <= Math.max(anchorColumn, targetColumn);
      column++
    ) {
      selected.add(qualifyCellId(sheet, `${columnLabel(column)}${row}`));
    }
  }
  return selected;
}

/** One step in a direction, clamped to the grid. */
export function stepCell(
  cellId: string,
  columnDelta: number,
  rowDelta: number,
  columnCount: number,
  rowCount: number,
): string {
  const [column, row] = cellPosition(cellId);
  return qualifyCellId(
    splitCellId(cellId)[0],
    `${columnLabel(clamp(column + columnDelta, 1, columnCount))}${clamp(row + rowDelta, 1, rowCount)}`,
  );
}

/**
 * Ctrl/Cmd+Arrow target, as in spreadsheets: inside a block of filled cells jump to its
 * last filled cell; otherwise jump to the next filled cell, or the grid edge.
 */
export function edgeCell(
  cellId: string,
  columnDelta: number,
  rowDelta: number,
  isFilled: (cellId: string) => boolean,
  columnCount: number,
  rowCount: number,
): string {
  let current = cellId;
  const next = () => stepCell(current, columnDelta, rowDelta, columnCount, rowCount);
  if (next() === current) return current;
  if (isFilled(current) && isFilled(next())) {
    while (next() !== current && isFilled(next())) current = next();
    return current;
  }
  while (next() !== current) {
    current = next();
    if (isFilled(current)) return current;
  }
  return current;
}

/** Filled cells of a column (top to bottom) or a row (left to right). */
export function filledInColumn(
  column: string,
  rows: readonly number[],
  isFilled: (id: string) => boolean,
  sheet = '',
): string[] {
  return rows.map((row) => qualifyCellId(sheet, `${column}${row}`)).filter(isFilled);
}

export function filledInRow(
  row: number,
  columns: readonly string[],
  isFilled: (id: string) => boolean,
  sheet = '',
): string[] {
  return columns.map((column) => qualifyCellId(sheet, `${column}${row}`)).filter(isFilled);
}

/** Only cells with a value can be collected (not notes or effects). */
export function collectableCells(
  ids: Iterable<string>,
  definitionAt: (id: string) => CollectableCell | undefined,
): CollectableCell[] {
  const cells = [...ids]
    .map(definitionAt)
    .filter(
      (cell): cell is CollectableCell =>
        cell !== undefined && cell.kind !== 'markdown' && cell.kind !== 'effect',
    );
  return orderForCollection(cells);
}

/** A column reads top to bottom, a row left to right, a block in reading order. */
export function orderForCollection<T extends { id: string }>(cells: readonly T[]): T[] {
  const columns = new Set(cells.map((cell) => cellPosition(cell.id)[0]));
  return [...cells].sort((left, right) => {
    const [leftColumn, leftRow] = cellPosition(left.id);
    const [rightColumn, rightRow] = cellPosition(right.id);
    return columns.size === 1 ? leftRow - rightRow : leftRow - rightRow || leftColumn - rightColumn;
  });
}

/**
 * Python source of the collecting formula, referencing cells by name when they have one,
 * otherwise by coordinate relative to the sheet the new cell lands on (A1 / Budget.A1).
 */
export function collectionSource(
  cells: readonly CollectableCell[],
  mode: CollectionMode,
  targetSheet = '',
  firstSheet = 'Sheet1',
): string {
  const reference = (cell: CollectableCell) =>
    cell.name || relativeReference(targetSheet, cell.id, firstSheet);
  const items =
    mode === 'list'
      ? cells.map(reference)
      : cells.map((cell) => `${JSON.stringify(reference(cell))}: ${reference(cell)}`);
  const [open, close] = mode === 'list' ? ['[', ']'] : ['{', '}'];
  const inline = `${open}${items.join(', ')}${close}`;
  return inline.length <= 72 ? inline : `${open}\n${items.map((item) => `    ${item},`).join('\n')}\n${close}`;
}

/**
 * Where the collecting cell goes: the first empty cell below a column selection, to the
 * right of a row selection, or below a block (in its first column). The grid grows when
 * that cell is outside it.
 */
export function collectionTarget(
  ids: readonly string[],
  isFilled: (id: string) => boolean,
  columnCount: number,
  rowCount: number,
): CollectionTarget {
  const positions = ids.map(cellPosition);
  const columns = positions.map(([column]) => column);
  const rows = positions.map(([, row]) => row);
  const singleRow = new Set(rows).size === 1 && new Set(columns).size > 1;
  const [sheet] = splitCellId(ids[0]);
  let column = singleRow ? Math.max(...columns) + 1 : Math.min(...columns);
  let row = singleRow ? rows[0] : Math.max(...rows) + 1;
  while (isFilled(qualifyCellId(sheet, `${columnLabel(column)}${row}`))) {
    if (singleRow) column += 1;
    else row += 1;
  }
  return {
    id: qualifyCellId(sheet, `${columnLabel(column)}${row}`),
    addRows: Math.max(0, row - rowCount),
    addColumns: Math.max(0, column - columnCount),
  };
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}
