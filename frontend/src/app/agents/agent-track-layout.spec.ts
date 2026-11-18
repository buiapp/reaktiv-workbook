import { describe, expect, it } from 'vitest';
import { patchTrackLayout } from './agent-track-layout';

const layout = {columns: 6, rows: 30, rowHeights: {'1': 70}, columnWidths: {A: 150}};
describe('agent track sizing', () => {
  it('patches and resets only named tracks without changing extent or input layout', () => {
    expect(patchTrackLayout(layout, {worksheet: 'Messung', rowHeights: {'2': 64, '1': null}, columnWidths: {B: 300}}))
      .toEqual({...layout, rowHeights: {'2': 64}, columnWidths: {A: 150, B: 300}});
    expect(layout.rowHeights).toEqual({'1': 70});
  });
  it('rejects invalid keys, sizes and entire malformed patches', () => {
    for (const rowHeights of <Record<string, number>[]>[{'0': 64}, {'31': 64}, {'2': 241}, {'2': NaN}, {'2': 64.5}, {'02': 64}])
      expect(() => patchTrackLayout(layout, {worksheet: 'Test', rowHeights})).toThrow();
    expect(() => patchTrackLayout(layout, {worksheet: 'Test', columnWidths: {G: 120}})).toThrow();
    expect(() => patchTrackLayout(layout, {worksheet: 'Test'})).toThrow();
    expect(layout.rowHeights).toEqual({'1': 70});
  });
});
