import { describe, expect, it } from 'vitest';
import { isNoteLink, noteLinkHref, resolveNoteLink } from './note-links';
import { renameCell } from './sheet-file';
import type { CellDefinition } from './sheet.types';

const note = (id: string, name?: string, source = '# Note'): CellDefinition => ({
  id,
  name,
  kind: 'markdown',
  source,
  enabled: true,
});

const cells: CellDefinition[] = [
  note('F1', 'intro'),
  note('F3'),
  note('Lab!A1', 'lab_notes'),
  note('Lab!B2'),
  { id: 'A1', name: 'rate', kind: 'input', source: '5', enabled: true },
];

describe('note links', () => {
  it('resolves labels and cell ids; bare coordinates are on the linking note’s sheet', () => {
    expect(resolveNoteLink('#note-intro', cells, '')?.id).toBe('F1');
    expect(resolveNoteLink('#note-lab_notes', cells, '')).toBeUndefined();
    expect(resolveNoteLink('#note-Lab.lab_notes', cells, '')?.id).toBe('Lab!A1');
    expect(resolveNoteLink('#note-F3', cells, '')?.id).toBe('F3');
    expect(resolveNoteLink('#note-B2', cells, 'Lab')?.id).toBe('Lab!B2');
    expect(resolveNoteLink('#note-Lab!B2', cells, '')?.id).toBe('Lab!B2');
    expect(resolveNoteLink('#note-B2', cells, '')).toBeUndefined();
    // Only Markdown cells are notes.
    expect(resolveNoteLink('#note-rate', cells, '')).toBeUndefined();
    expect(resolveNoteLink('#cell-F1', cells, '')).toBeUndefined();
  });

  it('links by label when the note has one, else by id relative to the linking sheet', () => {
    expect(noteLinkHref(cells[0], 'Lab')).toBe('#note-Sheet1.intro');
    expect(noteLinkHref(cells[1], '')).toBe('#note-F3');
    expect(noteLinkHref(cells[3], 'Lab')).toBe('#note-B2');
    expect(noteLinkHref(cells[3], '')).toBe('#note-Lab.B2');
    expect(isNoteLink('#note-')).toBe(false);
    expect(isNoteLink('#note-F3')).toBe(true);
  });

  it('follows a renamed label, and falls back to the id when the label is removed', () => {
    const linking = note('F5', undefined, 'See [the intro](#note-intro) and [not this](#note-introduction).');
    const renamed = renameCell([...cells, linking], 'F1', 'overview');
    expect(renamed.find((cell) => cell.id === 'F5')?.source).toBe(
      'See [the intro](#note-overview) and [not this](#note-introduction).',
    );
    const removed = renameCell(renamed, 'F1', '');
    expect(removed.find((cell) => cell.id === 'F5')?.source).toContain('[the intro](#note-F1)');
  });
});
