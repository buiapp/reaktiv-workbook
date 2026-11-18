import {
  adjacentSelection,
  EMPTY_SELECTION_HISTORY,
  renameSelections,
  visitSelection,
  type SelectionLocation,
} from './selection-history';

const location = (cellId: string): SelectionLocation => ({ cellId });

describe('selection history', () => {
  it('does not add duplicate selections and preserves forward history', () => {
    let history = visitSelection(EMPTY_SELECTION_HISTORY, location('A1'));
    history = visitSelection(history, location('B1'));
    history = { ...history, index: 0 };
    history = visitSelection(history, location('A1'));
    expect(history.entries).toHaveLength(2);
    expect(adjacentSelection(history, 1, () => true)).toBe(1);
    history = visitSelection(history, location('C1'));
    expect(history.entries.map((entry) => entry.cellId)).toEqual(['A1', 'C1']);
    expect(adjacentSelection(history, 1, () => true)).toBeNull();
  });

  it('skips unavailable sheets or coordinates and follows cell renames', () => {
    let history = EMPTY_SELECTION_HISTORY;
    for (const id of ['A1', 'Old!B1', 'C1']) history = visitSelection(history, location(id));
    expect(adjacentSelection(history, -1, (entry) => !entry.cellId.includes('!'))).toBe(0);
    history = renameSelections(history, (id) => id.replace('Old!', 'New!'));
    expect(history.entries[1].cellId).toBe('New!B1');
    expect(history.index).toBe(2);
  });

  it('bounds navigation history without losing the current selection', () => {
    let history = EMPTY_SELECTION_HISTORY;
    for (let row = 1; row <= 130; row++) history = visitSelection(history, location(`A${row}`));
    expect(history.entries).toHaveLength(100);
    expect(history.index).toBe(99);
    expect(history.entries[0].cellId).toBe('A31');
    expect(history.entries[99].cellId).toBe('A130');
  });
});
