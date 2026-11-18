import { cellPosition } from './cell-selection';
import { spanOf } from './dashboard';
import { splitCellId } from './sheet-file';
import type { CellDefinition } from './sheet.types';

export interface ConnectionSettings {
  upstream: boolean;
  downstream: boolean;
  depth: number;
}
export interface CellConnection {
  from: string;
  to: string;
  direction: 'upstream' | 'downstream';
  distance: number;
}
export interface CellBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Follow each direction independently; cycles never extend the requested depth. */
export function traceCellConnections(
  selected: string,
  dependencies: Record<string, string[]>,
  settings: ConnectionSettings,
  limit = 300,
): { edges: CellConnection[]; truncated: boolean } {
  if (settings.depth <= 0) return { edges: [], truncated: false };
  const edges = new Map<string, CellConnection>();
  const reverse = new Map<string, string[]>();
  if (settings.downstream)
    for (const [id, reads] of Object.entries(dependencies)) {
      for (const read of new Set(reads)) {
        const consumers = reverse.get(read);
        if (consumers) consumers.push(id);
        else reverse.set(read, [id]);
      }
    }
  for (const direction of ['upstream', 'downstream'] as const) {
    if (!settings[direction]) continue;
    const visited = new Set([selected]);
    const queue = [{ id: selected, distance: 0 }];
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const { id, distance } = queue[cursor];
      if (distance >= settings.depth) continue;
      const neighbors =
        direction === 'upstream' ? (dependencies[id] ?? []) : (reverse.get(id) ?? []);
      for (const neighbor of neighbors) {
        const from = direction === 'upstream' ? neighbor : id;
        const to = direction === 'upstream' ? id : neighbor;
        const key = `${from}\0${to}`;
        if (!edges.has(key)) {
          if (edges.size >= limit) return { edges: [...edges.values()], truncated: true };
          edges.set(key, { from, to, direction, distance: distance + 1 });
        }
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push({ id: neighbor, distance: distance + 1 });
        }
      }
    }
  }
  return { edges: [...edges.values()], truncated: false };
}

/** Match the grid's actual tracks, including resized columns/rows and dashboard spans. */
export function connectionBoxes(
  cells: readonly CellDefinition[],
  sheet: string,
  columns: readonly string[],
  rows: readonly number[],
  widths: Record<string, number>,
  heights: Record<string, number>,
): Map<string, CellBox> {
  const xs = [38],
    ys = [32];
  for (const column of columns) xs.push(xs.at(-1)! + (widths[column] ?? 112));
  for (const row of rows) ys.push(ys.at(-1)! + (heights[String(row)] ?? 45));
  const boxes = new Map<string, CellBox>();
  for (const cell of cells) {
    if (splitCellId(cell.id)[0] !== sheet) continue;
    const [column, row] = cellPosition(cell.id);
    if (column > columns.length || row > rows.length) continue;
    const [spanColumns, spanRows] = spanOf(cell, columns.length, rows.length);
    boxes.set(cell.id, {
      x: xs[column - 1],
      y: ys[row - 1],
      width: xs[column - 1 + spanColumns] - xs[column - 1],
      height: ys[row - 1 + spanRows] - ys[row - 1],
    });
  }
  return boxes;
}

/** End slightly inside each border so even neighboring cells have a visible arrow. */
export function connectionCurve(from: CellBox, to: CellBox): string {
  const dx = to.x + to.width / 2 - from.x - from.width / 2;
  const dy = to.y + to.height / 2 - from.y - from.height / 2;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const sign = dx >= 0 ? 1 : -1;
    const sx = from.x + (sign > 0 ? from.width - 8 : 8),
      sy = from.y + from.height / 2;
    const tx = to.x + (sign > 0 ? 8 : to.width - 8),
      ty = to.y + to.height / 2;
    const bend = Math.min(
      80,
      Math.max(20, Math.abs(tx - sx) / 5),
      Math.max(8, Math.min(sy, ty) - 36),
    );
    return `M ${sx} ${sy} C ${sx + (tx - sx) / 3} ${sy - bend}, ${tx - (tx - sx) / 3} ${ty - bend}, ${tx} ${ty}`;
  }
  const sign = dy >= 0 ? 1 : -1;
  const sx = from.x + from.width / 2,
    sy = from.y + (sign > 0 ? from.height - 8 : 8);
  const tx = to.x + to.width / 2,
    ty = to.y + (sign > 0 ? 8 : to.height - 8);
  const bend = Math.min(
    80,
    Math.max(20, Math.abs(ty - sy) / 5),
    Math.max(8, Math.min(from.width, to.width) / 2 - 8),
  );
  return `M ${sx} ${sy} C ${sx + bend} ${sy + (ty - sy) / 3}, ${tx + bend} ${ty - (ty - sy) / 3}, ${tx} ${ty}`;
}
