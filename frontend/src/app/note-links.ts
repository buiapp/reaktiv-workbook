/**
 * Links between notes: `[Chapter 2](#note-motion_forces)` or `[Summary](#note-F12)`.
 * The target is the note's cell label or its cell id; a bare coordinate means the linking
 * note's own sheet, like `#cell-` links. Moving a note rewrites id links, renaming its
 * label rewrites label links.
 */
import { cellReference, DEFAULT_SHEET_NAME, qualifyCellId, splitCellId } from './sheet-file';
import type { CellDefinition } from './sheet.types';

export const NOTE_LINK_PREFIX = '#note-';
const CELL_ID = /^(?:[A-Za-z_][A-Za-z0-9_]*!)?[A-Z]+[1-9][0-9]*$/;

export interface NoteLinkTarget {
  href: string;
  title: string;
}

export function isNoteLink(href: string | null): href is string {
  return href !== null && href.startsWith(NOTE_LINK_PREFIX) && href.length > NOTE_LINK_PREFIX.length;
}

/** The note a `#note-…` link points at, seen from a note on `fromSheet` ('' = first sheet). */
export function resolveNoteLink(
  href: string,
  cells: readonly CellDefinition[],
  fromSheet: string,
  firstSheet = DEFAULT_SHEET_NAME,
): CellDefinition | undefined {
  if (!isNoteLink(href)) return undefined;
  let target = href.slice(NOTE_LINK_PREFIX.length);
  try {
    target = decodeURIComponent(target);
  } catch {
    // keep the raw text
  }
  const notes = cells.filter((cell) => cell.kind === 'markdown');
  if (CELL_ID.test(target)) {
    const id = target.includes('!') ? target : qualifyCellId(fromSheet, target);
    const byId = notes.find((cell) => cell.id === id);
    if (byId !== undefined) return byId;
  }
  const [sheetName, label] = target.split('.');
  if (label !== undefined) {
    const sheet = sheetName === firstSheet ? '' : sheetName;
    return notes.find((cell) => splitCellId(cell.id)[0] === sheet && (cell.name === label || splitCellId(cell.id)[1] === label));
  }
  return notes.find((cell) => splitCellId(cell.id)[0] === fromSheet && cell.name === target);
}

/** The link to `note` from a note on `fromSheet`: its label when it has one, else its id. */
export function noteLinkHref(note: CellDefinition, fromSheet: string, firstSheet = DEFAULT_SHEET_NAME): string {
  return `${NOTE_LINK_PREFIX}${cellReference(fromSheet, note, firstSheet)}`;
}
