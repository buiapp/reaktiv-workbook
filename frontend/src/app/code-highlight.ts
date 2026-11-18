/**
 * Syntax highlighting of fenced code blocks (```python, ```sql, …) with Shiki, in the
 * note editor (ProseMirror decorations) and in rendered notes (`marked`).
 *
 * Shiki and every language grammar are loaded lazily, the first time a block needs them.
 * Colours come in a light and a dark variant as CSS variables (`--shiki-light`,
 * `--shiki-dark`); styles.scss picks one with `light-dark()`, so switching the theme needs
 * no re-highlighting. `codeRevision` changes when a grammar arrives, so synchronous
 * renderers render again.
 */
import { signal } from '@angular/core';
import { marked } from 'marked';
import type { Decoration } from 'prosekit/pm/view';
import type { HighlighterGeneric, ThemedToken } from '@shikijs/types';

type Highlighter = HighlighterGeneric<string, string>;

export const codeRevision = signal(0);

/** Languages offered in the editor's picker; any other Shiki language works when typed. */
export const CODE_LANGUAGES: ReadonlyArray<{ id: string; name: string }> = [
  { id: '', name: 'Plain text' },
  { id: 'python', name: 'Python' },
  { id: 'javascript', name: 'JavaScript' },
  { id: 'typescript', name: 'TypeScript' },
  { id: 'json', name: 'JSON' },
  { id: 'bash', name: 'Shell' },
  { id: 'sql', name: 'SQL' },
  { id: 'html', name: 'HTML' },
  { id: 'css', name: 'CSS' },
  { id: 'markdown', name: 'Markdown' },
  { id: 'yaml', name: 'YAML' },
  { id: 'toml', name: 'TOML' },
  { id: 'r', name: 'R' },
  { id: 'julia', name: 'Julia' },
  { id: 'matlab', name: 'MATLAB' },
  { id: 'c', name: 'C' },
  { id: 'cpp', name: 'C++' },
  { id: 'java', name: 'Java' },
  { id: 'rust', name: 'Rust' },
  { id: 'go', name: 'Go' },
  { id: 'latex', name: 'LaTeX' },
  { id: 'mermaid', name: 'Mermaid diagram' },
];

const THEMES = { light: 'github-light', dark: 'github-dark' } as const;
/** Blocks that are rendered as something else, or have nothing to highlight. */
const NOT_HIGHLIGHTED = new Set(['', 'text', 'plain', 'plaintext', 'txt', 'mermaid']);

let highlighter: Highlighter | null = null;
let starting: Promise<void> | null = null;
let known: ReadonlySet<string> = new Set();
const ready = new Set<string>();
const failed = new Set<string>();
const loading = new Map<string, Promise<void>>();

function start(): Promise<void> {
  starting ??= (async () => {
    const [{ createHighlighter, bundledLanguages }, { createJavaScriptRegexEngine }] = await Promise.all([
      import('shiki/bundle/full'),
      import('shiki/engine/javascript'),
    ]);
    known = new Set(Object.keys(bundledLanguages));
    highlighter = (await createHighlighter({
      themes: [THEMES.light, THEMES.dark],
      langs: [],
      engine: createJavaScriptRegexEngine({ forgiving: true }),
    })) as unknown as Highlighter;
  })();
  return starting;
}

function normalize(language: string | undefined): string {
  return (language ?? '').trim().toLowerCase();
}

/**
 * The highlighter when `language` is ready; otherwise null, and loading starts (it
 * resolves `whenLoaded`). Unknown languages and plain text resolve to null for good.
 */
function prepare(language: string): { highlighter: Highlighter } | { whenLoaded: Promise<void> } | null {
  if (NOT_HIGHLIGHTED.has(language) || failed.has(language)) return null;
  if (highlighter !== null && ready.has(language)) return { highlighter };
  if (highlighter !== null && !known.has(language)) return null;
  let pending = loading.get(language);
  if (pending === undefined) {
    pending = start()
      .then(async () => {
        if (!known.has(language)) throw new Error(`Unknown language ${language}`);
        await highlighter!.loadLanguage(language as never);
        ready.add(language);
      })
      .catch(() => {
        failed.add(language);
      })
      .finally(() => {
        loading.delete(language);
        codeRevision.update((revision) => revision + 1);
      });
    loading.set(language, pending);
  }
  return { whenLoaded: pending };
}

function tokens(api: Highlighter, code: string, language: string): ThemedToken[][] {
  return api.codeToTokens(code, { lang: language, themes: THEMES, defaultColor: false }).tokens;
}

function tokenStyle(token: ThemedToken): string {
  const style = token.htmlStyle;
  if (style === undefined) return token.color ? `color:${token.color}` : '';
  return typeof style === 'string'
    ? style
    : Object.entries(style)
        .map(([key, value]) => `${key}:${value}`)
        .join(';');
}

/** A highlighted `<pre>` for rendered Markdown, or null while (or if) not available. */
export function highlightedCodeHtml(code: string, language: string | undefined): string | null {
  const lang = normalize(language);
  const prepared = prepare(lang);
  if (prepared === null || !('highlighter' in prepared)) return null;
  const lines = tokens(prepared.highlighter, code.replace(/\n$/, ''), lang)
    .map((line) =>
      line.map((token) => `<span class="shiki-token" style="${escapeHtml(tokenStyle(token))}">${escapeHtml(token.content)}</span>`).join(''),
    )
    .join('\n');
  return `<pre data-language="${escapeHtml(lang)}"><code class="language-${escapeHtml(lang)}">${lines}</code></pre>\n`;
}

/** Load the grammars of every fenced block in a Markdown text (before exporting it). */
export async function prepareCode(markdown: string): Promise<void> {
  const languages = new Set([...markdown.matchAll(/^[ \t]{0,3}(?:```|~~~)[ \t]*([\w+#.-]+)/gm)].map((match) => normalize(match[1])));
  await Promise.all(
    [...languages].map((language) => {
      const prepared = prepare(language);
      return prepared !== null && 'whenLoaded' in prepared ? prepared.whenLoaded : undefined;
    }),
  );
}

/**
 * Parser for prosemirror-highlight (the editor): decorations for one code block, or a
 * promise while its grammar loads (the editor highlights again when it resolves).
 */
export function editorCodeParser(Decoration_: typeof Decoration) {
  return ({ content, language, pos }: { content: string; language?: string; pos: number; size: number }) => {
    const lang = normalize(language);
    const prepared = prepare(lang);
    if (prepared === null) return [];
    if (!('highlighter' in prepared)) return prepared.whenLoaded;
    const decorations: Decoration[] = [];
    let from = pos + 1;
    for (const line of tokens(prepared.highlighter, content, lang)) {
      for (const token of line) {
        const to = from + token.content.length;
        decorations.push(Decoration_.inline(from, to, { class: 'shiki-token', style: tokenStyle(token) }));
        from = to;
      }
      from += 1; // the line break
    }
    return decorations;
  };
}

let registered = false;

/** Highlight fenced code in `marked` output (idempotent; Mermaid blocks stay diagrams). */
export function registerMarkdownCode(): void {
  if (registered) return;
  registered = true;
  marked.use({
    renderer: {
      code(token) {
        const language = token.lang?.trim().split(/\s+/)[0];
        if (!language || normalize(language) === 'mermaid') return false;
        return highlightedCodeHtml(token.text, language) ?? false;
      },
    },
  });
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}
