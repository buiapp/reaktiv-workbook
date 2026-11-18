/** Note identity, titles and ordering; independent of the app shell. */

export type NoteSort = 'manual' | 'title' | 'sheet';

export function isNoteSort(value: unknown): value is NoteSort {
  return value === 'manual' || value === 'title' || value === 'sheet';
}

/**
 * Notes in list order. Manual: the saved order, then notes not in it (new ones) in sheet
 * order. Sheet: the grid order. Title: alphabetical.
 */
export function sortNotes<T extends { id: string }>(
  notes: readonly T[],
  sort: NoteSort,
  order: readonly string[],
  title: (note: T) => string,
): T[] {
  if (sort === 'title') {
    // Leading emoji and symbols ("🏡 Home") do not decide the order.
    const key = (note: T) => title(note).replace(/^[^\p{L}\p{N}]+/u, '');
    return [...notes].sort((left, right) =>
      key(left).localeCompare(key(right), undefined, { numeric: true, sensitivity: 'base' }),
    );
  }
  if (sort === 'sheet' || order.length === 0) return [...notes];
  const rank = new Map(order.map((id, index) => [id, index]));
  return [...notes].sort(
    (left, right) =>
      (rank.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
      (rank.get(right.id) ?? Number.MAX_SAFE_INTEGER),
  );
}

export function markdownTitle(source: string, fallback: string): string {
  // The first level-1 heading, else the first heading of any level.
  const heading = /^#\s+(.+?)\s*$/m.exec(source) ?? /^#{2,6}\s+(.+?)\s*$/m.exec(source);
  return heading?.[1]?.trim() || fallback;
}
