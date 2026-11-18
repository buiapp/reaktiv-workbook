import type { CellDefinition, CellResult } from '../sheet.types';
import type { GraphNodeSize } from '../graph-layout';
import { isRichWidget } from '../input-widgets';

export function hasGraphOutput(
  cell: CellDefinition | undefined,
  result: CellResult | undefined,
): boolean {
  return (
    !!cell &&
    !!result &&
    !result.error &&
    !!(
      result.richOutput ||
      result.artifact?.mimeType.startsWith('image/') ||
      cell.kind === 'input' ||
      cell.kind === 'linked'
    )
  );
}

/** Size from output metadata only: never parse plot payloads or evaluate cells. */
export function graphOutputSizes(
  cells: readonly CellDefinition[],
  results: ReadonlyMap<string, CellResult>,
): ReadonlyMap<string, GraphNodeSize> {
  const sizes = new Map<string, GraphNodeSize>();
  for (const cell of cells) {
    const result = results.get(cell.id);
    if (!result || result.error) continue;
    if (result.richOutput || result.artifact?.mimeType.startsWith('image/')) {
      sizes.set(cell.id, { width: 320, height: 240 });
    } else if (cell.kind === 'input' || cell.kind === 'linked') {
      sizes.set(cell.id, {
        width: 280,
        height: isRichWidget(result.widget?.type ?? cell.view?.widget?.type ?? '') ? 190 : 120,
      });
    }
  }
  return sizes;
}

/** Avoid size invalidation when a value/spec changes without changing dimensions. */
export function sameNodeSizes(
  a: ReadonlyMap<string, GraphNodeSize>,
  b: ReadonlyMap<string, GraphNodeSize>,
): boolean {
  return (
    a.size === b.size &&
    [...a].every(
      ([id, size]) => size.width === b.get(id)?.width && size.height === b.get(id)?.height,
    )
  );
}
