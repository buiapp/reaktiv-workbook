/** Lazy-loaded browser transport. The workbook itself stays ordinary Python with file references. */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { assetName } from './image-assets';
import { isWorkbookFileName } from './files/workbook-paths';

const MAX_ARCHIVE_BYTES = 128 * 1024 * 1024;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const IMAGE_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
};

export async function createWorkbookArchive(
  filename: string, source: string, outputs: string | undefined, assets: ReadonlyMap<string, Blob>,
): Promise<Blob> {
  const files: Record<string, Uint8Array> = { [filename]: strToU8(source) };
  if (outputs !== undefined) files[`${filename}.snapshot.json`] = strToU8(outputs);
  for (const [name, blob] of assets) files[name] = new Uint8Array(await blob.arrayBuffer());
  if (Object.values(files).some(bytes => bytes.length > MAX_FILE_BYTES)) {
    throw new Error('Workbook ZIP files are limited to 64 MB per file. Try saving without outputs.');
  }
  // Images are already compressed. Store without deflating to avoid blocking the UI on large plots.
  const bytes = zipSync(files, { level: 0 });
  if (bytes.length > MAX_ARCHIVE_BYTES) throw new Error('Workbook ZIP files are limited to 128 MB. Try saving without outputs.');
  return new Blob([bytes], { type: 'application/zip' });
}

export async function readWorkbookArchive(file: Blob): Promise<{
  filename: string; source: string; outputs: string | null; assets: Map<string, Blob>;
}> {
  if (file.size > MAX_ARCHIVE_BYTES) throw new Error('Workbook ZIP files are limited to 128 MB.');
  let total = 0;
  const files = unzipSync(new Uint8Array(await file.arrayBuffer()), {
    filter: entry => {
      // Never extract arbitrary paths. Bounds apply before allocating decompressed entries.
      if (!/^[^/\\]+\.(?:workbook|sheet)\.py(?:\.snapshot\.json)?$/.test(entry.name) && assetName(entry.name) === null) return false;
      total += entry.originalSize;
      if (entry.originalSize > MAX_FILE_BYTES || total > MAX_ARCHIVE_BYTES) {
        throw new Error('The workbook ZIP contains too much data (128 MB total, 64 MB per file).');
      }
      return true;
    },
  });
  const workbooks = Object.keys(files).filter(isWorkbookFileName);
  if (workbooks.length !== 1) throw new Error('Select a ZIP containing exactly one .workbook.py workbook.');
  const filename = workbooks[0];
  const assets = new Map<string, Blob>();
  for (const [name, bytes] of Object.entries(files)) {
    const asset = assetName(name);
    if (asset !== null) assets.set(name, new Blob([bytes], { type: IMAGE_MIME[asset.split('.').pop()!] }));
  }
  return {
    filename, source: strFromU8(files[filename]),
    outputs: files[`${filename}.snapshot.json`] === undefined ? null : strFromU8(files[`${filename}.snapshot.json`]),
    assets,
  };
}
