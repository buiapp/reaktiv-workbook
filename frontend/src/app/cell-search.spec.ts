import { searchCells } from './cell-search';
import type { CellDefinition } from './sheet.types';
const cells: CellDefinition[] = [
  {id: 'A1', name: 'rate', kind: 'input', source: '2', enabled: true},
  {id: 'Budget!A1', name: 'rate', kind: 'formula', source: '# forecasting\nnp.mean(samples) * rate', enabled: true},
  {id: 'B2', name: 'average', kind: 'formula', source: 'np.mean(samples)', enabled: true},
];
describe('Cell search', () => {
  it('finds duplicated labels across sheets, exact coordinates and code keywords', () => {
    expect(searchCells(cells, 'RATE').map(result => result.cell.id)).toEqual(['A1', 'Budget!A1']);
    expect(searchCells(cells, 'Budget!A1')[0].cell.id).toBe('Budget!A1');
    expect(searchCells(cells, 'np.mean samples')).toHaveLength(2);
    expect(searchCells(cells, 'forecasting')[0].snippet).toBe('# forecasting');
  });
  it('requires all terms, handles punctuation literally and ranks exact labels first', () => {
    expect(searchCells(cells, 'rate samples').map(result => result.cell.id)).toEqual(['Budget!A1']);
    expect(searchCells(cells, '[')).toEqual([]);
    expect(searchCells(cells, '  ')).toEqual([]);
    expect(searchCells(cells, 'average')[0].cell.id).toBe('B2');
  });
});
