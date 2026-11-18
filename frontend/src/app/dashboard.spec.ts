import { serializeSheetDocument } from '../../../tests/python-writer';
import { clampSpan, coveredCells, kpiText, spanOf, widgetFor, widgetSource } from './dashboard';
import { makeSnapshot, normalizeView, createSheetDocument } from './sheet-file';

describe('dashboard tiles', () => {
  it('clamps spans to the grid and lists covered cells', () => {
    expect(spanOf({ id: 'C3', view: { span: [5, 5] } }, 4, 4)).toEqual([2, 2]);
    const covered = coveredCells([{ id: 'A1', view: { span: [2, 2] } }, { id: 'D4' }], 5, 5);
    expect([...covered.entries()]).toEqual([
      ['B1', 'A1'],
      ['A2', 'A1'],
      ['B2', 'A1'],
    ]);
  });

  it('never grows a span over filled cells or other tiles', () => {
    const occupied = new Set(['C1', 'A4']);
    expect(clampSpan('A1', [4, 5], (id) => occupied.has(id), 8, 8)).toEqual([2, 3]);
    expect(clampSpan('A1', [1, 1], () => true, 8, 8)).toEqual([1, 1]);
  });

  it('infers widgets and writes Python sources', () => {
    expect(widgetFor(true)).toEqual({ type: 'checkbox' });
    expect(widgetFor(3)).toEqual({ type: 'number' });
    expect(widgetFor('x', { type: 'select', options: ['a'] })).toEqual({ type: 'select', options: ['a'] });
    expect(widgetSource(true, 'checkbox')).toBe('True');
    expect(widgetSource('0.25', 'range')).toBe('0.25');
    expect(widgetSource('Jul', 'select')).toBe('"Jul"');
    expect(kpiText(42, '42')).toBe('42');
    expect(kpiText([1, 2], '[1, 2]')).toBeNull();
  });
});

describe('sheet file views and snapshots', () => {
  it('drops default view settings', () => {
    expect(normalizeView({ display: 'value', span: [1, 1] })).toBeUndefined();
    expect(normalizeView({ display: 'rendered', span: [2, 0] })).toEqual({ display: 'rendered', span: [2, 1] });
  });

  it('writes the view keyword and the output snapshot as Python', () => {
    const document = createSheetDocument(
      'Dash',
      4,
      4,
      [
        {
          id: 'A1',
          kind: 'input',
          source: '0.2',
          enabled: true,
          trigger: 'auto',
          name: 'rate',
          view: { display: 'rendered', widget: { type: 'checkbox' } },
        },
      ],
      [],
      undefined,
      {},
      [],
      makeSnapshot({
        cells: [
          { id: 'A1', display: '0.2', value: 0.2, valueType: 'float', error: null },
          { id: 'A2', display: 'x', value: 'y'.repeat(30_000), valueType: 'str', error: null },
        ],
        dependencies: { A1: [] },
      }, new Date('2026-09-27T10:00:00Z')),
    );
    const source = serializeSheetDocument(document);
    expect(source).toContain('rate = cell(');
    expect(source).toContain('view={"display": "rendered", "widget": {"type": "checkbox"}}');
    expect(source).not.toContain('__snapshot__');
    const snapshot = document.snapshot!;
    expect(snapshot.savedAt).toBe('2026-09-27T10:00:00.000Z');
    expect(snapshot.cells[0].value).toBe(0.2);
    expect('value' in snapshot.cells[1]).toBe(false); // large raw values are dropped
  });
});

it('preserves Python widget settings expressions when saving', () => {
  const view = { widget: { type: 'range' as const, min: 'lower', max: 'upper * 2', step: .5 } };
  expect(normalizeView(view)).toEqual(view);
  const document = createSheetDocument('Widgets', 2, 2, [{ id: 'A1', kind: 'input', source: '2', enabled: true, trigger: 'auto', view }], []);
  expect(serializeSheetDocument(document)).toContain('"max": lambda self: upper * 2');
});
