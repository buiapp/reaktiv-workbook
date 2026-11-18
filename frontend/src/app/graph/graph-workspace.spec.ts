import { signal } from '@angular/core';
import { WorkbookState } from '../workbook/workbook-state';
import { GraphWorkspace } from './graph-workspace';

describe('GraphWorkspace', () => {
  it('retains resized cards through value/selection changes and resets to the current output default', () => {
    const state=new WorkbookState([{id:'A1',kind:'formula',source:'plot',enabled:true,trigger:'auto'}]);
    state.graph.update(graph=>({...graph,cells:[{id:'A1',value:null,display:'Plot',valueType:'rich-output',error:null,richOutput:{mimeType:'image/png',dataBase64:'first'}}]}));
    const selection=signal('A1'), workspace=new GraphWorkspace(state,selection,signal(''));
    workspace.showOutputs.set(true);const pane=workspace.paneLayout('',0);
    workspace.resizeNode(0,'A1',{width:640,height:400});
    expect(pane().nodes[0]).toMatchObject({width:640,height:400});
    selection.set('B1');state.graph.update(graph=>({...graph,cells:graph.cells.map(row=>({...row,display:'Updated'}))}));
    expect(pane().nodes[0]).toMatchObject({width:640,height:400});
    workspace.resizeNode(0,'A1',null);expect(pane().nodes[0]).toMatchObject({width:320,height:240});
    workspace.resizeNode(0,'A1',{width:640,height:400});workspace.resetViews();
    expect(pane().nodes[0]).toMatchObject({width:320,height:240});
  });

  it('resizes a pinned scope without following new selection/dependencies or changing another pin', () => {
    const state=new WorkbookState(['A1','B1','C1'].map(id=>({id,kind:'formula',source:'1',enabled:true,trigger:'auto'})));
    state.graph.update(graph=>({...graph,dependencies:{B1:['A1']}}));
    const selection=signal('B1'), workspace=new GraphWorkspace(state,selection,signal(''));
    workspace.graphFocus.set(true);const first=workspace.paneLayout('',0), second=workspace.paneLayout('',1);
    workspace.pin(0,first());workspace.pin(1,second());const other=second();
    selection.set('C1');state.graph.update(graph=>({...graph,dependencies:{C1:['B1'],B1:['A1']}}));
    workspace.resizeNode(0,'A1',{width:600,height:350});
    expect(workspace.isPinned(0)).toBe(true);expect(second()).toBe(other);
    expect(first().nodes.map(node=>node.id)).toEqual(['A1','B1']);expect(first().edges).toHaveLength(1);
    const a=first().nodes[0], b=first().nodes[1];
    expect(a.width).toBe(600);expect(b.x).toBeGreaterThan(a.x+a.width);
    expect(a.relation).toBe('upstream');expect(b.relation).toBe('focus');
    workspace.resizeNode(0,'A1',null);expect(first().nodes[0].width).toBe(176);
    expect(workspace.isPinned(0)).toBe(true);
  });
  it('pins layout and connections while selection and live results continue changing', () => {
    const state=new WorkbookState(['A1','B1','C1'].map(id=>({id,kind:'formula',source:'1',enabled:true,trigger:'auto'})));
    state.graph.update(graph=>({...graph,dependencies:{B1:['A1']}}));
    const selection=signal('B1'), sheet=signal('');
    const workspace=new GraphWorkspace(state,selection,sheet);
    workspace.graphFocus.set(true);
    const pane=workspace.paneLayout('',0), pinned=pane();
    workspace.pin(0,pinned);
    selection.set('C1');sheet.set('Budget');
    state.graph.update(graph=>({...graph,dependencies:{C1:['B1'],B1:['A1']},cells:[{id:'B1',value:42,display:'42',valueType:'int',error:null}]}));
    expect(pane()).toBe(pinned);
    expect(pane().nodes.map(node=>node.id)).toEqual(['A1','B1']);
    expect(pane().edges).toHaveLength(1);
    expect(state.resultMap().get('B1')?.value).toBe(42);
    workspace.unpin(0);
    expect(pane().nodes.map(node=>node.id)).toEqual(['A1','B1','C1']);
  });

  it('keeps split pins independent, swaps them with their pane, and prunes deleted cells without moving survivors', () => {
    const state=new WorkbookState(['A1','B1'].map(id=>({id,kind:'formula',source:'1',enabled:true,trigger:'auto'})));
    state.graph.update(graph=>({...graph,dependencies:{B1:['A1']}}));
    const workspace=new GraphWorkspace(state,signal('B1'),signal(''));
    const first=workspace.paneLayout('',0), second=workspace.paneLayout('',1);
    const layout=first();workspace.pin(0,layout);workspace.swapPins();
    expect(workspace.isPinned(0)).toBe(false);expect(workspace.isPinned(1)).toBe(true);
    expect(second()).toBe(layout);
    state.cells.update(cells=>cells.filter(cell=>cell.id==='B1'));
    expect(second().nodes).toEqual([layout.nodes.find(node=>node.id==='B1')]);
    expect(second().edges).toEqual([]);
    workspace.clearPins();expect(workspace.isPinned(1)).toBe(false);
  });

  it('expands renderable outputs only when requested and keeps the pinned output mode', () => {
    const state=new WorkbookState([{id:'A1',kind:'input',source:'1',enabled:true,trigger:'auto'}, {id:'B1',kind:'formula',source:'plot',enabled:true,trigger:'auto'}]);
    state.graph.update(graph=>({...graph,cells:[{id:'B1',value:null,display:'Plot',valueType:'rich-output',error:null,richOutput:{mimeType:'image/png',dataBase64:'first'}}]}));
    const workspace=new GraphWorkspace(state,signal('A1'),signal(''));
    const pane=workspace.paneLayout('',0);
    expect(pane().nodes.every(node=>node.width===176)).toBe(true);
    workspace.showOutputs.set(true);
    expect(pane().nodes.find(node=>node.id==='A1')?.height).toBe(120);
    expect(pane().nodes.find(node=>node.id==='B1')?.width).toBe(320);
    workspace.pin(0,pane());workspace.showOutputs.set(false);
    expect(workspace.outputsShown(0)).toBe(true);
    expect(pane().nodes.find(node=>node.id==='B1')?.width).toBe(320);
    workspace.unpin(0);expect(workspace.outputsShown(0)).toBe(false);
  });
  it('does no layout work for hidden panes and shares the global layout between visible panes', () => {
    const state = new WorkbookState();
    const cells = state.cells;
    let layoutReads = 0;
    Object.defineProperty(state, 'cells', {
      get: () => {
        layoutReads++;
        return cells;
      },
    });
    const workspace = new GraphWorkspace(state, signal('A1'), signal(''));
    const first = workspace.paneLayout(''),
      second = workspace.paneLayout('Budget');
    cells.set([{ id: 'A1', kind: 'input', source: '1', enabled: true, trigger: 'auto' }]);
    expect(layoutReads).toBe(0);
    expect(first().total).toBe(1);
    expect(second()).toBe(first());
    expect(layoutReads).toBe(1);
    cells.update((cells) => [...cells, { ...cells[0], id: 'Budget!A1' }]);
    expect(layoutReads).toBe(1);
    workspace.graphThisSheet.set(true);
    expect(first().nodes.map((node) => node.id)).toEqual(['A1']);
    expect(second().nodes.map((node) => node.id)).toEqual(['Budget!A1']);
  });

  it('keeps pinned worksheet scope through active-sheet changes and pane swaps', () => {
    const sheet = signal('Budget');
    const workspace = new GraphWorkspace(new WorkbookState(), signal('Budget!A1'), sheet);
    workspace.graphThisSheet.set(true);
    workspace.pin(0, workspace.paneLayout('Budget', 0)(), 'Budget');
    sheet.set(''); workspace.graphThisSheet.set(false);
    expect(workspace.scope(0, '')).toBe('Budget');
    expect(workspace.scope(1, '')).toBeNull();
    workspace.swapPins(); expect(workspace.scope(1, '')).toBe('Budget');
    workspace.unpin(1); expect(workspace.scope(1, '')).toBeNull();
    workspace.graphThisSheet.set(true); expect(workspace.scope(1, '')).toBe('');
  });

  it('preserves graph preferences and ignores invalid stored data', () => {
    const workspace = new GraphWorkspace(new WorkbookState(), signal('A1'), signal(''));
    workspace.restore('null');
    workspace.restore('[]');
    workspace.restore('{');
    expect(workspace.graphHideText()).toBe(true);
    workspace.graphFocus.set(true);
    workspace.graphDepth.set(2);
    workspace.graphHideIsolated.set(true);
    workspace.showOutputs.set(true);
    const copy = new GraphWorkspace(new WorkbookState(), signal('A1'), signal(''));
    copy.restore(workspace.settings());
    expect(copy.graphFocus()).toBe(true);
    expect(copy.graphDepth()).toBe(2);
    expect(copy.graphHideIsolated()).toBe(true);
    expect(copy.showOutputs()).toBe(true);
  });
});

it('defaults to horizontal, remembers direction, and preserves other pinned panes during vertical resizing', () => {
  const state=new WorkbookState(['A1','B1'].map(id=>({id,kind:'formula',source:'1',enabled:true,trigger:'auto'})));
  state.graph.update(graph=>({...graph,dependencies:{B1:['A1']}}));
  const workspace=new GraphWorkspace(state,signal('B1'),signal(''));
  const first=workspace.paneLayout('',0),second=workspace.paneLayout('',1);
  expect(first().direction).toBe('horizontal');workspace.pin(0,first());
  workspace.direction.set('vertical');expect(first().direction).toBe('horizontal');expect(second().direction).toBe('vertical');
  workspace.pin(1,second());workspace.direction.set('horizontal');
  workspace.resizeNode(1,'A1',{width:400,height:300});
  expect(second().direction).toBe('vertical');expect(second().nodes[1].y).toBeGreaterThan(second().nodes[0].y+300);
  expect(first().direction).toBe('horizontal');
  workspace.direction.set('vertical');const copy=new GraphWorkspace(state,signal('B1'),signal(''));
  copy.restore(workspace.settings());expect(copy.direction()).toBe('vertical');
  copy.restore('{}');expect(copy.direction()).toBe('horizontal');
  copy.restore('{"direction":"invalid"}');expect(copy.direction()).toBe('horizontal');
});

it('owns independent level scroll positions per pane, preserves pins, swaps positions and resets on document replacement',()=>{
  const state=new WorkbookState([{id:'A1',kind:'input',source:'1',enabled:true,trigger:'auto'}]);
  const workspace=new GraphWorkspace(state,signal('A1'),signal(''));
  const layout=workspace.paneLayout('',0)();workspace.pin(0,layout);
  workspace.levelState(0).setOffsets(new Map([['h:0',120]]));
  workspace.levelState(1).setOffsets(new Map([['h:0',240]]));
  expect(workspace.paneLayout('',0)()).toBe(layout);
  workspace.swapPins();expect(workspace.levelState(0).offsets().get('h:0')).toBe(240);expect(workspace.levelState(1).offsets().get('h:0')).toBe(120);
  workspace.scrollableLevels.set(true);
  const copy=new GraphWorkspace(state,signal('A1'),signal(''));copy.restore(workspace.settings());expect(copy.scrollableLevels()).toBe(true);
  copy.restore('{}');expect(copy.scrollableLevels()).toBe(false);
  workspace.resetViews();expect(workspace.levelState(0).offsets().size).toBe(0);
});

it('remembers connection and input placement preferences without changing captured pins',()=>{
  const state=new WorkbookState([{id:'A1',kind:'input',source:'1',enabled:true,trigger:'auto'}]);
  const workspace=new GraphWorkspace(state,signal('A1'),signal(''));
  const layout=workspace.paneLayout('',0);workspace.pin(0,layout());const captured=layout();
  expect(workspace.connections()).toBe('selected');expect(workspace.inputsFirst()).toBe(false);
  workspace.connections.set('all');workspace.inputsFirst.set(true);expect(layout()).toBe(captured);
  const copy=new GraphWorkspace(state,signal('A1'),signal(''));copy.restore(workspace.settings());
  expect(copy.connections()).toBe('all');expect(copy.inputsFirst()).toBe(true);
  copy.restore('{}');expect(copy.connections()).toBe('selected');expect(copy.inputsFirst()).toBe(false);
});
