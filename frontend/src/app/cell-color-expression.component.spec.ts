import { TestBed } from '@angular/core/testing';
import { CellColorExpressionComponent } from './cell-color-expression.component';

it('keeps expression typing local until Apply and resets it when selecting another cell', async () => {
  const fixture = TestBed.createComponent(CellColorExpressionComponent);
  fixture.componentRef.setInput('cellId', 'A1');
  fixture.componentRef.setInput('enabled', true);
  fixture.componentRef.setInput('expression', 'status_color');
  fixture.detectChanges();
  const emitted = vi.fn(); fixture.componentInstance.applied.subscribe(emitted);
  fixture.componentInstance.draft.set("'#ffcccc' if A1 else None");
  fixture.detectChanges();
  expect(emitted).not.toHaveBeenCalled();
  fixture.nativeElement.querySelector('button').click();
  expect(emitted).toHaveBeenCalledWith("'#ffcccc' if A1 else None");
  fixture.componentRef.setInput('cellId', 'B1'); fixture.detectChanges();
  expect(fixture.componentInstance.draft()).toBe('status_color');
  fixture.destroy();
});
