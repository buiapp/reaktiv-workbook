import { IMAGE_TYPES } from './image-assets';

/** The first image among pasted or dropped files that notes can store (asset-store.ts). */
export function firstSupportedImage(files: FileList | undefined, items?: DataTransferItemList): File | undefined {
  const file = [...(files ?? [])].find(file => IMAGE_TYPES.has(file.type));
  if (file) return file;
  for (const item of items ?? []) {
    if (item.kind === 'file' && IMAGE_TYPES.has(item.type)) {
      const image = item.getAsFile();
      if (image) return image;
    }
  }
  return undefined;
}

export function hasSupportedImage(dataTransfer: DataTransfer | null): boolean {
  return [...(dataTransfer?.items ?? [])].some((item) => item.kind === 'file' && IMAGE_TYPES.has(item.type));
}
