import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { GraphNodeSize } from '../graph-layout';
import { GraphNodeResizeDirective } from './graph-node-resize.directive';

@Component({
  imports: [GraphNodeResizeDirective],
  template:
    '<div class="graph-node"><button [graphNodeResize]="size" [graphResizeZoom]="zoom" (graphSizeChanged)="changed($event)">Resize</button></div>',
})
class Host {
  size = { width: 320, height: 240 };
  zoom = 0.5;
  changed = vi.fn<(size: GraphNodeSize | null) => void>();
}
const pointer = (type: string, x: number, y: number, id = 1) => {
  const event = new MouseEvent(type, {
    clientX: x,
    clientY: y,
    button: 0,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, 'pointerId', { value: id });
  return event;
};

describe('graph card resize gestures', () => {
  async function create() {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    return {
      fixture,
      host: fixture.componentInstance,
      handle: fixture.nativeElement.querySelector('button') as HTMLButtonElement,
    };
  }
  it('previews without committing, compensates for zoom and commits the final pointer position once', async () => {
    const { fixture, host, handle } = await create();
    const bubble = vi.fn();
    fixture.nativeElement.addEventListener('pointerdown', bubble);
    handle.dispatchEvent(pointer('pointerdown', 100, 100));
    window.dispatchEvent(pointer('pointermove', 140, 125));
    expect(bubble).not.toHaveBeenCalled();
    expect(host.changed).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('.graph-resize-outline')).not.toBeNull();
    window.dispatchEvent(pointer('pointerup', 150, 130));
    expect(host.changed).toHaveBeenCalledExactlyOnceWith({ width: 420, height: 300 });
    expect(fixture.nativeElement.querySelector('.graph-resize-outline')).toBeNull();
    window.dispatchEvent(pointer('pointermove', 200, 200));
    expect(host.changed).toHaveBeenCalledTimes(1);
    fixture.destroy();
  });
  it('ignores other pointers and cancels on Escape, pointer cancellation, zoom changes and destruction', async () => {
    const { fixture, host, handle } = await create();
    handle.dispatchEvent(pointer('pointerdown', 100, 100));
    window.dispatchEvent(pointer('pointerup', 200, 200, 2));
    expect(host.changed).not.toHaveBeenCalled();
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    window.dispatchEvent(pointer('pointerup', 200, 200));
    expect(host.changed).not.toHaveBeenCalled();
    handle.dispatchEvent(pointer('pointerdown', 100, 100));
    window.dispatchEvent(pointer('pointercancel', 200, 200));
    handle.dispatchEvent(pointer('pointerdown', 100, 100));
    host.zoom = 1;
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.graph-resize-outline')).toBeNull();
    window.dispatchEvent(pointer('pointerup', 200, 200));
    expect(host.changed).not.toHaveBeenCalled();
    handle.dispatchEvent(pointer('pointerdown', 100, 100));
    fixture.destroy();
    window.dispatchEvent(pointer('pointerup', 200, 200));
    expect(host.changed).not.toHaveBeenCalled();
  });
  it('supports keyboard adjustment, minimum sizes, and resetting without selecting or editing the cell', async () => {
    const { fixture, host, handle } = await create();
    const click = vi.fn();
    fixture.nativeElement.addEventListener('click', click);
    handle.click();
    expect(click).not.toHaveBeenCalled();
    handle.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }),
    );
    expect(host.changed).toHaveBeenLastCalledWith({ width: 400, height: 240 });
    handle.dispatchEvent(pointer('pointerdown', 100, 100));
    window.dispatchEvent(pointer('pointerup', -1000, -1000));
    expect(host.changed).toHaveBeenLastCalledWith({ width: 176, height: 62 });
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(host.changed).toHaveBeenLastCalledWith(null);
    handle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(host.changed).toHaveBeenLastCalledWith(null);
    fixture.destroy();
  });
});
