/**
 * Mermaid diagrams in notes: a ```mermaid fenced code block renders as a diagram
 * (flowcharts, sequence, state, class, gantt, …).
 *
 * Mermaid renders asynchronously and is large, so it is loaded on first use and every
 * rendered SVG is cached by (theme, source). Markdown renderers (`marked`) are
 * synchronous: they use the cached SVG when present, otherwise show the source and start
 * rendering; `mermaidRevision` changes when new diagrams are ready so callers re-render.
 * `{{ }}` values inside the source are substituted before rendering (by the engine for
 * rendered notes, by the note editor for live editing), so diagrams can be data-driven.
 */
import { signal } from '@angular/core';
import { marked } from 'marked';

type MermaidApi = typeof import('mermaid').default;

let mermaid: Promise<MermaidApi> | null = null;
let initializedTheme: string | null = null;
let nextId = 0;
const cache = new Map<string, string>();
const rendering = new Map<string, Promise<string>>();

export function mermaidMemoryDiagnostics():object {
  return {entries:cache.size,pending:rendering.size,
    sourceChars:[...cache.keys()].reduce((n,s)=>n+s.length,0),
    svgChars:[...cache.values()].reduce((n,s)=>n+s.length,0)};
}

export const mermaidRevision = signal(0);

function theme(): 'dark' | 'default' {
  const forced = document.documentElement.dataset['theme'];
  if (forced === 'light' || forced === 'dark') return forced === 'dark' ? 'dark' : 'default';
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'default';
}

function load(): Promise<MermaidApi> {
  mermaid ??= import('mermaid').then((module) => module.default);
  return mermaid;
}

/** SVG of a diagram (or an error message), rendered once per theme and source. */
export async function renderMermaid(source: string): Promise<string> {
  const current = theme();
  const key = `${current}\n${source}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const pending = rendering.get(key);
  if (pending !== undefined) return pending;
  const task = (async () => {
    let svg: string;
    try {
      const api = await load();
      if (initializedTheme !== current) {
        api.initialize({
          startOnLoad: false,
          theme: current,
          securityLevel: 'strict',
          // A concrete font (not `inherit`): Mermaid measures labels with it.
          fontFamily: getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif',
        });
        initializedTheme = current;
      }
      svg = (await api.render(`reaktiv-mermaid-${nextId++}`, source)).svg;
    } catch (error) {
      svg = `<pre class="mermaid-error">${escapeHtml(`Diagram error: ${error instanceof Error ? error.message : String(error)}`)}</pre>`;
    }
    cache.set(key, svg);
    rendering.delete(key);
    mermaidRevision.update((revision) => revision + 1);
    return svg;
  })();
  rendering.set(key, task);
  return task;
}

/** The cached SVG of a diagram, or undefined (and rendering starts in the background). */
export function cachedMermaid(source: string): string | undefined {
  const cached = cache.get(`${theme()}\n${source}`);
  if (cached === undefined) void renderMermaid(source);
  return cached;
}

/** Render every diagram in a Markdown text, so a synchronous render finds them cached. */
export async function prepareMermaid(markdown: string): Promise<void> {
  await Promise.all([...markdown.matchAll(MERMAID_FENCE)].map((match) => renderMermaid(match[3].trim())));
}

/** ```mermaid … ``` (or ~~~) fenced blocks. */
export const MERMAID_FENCE = /(^|\n)[ \t]{0,3}(```|~~~)mermaid[ \t]*\n([\s\S]*?)\n[ \t]{0,3}\2[ \t]*(?=\n|$)/g;

export function mermaidHtml(source: string): string {
  const svg = cachedMermaid(source);
  return svg === undefined
    ? `<pre class="mermaid-pending"><code>${escapeHtml(source)}</code></pre>`
    : `<div class="mermaid-diagram">${svg}</div>`;
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

let registered = false;

/** Make ```mermaid code blocks render as diagrams in `marked` (idempotent). */
export function registerMarkdownMermaid(): void {
  if (registered) return;
  registered = true;
  marked.use({
    renderer: {
      code(token) {
        return token.lang?.trim() === 'mermaid' ? `${mermaidHtml(token.text.trim())}\n` : false;
      },
    },
  });
}

registerMarkdownMermaid();

// Switching light/dark redraws diagrams in the matching Mermaid theme (the cache is keyed
// by theme; bumping the revision makes every view look up its diagram again).
if (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined') {
  const themeChanged = () => mermaidRevision.update((revision) => revision + 1);
  new MutationObserver(themeChanged).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
  if (typeof matchMedia === 'function') {
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', themeChanged);
  }
}
