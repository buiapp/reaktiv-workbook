import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { buildGraphLayout } from '../graph-layout';
import { GraphLevelsComponent } from './graph-levels.component';
import { GraphLevelScrollState } from './graph-levels';

@Component({imports:[GraphLevelsComponent],template:`
  <ng-template #node let-node><div class="graph-node" [attr.data-cell-id]="node.id"><button (click)="clicks=clicks+1">{{node.id}}</button></div></ng-template>
  <ng-template #edge let-edge><svg:path [attr.d]="edge.path" /></ng-template>
  <app-graph-levels [connections]="connections()" [layout]="layout()" [state]="state" [selectedId]="selected()" [nodeTemplate]="node" [edgeTemplate]="edge" [nodeContext]="{}" (cellRequested)="selected.set($event)" />`})
class Host {
  connections=signal<'selected'|'all'>('all');
  state=new GraphLevelScrollState();selected=signal('');clicks=0;
  layout=signal(buildGraphLayout(Array.from({length:16},(_,i)=>({id:'A'+i,kind:'formula',source:'1',enabled:true})),Object.fromEntries(Array.from({length:8},(_,i)=>['A'+(i+8),['A'+i]]))));
}
it('reveals hidden connections, preserves widget gestures, and reveals a newly selected cell',async()=>{
  await TestBed.configureTestingModule({imports:[Host]}).compileComponents();
  const fixture=TestBed.createComponent(Host);fixture.detectChanges();await fixture.whenStable();
  const root=fixture.nativeElement as HTMLElement, host=fixture.componentInstance;
  expect(root.querySelectorAll('.graph-level')).toHaveLength(2);
  const button=root.querySelector<HTMLButtonElement>('.level-connections button:not(:disabled)')!;
  expect(button).not.toBeNull();button.click();fixture.detectChanges();await fixture.whenStable();
  expect(host.state.offsets().get('h:0')).toBeGreaterThan(0);expect(host.selected()).not.toBe('');
  root.querySelector<HTMLButtonElement>('.graph-node button')!.click();expect(host.clicks).toBe(1);
  host.selected.set('A0');fixture.detectChanges();await fixture.whenStable();
  expect(host.state.offsets().get('h:0')).toBe(0);fixture.destroy();
});

it('retains manual scroll positions when the level view is remounted',async()=>{
  await TestBed.configureTestingModule({imports:[Host]}).compileComponents();
  const fixture=TestBed.createComponent(Host);fixture.detectChanges();await fixture.whenStable();
  const state=fixture.componentInstance.state;
  state.lastSelections.set('horizontal','A0');state.setOffsets(new Map([['h:0',120]]));
  fixture.componentInstance.selected.set('A0');fixture.detectChanges();await fixture.whenStable();
  expect(state.offsets().get('h:0')).toBe(120);
  fixture.destroy();
});

it('lets workbook shortcuts bubble from a focused level while native scrolling stays available',async()=>{
  await TestBed.configureTestingModule({imports:[Host]}).compileComponents();
  const fixture=TestBed.createComponent(Host);fixture.detectChanges();await fixture.whenStable();
  const shortcut=vi.fn(),scroller=fixture.nativeElement.querySelector('.level-scroller') as HTMLElement;
  window.addEventListener('keydown',shortcut);
  try {
    scroller.dispatchEvent(new KeyboardEvent('keydown',{key:'s',ctrlKey:true,bubbles:true}));
    expect(shortcut).toHaveBeenCalledOnce();
  } finally {window.removeEventListener('keydown',shortcut);fixture.destroy();}
});

it('shows only selected connections by default and switches to all without moving cards',async()=>{
  await TestBed.configureTestingModule({imports:[Host]}).compileComponents();
  const fixture=TestBed.createComponent(Host),host=fixture.componentInstance;
  host.connections.set('selected');host.selected.set('A0');fixture.detectChanges();await fixture.whenStable();
  const root=fixture.nativeElement as HTMLElement;
  expect(root.querySelectorAll('.levels-edges > path')).toHaveLength(1);
  const positions=[...root.querySelectorAll('.graph-node')].map(node=>node.getAttribute('data-cell-id'));
  host.connections.set('all');fixture.detectChanges();await fixture.whenStable();
  expect(root.querySelectorAll('.levels-edges > path').length).toBeGreaterThan(1);
  expect([...root.querySelectorAll('.graph-node')].map(node=>node.getAttribute('data-cell-id'))).toEqual(positions);
  fixture.destroy();
});
