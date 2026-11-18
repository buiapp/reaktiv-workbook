import { createSheetDocument } from './sheet-file';
import {
  copyRecoveryOutputs,
  readRecoveryDraft,
  recoveryOutputKey,
  removeRecoveryDraft,
  writeRecoveryOutputs,
} from './recovery-outputs';
import { draftKeyFor } from './window-session';

describe('optional recovery output sidecars', () => {
  beforeEach(() => localStorage.clear());
  const snapshot = { savedAt: 'now', cells: [], dependencies: {} };
  const document = createSheetDocument('test', 10, 20, []);

  it('restores matching previews, tolerates missing/damaged previews and refuses another workbook preview', () => {
    const key = draftKeyFor('main');
    localStorage.setItem(key, JSON.stringify({ document, outputRevision: 'one' }));
    expect(readRecoveryDraft(localStorage, key)?.document?.snapshot).toBeUndefined();
    writeRecoveryOutputs(localStorage, key, 'one', snapshot);
    expect(readRecoveryDraft(localStorage, key)?.document?.snapshot).toEqual(snapshot);
    writeRecoveryOutputs(localStorage, key, 'another', snapshot);
    expect(readRecoveryDraft(localStorage, key)?.document?.snapshot).toBeUndefined();
    localStorage.setItem(recoveryOutputKey(key), 'broken');
    expect(readRecoveryDraft(localStorage, key)?.document?.name).toBe('test');
  });

  it('reads legacy embedded previews and honors disabled output saving for both formats', () => {
    localStorage.setItem('draft', JSON.stringify({ document: { ...document, snapshot } }));
    expect(readRecoveryDraft(localStorage, 'draft')?.document?.snapshot).toEqual(snapshot);
    localStorage.setItem(
      'draft',
      JSON.stringify({
        document: { ...document, snapshot, saveOutputs: false },
        outputRevision: 'one',
      }),
    );
    writeRecoveryOutputs(localStorage, 'draft', 'one', snapshot);
    expect(readRecoveryDraft(localStorage, 'draft')?.document?.snapshot).toBeUndefined();
    writeRecoveryOutputs(localStorage, 'draft', 'one', undefined);
    expect(localStorage.getItem(recoveryOutputKey('draft'))).toBeNull();
  });

});
