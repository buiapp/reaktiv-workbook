/**
 * Widths of blocks in notes and the `#sheet-output?…` query that stores them (and a plot's
 * size). Kept free of imports: the note view uses it at startup, while the Markdown
 * conversion (remark/rehype) loads only with the editor.
 */

/** Note layouts wider than the text column: `wide` (up to 1080 px) and `full` (the whole note area). */
export const NOTE_LAYOUTS = ['wide', 'full'] as const;
export type NoteLayout = (typeof NOTE_LAYOUTS)[number];

export function isNoteLayout(value: unknown): value is NoteLayout {
  return typeof value === 'string' && (NOTE_LAYOUTS as readonly string[]).includes(value);
}

/** `width=W&height=H&layout=wide` (each part optional). */
export function parseOutputQuery(query: string): { width?: string; height?: string; layout?: NoteLayout } {
  const params = new URLSearchParams(query);
  const width = params.get('width');
  const height = params.get('height');
  const layout = params.get('layout');
  return {
    ...(width && height && /^\d+$/.test(width) && /^\d+$/.test(height) ? { width, height } : {}),
    ...(isNoteLayout(layout) ? { layout } : {}),
  };
}

/** The `#sheet-output?…` query for a value's size and layout; '' when it has neither. */
export function outputQuery(width: unknown, height: unknown, layout: unknown): string {
  const parts: string[] = [];
  if (width && height) parts.push(`width=${width}`, `height=${height}`);
  if (isNoteLayout(layout)) parts.push(`layout=${layout}`);
  return parts.join('&');
}
