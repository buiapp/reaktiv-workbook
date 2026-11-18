import { signal } from '@angular/core';
import type { GraphDirection, GraphEdge, GraphLayout, GraphNode } from '../graph-layout';

export type GraphConnections = 'selected' | 'all';

export const LEVEL_HEADER = 64;
const PAD = 12;
const OUTER = 24;
const GAP = 90;

/** Per-pane presentation state; no cell values or graph snapshots are retained. */
export class GraphLevelScrollState {
  /** Remounting a pane must not undo a manual scroll away from its selection. */
  readonly lastSelections = new Map<GraphDirection, string>();
  readonly offsets = signal<ReadonlyMap<string, number>>(new Map());
  setOffsets(updates: ReadonlyMap<string, number>): void {
    if ([...updates].every(([key, offset]) => this.offsets().get(key) === offset)) return;
    this.offsets.update(offsets => {
      const next = new Map(offsets);
      for (const [key, offset] of updates) next.set(key, Math.max(0, offset));
      return next;
    });
  }
}
export interface GraphLevel {
  key: string;
  index: number;
  nodes: GraphNode[];
  crossSpan: number;
  mainSpan: number;
}
export interface LevelPanel extends GraphLevel {
  x: number; y: number; width: number; height: number;
  scrollWidth: number; scrollHeight: number;
  offset: number; maxOffset: number;
  before: string[]; after: string[];
}
export interface LevelProjection {
  levels: LevelPanel[];
  edges: (GraphEdge & {offscreen: boolean})[];
  width: number; height: number;
  vertical: boolean;
}

/** Group existing captured geometry, preserving its membership and card order. */
export function graphLevels(layout: GraphLayout): GraphLevel[] {
  const vertical = layout.direction === 'vertical';
  const groups = new Map<number, GraphNode[]>();
  for (const node of layout.nodes) {
    const main = vertical ? node.y : node.x;
    const group = groups.get(main);
    if (group) group.push(node); else groups.set(main, [node]);
  }
  return [...groups].sort(([a], [b]) => a - b).map(([, nodes], index) => {
    const minCross = Math.min(...nodes.map(node => vertical ? node.x : node.y));
    const minMain = Math.min(...nodes.map(node => vertical ? node.y : node.x));
    const local = nodes.map(node => ({...node,
      x: vertical ? node.x - minCross + PAD : node.x - minMain + PAD,
      y: vertical ? node.y - minMain + PAD : node.y - minCross + PAD,
    }));
    return {key:`${vertical ? 'v' : 'h'}:${index}`, index, nodes:local,
      crossSpan:Math.max(...local.map(node => vertical ? node.x + node.width : node.y + node.height)) + PAD,
      mainSpan:Math.max(...local.map(node => vertical ? node.y + node.height : node.x + node.width)) + PAD};
  });
}

/** Project native scroll offsets into connector geometry; never read the DOM or cells. */
export function projectGraphLevels(
  levels: readonly GraphLevel[], layout: GraphLayout,
  viewport: {width:number; height:number}, zoom: number,
  offsets: ReadonlyMap<string, number>,
  connections: GraphConnections = 'all', selectedId = '',
): LevelProjection {
  const vertical = layout.direction === 'vertical';
  const crossViewport = vertical ? Math.max(220, viewport.width / zoom - OUTER * 2) : Math.max(160, viewport.height / zoom - OUTER * 2 - LEVEL_HEADER);
  let main = OUTER;
  const panels: LevelPanel[] = levels.map(level => {
    const maxOffset = Math.max(0, level.crossSpan - crossViewport);
    const panel: LevelPanel = {...level,
      x:vertical ? OUTER : main, y:vertical ? main : OUTER,
      width:vertical ? crossViewport : level.mainSpan + 18,
      height:vertical ? level.mainSpan + LEVEL_HEADER + 18 : crossViewport + LEVEL_HEADER,
      scrollWidth:vertical ? Math.max(level.crossSpan, crossViewport) : level.mainSpan,
      scrollHeight:vertical ? level.mainSpan : Math.max(level.crossSpan, crossViewport),
      offset:Math.min(maxOffset, Math.max(0, offsets.get(level.key) ?? 0)), maxOffset,
      before:[], after:[],
    };
    main += (vertical ? panel.height : panel.width) + GAP;
    return panel;
  });
  const positions = new Map<string, {node:GraphNode; panel:LevelPanel; visibility:'before'|'after'|'visible'}>();
  for (const panel of panels) for (const node of panel.nodes) {
    const start = (vertical ? node.x : node.y) - panel.offset;
    const end = start + (vertical ? node.width : node.height);
    positions.set(node.id, {panel, node:{...node,
      x:panel.x + node.x - (vertical ? panel.offset : 0),
      y:panel.y + LEVEL_HEADER + node.y - (vertical ? 0 : panel.offset),
    }, visibility:end <= 0 ? 'before' : start >= crossViewport ? 'after' : 'visible'});
  }
  const connected = new Set<string>();
  const edges: LevelProjection['edges'] = [];
  const clamp = (value:number, low:number, high:number) => Math.max(low, Math.min(high, value));
  for (const edge of layout.edges) {
    if (connections === 'selected' && edge.from !== selectedId && edge.to !== selectedId) continue;
    const from = positions.get(edge.from), to = positions.get(edge.to);
    if (!from || !to) continue;
    connected.add(edge.from); connected.add(edge.to);
    if (from.visibility !== 'visible' && to.visibility !== 'visible') continue;
    const a = from.node, b = to.node;
    const x1 = vertical ? clamp(a.x+a.width/2, from.panel.x+8, from.panel.x+from.panel.width-8) : a.x+a.width;
    const y1 = vertical ? a.y+a.height : clamp(a.y+a.height/2, from.panel.y+LEVEL_HEADER+8, from.panel.y+from.panel.height-8);
    const x2 = vertical ? clamp(b.x+b.width/2, to.panel.x+8, to.panel.x+to.panel.width-8) : b.x;
    const y2 = vertical ? b.y : clamp(b.y+b.height/2, to.panel.y+LEVEL_HEADER+8, to.panel.y+to.panel.height-8);
    const bend = Math.max(40, Math.abs(vertical ? y2-y1 : x2-x1)/2);
    const path = vertical ? `M${x1},${y1} C${x1},${y1+bend} ${x2},${y2-bend} ${x2},${y2}` : `M${x1},${y1} C${x1+bend},${y1} ${x2-bend},${y2} ${x2},${y2}`;
    const clipped = vertical ? x1!==a.x+a.width/2 || x2!==b.x+b.width/2 : y1!==a.y+a.height/2 || y2!==b.y+b.height/2;
    edges.push({...edge,relation:connections === 'selected' ? (edge.to === selectedId ? 'upstream' : 'downstream') : edge.relation,path,offscreen:clipped||from.visibility!=='visible'||to.visibility!=='visible'});
  }
  for (const [id, position] of positions) {
    if (connected.has(id) && position.visibility !== 'visible') position.panel[position.visibility].push(id);
  }
  return {levels:panels,edges,vertical,
    width:panels.length ? Math.max(...panels.map(panel=>panel.x+panel.width))+OUTER : 0,
    height:panels.length ? Math.max(...panels.map(panel=>panel.y+panel.height))+OUTER : 0};
}

/** Reveal a card with the smallest scroll adjustment, respecting the current zoom. */
export function revealInLevel(panel: LevelPanel, id: string, vertical: boolean): number {
  const node = panel.nodes.find(node=>node.id===id);
  if (!node) return panel.offset;
  const start = vertical ? node.x : node.y;
  const end = start + (vertical ? node.width : node.height);
  const extent = vertical ? panel.width : panel.height - LEVEL_HEADER;
  const next = start < panel.offset ? start - PAD : end > panel.offset + extent ? (end-start > extent ? start-PAD : end-extent+PAD) : panel.offset;
  return Math.max(0, Math.min(panel.maxOffset, next));
}
