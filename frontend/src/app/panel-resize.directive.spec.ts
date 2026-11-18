import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PanelResizeDirective } from './panel-resize.directive';

@Component({imports: [PanelResizeDirective], template: '<section><div [panelResize]="height" (panelHeightChange)="height = $event"></div></section>'})
class Host { height: number | null = 240; }

describe('resizing bottom panels', () => {
  it('expands upward, clamps, supports keyboard adjustment and cleans up a cancelled drag', async () => {
    await TestBed.configureTestingModule({imports: [Host]}).compileComponents();
    const fixture = TestBed.createComponent(Host); fixture.detectChanges();
    const handle = fixture.nativeElement.querySelector('[role=separator]') as HTMLElement;
    vi.spyOn(handle.parentElement!, 'getBoundingClientRect').mockReturnValue({height: 240} as DOMRect);
    const pointer = (type: string, y: number) => {
      const event = new MouseEvent(type, {button: 0, clientY: y, bubbles: true, cancelable: true});
      Object.defineProperty(event, 'pointerId', {value: 1}); return event;
    };
    handle.dispatchEvent(pointer('pointerdown', 400));
    window.dispatchEvent(pointer('pointermove', 300));
    expect(fixture.componentInstance.height).toBe(340);
    window.dispatchEvent(pointer('pointermove', 10000));
    expect(fixture.componentInstance.height).toBe(140);
    window.dispatchEvent(pointer('pointercancel', 10000));
    window.dispatchEvent(pointer('pointermove', 100));
    expect(fixture.componentInstance.height).toBe(140);
    fixture.detectChanges();
    handle.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowUp', bubbles: true}));
    expect(fixture.componentInstance.height).toBe(164);
    handle.dispatchEvent(new KeyboardEvent('keydown', {key: 'End', bubbles: true}));
    expect(fixture.componentInstance.height).toBe(Math.min(window.innerHeight * 0.6, window.innerHeight - 240));
    fixture.detectChanges();
    handle.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowDown', bubbles: true}));
    expect(fixture.componentInstance.height).toBe(Math.min(window.innerHeight * 0.6, window.innerHeight - 240) - 24);
    handle.dispatchEvent(new MouseEvent('dblclick', {bubbles: true}));
    expect(fixture.componentInstance.height).toBeNull();
    handle.dispatchEvent(pointer('pointerdown', 400)); fixture.destroy();
    window.dispatchEvent(pointer('pointermove', 100));
    expect(fixture.componentInstance.height).toBeNull();
  });
});
