import type { CellResult } from '../sheet.types';

/** Reuse equal JSON subtrees so unchanged tables/outputs retain their UI caches.
 * Timings and other changed metadata remain observable. Keep only the last graph. */
function share(previous: unknown, next: unknown): unknown {
  if (Object.is(previous, next)) return previous;
  if (!previous || !next || typeof previous !== 'object' || typeof next !== 'object') return next;
  if (Array.isArray(previous) && Array.isArray(next)) {
    if (previous.length !== next.length) return next;
    let equal = true;
    let result = next;
    for (let index = 0; index < next.length; index++) {
      const value = share(previous[index], next[index]);
      if (!Object.is(value, previous[index])) equal = false;
      if (!Object.is(value, next[index])) {
        if (result === next) result = [...next];
        result[index] = value;
      }
    }
    return equal ? previous : result;
  }
  if (Array.isArray(previous) || Array.isArray(next)) return next;
  const before = previous as Record<string, unknown>, after = next as Record<string, unknown>;
  const keys = Object.keys(after);
  if (Object.keys(before).length !== keys.length) return next;
  let equal = true, result = after;
  for (const key of keys) {
    if (!Object.hasOwn(before, key)) return next;
    const value = share(before[key], after[key]);
    if (!Object.is(value, before[key])) equal = false;
    if (!Object.is(value, after[key])) {
      if (result === after) result = {...after};
      result[key] = value;
    }
  }
  return equal ? previous : result;
}

export function shareCellResults(previous: readonly CellResult[], next: readonly CellResult[]): CellResult[] {
  const byId = new Map(previous.map(cell => [cell.id, cell]));
  return next.map(cell => share(byId.get(cell.id), cell) as CellResult);
}
