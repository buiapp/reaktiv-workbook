import type { CellResult } from '../sheet.types';

const MAX_BASE64 = 7 * 1024 * 1024;

/** Capture only an explicitly requested cell/note, never the surrounding app. No Python runs. */
export async function inspectVisualCell(id: string, pane: number | undefined, result?: CellResult): Promise<Record<string, unknown>> {
  const candidates = [...document.querySelectorAll<HTMLElement>('[data-agent-cell-id], app-markdown-cell-editor[data-cell-id]')]
    .filter(node => (node.dataset['agentCellId'] ?? node.dataset['cellId']) === id &&
      (pane === undefined || Number(node.dataset['agentPane']) === pane));
  const element = candidates.find(node => {
    const box = node.getBoundingClientRect();
    return getComputedStyle(node).visibility !== 'hidden' && node.getClientRects().length && box.width > 0 && box.height > 0 &&
      box.right > 0 && box.bottom > 0 && box.left < innerWidth && box.top < innerHeight;
  });
  if (!element) {
    const rich = result?.richOutput;
    if (!rich) throw new Error('Cell/note is not visible and has no image/chart output. Open it in the app, then inspect again.');
    let url = `data:${rich.mimeType};base64,${rich.dataBase64}`;
    if (rich.mimeType === 'application/vnd.plotly.v1+json') {
      const {plotlySpecsToPng} = await import('../plotly-figure');
      url = await plotlySpecsToPng(`<img src="${url}">`);
      url = /src="([^"]+)"/.exec(url)?.[1] ?? '';
    }
    if (!/^data:image\/(png|jpeg|webp|svg\+xml);base64,/.test(url)) throw new Error('This output needs a visible cell for visual inspection.');
    const image = new Image(); image.src = url; await image.decode();
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image rendering is unavailable.');
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return imageReply(canvas.toDataURL('image/png'), id, 'rendered-output', canvas.width, canvas.height,
      ['Output preview only; this does not prove that the cell fits its grid span.']);
  }
  const warnings: string[] = [];
  if (element.querySelector('iframe')) warnings.push('Sandboxed iframe/anywidget internals are omitted.');
  const plots = [...element.querySelectorAll<HTMLElement>('reaktiv-plotly')];
  if (plots.some(plot => (plot as HTMLElement & {renderStatus?: string}).renderStatus !== 'ready'))
    throw new Error('Plot rendering is pending or failed; inspect again after rendering.');
  if ([...element.querySelectorAll('img')].some(image => !image.complete || !image.naturalWidth))
    throw new Error('An image is still loading or failed; no complete capture is available.');
  const width = element.clientWidth, height = element.clientHeight;
  if (!width || !height || width * height > 8_000_000) throw new Error('Cell/note is too large to capture. Inspect a smaller cell or reduce the note size.');
  const {toPng} = await import('html-to-image');
  const scale = Math.min(1, 1600 / Math.max(width, height));
  const png = await toPng(element, {
    pixelRatio: scale, skipFonts: true, backgroundColor: getComputedStyle(document.body).backgroundColor,
    filter: node => !(node instanceof HTMLElement && ['IFRAME', 'APP-AGENT-CELL-FEEDBACK'].includes(node.tagName)),
    style: {transform: 'none', zoom: '1', animation: 'none'},
  });
  warnings.push('DOM rasterization may differ from native rendering; cross-origin images and WebGL canvases may be unavailable.');
  return imageReply(png, id, 'visible-cell', Math.round(width * scale), Math.round(height * scale), warnings);
}

function imageReply(url: string, id: string, captureKind: string, width: number, height: number, warnings: string[]): Record<string, unknown> {
  const dataBase64 = url.split(',')[1];
  if (!dataBase64 || dataBase64.length > MAX_BASE64) throw new Error('Visual capture exceeds 5 MB; inspect a smaller cell.');
  return {cellId: id, captureKind, width, height, mimeType: 'image/png', dataBase64, warnings};
}
