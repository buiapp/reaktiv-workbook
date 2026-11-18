/**
 * LaTeX math in Markdown, rendered with KaTeX.
 *
 * Syntax: `$…$` inline and `$$…$$` display. Inline math follows pandoc's rules so
 * prices are not math: the opening `$` must be followed by a non-space character, the
 * closing `$` preceded by a non-space character and not followed by a digit, and `\$`
 * is a literal dollar. Importing this module registers the extension with `marked`
 * (used for notes in the grid, the inspector, exports, and value previews); the note
 * editor uses the same tokenizer through markdown-conversion.ts.
 */
import { signal } from '@angular/core';
import type katexModule from 'katex';
import { marked, type TokenizerAndRendererExtension } from 'marked';

/**
 * KaTeX (~270 kB) is loaded lazily, starting when this module is imported (at app
 * start); until it arrives formulas show their source. `mathRevision` changes when it
 * has loaded, so cached renderings can be refreshed.
 */
let katex: typeof katexModule | null = null;
export const mathRevision = signal(0);
let loading: Promise<void> | null = null;

export function loadMath(): Promise<void> {
  loading ??= import('katex').then((module) => {
    katex = (module as unknown as { default?: typeof katexModule }).default ?? (module as unknown as typeof katexModule);
    mathRevision.update((revision) => revision + 1);
  });
  return loading;
}

export type MathOutput = 'html' | 'mathml';

/** `html` for the app (KaTeX CSS); exports switch to `mathml` (no CSS or fonts needed). */
let output: MathOutput = 'html';

export function withMathOutput<T>(mode: MathOutput, render: () => T): T {
  const previous = output;
  output = mode;
  try {
    return render();
  } finally {
    output = previous;
  }
}

/** KaTeX HTML for a formula; errors show the source in red instead of throwing. */
export function renderMath(latex: string, display: boolean): string {
  if (katex === null) {
    void loadMath();
    const delimiter = display ? '$$' : '$';
    return `<span class="math-pending">${escapeHtml(delimiter + latex + delimiter)}</span>`;
  }
  // `102,500` from a live value is a thousands separator, not punctuation with a space.
  return katex.renderToString(latex.replace(/(\d),(?=\d{3}(?!\d))/g, '$1{,}'), {
    displayMode: display,
    throwOnError: false,
    output: output === 'mathml' ? 'mathml' : 'htmlAndMathml',
    strict: 'ignore',
    trust: false,
  });
}

export interface MathMatch {
  start: number;
  end: number;
  latex: string;
  display: boolean;
}

/** Math spans in text (not code: callers handle code themselves). */
export function findMath(text: string): MathMatch[] {
  const matches: MathMatch[] = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === '\\' && text[index + 1] === '$') {
      index += 2;
      continue;
    }
    if (char !== '$') {
      index += 1;
      continue;
    }
    if (text[index + 1] === '$') {
      const close = text.indexOf('$$', index + 2);
      if (close > index + 2) {
        matches.push({ start: index, end: close + 2, latex: text.slice(index + 2, close).trim(), display: true });
        index = close + 2;
        continue;
      }
      index += 2;
      continue;
    }
    const end = inlineEnd(text, index);
    if (end !== null) {
      matches.push({ start: index, end: end + 1, latex: text.slice(index + 1, end), display: false });
      index = end + 1;
      continue;
    }
    index += 1;
  }
  return matches;
}

/** Index of the `$` closing inline math opened at `start`, or null. */
function inlineEnd(text: string, start: number): number | null {
  const first = text[start + 1];
  if (first === undefined || /\s/.test(first)) return null;
  for (let index = start + 1; index < text.length; index++) {
    const char = text[index];
    if (char === '\n' && text[index + 1] === '\n') return null; // never across paragraphs
    if (char === '\\') {
      index += 1;
      continue;
    }
    if (char !== '$') continue;
    if (text[index + 1] === '$') return null;
    if (/\s/.test(text[index - 1]) || /\d/.test(text[index + 1] ?? '')) continue;
    return index;
  }
  return null;
}

const blockMath: TokenizerAndRendererExtension = {
  name: 'mathBlock',
  level: 'block',
  start: (source) => source.match(/^\s*\$\$/m)?.index,
  tokenizer(source) {
    const match = /^ {0,3}\$\$([\s\S]+?)\$\$[ \t]*(?:\n+|$)/.exec(source);
    if (match === null) return undefined;
    return { type: 'mathBlock', raw: match[0], text: match[1].trim() };
  },
  renderer: (token) => `<div class="math-block">${renderMath(String(token['text']), true)}</div>\n`,
};

const inlineMath: TokenizerAndRendererExtension = {
  name: 'mathInline',
  level: 'inline',
  start: (source) => {
    const index = source.indexOf('$');
    return index < 0 ? undefined : index;
  },
  tokenizer(source) {
    if (source[0] !== '$') return undefined;
    const [match] = findMath(source);
    if (match === undefined || match.start !== 0) return undefined;
    return {
      type: 'mathInline',
      raw: source.slice(0, match.end),
      text: match.latex,
      display: match.display,
    };
  },
  renderer: (token) => renderMath(String(token['text']), Boolean(token['display'])),
};

let registered = false;

/** Register `$…$` / `$$…$$` with marked (idempotent). */
export function registerMarkdownMath(): void {
  if (registered) return;
  registered = true;
  marked.use({ extensions: [blockMath, inlineMath] });
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

registerMarkdownMath();
void loadMath();
