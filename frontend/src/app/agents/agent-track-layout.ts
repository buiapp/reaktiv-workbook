import type { AgentWorksheetLayout } from './agent-layout';
import { columnLabel } from '../cell-selection';

export interface AgentTrackChange {
  worksheet: string;
  rowHeights?: Record<string, number | null>;
  columnWidths?: Record<string, number | null>;
}

/** Patch track overrides; null restores the normal size. Never moves cells. */
export function patchTrackLayout(layout: AgentWorksheetLayout, change: AgentTrackChange): AgentWorksheetLayout {
  const next = {...layout, rowHeights: {...layout.rowHeights}, columnWidths: {...layout.columnWidths}};
  for (const key of ['rowHeights', 'columnWidths'] as const) {
    const patch = change[key];
    if (patch === undefined) continue;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error(`${key} must be an object.`);
    const allowed = new Set(Array.from({length: key === 'rowHeights' ? layout.rows : layout.columns},
      (_, index) => key === 'rowHeights' ? String(index + 1) : columnLabel(index + 1)));
    for (const [track, size] of Object.entries(patch)) {
      if (!allowed.has(track)) throw new Error(`Unknown ${key} track ${track}. Use existing row numbers or uppercase column letters.`);
      const min = key === 'rowHeights' ? 28 : 64, max = key === 'rowHeights' ? 240 : 480;
      if (size === null) delete next[key][track];
      else if (typeof size !== 'number' || !Number.isInteger(size) || size < min || size > max)
        throw new Error(`${key}.${track} must be ${min}–${max} CSS pixels, or null to reset.`);
      else next[key][track] = size;
    }
  }
  if (change.rowHeights === undefined && change.columnWidths === undefined) throw new Error('Provide rowHeights or columnWidths.');
  return next;
}
