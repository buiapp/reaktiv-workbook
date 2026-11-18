import { TestBed } from '@angular/core/testing';
import { SheetExtentComponent } from './sheet-extent.component';

describe('dragging sheet dimensions', () => {
  it('changes both counts, clamps occupied extents and removes pointer listeners', async () => {
    await TestBed.configureTestingModule({imports: [SheetExtentComponent]}).compileComponents();
    const fixture = TestBed.createComponent(SheetExtentComponent);
    fixture.componentRef.setInput('columns', 10); fixture.componentRef.setInput('rows', 16);
    fixture.componentRef.setInput('minColumns', 4); fixture.componentRef.setInput('minRows', 7);
    const changed = vi.fn(); fixture.componentInstance.changed.subscribe(changed);
    const event = (x: number, y: number) => ({button: 0, pointerId: 1, clientX: x, clientY: y, preventDefault() {}}) as PointerEvent;
    fixture.componentInstance.start(event(100, 100));
    const move = new MouseEvent('pointermove', {clientX: 164, clientY: 172});
    Object.defineProperty(move, 'pointerId', {value: 1}); window.dispatchEvent(move);
    expect(changed).toHaveBeenLastCalledWith({columns: 12, rows: 19});
    const shrink = new MouseEvent('pointermove', {clientX: -1000, clientY: -1000});
    Object.defineProperty(shrink, 'pointerId', {value: 1}); window.dispatchEvent(shrink);
    expect(changed).toHaveBeenLastCalledWith({columns: 4, rows: 7});
    fixture.destroy();
    const count = changed.mock.calls.length; window.dispatchEvent(move);
    expect(changed).toHaveBeenCalledTimes(count);
  });
});
