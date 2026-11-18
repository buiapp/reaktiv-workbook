/**
 * `<reaktiv-html data-spec="<base64 HTML>">` shows a cell's HTML output (`html("…")` or a
 * value with `_repr_html_`, see rich_output.py). The markup is sanitised with DOMPurify —
 * no scripts, event handlers, frames, forms, or external stylesheets — and rendered in a
 * shadow root: its `<style>` styles only this output, and the app's CSS stays out (text
 * properties such as font, colour, and `color-scheme` are inherited, so `light-dark()`
 * follows the theme). HTML that needs JavaScript is what anywidget is for.
 */
import DOMPurify from 'dompurify';
import { externalUrl, openExternal } from './external-links';
import { NOTE_LINK_PREFIX } from './note-links';

export const HTML_MIME_TYPE = 'text/html';

/** Fired (bubbling out of the shadow root) when a `#note-…` link inside HTML output is clicked. */
export const HTML_NOTE_LINK_EVENT = 'reaktiv-note-link';

export function isHtmlOutput(output: { mimeType: string } | undefined): boolean {
  return output?.mimeType === HTML_MIME_TYPE;
}

export function decodeHtmlOutput(dataBase64: string): string {
  const bytes = Uint8Array.from(atob(dataBase64), (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Markup without anything executable, keeping `<style>`, inline styles, and SVG. */
export function sanitizeHtmlOutput(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, svg: true, svgFilters: true },
    ADD_TAGS: ['style'],
    FORBID_TAGS: ['form', 'link', 'meta', 'base'],
    FORBID_ATTR: ['target'],
    // Keep a leading <style> (DOMPurify otherwise treats it as head content and drops it).
    FORCE_BODY: true,
  });
}

const BASE_STYLE = `<style>
  :host { display: block; max-width: 100%; overflow: auto; }
  img, svg, video { max-width: 100%; height: auto; }
</style>`;

class HtmlOutputElement extends HTMLElement {
  static observedAttributes = ['data-spec'];
  private readonly root = this.attachShadow({ mode: 'open' });
  private rendered = '';

  constructor() {
    super();
    // Links inside the shadow root: the app's document-level handlers only see the host.
    this.root.addEventListener('click', (event) => {
      const link = (event.target as Element | null)?.closest?.('a[href]');
      if (!(link instanceof HTMLAnchorElement)) return;
      event.preventDefault();
      const href = link.getAttribute('href') ?? '';
      const url = externalUrl(href);
      if (url !== null) {
        void openExternal(url);
      } else if (href.startsWith(NOTE_LINK_PREFIX)) {
        this.dispatchEvent(new CustomEvent(HTML_NOTE_LINK_EVENT, { bubbles: true, composed: true, detail: href }));
      }
    });
  }

  connectedCallback(): void {
    this.render();
  }

  attributeChangedCallback(): void {
    this.render();
  }

  private render(): void {
    const encoded = this.getAttribute('data-spec') ?? '';
    if (encoded === this.rendered) return;
    this.rendered = encoded;
    let markup = '';
    try {
      markup = encoded === '' ? '' : sanitizeHtmlOutput(decodeHtmlOutput(encoded));
    } catch {
      markup = '<p>Could not read this HTML output.</p>';
    }
    this.root.innerHTML = BASE_STYLE + markup;
  }
}

export function registerHtmlOutput(): void {
  if (typeof customElements !== 'undefined' && customElements.get('reaktiv-html') === undefined) {
    customElements.define('reaktiv-html', HtmlOutputElement);
  }
}
