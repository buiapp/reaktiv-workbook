import type { CellResult } from './sheet.types';

export interface GraphError {
  message: string;
  /** Reported origin, following propagated errors. Null when the origin chain cycles. */
  origin: string | null;
}

/** Use kernel provenance, rather than guessing causes from dependency edges. */
export function graphErrors(cells: readonly CellResult[]): ReadonlyMap<string, GraphError> {
  const failed = new Map(cells.filter(cell => cell.error).map(cell => [cell.id, cell]));
  const errors = new Map<string, GraphError>();
  for (const cell of failed.values()) {
    const seen = new Set<string>();
    let origin: string | null = cell.id;
    while (origin !== null) {
      if (seen.has(origin)) { origin = null; break; }
      seen.add(origin);
      const parent: string | undefined = failed.get(origin)?.errorDetail?.origin;
      if (!parent || parent === origin) break;
      origin = parent;
    }
    errors.set(cell.id, {message: cell.error!, origin});
  }
  return errors;
}
