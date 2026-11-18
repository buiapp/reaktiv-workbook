import type { SheetDocument, SheetSnapshot } from './sheet.types';

export interface RecoveryDocument {
  document?: SheetDocument;
  outputRevision?: string;
}

export const recoveryOutputKey = (key: string): string => `reaktiv-workbook:outputs:${key}`;

/** Legacy inline snapshots remain readable. A sidecar belongs to exactly one document. */
export function readRecoveryDraft<T extends RecoveryDocument>(
  storage: Storage,
  key: string,
): T | null {
  const text = storage.getItem(key);
  if (text === null) return null;
  const draft = JSON.parse(text) as T;
  if (!draft.document) return draft;
  if (draft.document.saveOutputs === false) {
    draft.document = { ...draft.document, snapshot: undefined };
    return draft;
  }
  if (draft.outputRevision) {
    try {
      const text = storage.getItem(recoveryOutputKey(key));
      const output =
        text === null ? null : (JSON.parse(text) as { revision: string; snapshot: SheetSnapshot });
      if (output?.revision === draft.outputRevision && Array.isArray(output.snapshot?.cells))
        draft.document = { ...draft.document, snapshot: output.snapshot };
    } catch {
      /* A missing or damaged preview never prevents source recovery. */
    }
  }
  return draft;
}

export function writeRecoveryOutputs(
  storage: Storage,
  key: string,
  revision: string,
  snapshot: SheetSnapshot | undefined,
): void {
  if (snapshot === undefined) {
    if (storage.getItem(recoveryOutputKey(key)) !== null)
      storage.removeItem(recoveryOutputKey(key));
  } else storage.setItem(recoveryOutputKey(key), JSON.stringify({ revision, snapshot }));
}

export function copyRecoveryOutputs(storage: Storage, from: string, to: string): void {
  const output = storage.getItem(recoveryOutputKey(from));
  if (output === null) storage.removeItem(recoveryOutputKey(to));
  else storage.setItem(recoveryOutputKey(to), output);
}

export function removeRecoveryDraft(storage: Storage, key: string): void {
  storage.removeItem(key);
  if (storage.getItem(recoveryOutputKey(key)) !== null) storage.removeItem(recoveryOutputKey(key));
}
