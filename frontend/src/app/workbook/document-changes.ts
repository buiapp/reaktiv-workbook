import type { SheetDocument } from '../sheet.types';

export type DocumentCheckpoint = SheetDocument | null;

/** Exact comparisons of immutable source state. Never encode source to test dirtiness.
 * Equal object pairs are weakly memoized; unchanged cells/subtrees are skipped.
 * Content comparison preserves undo-to-saved and edits made while a save awaits I/O.
 */
export class DocumentChanges {
  private readonly equal = new WeakMap<object, WeakSet<object>>();

  same(left: unknown, right: unknown): boolean {
    if (left === right) return true;
    if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object')
      return false;
    if (this.equal.get(left)?.has(right)) return true;
    if (Array.isArray(left) !== Array.isArray(right)) return false;
    if (Array.isArray(left) && Array.isArray(right)) {
      if (
        left.length !== right.length ||
        !left.every((value, index) => this.same(value, right[index]))
      )
        return false;
    } else {
      const a = left as Record<string, unknown>,
        b = right as Record<string, unknown>;
      const keys = Object.keys(a).filter((key) => a[key] !== undefined);
      if (
        keys.length !== Object.keys(b).filter((key) => b[key] !== undefined).length ||
        !keys.every((key) => Object.hasOwn(b, key) && this.same(a[key], b[key]))
      )
        return false;
    }
    let matches = this.equal.get(left);
    if (!matches) this.equal.set(left, (matches = new WeakSet()));
    matches.add(right);
    return true;
  }
}

/** Only used to migrate an existing local recovery draft, outside the editing path. */
export function legacyCheckpoint(signature: string | undefined): DocumentCheckpoint {
  if (!signature) return null;
  try {
    const value = JSON.parse(signature) as SheetDocument;
    return value?.format === 'reaktiv-workbook' && value.version === 4 ? value : null;
  } catch {
    return null;
  }
}
