/**
 * Export and print notes as they are shown: interpolated values, tables, and plots are
 * the current results (a snapshot), not the Markdown source with `{{ }}` expressions.
 * Images are embedded as data URLs, so the files are self-contained.
 */

export type NoteExportFormat = 'markdown' | 'html';

export interface ExportedNote {
  id: string;
  title: string;
  /** Rendered Markdown (values interpolated, images embedded). */
  markdown: string;
  /** Rendered HTML of the same note. */
  html: string;
}

/** One Markdown file; several notes are separated by horizontal rules. */
export function notesToMarkdown(notes: readonly ExportedNote[]): string {
  return `${notes.map((note) => note.markdown.trim()).join('\n\n---\n\n')}\n`;
}

/** A standalone HTML document; each note starts on a new page when printed. */
export function notesToHtml(
  title: string,
  notes: readonly ExportedNote[],
  exportedAt = new Date(),
): string {
  const sections = notes
    .map((note) => `<section class="note" id="${escapeHtml(note.id)}">\n${note.html}\n</section>`)
    .join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Reaktiv Workbook">
<title>${escapeHtml(title)}</title>
<style>
${EXPORT_STYLES}
</style>
</head>
<body>
${sections}
<footer>Exported from Reaktiv Workbook on ${escapeHtml(exportedAt.toLocaleString())}</footer>
</body>
</html>
`;
}

/**
 * App-only links mean nothing outside the app: input widgets
 * (`[Name: Alex](#sheet-input:owner_name?...)`), cell links (`[see](#cell-A1)`), and links to
 * notes not in the export (`[next](#note-F3)`) become their plain label. Images (`![..](...)`) are kept.
 */
export function withoutAppLinksMarkdown(markdown: string): string {
  return markdown
    // A value's size or layout (`[![Plot](…)](#sheet-output?width=…)`): keep the value only.
    .replace(/\[(!\[[^\]]*\]\([^)]*\))\]\(#sheet-output\?[^)]*\)/g, '$1')
    .replace(/(?<!!)\[([^\]]*)\]\(#(?:sheet-input:|cell-|note-|sheet-output\?)[^)]*\)/g, '$1');
}

export function withoutAppLinksHtml(html: string): string {
  return html
    .replace(/<a\b[^>]*\bhref="#sheet-output\?[^"]*"[^>]*>([\s\S]*?)<\/a>/g, '$1')
    .replace(/<a\b[^>]*\bhref="#(?:sheet-input:|cell-|note-)[^"]*"[^>]*>([\s\S]*?)<\/a>/g, '<span>$1</span>');
}

export function exportFileName(stem: string, format: NoteExportFormat): string {
  const safe = stem.replace(/[^\p{L}\p{N}._ -]+/gu, '').trim().replace(/\s+/g, '-') || 'notes';
  return `${safe}.${format === 'markdown' ? 'md' : 'html'}`;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** Typography for exported and printed notes (also used by the print view). */
export const EXPORT_STYLES = `
:root { color-scheme: light; }
body { max-width: 760px; margin: 40px auto; padding: 0 24px; color: #1d1d1b; background: #fff;
  font: 15px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
.note + .note { margin-top: 48px; padding-top: 32px; border-top: 1px solid #e9e8e3; }
h1, h2, h3 { line-height: 1.25; margin: 1.4em 0 0.5em; }
h1 { font-size: 1.9em; } h2 { font-size: 1.4em; } h3 { font-size: 1.15em; }
.note > :first-child { margin-top: 0; }
p, ul, ol, blockquote, table, pre { margin: 0 0 1em; }
a { color: #4d6fbf; }
img { max-width: 100%; height: auto; }
table { border-collapse: collapse; font-size: 0.92em; }
th, td { padding: 5px 10px; border: 1px solid #e0dfd9; text-align: left; }
th { background: #f6f5f1; }
code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9em; }
pre { overflow-x: auto; padding: 12px; border-radius: 6px; background: #f6f5f1; }
code, pre { white-space: pre-wrap; overflow-wrap: anywhere; }
.shiki-token { color: var(--shiki-light); }
blockquote { margin-left: 0; padding-left: 14px; border-left: 3px solid #d7d6d0; color: #5e645b; }
footer { margin-top: 48px; color: #8f8f88; font-size: 12px; }
@media print {
  body { max-width: none; margin: 0; padding: 0; }
  .note + .note { break-before: page; margin-top: 0; padding-top: 0; border-top: 0; }
  footer { display: none; }
  img, table, pre { break-inside: avoid; }
}
`;
