import { marked } from 'marked';
import { applyMarkdownImageSizes } from '../markdown-cell-editor.component';
import { withMathOutput } from '../markdown-math';
import { decodeHtmlOutput, isHtmlOutput, sanitizeHtmlOutput } from '../html-output';
import { withPlotlyPlaceholders } from '../plotly-figure';
import type { CellResult } from '../sheet.types';

/**
 * Notes link plots produced by other cells as `![alt](#cell-C1)` so the runtime
 * does not re-encode and re-send each image per note. Resolve those links to
 * the referenced cell's image data wherever self-contained Markdown is needed.
 */
export function embedCellImages(
  markdown: string,
  results: ReadonlyMap<string, CellResult>,
): string {
  return markdown.replace(
    /!\[([^\]]*)\]\(#cell-((?:[A-Za-z_][A-Za-z0-9_]*!)?[A-Z]+[1-9][0-9]*)\)/g,
    (match, alt: string, cellId: string) => {
      const result = results.get(cellId);
      const image = result?.richOutput ?? result?.artifact;
      // HTML output goes into self-contained Markdown as (sanitised) HTML.
      if (image !== undefined && isHtmlOutput(image)) {
        return `\n\n<div class="html-output">${sanitizeHtmlOutput(decodeHtmlOutput(image.dataBase64))}</div>\n\n`;
      }
      return image === undefined || !image.mimeType.startsWith('image/')
        ? match
        : `![${alt}](data:${image.mimeType};base64,${image.dataBase64})`;
    },
  );
}

/** HTML counterpart of {@link embedCellImages}, applied after Markdown rendering. */
export function embedCellImageSources(
  html: string,
  results: ReadonlyMap<string, CellResult>,
): string {
  return html.replace(
    /\bsrc="#cell-((?:[A-Za-z_][A-Za-z0-9_]*!)?[A-Z]+[1-9][0-9]*)"/g,
    (match, cellId: string) => {
      const result = results.get(cellId);
      const image = result?.richOutput ?? result?.artifact;
      return image === undefined || !image.mimeType.startsWith('image/')
        ? match
        : `src="data:${image.mimeType};base64,${image.dataBase64}"`;
    },
  );
}

/** One current rendering per cell, plus bounded shared history for transient sources. */
export class NoteRenderer {
  private readonly cells = new Map<string, { source: string; html: string }>();
  private readonly cache = new Map<string, string>();
  private revision = '';
  private characters = 0;
  private static readonly MAX_ENTRIES = 256;
  private static readonly MAX_CHARACTERS = 4 * 1024 * 1024;

  invalidate(revision: string): void {
    if (revision === this.revision) return;
    this.clear();
    this.revision = revision;
  }

  renderCell(cellId: string, source: string): string {
    const current = this.cells.get(cellId);
    if (current?.source === source) return current.html;
    const html = this.render(source);
    this.cells.set(cellId, { source, html });
    return html;
  }

  /** Active outputs belong to their current cells, not to a cache access sequence. */
  retainCells(cellIds: Iterable<string>): void {
    const retained = new Set(cellIds);
    for (const id of this.cells.keys()) {
      if (!retained.has(id)) this.cells.delete(id);
    }
  }

  render(source: string): string {
    const cached = this.cache.get(source);
    if (cached !== undefined) return cached;
    const html = renderMarkdownUncached(source);
    const size = source.length + html.length;
    if (size > NoteRenderer.MAX_CHARACTERS) return html;
    this.cache.set(source, html);
    this.characters += size;
    while (
      this.cache.size > NoteRenderer.MAX_ENTRIES ||
      this.characters > NoteRenderer.MAX_CHARACTERS
    ) {
      const oldest = this.cache.keys().next().value!;
      this.characters -= oldest.length + this.cache.get(oldest)!.length;
      this.cache.delete(oldest);
    }
    return html;
  }

  clear(): void {
    this.cells.clear();
    this.cache.clear();
    this.characters = 0;
  }

  diagnostics(): {
    entries: number;
    keyChars: number;
    htmlChars: number;
    activeCells: { entries: number; sourceChars: number; htmlChars: number };
  } {
    let keyChars = 0;
    let htmlChars = 0;
    for (const [key, html] of this.cache) {
      keyChars += key.length;
      htmlChars += html.length;
    }
    let sourceChars = 0,
      cellHtmlChars = 0;
    for (const cell of this.cells.values()) {
      sourceChars += cell.source.length;
      cellHtmlChars += cell.html.length;
    }
    // Current outputs and shared cache entries can reference the same strings.
    // These logical character counts must not be added as allocated heap bytes.
    return {
      entries: this.cache.size,
      keyChars,
      htmlChars,
      activeCells: { entries: this.cells.size, sourceChars, htmlChars: cellHtmlChars },
    };
  }
}

/** Markdown → HTML for exports: like the app's renderer, but charts stay images. */
export function renderMarkdownForExport(source: string): string {
  // MathML needs no KaTeX stylesheet or fonts, so exported files stay self-contained.
  return withMathOutput('mathml', () =>
    applyMarkdownImageSizes(marked.parse(source, { async: false, breaks: true, gfm: true })),
  );
}

function renderMarkdownUncached(source: string): string {
  return withPlotlyPlaceholders(
    applyMarkdownImageSizes(
      marked.parse(source, {
        async: false,
        breaks: true,
        gfm: true,
      }),
    ),
  );
}
