import { TestBed } from '@angular/core/testing';
import type { CellUpdateObservation, WorkbookUpdateTrace } from './sheet.types';
import { UpdateTraceComponent } from './update-trace.component';
import { updateExplanation, updatePath } from './update-trace';

function row(status:CellUpdateObservation['status'],dependencies:string[]=[]):CellUpdateObservation {
  return {status,executions:status==='equal'?1:0,publishedChanged:status==='changed',dependencies,changedDependencies:[]};
}
const trace:WorkbookUpdateTrace={sequence:2,roots:['A1'],cells:{
  A1:row('changed'), B1:{...row('equal',['A1']),equal:true,equality:'custom'},
  'Charts!C1':{...row('cached',['B1']),output:'reused'}, D1:row('unaffected'),
}};

describe('update tracing',()=>{
  it('follows observed dependencies in either direction without unrelated nodes or cycles',()=>{
    expect([...updatePath(trace,'Charts!C1','upstream')]).toEqual(['Charts!C1','B1','A1']);
    expect([...updatePath(trace,'A1','downstream')]).toEqual(['A1','B1','Charts!C1']);
    expect(updatePath(undefined,'A1','upstream').size).toBe(0);
    const cyclic={...trace,cells:{...trace.cells,A1:row('changed',['B1'])}};
    expect(updatePath(cyclic,'Charts!C1','upstream').size).toBe(3);
  });
  it('distinguishes no execution from suppressed publication and primitive-specific behavior',()=>{
    expect(updateExplanation(trace.cells['B1'])).toContain('custom equality suppressed');
    expect(updateExplanation({...row('equal'),executions:0})).toContain('write or replacement');
    expect(updateExplanation(row('cached'),'input')).toContain('initializers run once');
    expect(updateExplanation({...row('cached'),changedDependencies:['A1']})).toContain('despite a changed dependency');
    expect(updateExplanation(row('failed'))).toContain('retained error');
  });
  it('explains cached plots and navigates to equality boundaries with persistent trace context',async()=>{
    await TestBed.configureTestingModule({imports:[UpdateTraceComponent]}).compileComponents();
    const fixture=TestBed.createComponent(UpdateTraceComponent);
    fixture.componentRef.setInput('trace',trace);fixture.componentRef.setInput('selectedId','Charts!C1');
    fixture.componentRef.setInput('enabled',true);
    fixture.componentRef.setInput('pathTarget','Charts!C1');fixture.componentRef.setInput('pathDirection','upstream');
    const inspect=vi.fn(), requested=vi.fn(), clear=vi.fn();
    fixture.componentInstance.inspectRequested.subscribe(inspect);
    fixture.componentInstance.traceRequested.subscribe(requested);
    fixture.componentInstance.clearPath.subscribe(clear);
    fixture.detectChanges();
    const root=fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Charts!C1 · Cached');
    expect(root.textContent).toContain('Existing rich output reused');
    expect(root.textContent).toContain('Upstream equality decisions');
    expect(root.textContent).toContain('Showing dependencies of Charts!C1');
    const button=(label:string)=>[...root.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim()===label)!;
    button('B1').click();expect(inspect).toHaveBeenCalledWith('B1');
    button("Why didn't this update?").click();expect(requested).toHaveBeenCalledWith({id:'Charts!C1',direction:'upstream'});
    button('Trace dependents').click();expect(requested).toHaveBeenLastCalledWith({id:'Charts!C1',direction:'downstream'});
    button('Show whole graph').click();expect(clear).toHaveBeenCalled();
    fixture.destroy();
  });
  it('handles older kernels and keeps tracing optional',async()=>{
    await TestBed.configureTestingModule({imports:[UpdateTraceComponent]}).compileComponents();
    const fixture=TestBed.createComponent(UpdateTraceComponent);
    fixture.detectChanges();expect(fixture.nativeElement.textContent).not.toContain('older kernels');
    fixture.componentRef.setInput('enabled',true);fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('older kernels');
    fixture.destroy();
  });
});
