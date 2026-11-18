import type { CellDefinition } from './sheet.types';
import { cellPosition, columnLabel } from './cell-selection';
import { splitCellId, qualifyCellId } from './sheet-file';

type Placement = Pick<CellDefinition, 'id' | 'view'>;

export function translateCellId(cellId: string, anchorId: string, targetId: string): string {
  const [column, row] = cellPosition(cellId);
  const [anchorColumn, anchorRow] = cellPosition(anchorId);
  const [targetColumn, targetRow] = cellPosition(targetId);
  return qualifyCellId(splitCellId(targetId)[0], `${columnLabel(column + targetColumn - anchorColumn)}${row + targetRow - anchorRow}`);
}

/** Shared by drag previews and actual drop validation. A single occupied drop swaps. */
export function planCellMove(cells: readonly CellDefinition[], sourceId: string, targetId: string, selection: readonly string[]) {
  const existing = new Set(cells.map(cell => cell.id));
  if (!existing.has(sourceId)) throw new Error(`Cell ${sourceId} no longer exists.`);
  const selected = selection.filter(id => existing.has(id));
  const movingIds = selected.includes(sourceId) && selected.length > 1 ? selected : undefined;
  const positions = new Map((movingIds ?? [sourceId]).map(id => [id, translateCellId(id, sourceId, targetId)]));
  if (!movingIds && sourceId !== targetId && existing.has(targetId)) positions.set(targetId, sourceId);
  for (const id of positions.values()) cellPosition(id);
  return {movingIds, positions};
}

export interface CellMovePreview {
  cells: CellDefinition[];
  message: string;
  invalid: boolean;
}

export function previewCellMove(cells: readonly CellDefinition[], sourceId: string, targetId: string, selection: readonly string[]): CellMovePreview {
  let moved: CellDefinition[] = [];
  try {
    const {movingIds, positions} = planCellMove(cells, sourceId, targetId, selection);
    moved = cells.filter(cell => positions.has(cell.id)).map(cell => ({...cell, id: positions.get(cell.id)!}));
    assertCellPlacements(cells.map(cell => positions.has(cell.id) ? {...cell, id: positions.get(cell.id)!} : cell), new Set(positions.values()));
    return {cells: moved, invalid: false, message: sourceId === targetId ? 'Keep current position' :
      !movingIds && positions.size > 1 ? `Swap ${sourceId} ↔ ${targetId}` : `Move ${movingIds?.length ?? 1} cell${movingIds ? 's' : ''} → ${targetId}`};
  } catch (error) {
    const source = cells.find(cell => cell.id === sourceId);
    return {cells: moved.length ? moved : source ? [{...source, id: targetId}] : [], invalid: true,
      message: error instanceof Error ? error.message : String(error)};
  }
}

/** Validate final, unclipped footprints, including cells with empty source. */
export function assertCellPlacements(cells: readonly Placement[], changedIds: ReadonlySet<string>): void {
  if (!changedIds.size) return;
  const anchors = new Set<string>();
  for (const cell of cells) {
    if (anchors.has(cell.id)) throw new Error(`Cell ${cell.id} would overwrite another cell. Choose an empty area.`);
    anchors.add(cell.id);
  }
  const rectangles = cells.map(cell => {
    const [left, top] = cellPosition(cell.id), [width, height] = cell.view?.span ?? [1, 1];
    return { id: cell.id, sheet: splitCellId(cell.id)[0], left, top, right: left + width, bottom: top + height };
  });
  const sheets = new Map<string, typeof rectangles>();
  for (const rectangle of rectangles) {
    const sheet = sheets.get(rectangle.sheet) ?? [];
    sheet.push(rectangle); sheets.set(rectangle.sheet, sheet);
  }
  for (const candidate of rectangles) {
    if (!changedIds.has(candidate.id)) continue;
    for (const other of sheets.get(candidate.sheet) ?? []) {
      if (candidate.id === other.id) continue;
      if (candidate.left < other.right && other.left < candidate.right && candidate.top < other.bottom && other.top < candidate.bottom)
        throw new Error(`Cell ${candidate.id} would overlap cell ${other.id}. Choose an empty area outside resized cells.`);
    }
  }
}

/** Source-only changes do not make legacy overlaps prevent unrelated editing. */
export function assertChangedCellPlacements(before: readonly Placement[], after: readonly Placement[]): void {
  const previous = new Map(before.map(cell => [cell.id, cell]));
  const changed = new Set(after.filter(cell => {
    const old = previous.get(cell.id), span = cell.view?.span ?? [1, 1], oldSpan = old?.view?.span ?? [1, 1];
    return !old || span[0] !== oldSpan[0] || span[1] !== oldSpan[1];
  }).map(cell => cell.id));
  assertCellPlacements(after, changed);
}
