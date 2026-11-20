import { afterEach, describe, expect, it } from 'vitest';
import { agentCellLayoutKey, inspectCellLayouts, type AgentWorksheetLayout } from './agent-layout';
import type { CellDefinition, CellResult } from '../sheet.types';
const cell = (id: string, view: CellDefinition['view'] = {}): CellDefinition => ({id, view, kind: 'input', source: '7', enabled: true});
const layout: AgentWorksheetLayout = {columns: 10, rows: 16, columnWidths: {}, rowHeights: {}};
const result = (id: string): CellResult => ({id, value: 7, display: '7', valueType: 'int', error: null});
function sizes(element: HTMLElement, width: number, height: number, scrollWidth = width, scrollHeight = height) {
  Object.defineProperties(element, {clientWidth:{configurable:true,value:width}, clientHeight:{configurable:true,value:height},
    offsetWidth:{configurable:true,value:width}, offsetHeight:{configurable:true,value:height},
    scrollWidth:{configurable:true,value:scrollWidth}, scrollHeight:{configurable:true,value:scrollHeight}});
}
function element(cell: CellDefinition, content = '<label class="tile-widget"></label>') {
  const root = document.createElement('div'); root.innerHTML = content;
  Object.assign(root.dataset, {agentCellId: cell.id, agentPane:'-1', agentView:'sheet', agentZoom:'.8', agentLayoutKey:agentCellLayoutKey(cell), agentLayoutRevision:'r1'});
  root.style.cssText = 'padding:16px 8px 4px;overflow:hidden'; sizes(root,224,90);
  root.getBoundingClientRect = () => new DOMRect(100,100,179.2,72);
  document.body.append(root);
  const child = root.firstElementChild as HTMLElement; sizes(child,208,70);
  return root;
}
afterEach(() => document.body.replaceChildren());
describe('passive agent layout inspection', () => {
  it('ignores display:contents wrappers as clipping boxes, while respecting hidden content', () => {
    const definition = cell('A1',{display:'rendered'}), root = element(definition);
    const wrapper = document.createElement('section');
    wrapper.style.cssText='display:contents;overflow-x:hidden;overflow-y:hidden';
    document.body.append(wrapper); wrapper.append(root);
    expect(inspectCellLayouts([definition], [result('A1')], ['A1'], () => layout, 'r1')[0].status).toBe('measured');
    (root.firstElementChild as HTMLElement).style.display='none';
    const report = inspectCellLayouts([definition], [result('A1')], ['A1'], () => layout, 'r1')[0];
    expect(report.status).toBe('unmeasured'); expect(report.panes[0].reason).toContain('intentionally hidden');
  });
  it('reports exact metadata and estimated suggestions off-screen, including custom tracks and collisions', () => {
    const cells = [cell('A1',{display:'rendered',widget:{type:'range'}}),cell('B1')];
    const report = inspectCellLayouts(cells, [result('A1')], ['A1'], () => layout, 'r1');
    expect(report[0]).toMatchObject({status:'unmeasured', contentKind:'widget:range', storedSpan:[1,1],gridSizePx:{width:112,height:45},panes:[]});
    expect(report[0].recommendation).toMatchObject({basis:'estimated-minimum',suggestedSpan:[2,2],placementValid:false});
    expect(report[0].recommendation.placementError).toContain('overlap');
    const custom = inspectCellLayouts([cell('Other!C3',{span:[2,2]})], [], ['Other!C3'], () => ({...layout,columnWidths:{C:200,D:150},rowHeights:{'3':80,'4':60}}), 'r1')[0];
    expect(custom.gridSizePx).toEqual({width:350,height:140});
  });
  it('measures usable layout pixels and nested overflow without conflating view zoom with size', () => {
    const definition = cell('A1',{display:'rendered',span:[2,2]});
    const root = element(definition); const content = root.firstElementChild as HTMLElement;
    sizes(content,208,70,300,120); content.style.overflowX = 'auto'; content.style.overflowY = 'auto';
    const report = inspectCellLayouts([definition], [result('A1')], ['A1'], () => layout, 'r1')[0];
    expect(report.panes[0]).toMatchObject({pane:-1,zoom:.8,status:'measured',visible:true,outerPx:{width:224,height:90},
      usablePx:{width:208,height:70},contentPx:{width:300,height:120},overflow:{horizontal:true,vertical:true},clipped:true,scrollable:true});
    expect(root.scrollTop).toBe(0);
  });
  it('distinguishes pending presentation, off-screen content and opaque widget internals', () => {
    const definition = cell('A1',{display:'rendered'}), root = element(definition);
    root.dataset['agentLayoutRevision'] = 'old';
    expect(inspectCellLayouts([definition], [], ['A1'], () => layout, 'r1')[0].status).toBe('render-pending');
    root.dataset['agentLayoutRevision'] = 'r1'; root.getBoundingClientRect = () => new DOMRect(0,2000,224,90);
    expect(inspectCellLayouts([definition], [], ['A1'], () => layout, 'r1')[0].status).toBe('unmeasured');
    root.remove(); element(definition,'<reaktiv-anywidget class="tile-widget"></reaktiv-anywidget>');
    const opaque = inspectCellLayouts([definition], [], ['A1'], () => layout, 'r1')[0];
    expect(opaque.status).toBe('opaque'); expect(opaque.panes[0].clipped).toBeNull();
  });
  it('does not claim a plot is readable just because it fits and waits for asynchronous rendering', () => {
    const definition = cell('A1',{display:'rendered'}), root = element(definition,'<reaktiv-plotly class="tile-plot"></reaktiv-plotly>');
    const plot = root.firstElementChild as HTMLElement & {renderStatus:string};
    const plotResult = {...result('A1'),richOutput:{mimeType:'application/vnd.plotly.v1+json',dataBase64:'not-read'}};
    plot.renderStatus = 'pending';
    expect(inspectCellLayouts([definition], [plotResult], ['A1'], () => layout, 'r1')[0].status).toBe('render-pending');
    plot.renderStatus = 'error';
    expect(inspectCellLayouts([definition], [plotResult], ['A1'], () => layout, 'r1')[0].status).toBe('unmeasured');
    plot.renderStatus = 'ready';
    const report = inspectCellLayouts([definition], [plotResult], ['A1'], () => layout, 'r1')[0];
    expect(report.panes[0].clipped).toBe(false);
    expect(report.recommendation.minimumContentPx).toEqual({width:480,height:300});
    expect(report.recommendation.suggestedSpan[0]).toBeGreaterThan(2);
    expect(JSON.stringify(report)).not.toContain('not-read');
  });
  it('reports each pane separately and flags suggestions needing more grid space', () => {
    const definition = cell('J16',{display:'rendered',widget:{type:'textarea'}});
    element(definition); const other = element(definition); other.dataset['agentPane']='1'; other.dataset['agentZoom']='1.5';
    const report = inspectCellLayouts([definition], [result('J16')], ['J16'], () => layout, 'r1')[0];
    expect(report.panes.map(pane => pane.zoom)).toEqual([.8,1.5]);
    expect(report.recommendation.requiresGridExpansion).toBe(true);
    expect(report.recommendation.requiredGrid.rows).toBeGreaterThan(16);
  });
});

it('reports resize needed for a small rendered widget without pretending hidden content fits', () => {
  const small = cell('A1', {display:'rendered', widget:{type:'textarea'}});
  const first = inspectCellLayouts([small],[result('A1')],['A1'],()=>layout,'r1')[0];
  expect(first.fit.resizeNeeded).toBe(true); expect(first.fit.status).toBe('too-small');
  const large = {...small,view:{...small.view,span:[4,5] as [number,number]}};
  const second = inspectCellLayouts([large],[result('A1')],['A1'],()=>layout,'r1')[0];
  expect(second.fit.resizeNeeded).toBeNull(); expect(second.fit.status).toBe('estimated-fit');
});


it('offers track sizing without overlap when increasing the span collides', () => {
  const input = cell('A1', {display: 'rendered', widget: {type: 'textarea'}});
  const neighbour = cell('A2', {});
  const report = inspectCellLayouts([input, neighbour], [result('A1')], ['A1'], () => layout, 'r1')[0];
  expect(report.recommendation.placementValid).toBe(false);
  expect(report.recommendation.trackSizing.meetsMinimum).toBe(true);
  expect(report.recommendation.trackSizing.rowHeights['1']).toBeGreaterThan(120);
  expect(report.recommendation.trackSizing.columnWidths['A']).toBeGreaterThan(220);
  expect(input.view?.span).toBeUndefined();
});
