/** File names and bundled-example URLs, without filesystem or kernel access. */

/**
 * New workbooks are saved as `name.workbook.py`. Files from before the Reaktiv Workbook
 * rename (`name.sheet.py`) keep opening and saving under their own name.
 */
export const WORKBOOK_SUFFIX = '.workbook.py';

/** Matches the end of a workbook file name: `.workbook.py` or the legacy `.sheet.py`. */
export const WORKBOOK_FILE_SUFFIX = /\.(?:workbook|sheet)\.py$/i;

export function isWorkbookFileName(name: string): boolean {
  return WORKBOOK_FILE_SUFFIX.test(name);
}

export function exampleAssetUrl(name: string, baseUri: string): string {
  // Examples may live in a subfolder (`education/…`): encode each path segment.
  const path = name.split('/').map(encodeURIComponent).join('/');
  return new URL(`./examples/${path}`, baseUri).href;
}

/**
 * A file in an `examples` folder (the app's bundled examples and courses, or a repository
 * checkout): treated as a template, so Save asks where to save a copy instead of overwriting it.
 */
export function isExampleFile(path: string | null): boolean {
  return path !== null && /[\\/]examples[\\/](?:[^\\/]+[\\/])?[^\\/]+\.(?:workbook|sheet)\.py$/i.test(path);
}

export function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/u).pop() || path;
}

export function fileStem(name: string): string {
  const stem = name
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return stem || 'untitled';
}
