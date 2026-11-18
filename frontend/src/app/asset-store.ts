import { Injectable, signal } from '@angular/core';
import {
  IMAGE_TYPES,
  assetName,
  assetRef,
  blobToDataUrl,
  contentName,
  dataUrlToBlob,
  isEmbeddedImage,
  imageSources,
  referencedAssets,
  replaceImageSources,
  shrinkIfLarge,
  shrinkImage,
} from './image-assets';
import type { CellDefinition } from './sheet.types';

/** Larger images are refused before shrinking (they would not fit in memory comfortably). */
const MAX_INPUT_BYTES = 40 * 1024 * 1024;
const DATABASE = 'reaktiv-workbook-assets';
const STORE = 'images';

/**
 * The images of the open workbook.
 *
 * Images wait in memory and IndexedDB (so a draft survives a reload) and are shown as blob
 * URLs. A CLI session's save sends them to Python, which writes `<workbook folder>/assets/`;
 * the web app downloads a ZIP with the workbook and its assets as separate files.
 *
 * Notes always hold `assets/<name>`; `toDisplay`/`fromDisplay` swap in the URL the web view can
 * show while the editor or the renderer works with the HTML.
 */
@Injectable({ providedIn: 'root' })
export class AssetStore {
  /** Bumped when an image becomes showable later (loaded from IndexedDB): re-render notes. */
  readonly revision = signal(0);
  private readonly blobs = new Map<string, Blob>();
  private readonly urls = new Map<string, string>();
  private readonly refsByUrl = new Map<string, string>();
  private readonly loading = new Set<string>();
  /** Imported data/blob image source → its durable asset reference. */
  private readonly embeddedRefs = new Map<string, string>();
  private readonly importing = new Map<string, Promise<string>>();

  memoryDiagnostics():object {
    return {blobCount:this.blobs.size,blobBytes:[...this.blobs.values()].reduce((n,b)=>n+b.size,0),
      urlCount:this.urls.size,blobUrlCount:[...this.urls.values()].filter(u=>u.startsWith('blob:')).length,
      embeddedSourceChars:[...this.embeddedRefs.keys()].reduce((n,s)=>n+s.length,0)};
  }

  /** Store a pasted or dropped image; returns the reference to put in the note. */
  async add(file: Blob, assertCurrent: () => void = () => {}): Promise<string> {
    if (!IMAGE_TYPES.has(file.type)) throw new Error('Use a PNG, JPEG, GIF, or WebP image.');
    if (file.size > MAX_INPUT_BYTES) throw new Error('Images are limited to 40 MB.');
    const image = await shrinkImage(file);
    const name = await contentName(image);
    assertCurrent();
    this.blobs.set(name, image);
    await putPending(name, image);
    assertCurrent();
    return assetRef(name);
  }

  /** The URL that shows an asset now, or null (unknown here, or still loading). */
  displayUrl(name: string): string | null {
    const known = this.urls.get(name);
    if (known !== undefined) return known;
    let url: string | null = null;
    const blob = this.blobs.get(name);
    if (blob !== undefined) url = URL.createObjectURL(blob);
    else void this.loadPending(name);
    if (url !== null) {
      this.urls.set(name, url);
      this.refsByUrl.set(url, assetRef(name));
    }
    return url;
  }

  /** Markdown with `assets/<name>` replaced by URLs the web view can show. */
  toDisplay(markdown: string): string {
    return replaceImageSources(markdown, (source) => {
      const name = assetName(source);
      return name === null ? null : this.displayUrl(name);
    });
  }

  /** The inverse of `toDisplay`: shown URLs back to `assets/<name>`. */
  fromDisplay(markdown: string): string {
    if (this.refsByUrl.size === 0) return markdown;
    return replaceImageSources(markdown, (source) => this.refsByUrl.get(source) ?? null);
  }

  /** Only images referenced by this workbook, for a browser download. Never silently lose one. */
  async filesForDownload(cells: readonly CellDefinition[]): Promise<Map<string, Blob>> {
    const names = new Set(cells.flatMap(cell => cell.kind === 'markdown' ? referencedAssets(cell.source) : []));
    const files = new Map<string, Blob>();
    for (const name of names) {
      const blob = await this.blob(name);
      if (blob === undefined) throw new Error(`Image assets/${name} is missing. Restore the image before saving.`);
      files.set(assetRef(name), blob);
    }
    return files;
  }

  /** Restore original image bytes from a workbook ZIP without resizing or changing names. */
  async importFiles(files: ReadonlyMap<string, Blob>): Promise<void> {
    for (const [reference, blob] of files) {
      const name = assetName(reference);
      if (name === null || blob.size > MAX_INPUT_BYTES || await contentName(blob) !== name) {
        throw new Error(`Invalid workbook image: ${reference}`);
      }
    }
    for (const [reference, blob] of files) {
      const name = assetName(reference)!;
      this.blobs.set(name, blob);
      await putPending(name, blob);
    }
    this.revision.update(value => value + 1);
  }

  /** A note with its asset references as data URLs (HTML exports and print only). */
  async inline(markdown: string): Promise<string> {
    const urls = new Map<string, string>();
    for (const name of referencedAssets(markdown)) {
      const blob = await this.blob(name);
      if (blob !== undefined) urls.set(name, await blobToDataUrl(blob));
    }
    return replaceImageSources(markdown, (source) => {
      const name = assetName(source);
      return name === null ? null : (urls.get(name) ?? null);
    });
  }

  /** Convert temporary clipboard/display images to durable, content-addressed assets.
   * Only data/blob URLs are imported; ordinary remote image links stay links.
   */
  async importImageSource(source: string): Promise<string> {
    return this.importTemporaryImage(source);
  }

  private async importTemporaryImage(source: string): Promise<string> {
    const known = this.refsByUrl.get(source) ?? this.embeddedRefs.get(source);
    if (known !== undefined) return known;
    if (assetName(source) !== null) return source;
    if (!isEmbeddedImage(source) && !/^blob:/i.test(source)) throw new Error('Not a temporary image URL.');
    const pending = this.importing.get(source);
    if (pending) return pending;
    const importing = (async () => {
      let blob: Blob;
      if (isEmbeddedImage(source)) blob = dataUrlToBlob(source);
      else {
        try {
          const response = await fetch(source, {signal: AbortSignal.timeout(10000)});
          if (!response.ok) throw new Error('Image unavailable');
          blob = await response.blob();
        } catch {
          throw new Error('A temporary pasted image is no longer available. Paste the image again before saving.');
        }
      }
      if (!IMAGE_TYPES.has(blob.type)) throw new Error('Use a PNG, JPEG, GIF, or WebP image.');
      if (blob.size > MAX_INPUT_BYTES) throw new Error('Images are limited to 40 MB.');
      const image = await shrinkIfLarge(blob);
      const name = await contentName(image);
      this.blobs.set(name, image);
      const reference = assetRef(name);
      // Kept pending until the save writes it, including recovered drafts.
      await putPending(name, image);
      this.embeddedRefs.set(source, reference);
      if (/^blob:/i.test(source)) this.refsByUrl.set(source, reference);
      return reference;
    })();
    this.importing.set(source, importing);
    try { return await importing; }
    finally { this.importing.delete(source); }
  }

  /** Old embedded images and leaked blob URLs are normalized before saving. */
  async extractEmbedded(cells: readonly CellDefinition[]): Promise<CellDefinition[]> {
    return Promise.all(cells.map(async cell => {
      if (cell.kind !== 'markdown') return cell;
      const canonical = this.fromDisplay(cell.source);
      const replacements = new Map<string,string>();
      for (const source of imageSources(canonical)) {
        if (isEmbeddedImage(source) || /^blob:/i.test(source)) {
          replacements.set(source, await this.importImageSource(source));
        }
      }
      const source = replaceImageSources(canonical, value => replacements.get(value) ?? null);
      return source === cell.source ? cell : {...cell,source};
    }));
  }

  /** Saved note outputs use the same durable references as normalized note source. */
  replaceEmbedded(text: string): string {
    const canonical = this.fromDisplay(text);
    if (this.embeddedRefs.size === 0) return canonical;
    return replaceImageSources(canonical, source => this.embeddedRefs.get(source) ?? null);
  }

  private async blob(name: string): Promise<Blob | undefined> {
    const known = this.blobs.get(name) ?? (await getPending(name));
    if (known !== undefined) return known;
    const url = this.displayUrl(name);
    if (url === null) return undefined;
    try {
      const response = await fetch(url);
      return response.ok ? await response.blob() : undefined;
    } catch {
      return undefined;
    }
  }

  private async loadPending(name: string): Promise<void> {
    if (this.loading.has(name)) return;
    this.loading.add(name);
    try {
      const blob = await getPending(name);
      if (blob !== undefined && !this.blobs.has(name)) {
        this.blobs.set(name, blob);
        // Show it from memory from now on (a file URL may point at nothing yet).
        const url = this.urls.get(name);
        if (url !== undefined && !url.startsWith('blob:')) {
          this.urls.delete(name);
          // Keep translating an older editor DOM URL until it is refreshed.
        }
        this.revision.update((value) => value + 1);
      }
    } finally {
      this.loading.delete(name);
    }
  }
}

// -- IndexedDB: images that are not in a file yet ------------------------------------------

function database(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null); // private mode, blocked storage: memory only
  });
}

async function putPending(name: string, blob: Blob): Promise<void> {
  const db = await database();
  if (db === null) return;
  await new Promise<void>((resolve) => {
    const transaction = db.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).put(blob, name);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => resolve();
  });
  db.close();
}

async function getPending(name: string): Promise<Blob | undefined> {
  const db = await database();
  if (db === null) return undefined;
  const blob = await new Promise<Blob | undefined>((resolve) => {
    const request = db.transaction(STORE).objectStore(STORE).get(name);
    request.onsuccess = () => resolve(request.result instanceof Blob ? request.result : undefined);
    request.onerror = () => resolve(undefined);
  });
  db.close();
  return blob;
}
