import { describe, expect, it } from 'vitest';
import { assertCellPlacements, assertChangedCellPlacements } from './cell-placement';
import type { CellDefinition } from './sheet.types';
const cell = (id: string, span?: [number, number]): CellDefinition => ({ id, kind: 'input', source: '1', enabled: true, ...(span ? { view: { span } } : {}) });

describe('cell placement footprints', () => {
  it('rejects anchors inside a tile, tile edges over anchors, and tile-to-tile intersections', () => {
    for (const [cells, id] of [
      [[cell('A1', [3, 3]), cell('B2')], 'B2'],
      [[cell('A1', [3, 3]), cell('C3')], 'A1'],
      [[cell('A1', [3, 3]), cell('C2', [2, 3])], 'C2'],
    ] as const) expect(() => assertCellPlacements(cells, new Set([id]))).toThrow('overlap');
  });
  it('uses final positions, permits adjacent edges and scopes occupancy to each sheet', () => {
    expect(() => assertCellPlacements([cell('B1', [2, 2]), cell('D1')], new Set(['B1', 'D1']))).not.toThrow();
    expect(() => assertCellPlacements([cell('A1', [3, 3]), cell('Other!B2')], new Set(['Other!B2']))).not.toThrow();
    expect(() => assertCellPlacements([cell('A1'), cell('A1')], new Set(['A1']))).toThrow('overwrite');
  });
  it('validates only created or resized footprints, preserving unrelated legacy editing', () => {
    const legacy = [cell('A1', [3, 3]), cell('B2')];
    expect(() => assertChangedCellPlacements(legacy, legacy.map(value => ({ ...value, source: '2' })))).not.toThrow();
    expect(() => assertChangedCellPlacements([cell('A1'), cell('B2')], legacy)).toThrow('overlap');
    expect(() => assertChangedCellPlacements([cell('A1', [3, 3])], legacy)).toThrow('overlap');
    expect(() => assertChangedCellPlacements(legacy, [cell('C1', [3, 3])])).not.toThrow();
  });
});

it('previews full move/group/swap footprints using the same final-placement validation', async () => {
  const {previewCellMove, planCellMove} = await import('./cell-placement');
  const cells = [cell('A1', [2, 2]), cell('D1')];
  expect(previewCellMove(cells, 'A1', 'B4', ['A1'])).toMatchObject({invalid: false, cells: [{id: 'B4', view: {span: [2, 2]}}]});
  const swap = previewCellMove(cells, 'A1', 'D1', ['A1']);
  expect(swap.invalid).toBe(false); expect(swap.message).toContain('Swap');
  expect(swap.cells.map(c => c.id)).toEqual(['D1', 'A1']);
  const blocked = previewCellMove(cells, 'D1', 'B2', ['D1']);
  expect(blocked.invalid).toBe(true); expect(blocked.message).toContain('overlap');
  const group = previewCellMove(cells, 'A1', 'B4', ['A1', 'D1']);
  expect(group.cells.map(c => c.id)).toEqual(['B4', 'E4']); expect(group.invalid).toBe(false);
  expect([...planCellMove(cells, 'A1', 'B4', ['A1', 'D1']).positions.values()]).toEqual(['B4', 'E4']);
  expect(previewCellMove(cells, 'D1', 'B1', ['A1', 'D1']).invalid).toBe(true);
  expect(previewCellMove(cells, 'A1', 'Other!B4', ['A1']).cells[0].id).toBe('Other!B4');
  expect(cells[0].id).toBe('A1');
});
