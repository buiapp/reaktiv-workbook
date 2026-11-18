import {
  collectableCells,
  collectionSource,
  collectionTarget,
  edgeCell,
  filledInColumn,
  orderForCollection,
  stepCell,
} from './cell-selection';

const filled = new Set(['A1', 'A2', 'A3', 'A5', 'B1', 'C1']);
const isFilled = (id: string) => filled.has(id);

describe('cell selection', () => {
  it('steps and jumps to block edges like a spreadsheet', () => {
    expect(stepCell('A1', 0, -1, 5, 8)).toBe('A1');
    expect(stepCell('A1', 1, 1, 5, 8)).toBe('B2');
    expect(edgeCell('A1', 0, 1, isFilled, 5, 8)).toBe('A3'); // end of the filled block
    expect(edgeCell('A3', 0, 1, isFilled, 5, 8)).toBe('A5'); // next filled cell
    expect(edgeCell('A5', 0, 1, isFilled, 5, 8)).toBe('A8'); // grid edge
    expect(edgeCell('A1', 1, 0, isFilled, 5, 8)).toBe('C1');
  });

  it('selects filled cells of a column', () => {
    expect(filledInColumn('A', [1, 2, 3, 4, 5, 6], isFilled)).toEqual(['A1', 'A2', 'A3', 'A5']);
  });

  it('collects value cells in reading order, by name, skipping notes and effects', () => {
    const definitions: Record<string, { id: string; kind: string; name?: string }> = {
      B2: { id: 'B2', kind: 'input', name: 'rent' },
      A2: { id: 'A2', kind: 'formula' },
      A1: { id: 'A1', kind: 'input', name: 'income' },
      C1: { id: 'C1', kind: 'markdown' },
      C2: { id: 'C2', kind: 'effect' },
    };
    const cells = collectableCells(['B2', 'C1', 'A2', 'C2', 'A1', 'D9'], (id) => definitions[id]);
    expect(cells.map((cell) => cell.id)).toEqual(['A1', 'A2', 'B2']);
    expect(collectionSource(cells, 'list')).toBe('[income, A2, rent]');
    expect(collectionSource(cells, 'dict')).toBe('{"income": income, "A2": A2, "rent": rent}');
    expect(orderForCollection([{ id: 'A3' }, { id: 'A1' }]).map((cell) => cell.id)).toEqual(['A1', 'A3']);
  });

  it('wraps long collections over several lines', () => {
    const cells = Array.from({ length: 12 }, (_, index) => ({ id: `A${index + 1}`, kind: 'input', name: `monthly_value_${index + 1}` }));
    expect(collectionSource(cells, 'list')).toMatch(/^\[\n {4}monthly_value_1,\n[\s\S]*\n\]$/);
  });

  it('places the collecting cell after the selection and grows the grid when needed', () => {
    expect(collectionTarget(['A1', 'A2', 'A3'], isFilled, 5, 8)).toEqual({ id: 'A4', addRows: 0, addColumns: 0 });
    expect(collectionTarget(['A1', 'B1', 'C1'], isFilled, 5, 8)).toEqual({ id: 'D1', addRows: 0, addColumns: 0 });
    expect(collectionTarget(['A1', 'B1', 'C1'], isFilled, 3, 8)).toEqual({ id: 'D1', addRows: 0, addColumns: 1 });
    expect(collectionTarget(['A7', 'A8'], isFilled, 5, 8)).toEqual({ id: 'A9', addRows: 1, addColumns: 0 });
  });
});

describe('cell selection across sheets', () => {
  it('keeps the sheet prefix when moving, selecting, and collecting', () => {
    expect(stepCell('Budget!A1', 1, 1, 5, 5)).toBe('Budget!B2');
    expect(filledInColumn('A', [1, 2], (id) => id === 'Budget!A2', 'Budget')).toEqual(['Budget!A2']);
    expect(collectionTarget(['Budget!A1', 'Budget!A2'], () => false, 5, 5).id).toBe('Budget!A3');
    const cells = [
      { id: 'A1', kind: 'input' },
      { id: 'Budget!A2', kind: 'input' },
      { id: 'Budget!A3', kind: 'input', name: 'rent' },
    ];
    expect(collectionSource(cells, 'list', 'Budget', 'Main')).toBe('[Main.A1, A2, rent]');
  });
});
