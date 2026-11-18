/**
 * Images in notes are files next to the workbook:
 * `![Plan](assets/3f2a9c1e0b7d4a55.webp)`. Names are content hashes (the same image is stored
 * once, renaming a workbook breaks nothing); images are shrunk when they arrive. No SVG: it can
 * carry script, which runs when the file is opened directly.
 *
 * Pure helpers, no heavy imports (part of the initial bundle). The store that writes and shows
 * the files is `asset-store.ts`.
 */

export const ASSET_FOLDER = 'assets';
const ASSET_REF = /^assets\/([0-9a-f]{16}\.(?:webp|png|jpe?g|gif))$/;
const EXTENSIONS: Record<string, string> = {
  'image/webp': 'webp',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
};
export const IMAGE_TYPES = new Set(Object.keys(EXTENSIONS));
/** Longest side after shrinking: sharp on large screens, a fraction of a screenshot's bytes. */
export const MAX_IMAGE_SIDE = 1920;
const WEBP_QUALITY = 0.85;
/** Embedded images up to this size are kept as they are (see `shrinkIfLarge`). */
const KEEP_EMBEDDED_BYTES = 768 * 1024;

/** The file name of an asset reference (`assets/<name>`), or null for any other source. */
export function assetName(source: string): string | null {
  return ASSET_REF.exec(source)?.[1] ?? null;
}

export function assetRef(name: string): string {
  return `${ASSET_FOLDER}/${name}`;
}

/** Image sources in Markdown (`![alt](src "title")`) and HTML (`<img src="…">`), rewritten
 * where `replace` returns a new source (null keeps it). */
export function replaceImageSources(markdown: string, replace: (source: string) => string | null): string {
  return markdown
    .replace(/(!\[[^\]\n]*\]\()(<[^>\n]*>|[^)\s]+)((?:\s+"[^"\n]*")?\))/g, (match, open: string, source: string, close: string) => {
      const bare = source.startsWith('<') ? source.slice(1, -1) : source;
      const next = replace(bare);
      return next === null ? match : `${open}${next}${close}`;
    })
    .replace(/(<img\b[^>]*?\ssrc=")([^"]*)(")/gi, (match, open: string, source: string, close: string) => {
      const next = replace(source);
      return next === null ? match : `${open}${next}${close}`;
    });
}

/** Every image source in a note. */
export function imageSources(markdown: string): string[] {
  const found: string[] = [];
  replaceImageSources(markdown, (source) => {
    found.push(source);
    return null;
  });
  return found;
}

/** The asset files a note uses. */
export function referencedAssets(markdown: string): string[] {
  return [...new Set(imageSources(markdown).map(assetName).filter((name): name is string => name !== null))];
}

export function isEmbeddedImage(source: string): boolean {
  return /^data:image\/[a-z0-9.+-]+;base64,/i.test(source);
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');
  const type = /^data:([^;,]+)/.exec(dataUrl)?.[1] ?? 'application/octet-stream';
  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type });
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(String(reader.result)));
    reader.addEventListener('error', () => reject(reader.error ?? new Error('Could not read the image.')));
    reader.readAsDataURL(blob);
  });
}

/** `<first 16 hex of SHA-256>.<ext>`: the same image always gets the same name. */
export async function contentName(blob: Blob): Promise<string> {
  const extension = EXTENSIONS[blob.type];
  if (extension === undefined) throw new Error(`Not an image this app stores: ${blob.type || 'unknown type'}`);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
  const hex = [...digest.slice(0, 8)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex}.${extension}`;
}

/**
 * An embedded image found in a file: kept byte for byte when it is already small enough
 * (so the same image always gets the same name — a downloaded file reopens with its saved
 * outputs still pointing at it), otherwise shrunk.
 */
export async function shrinkIfLarge(blob: Blob): Promise<Blob> {
  if (blob.type === 'image/gif' || blob.size <= KEEP_EMBEDDED_BYTES) return blob;
  return shrinkImage(blob);
}

/**
 * A smaller copy for storing: at most `MAX_IMAGE_SIDE` pixels on the long side, as WebP. GIFs
 * (animation) are kept; so is the original when the copy is not smaller.
 */
export async function shrinkImage(blob: Blob): Promise<Blob> {
  if (blob.type === 'image/gif') return blob;
  if (typeof createImageBitmap !== 'function') return blob;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return blob; // not decodable here: store as it is
  }
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (context === null) return blob;
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const shrunk = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', WEBP_QUALITY));
  // Browsers without WebP encoding hand back PNG; keep whichever is smaller.
  return shrunk !== null && shrunk.size < blob.size ? shrunk : blob;
}
