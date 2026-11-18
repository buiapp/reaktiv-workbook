import rehypeParse from 'rehype-parse';
import rehypeRemark from 'rehype-remark';
import remarkGfm from 'remark-gfm';
import remarkHtml from 'remark-html';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';
import { findMath } from './markdown-math';
import { isNoteLayout, outputQuery, parseOutputQuery, type NoteLayout } from './note-layout';

export { isNoteLayout, NOTE_LAYOUTS, outputQuery, parseOutputQuery, type NoteLayout } from './note-layout';
import { MERMAID_FENCE } from './markdown-mermaid';

const markdownReader = unified().use(remarkParse).use(remarkGfm).use(remarkHtml);
const htmlReader = unified()
  .use(rehypeParse, { fragment: true })
  .use(rehypeRemark)
  .use(remarkGfm)
  .use(remarkStringify, {
    bullet: '-',
    fences: true,
    listItemIndent: 'one',
  });

/**
 * Markdown → editor HTML. Live values and input widgets become inline nodes the note
 * editor renders with current results (see note-nodes.ts):
 *
 * - `{{ expression }}` → `<span data-cell-value="expression">`
 * - `[{{ plot }}](#sheet-output?width=W&height=H&layout=wide)` → the same with data-width/
 *   height (a plot's size) and data-layout (`wide` or `full`: wider than the text column)
 * - `[Label: {{ x }}](#sheet-input:x?type=…)` → `<span data-sheet-widget="x" …>`
 *
 * They are swapped for plain tokens while Markdown is parsed, so Markdown syntax inside
 * an expression (`{{ a * b }}`) is never interpreted. Inside code blocks they stay text.
 */
export function markdownToHtml(markdown: string): string {
  const protectedImages = protectEmbeddedImages(markdown);
  const nodes = protectNoteNodes(protectedImages.content);
  const html = String(markdownReader.processSync(nodes.content));
  return protectedImages.restore(nodes.restoreHtml(html));
}

/** Editor HTML → Markdown; the inverse of {@link markdownToHtml}. */
export function htmlToMarkdown(html: string): string {
  const protectedImages = protectEmbeddedImages(annotateSizedImages(html));
  const nodes = protectNodeElements(protectedImages.content);
  return protectedImages
    .restore(nodes.restore(String(htmlReader.processSync(nodes.content))))
    .replace(/(\(#sheet-input:[^\s)]*)\\&/g, '$1&')
    .trimEnd();
}

const NODE_TOKEN = /REAKTIVNODE(\d+)TOKEN/g;

interface ProtectedNode {
  markdown: string;
  html: string;
}

function protectNoteNodes(markdown: string): {
  content: string;
  restoreHtml: (html: string) => string;
} {
  const nodes: ProtectedNode[] = [];
  const token = (node: ProtectedNode) => `REAKTIVNODE${nodes.push(node) - 1}TOKEN`;
  // Mermaid diagrams first (fenced code), then math (it may contain `{{ }}`), skipping
  // code where `$` is literal.
  const withDiagrams = markdown.replace(MERMAID_FENCE, (match, lead: string, _fence, source: string) =>
    lead + token({ markdown: match.slice(lead.length), html: `<div data-mermaid="${escapeAttribute(source.trim())}"></div>` }),
  );
  const content = protectMath(withDiagrams, (match, original, alone) =>
    token({
      markdown: original,
      html:
        match.display && alone
          ? `<div data-math-block="${escapeAttribute(match.latex)}"></div>`
          : `<span data-math="${escapeAttribute(match.latex)}"${match.display ? ' data-display="true"' : ''}></span>`,
    }),
  )
    .replace(
      /\[\{\{\s*([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?)\s*\}\}\]\(#sheet-output\?([^)\s]*)\)/g,
      (match, expression: string, query: string) => {
        const output = parseOutputQuery(query);
        return token({ markdown: match, html: cellValueHtml(expression, output.width, output.height, output.layout) });
      },
    )
    .replace(
      /\[([^\]]*?)\]\(#sheet-input:([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?)(\?[^)]*)?\)/g,
      (match, label: string, reference: string, query: string | undefined) =>
        token({
          markdown: match,
          html: `<span data-sheet-widget="${escapeAttribute(reference)}" data-label="${escapeAttribute(label)}" data-query="${escapeAttribute(query ?? '')}"></span>`,
        }),
    )
    .replace(/\{\{\s*([\s\S]*?)\s*\}\}/g, (match, expression: string) =>
      token({ markdown: match, html: cellValueHtml(expression.trim()) }),
    );
  const restoreHtml = (html: string) =>
    html
      // Code blocks hold text only: keep the original Markdown there.
      .replace(/<pre\b[\s\S]*?<\/pre>/g, (block) =>
        block.replace(NODE_TOKEN, (_match, index: string) => escapeText(nodes[Number(index)].markdown)),
      )
      // Display math on its own line is a block, not inside a paragraph.
      .replace(/<p>(REAKTIVNODE(\d+)TOKEN)<\/p>/g, (match, _token, index: string) =>
        nodes[Number(index)].html.startsWith('<div') ? nodes[Number(index)].html : match,
      )
      .replace(NODE_TOKEN, (_match, index: string) => nodes[Number(index)].html);
  return { content, restoreHtml };
}

/** Replace math outside code (fences and inline code spans) with `replace(match, original)`. */
function protectMath(
  markdown: string,
  replace: (match: ReturnType<typeof findMath>[number], original: string, alone: boolean) => string,
): string {
  const code: string[] = [];
  const masked = markdown.replace(/(^|\n)(```|~~~)[\s\S]*?\n\2[^\n]*|`[^`\n]+`/g, (block) => {
    code.push(block);
    return `REAKTIVCODE${code.length - 1}MASK`;
  });
  let result = '';
  let cursor = 0;
  for (const match of findMath(masked)) {
    // Display math alone on its line(s) is a block; inside a sentence it stays inline.
    const lineStart = masked.lastIndexOf('\n', match.start - 1) + 1;
    const lineEnd = masked.indexOf('\n', match.end);
    const alone =
      masked.slice(lineStart, match.start).trim() === '' &&
      masked.slice(match.end, lineEnd < 0 ? undefined : lineEnd).trim() === '';
    result += masked.slice(cursor, match.start) + replace(match, masked.slice(match.start, match.end), alone);
    cursor = match.end;
  }
  result += masked.slice(cursor);
  return result.replace(/REAKTIVCODE(\d+)MASK/g, (_match, index: string) => code[Number(index)]);
}

function cellValueHtml(expression: string, width?: string, height?: string, layout?: string): string {
  const size = width !== undefined && height !== undefined ? ` data-width="${width}" data-height="${height}"` : '';
  const wide = layout !== undefined ? ` data-layout="${layout}"` : '';
  return `<span data-cell-value="${escapeAttribute(expression)}"${size}${wide}></span>`;
}


/** Node elements (and literal `{{ … }}` text) → tokens, restored as Markdown after conversion. */
function protectNodeElements(html: string): { content: string; restore: (markdown: string) => string } {
  const markdown: string[] = [];
  const token = (value: string) => `REAKTIVNODE${markdown.push(value) - 1}TOKEN`;
  const content = html
    .replace(/<div\b([^>]*\bdata-mermaid=[^>]*)>\s*<\/div>/g, (_element, attributes: string) =>
      token('```mermaid\n' + (readAttributes(attributes)['data-mermaid'] ?? '') + '\n```'),
    )
    .replace(/<div\b([^>]*\bdata-math-block=[^>]*)>\s*<\/div>/g, (_element, attributes: string) =>
      token(`$$\n${readAttributes(attributes)['data-math-block'] ?? ''}\n$$`),
    )
    .replace(/<span\b([^>]*\bdata-math=[^>]*)>\s*<\/span>/g, (_element, attributes: string) => {
      const attrs = readAttributes(attributes);
      const latex = attrs['data-math'] ?? '';
      return token(attrs['data-display'] === 'true' ? `$$${latex}$$` : `$${latex}$`);
    })
    .replace(/<span\b([^>]*\bdata-(?:cell-value|sheet-widget)=[^>]*)>\s*<\/span>/g, (element, attributes: string) => {
      const attrs = readAttributes(attributes);
      if (attrs['data-sheet-widget'] !== undefined) {
        return token(
          `[${attrs['data-label'] ?? ''}](#sheet-input:${attrs['data-sheet-widget']}${attrs['data-query'] ?? ''})`,
        );
      }
      const expression = attrs['data-cell-value'] ?? '';
      const query = outputQuery(attrs['data-width'], attrs['data-height'], attrs['data-layout']);
      if (query !== '' && /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?$/.test(expression)) {
        return token(`[{{ ${expression} }}](#sheet-output?${query})`);
      }
      return element === '' ? '' : token(`{{ ${expression} }}`);
    })
    // `{{ … }}` typed as text (not yet a node) must not be escaped either.
    .replace(/\{\{[^<{}]*\}\}/g, (text) => token(unescapeHtml(text)));
  return {
    content,
    restore: (value) => value.replace(NODE_TOKEN, (_match, index: string) => markdown[Number(index)]),
  };
}

function readAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of source.matchAll(/([\w-]+)="([^"]*)"/g)) {
    attributes[match[1]] = unescapeHtml(match[2]);
  }
  return attributes;
}

function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function escapeText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function unescapeHtml(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&#x27;', "'")
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

/** An image's size and layout, kept in its Markdown title (`reaktiv-size:WxH reaktiv-layout:wide`). */
export interface MarkdownImageSize {
  width?: number;
  height?: number;
  layout?: NoteLayout;
}

export function markdownImageSizes(markdown: string): Array<MarkdownImageSize | null> {
  const sizes: Array<MarkdownImageSize | null> = [];
  walkMarkdown(markdownReader.parse(markdown) as MarkdownNode, (node) => {
    if (node.type !== 'image') return;
    const title = node.title ?? '';
    const size = /(?:^|\s)reaktiv-size:(\d+)x(\d+)(?=\s|$)/u.exec(title);
    const layout = /(?:^|\s)reaktiv-layout:(\w+)(?=\s|$)/u.exec(title)?.[1];
    sizes.push(
      size === null && !isNoteLayout(layout)
        ? null
        : {
            ...(size === null ? {} : { width: Number(size[1]), height: Number(size[2]) }),
            ...(isNoteLayout(layout) ? { layout } : {}),
          },
    );
  });
  return sizes;
}

interface MarkdownNode {
  type?: string;
  title?: string | null;
  children?: MarkdownNode[];
}

function walkMarkdown(node: MarkdownNode, visit: (node: MarkdownNode) => void): void {
  visit(node);
  for (const child of node.children ?? []) walkMarkdown(child, visit);
}

function annotateSizedImages(html: string): string {
  return html.replace(/<img\b[^>]*>/giu, (tag) => {
    const width = imageDimension(tag, 'width');
    const height = imageDimension(tag, 'height');
    const layout = /\bdata-layout=["'](\w+)["']/iu.exec(tag)?.[1];
    const parts = [
      ...(width !== null && height !== null ? [`reaktiv-size:${width}x${height}`] : []),
      ...(isNoteLayout(layout) ? [`reaktiv-layout:${layout}`] : []),
    ];
    if (parts.length === 0) return tag;
    const withoutTitle = tag.replace(/\s+title=(?:"[^"]*"|'[^']*')/iu, '');
    return withoutTitle.replace(/\s*\/?>$/u, ` title="${parts.join(' ')}">`);
  });
}

function imageDimension(tag: string, name: 'width' | 'height'): number | null {
  const match = new RegExp(`\\b${name}=["'](\\d+(?:\\.\\d+)?)["']`, 'iu').exec(tag);
  if (match === null) return null;
  const value = Math.round(Number(match[1]));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function protectEmbeddedImages(source: string): {
  content: string;
  restore: (value: string) => string;
} {
  const images: string[] = [];
  // Embedded images, and the blob:/asset: URLs note images are shown with while editing
  // (asset-store.ts): remark's sanitiser would drop any image that is not http(s).
  const content = source.replace(
    /data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+|blob:[^\s)"'<>]+|asset:\/\/[^\s)"'<>]+/giu,
    (dataUrl) => {
      const index = images.push(dataUrl) - 1;
      return `https://embedded-image.reaktiv.invalid/${index}`;
    },
  );
  return {
    content,
    restore: (value) =>
      images.reduce(
        (restored, dataUrl, index) =>
          restored.replaceAll(`https://embedded-image.reaktiv.invalid/${index}`, dataUrl),
        value,
      ),
  };
}
