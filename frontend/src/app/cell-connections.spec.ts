import { connectionBoxes, connectionCurve, traceCellConnections } from './cell-connections';
import type { ConnectionSettings } from './cell-connections';
import type { CellDefinition } from './sheet.types';

const both: ConnectionSettings = { upstream: true, downstream: true, depth: 1 };
const dependencies = { B1: ['A1'], C1: ['B1'], D1: ['C1'], E1: ['B1'], 'Budget!A1': ['D1'] };
const pairs = (selected: string, settings = both) =>
  traceCellConnections(selected, dependencies, settings).edges.map(
    (edge) => `${edge.from}>${edge.to}`,
  );

describe('cell connection tracing', () => {
  it('traces each direction to its own depth, following actual edges rather than nearby siblings', () => {
    expect(traceCellConnections('C1', dependencies, { ...both, depth: 0 })).toEqual({
      edges: [], truncated: false,
    });
    expect(pairs('C1')).toEqual(['B1>C1', 'C1>D1']);
    expect(pairs('C1', { ...both, depth: 2 })).toEqual(['B1>C1', 'A1>B1', 'C1>D1', 'D1>Budget!A1']);
    expect(pairs('C1', { ...both, upstream: false, depth: Infinity })).toEqual([
      'C1>D1',
      'D1>Budget!A1',
    ]);
    expect(pairs('C1', { ...both, downstream: false, depth: Infinity })).toEqual([
      'B1>C1',
      'A1>B1',
    ]);
    expect(pairs('C1', { upstream: false, downstream: false, depth: Infinity })).toEqual([]);
  });
  it('terminates cycles and deduplicates diamonds and repeated reads', () => {
    const result = traceCellConnections(
      'A1',
      { A1: ['B1', 'C1'], B1: ['D1', 'D1'], C1: ['D1'], D1: ['A1'] },
      { ...both, depth: Infinity },
    );
    expect(result.truncated).toBe(false);
    expect(result.edges).toHaveLength(5);
    expect(new Set(result.edges.map((edge) => `${edge.from}>${edge.to}`)).size).toBe(5);
  });
  it('bounds very large neighborhoods and reports truncation accurately', () => {
    const reads = Array.from({ length: 301 }, (_, index) => `A${index + 1}`);
    expect(traceCellConnections('B1', { B1: reads.slice(0, 300) }, both).truncated).toBe(false);
    const result = traceCellConnections('B1', { B1: reads }, both);
    expect(result.edges).toHaveLength(300);
    expect(result.truncated).toBe(true);
  });
});

describe('cell connection geometry', () => {
  const cell = (id: string, span?: [number, number]): CellDefinition => ({
    id,
    source: '1',
    kind: 'input',
    enabled: true,
    view: span ? { span } : undefined,
  });
  it('respects resized tracks, spanning tiles and qualified sheet coordinates', () => {
    const boxes = connectionBoxes(
      [cell('A1'), cell('B2', [2, 2]), cell('Budget!A1')],
      '',
      ['A', 'B', 'C'],
      [1, 2, 3],
      { A: 180, B: 90 },
      { '1': 60, '2': 80 },
    );
    expect(boxes.get('A1')).toEqual({ x: 38, y: 32, width: 180, height: 60 });
    expect(boxes.get('B2')).toEqual({ x: 218, y: 92, width: 202, height: 125 });
    expect(boxes.has('Budget!A1')).toBe(false);
    expect(
      connectionBoxes([cell('Budget!A1')], 'Budget', ['A'], [1], {}, {}).has('Budget!A1'),
    ).toBe(true);
  });
  it('produces nonzero curved paths for adjacent horizontal and vertical cells', () => {
    const from = { x: 38, y: 32, width: 112, height: 45 };
    const horizontal = connectionCurve(from, { ...from, x: 150 });
    const vertical = connectionCurve(from, { ...from, y: 77 });
    expect(horizontal).toContain('M 142 54.5 C');
    expect(horizontal.endsWith('158 54.5')).toBe(true);
    expect(vertical).toContain('M 94 69 C');
    expect(vertical.endsWith('94 85')).toBe(true);
    expect(horizontal).not.toContain('NaN');
    expect(vertical).not.toContain('NaN');
  });
  it('keeps long first-row and last-column curves inside the grid', () => {
    const row = connectionCurve(
      { x: 38, y: 32, width: 112, height: 45 },
      { x: 1158, y: 32, width: 112, height: 45 },
    );
    const column = connectionCurve(
      { x: 1158, y: 32, width: 64, height: 45 },
      { x: 1158, y: 932, width: 64, height: 45 },
    );
    const controls = (path: string) =>
      path
        .split(' C ')[1]
        .split(', ')
        .slice(0, 2)
        .map((point) => point.split(' ').map(Number));
    expect(controls(row).every(([, y]) => y >= 32)).toBe(true);
    expect(controls(column).every(([x]) => x < 1222)).toBe(true);
  });
});
