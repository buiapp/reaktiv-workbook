/** Python source format migration is independent of the JSON document schema. */
export interface WorkbookMigration {
  /** File name of the format-1 workbook, which is kept unchanged. */
  sourceName: string;
}

const SUFFIXES = ['.workbook.py', '.sheet.py'];

/** A new name for the format-2 copy: `budget.sheet.py` → `budget.workbook.py`, else `-v2`. */
export function migratedFilename(original: string): string {
  const name = original.replace(/\.zip$/i, '');
  const stem = name.replace(/(?:\.workbook|\.sheet)?\.py$/i, '');
  return name.toLowerCase().endsWith('.workbook.py') ? `${stem}-v2.workbook.py` : `${stem}.workbook.py`;
}

export function migrationDownloadName(value: string, original: string): string {
  const name = value.trim();
  if (!name || /[\\/<>:"|?*\x00-\x1f]/.test(name) || !SUFFIXES.some(suffix => name.toLowerCase().endsWith(suffix)))
    throw new Error('Choose a new filename ending in .workbook.py.');
  if (name.toLowerCase() === original.replace(/\.zip$/i, '').toLowerCase())
    throw new Error('Choose a different filename to keep the original format-1 workbook.');
  return name;
}
