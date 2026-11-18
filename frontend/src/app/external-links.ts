/**
 * Links to the outside (web, mail, phone) never navigate the app window: they open in a
 * new tab. In-app links (`#cell-A1`, `#sheet-input:…`, downloads) are left alone.
 */

const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);

/** The absolute URL when `href` points outside the app, else null. */
export function externalUrl(href: string | null, base: string = document.baseURI): string | null {
  if (href === null || href.trim() === '' || href.startsWith('#')) return null;
  let url: URL;
  try {
    url = new URL(href, base);
  } catch {
    return null;
  }
  if (!EXTERNAL_PROTOCOLS.has(url.protocol)) return null;
  // A link into the app itself (same origin) is not external.
  if (url.protocol.startsWith('http') && url.origin === new URL(base).origin) return null;
  return url.href;
}

export async function openExternal(url: string): Promise<void> {
  window.open(url, '_blank', 'noopener,noreferrer');
}

/**
 * Route every click on an external link through {@link openExternal}. A click that ends a
 * text selection (dragging across a link while editing) does not open it.
 */
export function installExternalLinkHandler(
  onError: (message: string) => void = () => undefined,
  open: (url: string) => Promise<void> = openExternal,
): () => void {
  const handle = (event: MouseEvent): void => {
    if (event.defaultPrevented || event.button > 1) return;
    const target = event.target instanceof Element ? event.target : null;
    const link = target?.closest<HTMLAnchorElement>('a[href]') ?? null;
    if (link === null || link.hasAttribute('download')) return;
    const url = externalUrl(link.getAttribute('href'));
    if (url === null) return;
    event.preventDefault();
    const selection = window.getSelection();
    if (selection !== null && !selection.isCollapsed && selection.toString().trim() !== '') return;
    open(url).catch((error: unknown) =>
      onError(`Could not open ${url}: ${error instanceof Error ? error.message : String(error)}`),
    );
  };
  document.addEventListener('click', handle, true);
  document.addEventListener('auxclick', handle, true);
  return () => {
    document.removeEventListener('click', handle, true);
    document.removeEventListener('auxclick', handle, true);
  };
}
