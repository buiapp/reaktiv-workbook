/** Selection navigation is separate from workbook edits and undo/redo. */
export interface SelectionLocation {
  cellId: string;
}
export interface SelectionHistory {
  entries: readonly SelectionLocation[];
  index: number;
}
export const EMPTY_SELECTION_HISTORY: SelectionHistory = { entries: [], index: -1 };
const LIMIT = 100;

export function visitSelection(
  history: SelectionHistory,
  location: SelectionLocation,
): SelectionHistory {
  const current = history.entries[history.index];
  if (current?.cellId === location.cellId) return history;
  const entries = [...history.entries.slice(0, history.index + 1), location].slice(-LIMIT);
  return { entries, index: entries.length - 1 };
}

export function adjacentSelection(
  history: SelectionHistory,
  direction: -1 | 1,
  valid: (location: SelectionLocation) => boolean,
): number | null {
  for (
    let index = history.index + direction;
    index >= 0 && index < history.entries.length;
    index += direction
  ) {
    if (valid(history.entries[index])) return index;
  }
  return null;
}

export function renameSelections(
  history: SelectionHistory,
  rename: (id: string) => string,
): SelectionHistory {
  return {
    ...history,
    entries: history.entries.map((entry) => ({
      ...entry,
      cellId: rename(entry.cellId),
    })),
  };
}
