import { isNoteTable, renderTableHtml, tableSummary } from './data-table';
import type { TableResult } from './sheet.types';

const frame: TableResult = {
  kind: 'DataFrame',
  columns: ['month', 'sales'],
  index: ['a', 'b'],
  indexName: 'id',
  rows: [
    ['Jan', 92000.5],
    ['<b>Feb</b>', null],
  ],
  rowCount: 250,
  columnCount: 2,
  truncated: true,
};

describe('data tables', () => {
  it('renders an escaped table with index, numeric alignment and a caption', () => {
    const html = renderTableHtml(frame);
    expect(html).toContain('<th class="index">id</th><th>month</th><th class="numeric">sales</th>');
    expect(html).toContain('<td>&lt;b&gt;Feb&lt;/b&gt;</td><td class="numeric"><span class="missing">—</span></td>');
    expect(html).toMatch(/92.000,5|92,000\.5/);
    expect(html).toContain('DataFrame · 250 rows × 2 columns · showing 2 × 2');
  });

  it('only shows DataFrames and Series as tables inside notes', () => {
    expect(isNoteTable(frame)).toBe(true);
    expect(isNoteTable({ ...frame, kind: 'records' })).toBe(false);
    expect(tableSummary({ ...frame, rowCount: 1, columnCount: 1 })).toBe('1 row × 1 column');
  });
});
