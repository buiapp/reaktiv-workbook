import { buildGraphLayout, neighborhood, resizePinnedGraph } from './graph-layout';
import type { CellDefinition, CellKind } from './sheet.types';

const cell = (id: string, kind: CellKind = 'formula'): CellDefinition => ({
  id,
  kind,
  source: '',
  enabled: true,
});

// A1, A2 → B1 → C1 → D1; note N1 reads everything; Budget!A1 is unrelated.
const cells = [cell('A1', 'input'), cell('A2', 'input'), cell('B1'), cell('C1'), cell('D1'), cell('N1', 'markdown'), cell('Budget!A1', 'input')];
const dependencies = { B1: ['A1', 'A2'], C1: ['B1'], D1: ['C1'], N1: ['A1', 'B1', 'C1', 'D1'] };

describe('graph layout', () => {
  it('keeps expanded outputs apart and connects edges to their actual card boundaries', () => {
    const layout = buildGraphLayout([cell('A1','input'),cell('A2','input'),cell('B1')], {B1:['A1','A2']}, {
      nodeSizes:new Map([['A1',{width:280,height:120}],['B1',{width:320,height:240}]]),
    });
    const a = layout.nodes.find(node=>node.id==='A1')!, other=layout.nodes.find(node=>node.id==='A2')!, b=layout.nodes.find(node=>node.id==='B1')!;
    expect(a.y+a.height).toBeLessThan(other.y);
    expect(a.x+a.width).toBeLessThan(b.x);
    expect(layout.edges.find(edge=>edge.from==='A1')?.path).toMatch(new RegExp(`^M${a.x+a.width},${a.y+a.height/2} C`));
    expect(layout.width).toBeGreaterThan(b.x+b.width);
    expect(layout.height).toBeGreaterThan(b.y+b.height);
  });
  it('places every edge left to right in layers', () => {
    const layout = buildGraphLayout(cells, dependencies);
    const x = new Map(layout.nodes.map((node) => [node.id, node.x]));
    for (const edge of layout.edges) expect(x.get(edge.from)!).toBeLessThan(x.get(edge.to)!);
    expect(layout.nodes).toHaveLength(7);
    expect(layout.edges).toHaveLength(8);
    expect(layout.edges[0].path).toMatch(/^M[\d.]+,[\d.]+ C/);
  });

  it('finds upstream and downstream cells within a depth', () => {
    expect(neighborhood(dependencies, 'C1', 1)).toEqual({
      upstream: new Set(['B1']),
      downstream: new Set(['D1', 'N1']),
    });
    expect(neighborhood(dependencies, 'C1').upstream).toEqual(new Set(['B1', 'A1', 'A2']));
  });

  it('focuses on the selected cell and filters notes and sheets', () => {
    const focused = buildGraphLayout(cells, dependencies, { focus: 'B1', depth: 1, hideNotes: true });
    expect(focused.nodes.map((node) => node.id).sort()).toEqual(['A1', 'A2', 'B1', 'C1']);
    expect(focused.hidden).toBe(3);
    expect(focused.nodes.find((node) => node.id === 'A1')?.relation).toBe('upstream');
    expect(focused.edges.find((edge) => edge.from === 'B1')?.relation).toBe('downstream');

    const budget = buildGraphLayout(cells, dependencies, { sheet: 'Budget' });
    expect(budget.nodes.map((node) => node.id)).toEqual(['Budget!A1']);
  });

  it('filters worksheet text separately from note pages, retaining a focused label', () => {
    const text = {...cell('T1', 'markdown'), view: {page: false}};
    const definitions = [cell('A1', 'input'), text, cell('N1', 'markdown')];
    const reads = {T1: ['A1'], N1: ['A1']};
    expect(buildGraphLayout(definitions, reads, {hideText: true}).nodes.map(node => node.id).sort()).toEqual(['A1','N1']);
    expect(buildGraphLayout(definitions, reads, {hideNotes: true}).nodes.map(node => node.id).sort()).toEqual(['A1','T1']);
    expect(buildGraphLayout(definitions, reads, {hideText: true, hideNotes: true, focus: 'T1'}).nodes.map(node => node.id).sort()).toEqual(['A1','T1']);
  });

  it('identifies isolated nodes using the full graph before presentation filters', () => {
    const definitions = [cell('A1', 'input'), cell('N1', 'markdown'), cell('B1'), cell('C1')];
    const reads = {N1: ['A1'], B1: ['missing']};
    const layout = buildGraphLayout(definitions, reads, {hideNotes: true, hideIsolated: true});
    expect(layout.nodes.map(node => node.id)).toEqual(['A1']);
    expect(layout.nodes[0].isolated).toBe(false);
    expect(buildGraphLayout(definitions, reads).nodes.find(node => node.id === 'B1')?.isolated).toBe(true);
    expect(buildGraphLayout(definitions, reads, {hideIsolated: true, focus: 'C1'}).nodes.some(node => node.id === 'C1')).toBe(true);
  });

  it('restricts errors without losing a focused selection and handles empty results', () => {
    const layout = buildGraphLayout(cells, dependencies, {onlyIds: new Set(['B1','C1'])});
    expect(layout.nodes.map(node => node.id)).toEqual(['B1','C1']);
    expect(layout.edges.map(edge => [edge.from,edge.to])).toEqual([['B1','C1']]);
    expect(buildGraphLayout(cells, dependencies, {onlyIds: new Set()}).nodes).toEqual([]);
    const focused = buildGraphLayout(cells, dependencies, {onlyIds: new Set(), focus: 'A1'});
    expect(focused.nodes.map(node => node.id)).toEqual(['A1']);
  });

  it('orders layers to avoid crossings', () => {
    // X1 → Y2 and X2 → Y1: the barycenter pass swaps Y1/Y2 so the edges do not cross.
    const layout = buildGraphLayout([cell('X1', 'input'), cell('X2', 'input'), cell('Y1'), cell('Y2')], {
      Y1: ['X2'],
      Y2: ['X1'],
    });
    const y = new Map(layout.nodes.map((node) => [node.id, node.y]));
    expect(y.get('Y2')!).toBeLessThan(y.get('Y1')!);
  });

  it('places a late-stage input directly before the calculation that uses it', () => {
    const layout = buildGraphLayout([cell('A1', 'input'), cell('B1'), cell('C1'), cell('D1'), cell('A2', 'input')], {
      B1: ['A1'], C1: ['B1'], D1: ['C1', 'A2'],
    });
    const x = new Map(layout.nodes.map(node => [node.id, node.x]));
    expect(x.get('A2')).toBe(x.get('C1'));
    expect(x.get('A2')!).toBeGreaterThan(x.get('A1')!);
    for (const edge of layout.edges) expect(x.get(edge.from)!).toBeLessThan(x.get(edge.to)!);
  });

  it('keeps shared inputs before their earliest consumer and unrelated inputs at the start', () => {
    const layout = buildGraphLayout([cell('A1', 'input'), cell('B1'), cell('C1'), cell('D1'), cell('A2', 'input'), cell('A3', 'input')], {
      B1: ['A1', 'A2'], C1: ['B1'], D1: ['C1', 'A2'],
    });
    const x = new Map(layout.nodes.map(node => [node.id, node.x]));
    expect(x.get('A2')).toBe(x.get('A1'));
    expect(x.get('A3')).toBe(x.get('A1'));
    for (const edge of layout.edges) expect(x.get(edge.from)!).toBeLessThan(x.get(edge.to)!);
  });

  it('places input sources near visible consumers when notes are hidden', () => {
    const definitions = [cell('A1', 'input'), cell('B1'), cell('C1'), cell('D1'), cell('A2', 'linked'), cell('N1', 'markdown')];
    const layout = buildGraphLayout(definitions, { B1: ['A1'], C1: ['B1'], D1: ['C1', 'A2'], N1: ['A2'] }, { hideNotes: true });
    const x = new Map(layout.nodes.map(node => [node.id, node.x]));
    expect(x.get('A2')).toBe(x.get('C1'));
    expect(x.has('N1')).toBe(false);
  });

});

it.each(['horizontal','vertical'] as const)('keeps sized cards and edge anchors correct in %s direction', direction => {
  const layout=buildGraphLayout([cell('A1','input'),cell('A2','input'),cell('B1')],{B1:['A1','A2']},{direction,nodeSizes:new Map([['A1',{width:280,height:120}],['B1',{width:320,height:240}]])});
  const vertical=direction==='vertical';
  expect(layout.direction).toBe(direction);
  for (const edge of layout.edges) {
    const from=layout.nodes.find(node=>node.id===edge.from)!, to=layout.nodes.find(node=>node.id===edge.to)!;
    expect(vertical ? from.y+from.height : from.x+from.width).toBeLessThan(vertical ? to.y : to.x);
    const start=vertical ? `${from.x+from.width/2},${from.y+from.height}` : `${from.x+from.width},${from.y+from.height/2}`;
    const end=vertical ? `${to.x+to.width/2},${to.y}` : `${to.x},${to.y+to.height/2}`;
    expect(edge.path.startsWith(`M${start} C`)).toBe(true);expect(edge.path.endsWith(` ${end}`)).toBe(true);
  }
  const a=layout.nodes[0],b=layout.nodes[1];
  expect(vertical ? a.x+a.width : a.y+a.height).toBeLessThan(vertical ? b.x : b.y);
});

it.each(['horizontal','vertical'] as const)('optionally keeps source inputs first in %s layouts and pinned reflows',direction=>{
  const definitions=[cell('A1','input'),cell('B1'),cell('C1'),cell('A2','input'),cell('A3','linked'),cell('L1','linked'),cell('D1')];
  const reads={B1:['A1'],C1:['B1'],D1:['C1','A2','A3','L1'],L1:['B1']};
  const main=(node:{x:number;y:number})=>direction==='vertical'?node.y:node.x;
  const normal=buildGraphLayout(definitions,reads,{direction});
  expect(main(normal.nodes.find(node=>node.id==='A2')!)).toBeGreaterThan(main(normal.nodes.find(node=>node.id==='A1')!));
  const layout=buildGraphLayout(definitions,reads,{direction,inputsFirst:true});
  for(const current of [layout,resizePinnedGraph(layout,'B1',{width:400,height:220})]) {
    const nodes=new Map(current.nodes.map(node=>[node.id,node]));
    expect(main(nodes.get('A2')!)).toBe(main(nodes.get('A1')!));
    expect(main(nodes.get('A3')!)).toBe(main(nodes.get('A1')!));
    for(const edge of current.edges)expect(main(nodes.get(edge.from)!)).toBeLessThan(main(nodes.get(edge.to)!));
    expect(current.inputsFirst).toBe(true);
  }
});
