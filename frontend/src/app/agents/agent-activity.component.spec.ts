import { TestBed } from '@angular/core/testing';
import { AgentActivityComponent } from './agent-activity.component';
import { AgentCellFeedbackComponent } from './agent-cell-feedback.component';

it('shows request outcomes and cell links without navigating until explicitly clicked', () => {
  const fixture = TestBed.createComponent(AgentActivityComponent);
  fixture.componentRef.setInput('cellIds', new Set(['A1']));
  fixture.componentRef.setInput('entries', [{id: 1, kind: 'write', label: 'Edit cells', status: 'failed',
    cellIds: ['A1', 'B1'], cellCount: 2, time: Date.now(), error: 'Draft conflict'}]);
  fixture.componentInstance.open.set(true);
  const ids: string[] = []; fixture.componentInstance.cellRequested.subscribe(id => ids.push(id));
  fixture.detectChanges();
  const root = fixture.nativeElement as HTMLElement;
  expect(root.textContent).toContain('Draft conflict'); expect(root.textContent).toContain('Current session');
  const links = [...root.querySelectorAll<HTMLButtonElement>('.cells button')];
  expect(ids).toEqual([]); expect(links[1].disabled).toBe(true);
  links[0].click(); expect(ids).toEqual(['A1']);
  fixture.destroy();
});
it('shows a compact created badge and expands attribution in the inspector', () => {
  const fixture = TestBed.createComponent(AgentCellFeedbackComponent);
  fixture.componentRef.setInput('feedback', {origin: 'created', activity: 'write'});
  fixture.detectChanges();
  expect((fixture.nativeElement as HTMLElement).querySelector('i.write')).not.toBeNull();
  expect(fixture.nativeElement.textContent).toContain('created');
  fixture.componentRef.setInput('inline', true); fixture.detectChanges();
  expect((fixture.nativeElement as HTMLElement).classList.contains('inline')).toBe(true);
  fixture.destroy();
});

it('hides provenance labels without hiding activity animations or discarding their state', () => {
  const fixture = TestBed.createComponent(AgentCellFeedbackComponent);
  fixture.componentRef.setInput('feedback', {origin:'edited',activity:'read'});
  fixture.componentRef.setInput('showOrigin', false); fixture.detectChanges();
  expect(fixture.nativeElement.querySelector('span')).toBeNull();
  expect(fixture.nativeElement.querySelector('i.read')).not.toBeNull();
  fixture.componentRef.setInput('showOrigin', true); fixture.detectChanges();
  expect(fixture.nativeElement.querySelector('span')?.textContent).toContain('Agent');
  fixture.destroy();
});
