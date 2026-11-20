import { createSheetDocument } from '../sheet-file';
import { DocumentChanges, legacyCheckpoint } from './document-changes';

describe('source change tracking', () => {
  it('compares source exactly without serialization and recognizes undo to the saved content', () => {
    const changes = new DocumentChanges();
    const saved = createSheetDocument('test', 10, 20, [
      { id: 'A1', kind: 'input', source: 'x'.repeat(2_000_000), enabled: true },
    ]);
    const encoded = vi.spyOn(JSON, 'stringify');
    const edited = { ...saved, cells: [{ ...saved.cells[0], source: '2' }] };
    expect(changes.same(saved, edited)).toBe(false);
    expect(changes.same(saved, { ...saved, cells: [{ ...saved.cells[0] }] })).toBe(true);
    expect(changes.same(saved, { ...saved, name: 'Renamed' })).toBe(false);
    expect(changes.same(saved, { ...saved, saveOutputs: false })).toBe(false);
    expect(encoded).not.toHaveBeenCalled();
    encoded.mockRestore();
  });

  it('skips unchanged cells and memoizes equal cloned subtrees', () => {
    const changes = new DocumentChanges();
    let reads = 0;
    const cell = {
      id: 'A1',
      get source() {
        reads++;
        return 'large';
      },
    };
    const copy = { id: 'A1', source: 'large' };
    expect(changes.same({ cells: [cell] }, { cells: [cell] })).toBe(true);
    expect(reads).toBe(0);
    expect(changes.same(cell, copy)).toBe(true);
    const first = reads;
    expect(changes.same({ cells: [cell] }, { cells: [copy] })).toBe(true);
    expect(reads).toBe(first);
    expect(changes.same({ value: undefined }, {})).toBe(true);
    expect(changes.same({ value: null }, {})).toBe(false);
    expect(changes.same(['a', 'b'], ['b', 'a'])).toBe(false);
  });

  it('keeps a captured save checkpoint independent of subsequent edits and reads old recovery signatures', () => {
    const changes = new DocumentChanges();
    const saved = createSheetDocument('test', 10, 20, []);
    expect(changes.same(saved, { ...saved, name: 'Edited during save' })).toBe(false);
    expect(changes.same(saved, legacyCheckpoint(JSON.stringify(saved)))).toBe(true);
    expect(legacyCheckpoint('')).toBeNull();
    expect(legacyCheckpoint('broken')).toBeNull();
  });
});
