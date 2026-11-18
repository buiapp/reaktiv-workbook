/**
 * Dependency graph view: which cells to show and where. Pure helpers; the app wires
 * them to signals.
 *
 * Large workbooks become unreadable as one picture, so the view can focus on the
 * selected cell (what feeds it, what it affects — like "trace precedents/dependents"
 * in spreadsheets), hide notes (they reference many cells), and stay on one sheet.
 * The layout defaults to left to right, with an optional top-to-bottom direction; inputs sit just before their first consumer.
 * Nodes in a layer are ordered to
 * reduce edge crossings, and edges are curves so parallel edges stay distinguishable.
 */
import { splitCellId } from './sheet-file';
import type { CellDefinition, CellKind } from './sheet.types';

export const NODE_WIDTH = 176;
export const NODE_HEIGHT = 62;
const LAYER_GAP = 90;
const NODE_GAP = 20;
const PADDING = 32;
const ORDERING_SWEEPS = 6;

export interface GraphNodeSize { width: number; height: number; }

export type GraphDirection = 'horizontal' | 'vertical';

export interface GraphOptions {
  direction?: GraphDirection;
  inputsFirst?: boolean;
  nodeSizes?: ReadonlyMap<string, GraphNodeSize>;
  /** Show only cells connected to this one (upstream and downstream). */
  focus?: string | null;
  /** How many steps from the focus in each direction; Infinity = the whole chain. */
  depth?: number;
  hideNotes?: boolean;
  hideText?: boolean;
  /** No observed edges to any other known cell, before display filters are applied. */
  hideIsolated?: boolean;
  onlyIds?: ReadonlySet<string> | null;
  /** Show only this sheet ('' = first sheet); null = all sheets. */
  sheet?: string | null;
}

export type EdgeRelation = 'upstream' | 'downstream' | null;

export interface GraphNode {
  id: string;
  kind: CellKind;
  isolated: boolean;
  width: number;
  height: number;
  x: number;
  y: number;
  /** Position relative to the focus cell. */
  relation: 'focus' | 'upstream' | 'downstream' | null;
}

export interface GraphEdge {
  from: string;
  to: string;
  /** SVG path between card boundaries in the selected direction. */
  path: string;
  relation: EdgeRelation;
}

export interface GraphLayout {
  direction?: GraphDirection;
  inputsFirst?: boolean;
  nodes: GraphNode[];
  edges: GraphEdge[];
  width: number;
  height: number;
  /** Cells left out by the options (for "showing 8 of 40"). */
  hidden: number;
  total: number;
}

/** Cells within `depth` steps upstream (dependencies) and downstream (dependents). */
export function neighborhood(
  dependencies: Record<string, string[]>,
  focus: string,
  depth = Infinity,
): { upstream: Set<string>; downstream: Set<string> } {
  const dependents = new Map<string, string[]>();
  for (const [cell, parents] of Object.entries(dependencies)) {
    for (const parent of parents) dependents.set(parent, [...(dependents.get(parent) ?? []), cell]);
  }
  const walk = (next: (id: string) => readonly string[]) => {
    const seen = new Set<string>();
    let frontier = [focus];
    for (let step = 0; step < depth && frontier.length > 0; step++) {
      const following: string[] = [];
      for (const id of frontier) {
        for (const neighbor of next(id)) {
          if (neighbor === focus || seen.has(neighbor)) continue;
          seen.add(neighbor);
          following.push(neighbor);
        }
      }
      frontier = following;
    }
    return seen;
  };
  return {
    upstream: walk((id) => dependencies[id] ?? []),
    downstream: walk((id) => dependents.get(id) ?? []),
  };
}

export function buildGraphLayout(
  cells: readonly CellDefinition[],
  dependencies: Record<string, string[]>,
  options: GraphOptions = {},
): GraphLayout {
  const all = new Map(cells.map((cell) => [cell.id, cell]));
  const connected = new Set<string>();
  for (const [id, parents] of Object.entries(dependencies)) {
    if (!all.has(id)) continue;
    for (const parent of parents) {
      if (all.has(parent)) { connected.add(id); connected.add(parent); }
    }
  }
  const focus = options.focus && all.has(options.focus) ? options.focus : null;
  const related = focus === null ? null : neighborhood(dependencies, focus, options.depth);
  const visible = cells.filter((cell) => {
    if (cell.id === focus) return true;
    if (cell.kind === 'markdown') {
      if (options.hideText && cell.view?.page === false) return false;
      if (options.hideNotes && cell.view?.page !== false) return false;
    }
    if (options.hideIsolated && !connected.has(cell.id)) return false;
    if (options.onlyIds && !options.onlyIds.has(cell.id)) return false;
    if (options.sheet != null && splitCellId(cell.id)[0] !== options.sheet) return false;
    if (related !== null) return related.upstream.has(cell.id) || related.downstream.has(cell.id);
    return true;
  });
  const shown = new Set(visible.map((cell) => cell.id));
  const parentsOf = (id: string) => (dependencies[id] ?? []).filter((parent) => shown.has(parent));

  // Layers: longest path from a source, so every edge points forward.
  const layerOf = new Map<string, number>();
  const layer = (id: string, visiting: Set<string>): number => {
    const known = layerOf.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return 0; // A cycle (reported as an error elsewhere).
    visiting.add(id);
    const parents = parentsOf(id);
    const value = parents.length === 0 ? 0 : 1 + Math.max(...parents.map((parent) => layer(parent, visiting)));
    visiting.delete(id);
    layerOf.set(id, value);
    return value;
  };
  for (const cell of visible) layer(cell.id, new Set());
  const children = childrenMap(visible, parentsOf);
  // A source used only by a later calculation belongs beside that calculation,
  // rather than at the start of every unrelated chain. Shared inputs stay before
  // their earliest consumer, preserving forward edges.
  for (const cell of visible) {
    if (options.inputsFirst || (cell.kind !== 'input' && cell.kind !== 'linked') || parentsOf(cell.id).length > 0) continue;
    const consumers = children.get(cell.id) ?? [];
    if (consumers.length > 0) {
      layerOf.set(cell.id, Math.min(...consumers.map((id) => layerOf.get(id)!)) - 1);
    }
  }
  const layers: string[][] = [];
  for (const cell of visible) {
    const index = layerOf.get(cell.id)!;
    (layers[index] ??= []).push(cell.id);
  }
  for (const ids of layers) ids?.sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  const filled = layers.filter((ids): ids is string[] => ids !== undefined && ids.length > 0);
  orderLayers(filled, parentsOf, children);

  const size = (id: string) => options.nodeSizes?.get(id) ?? {width: NODE_WIDTH, height: NODE_HEIGHT};
  const vertical = options.direction === 'vertical';
  const crossSize = (id: string) => vertical ? size(id).width : size(id).height;
  const mainSize = (id: string) => vertical ? size(id).height : size(id).width;
  const spans = filled.map(ids => ids.reduce((sum, id) => sum + crossSize(id), 0) + Math.max(0, ids.length - 1) * NODE_GAP);
  const widest = Math.max(0, ...spans);
  const nodes: GraphNode[] = [];
  let main = PADDING;
  filled.forEach((ids, layer) => {
    let cross = PADDING + (widest - spans[layer]) / 2;
    ids.forEach(id => {
      nodes.push({
        id, kind: all.get(id)!.kind, isolated: !connected.has(id),
        x: vertical ? cross : main, y: vertical ? main : cross, ...size(id),
        relation: id === focus ? 'focus' : related?.upstream.has(id) ? 'upstream' : related?.downstream.has(id) ? 'downstream' : null,
      });
      cross += crossSize(id) + NODE_GAP;
    });
    main += Math.max(...ids.map(mainSize)) + LAYER_GAP;
  });

  const positions = new Map(nodes.map((node) => [node.id, node]));
  const edges: GraphEdge[] = [];
  for (const node of nodes) {
    for (const parent of parentsOf(node.id)) {
      const from = positions.get(parent)!;
      edges.push({
        from: parent,
        to: node.id,
        path: vertical
          ? curve(from.x + from.width / 2, from.y + from.height, node.x + node.width / 2, node.y, true)
          : curve(from.x + from.width, from.y + from.height / 2, node.x, node.y + node.height / 2, false),
        relation: edgeRelation(from, node),
      });
    }
  }
  return {
    direction: options.direction ?? 'horizontal',
    inputsFirst: options.inputsFirst === true,
    nodes,
    edges,
    width: Math.max(...nodes.map((node) => node.x + node.width + PADDING), 0),
    height: Math.max(...nodes.map((node) => node.y + node.height + PADDING), 0),
    hidden: cells.length - nodes.length,
    total: cells.length,
  };
}

/** Resize a visual snapshot without reading current dependencies or changing its scope. */
export function resizePinnedGraph(layout: GraphLayout, id: string, size: GraphNodeSize): GraphLayout {
  const previous = new Map(layout.nodes.map(node => [node.id, node]));
  if (!previous.has(id)) return layout;
  const cells = layout.nodes.map(node => ({id:node.id, kind:node.kind, source:'', enabled:true, trigger:'auto' as const}));
  const dependencies: Record<string,string[]> = {};
  for (const edge of layout.edges) (dependencies[edge.to] ??= []).push(edge.from);
  const sizes = new Map(layout.nodes.map(node => [node.id, node.id === id ? size : {width:node.width, height:node.height}]));
  const next = buildGraphLayout(cells, dependencies, {nodeSizes:sizes, direction:layout.direction, inputsFirst:layout.inputsFirst});
  const relations = new Map(layout.edges.map(edge => [JSON.stringify([edge.from,edge.to]), edge.relation]));
  return {...layout, width:next.width, height:next.height,
    nodes:next.nodes.map(node => ({...node, relation:previous.get(node.id)!.relation, isolated:previous.get(node.id)!.isolated})),
    edges:next.edges.map(edge => ({...edge, relation:relations.get(JSON.stringify([edge.from,edge.to])) ?? null}))};
}

/** Upstream edges lead into the focus, downstream edges lead away from it. */
function edgeRelation(from: GraphNode, to: GraphNode): EdgeRelation {
  if (to.relation === 'focus' || (from.relation === 'upstream' && to.relation === 'upstream')) {
    return 'upstream';
  }
  if (from.relation === 'focus' || (from.relation === 'downstream' && to.relation === 'downstream')) {
    return 'downstream';
  }
  return null;
}

function childrenMap(
  cells: readonly CellDefinition[],
  parentsOf: (id: string) => string[],
): Map<string, string[]> {
  const children = new Map<string, string[]>();
  for (const cell of cells) {
    for (const parent of parentsOf(cell.id)) children.set(parent, [...(children.get(parent) ?? []), cell.id]);
  }
  return children;
}

/**
 * Barycenter heuristic: alternately sort each layer by the average position of its
 * neighbours in the previous (forward sweep) or next (backward sweep) layer. Cheap and
 * removes most crossings in the typical input → formula → summary shape.
 */
function orderLayers(
  layers: string[][],
  parentsOf: (id: string) => string[],
  children: Map<string, string[]>,
): void {
  const position = new Map<string, number>();
  const index = () => layers.forEach((ids) => ids.forEach((id, row) => position.set(id, row)));
  index();
  const sortBy = (ids: string[], neighbours: (id: string) => string[]) => {
    const weight = new Map(
      ids.map((id, row) => {
        const around = neighbours(id).filter((neighbour) => position.has(neighbour));
        return [
          id,
          around.length === 0
            ? row
            : around.reduce((sum, neighbour) => sum + position.get(neighbour)!, 0) / around.length,
        ];
      }),
    );
    ids.sort((left, right) => weight.get(left)! - weight.get(right)!);
    ids.forEach((id, row) => position.set(id, row));
  };
  for (let sweep = 0; sweep < ORDERING_SWEEPS; sweep++) {
    if (sweep % 2 === 0) {
      for (let column = 1; column < layers.length; column++) sortBy(layers[column], parentsOf);
    } else {
      for (let column = layers.length - 2; column >= 0; column--) {
        sortBy(layers[column], (id) => children.get(id) ?? []);
      }
    }
  }
}

function curve(x1: number, y1: number, x2: number, y2: number, vertical: boolean): string {
  if (!vertical) {
    const bend = Math.max(40, Math.abs(x2 - x1) / 2);
    return `M${x1},${y1} C${x1 + bend},${y1} ${x2 - bend},${y2} ${x2},${y2}`;
  }
  const bend = Math.max(40, Math.abs(y2 - y1) / 2);
  return `M${x1},${y1} C${x1},${y1 + bend} ${x2},${y2 - bend} ${x2},${y2}`;
}
