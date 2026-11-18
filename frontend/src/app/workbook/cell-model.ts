import type { CellDefinition, CellResult } from '../sheet.types';
import { affectedCells, indexDependents } from './dependency-index';

export function isNotePage(cell: Pick<CellDefinition, 'kind' | 'view'>): boolean {
  return cell.kind === 'markdown' && cell.view?.page !== false;
}

export function cloneCells(cells: CellDefinition[]): CellDefinition[] {
  return cells.map((cell) => ({ ...cell }));
}

export function sortCells(cells: CellDefinition[]): CellDefinition[] {
  return [...cells].sort((left, right) =>
    left.id.localeCompare(right.id, undefined, { numeric: true }),
  );
}

export function sameCell(left: CellDefinition, right: CellDefinition): boolean {
  return (
    left.id === right.id &&
    left.kind === right.kind &&
    left.source === right.source &&
    (left.saveValue ?? true) === (right.saveValue ?? true) &&
    left.name === right.name &&
    left.enabled === right.enabled &&
    left.trigger === right.trigger &&
    (left.color ?? '') === (right.color ?? '') &&
    (left.view?.color?.expr ?? '') === (right.view?.color?.expr ?? '') &&
    (left.equal ?? '') === (right.equal ?? '') &&
    left.params === right.params &&
    left.computation === right.computation &&
    (left.annotation ?? '') === (right.annotation ?? '') &&
    left.override === right.override
  );
}

/** Same code, kind, label and switches: Python would not recompute the cell (colour and
 * tile settings are presentation only). */
export function sameComputation(left: CellDefinition, right: CellDefinition): boolean {
  return (
    left.kind === right.kind &&
    left.source === right.source &&
    (left.equal ?? '') === (right.equal ?? '') &&
    left.params === right.params &&
    left.computation === right.computation &&
    left.override === right.override &&
    left.name === right.name &&
    left.enabled === right.enabled &&
    left.trigger === right.trigger
  );
}

export function affectedCellIds(
  changed: readonly string[],
  dependencies: Record<string, string[]>,
): ReadonlySet<string> {
  return affectedCells(changed, indexDependents(dependencies));
}

/** An input cell's value read from its Python literal, without running Python. */
export function literalInputResult(cell: Pick<CellDefinition, 'id' | 'source'>): CellResult {
  const source = cell.source.trim();
  let value: unknown = source;
  let valueType = 'str';
  if (/^[-+]?(\d[\d_]*\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(source)) {
    value = Number(source.replaceAll('_', ''));
    valueType = Number.isInteger(value) && !/[.eE]/.test(source) ? 'int' : 'float';
  } else if (source === 'True' || source === 'False') {
    value = source === 'True';
    valueType = 'bool';
  } else if (source === 'None' || source === '') {
    value = null;
    valueType = 'NoneType';
  } else if (/^(['"]).*\1$/s.test(source)) {
    value = source.slice(1, -1);
  } else {
    // Source code is not a string value. Only Python can initialize these cells.
    return { id: cell.id, display: '', value: null, valueType: 'unknown', error: null };
  }
  const display =
    value === null ? '' : typeof value === 'boolean' ? (value ? 'True' : 'False') : String(value);
  return { id: cell.id, display, value, valueType, error: null };
}
