import { buildGraphLayout, type GraphDirection } from '../graph-layout';
import { GraphLevelScrollState, LEVEL_HEADER, graphLevels, projectGraphLevels, revealInLevel } from './graph-levels';

function sample(direction:GraphDirection) {
  const inputs=Array.from({length:12},(_,i)=>({id:'A'+(i+1),kind:'input' as const,source:'1',enabled:true,trigger:'auto' as const}));
  return buildGraphLayout([...inputs,{...inputs[0],id:'B1',kind:'formula'}],{B1:inputs.map(cell=>cell.id)},{direction});
}
it.each(['horizontal','vertical'] as const)('scrolls %s levels independently and keeps edge endpoints within the panel',direction=>{
  const layout=sample(direction), levels=graphLevels(layout), state=new GraphLevelScrollState();
  const project=()=>projectGraphLevels(levels,layout,{width:600,height:350},1,state.offsets());
  const initial=project(), first=initial.levels[0], second=initial.levels[1];
  expect(initial.levels).toHaveLength(2);expect(first.after.length).toBeGreaterThan(0);expect(second.offset).toBe(0);
  expect(initial.edges.some(edge=>edge.offscreen)).toBe(true);
  const last=first.nodes.at(-1)!;
  state.setOffsets(new Map([[first.key,revealInLevel(first,last.id,initial.vertical)]]));
  const next=project();expect(next.levels[0].offset).toBeGreaterThan(0);expect(next.levels[1].offset).toBe(0);
  expect(next.levels[0].before.length).toBeGreaterThan(0);expect(next.levels[0].after).not.toContain(last.id);
  for(const edge of next.edges) {
    const start=/^M([\d.]+),([\d.]+)/.exec(edge.path)!;
    const value=Number(start[initial.vertical?1:2]), panel=next.levels[0];
    const low=initial.vertical?panel.x:panel.y+LEVEL_HEADER;
    const high=initial.vertical?panel.x+panel.width:panel.y+panel.height;
    expect(value).toBeGreaterThanOrEqual(low);expect(value).toBeLessThanOrEqual(high);
  }
  expect(layout.nodes.map(node=>[node.id,node.x,node.y])).toEqual(sample(direction).nodes.map(node=>[node.id,node.x,node.y]));
});
it('clamps restored offsets after filters, zoom and viewport changes',()=>{
  const layout=sample('horizontal'), levels=graphLevels(layout);
  const projected=projectGraphLevels(levels,layout,{width:600,height:350},2,new Map([['h:0',100000]]));
  expect(projected.levels[0].offset).toBe(projected.levels[0].maxOffset);
  const empty=projectGraphLevels([], {...layout,nodes:[],edges:[]},{width:600,height:350},1,new Map());
  expect(empty).toMatchObject({width:0,height:0,edges:[],levels:[]});
});
it('does not draw misleading connections when both cards are offscreen',()=>{
  const sources=Array.from({length:20},(_,i)=>({id:'A'+i,kind:'formula' as const,source:'1',enabled:true,trigger:'auto' as const}));
  const consumers=sources.map(cell=>({...cell,id:'B'+cell.id.slice(1)}));
  const layout=buildGraphLayout([...sources,...consumers],Object.fromEntries(consumers.map((cell,i)=>[cell.id,[sources[i].id]])));
  const projected=projectGraphLevels(graphLevels(layout),layout,{width:600,height:300},1,new Map());
  expect(projected.edges.length).toBeLessThan(layout.edges.length);expect(projected.levels.every(level=>level.after.length>0)).toBe(true);
});

it.each(['horizontal','vertical'] as const)('filters %s arrows and hidden indicators to the selected cell',direction=>{
  const layout=sample(direction),levels=graphLevels(layout);
  const project=(selected:string)=>projectGraphLevels(levels,layout,{width:600,height:350},1,new Map(),'selected',selected);
  const single=project('A12');
  expect(single.edges).toHaveLength(1);expect(single.edges[0]).toMatchObject({from:'A12',to:'B1',relation:'downstream'});
  expect(single.levels[0].after).toEqual(['A12']);
  const incoming=project('B1');expect(incoming.edges).toHaveLength(12);expect(incoming.edges.every(edge=>edge.relation==='upstream')).toBe(true);
  const absent=project('missing');expect(absent.edges).toEqual([]);expect(absent.levels.every(level=>!level.before.length&&!level.after.length)).toBe(true);
});
