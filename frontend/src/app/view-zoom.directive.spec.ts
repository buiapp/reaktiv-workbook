import { Component, CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { TestBed } from '@angular/core/testing';
import { ViewZoomDirective } from './view-zoom.directive';

@Component({
  imports: [ViewZoomDirective],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <div>
      <button data-view-zoom-value>100%</button>
      <div
        id="cells"
        [viewZoom]="cells"
        zoomContent=".sheet-grid"
        (viewZoomChange)="cells = $event; commits.push($event)"
      >
        <div class="sheet-grid-frame" style="width:500px;height:400px">
          <div class="scaled sheet-grid" [style.zoom]="cells"></div>
        </div>
        <reaktiv-plotly></reaktiv-plotly>
      </div>
    </div>
    <div
      id="notes"
      [viewZoom]="notes"
      [viewZoomMin]="0.7"
      [viewZoomMax]="1.6"
      zoomContent=".note-page"
      (viewZoomChange)="notes = $event"
    >
      <div class="note-page" [style.zoom]="notes"></div>
    </div>
  `,
})
class Host {
  private readonly cellScale = signal(1);
  private readonly noteScale = signal(1);
  get cells(): number {
    return this.cellScale();
  }
  set cells(value: number) {
    this.cellScale.set(value);
  }
  get notes(): number {
    return this.noteScale();
  }
  set notes(value: number) {
    this.noteScale.set(value);
  }
  commits: number[] = [];
}

async function setup() {
  await TestBed.configureTestingModule({
    imports: [Host],
    errorOnUnknownElements: false,
  }).compileComponents();
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  let id = 0;
  const frames = new Map<number, FrameRequestCallback>();
  const raf = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.set(++id, callback);
    return id;
  });
  const cancel = vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation((frame) => {
    frames.delete(frame);
  });
  return {
    fixture,
    host: fixture.componentInstance,
    cells: fixture.nativeElement.querySelector('#cells') as HTMLElement,
    notes: fixture.nativeElement.querySelector('#notes') as HTMLElement,
    paint: () => {
      const queued = [...frames.values()];
      frames.clear();
      queued.forEach((callback) => callback(0));
    },
    close: () => {
      fixture.destroy();
      raf.mockRestore();
      cancel.mockRestore();
    },
  };
}
function gesture(element: HTMLElement, name: string, values: Record<string, unknown> = {}) {
  const event = new Event(name, { bubbles: true, cancelable: true });
  Object.assign(event, values);
  element.dispatchEvent(event);
  return event;
}
function wheel(element: HTMLElement, deltaY: number, extra: WheelEventInit = {}) {
  const event = new WheelEvent('wheel', {
    ctrlKey: true,
    deltaY,
    bubbles: true,
    cancelable: true,
    ...extra,
  });
  element.dispatchEvent(event);
  return event;
}
const touches = (distance: number) => [
  { clientX: 0, clientY: 0 },
  { clientX: distance, clientY: 0 },
];

describe('pane-local zoom gestures', () => {
  it('allows cell wheel zoom down to 10% while preserving the note minimum', async () => {
    const {host,cells,notes,paint,close}=await setup();
    try {
      wheel(cells,1000);paint();gesture(cells,'gestureend');expect(host.cells).toBe(0.1);
      wheel(notes,1000);paint();gesture(notes,'gestureend');expect(host.notes).toBe(0.7);
    } finally {close();}
  });

  it('coalesces bursts into one visual update and commits state once at gesture end', async () => {
    const { host, cells, notes, paint, close } = await setup();
    try {
      expect(wheel(cells, -1, { ctrlKey: false }).defaultPrevented).toBe(false);
      for (let index = 0; index < 8; index++) expect(wheel(cells, -1).defaultPrevented).toBe(true);
      expect(host.cells).toBe(1);
      expect(host.commits).toEqual([]);
      expect(cells.querySelector<HTMLElement>('.scaled')!.style.transform).toBe('');
      paint();
      expect(
        parseFloat(cells.querySelector<HTMLElement>('.scaled')!.style.transform.slice(6)),
      ).toBeCloseTo(Math.exp(0.08));
      expect(host.cells).toBe(1);
      expect(host.notes).toBe(1);
      gesture(cells, 'gestureend');
      expect(host.cells).toBeCloseTo(Math.exp(0.08));
      expect(host.commits).toHaveLength(1);
      wheel(notes, -1, { ctrlKey: false, metaKey: true });
      gesture(notes, 'gestureend');
      expect(host.notes).toBeCloseTo(Math.exp(0.01));
    } finally {
      close();
    }
  });

  it('previews relative to native grid zoom and repaints sharply on completion', async () => {
    const { fixture, host, cells, paint, close } = await setup();
    const grid = cells.querySelector<HTMLElement>('.scaled')!;
    const header = document.createElement('div');
    header.className = 'corner-cell';
    grid.append(header);
    try {
      host.cells = 0.8;
      fixture.changeDetectorRef.markForCheck();
      fixture.detectChanges();
      cells.scrollLeft = 100;
      cells.scrollTop = 80;
      wheel(cells, -Math.log(1.25) * 100);
      paint();
      expect(grid.style.zoom).toBe('0.8');
      expect(grid.style.transform).toBe('scale(1.25)');
      expect(header.style.transform).toBe('translate(-25px, -20px)');
      gesture(cells, 'gestureend');
      expect(host.cells).toBe(1);
      expect(grid.style.zoom).toBe('1');
      expect(grid.style.transform).toBe('');
      expect(grid.style.willChange).toBe('');
      expect(header.style.transform).toBe('');
    } finally {
      close();
    }
  });

  it('clamps notes, previews with a transform, then reflows once and preserves plot interactions', async () => {
    const { host, cells, notes, paint, close } = await setup();
    const page = notes.querySelector<HTMLElement>('.note-page')!;
    try {
      wheel(notes, -10000);
      paint();
      expect(page.style.transform).toBe('scale(1.6)');
      expect(page.style.zoom).toBe('1');
      expect(host.notes).toBe(1);
      wheel(notes, 10000);
      paint();
      expect(page.style.transform).toBe('scale(0.7)');
      gesture(notes, 'gestureend');
      expect(host.notes).toBe(0.7);
      expect(page.style.zoom).toBe('0.7');
      expect(page.style.transform).toBe('');
      const event = wheel(cells.querySelector('reaktiv-plotly')! as HTMLElement, -20);
      expect(event.defaultPrevented).toBe(false);
      expect(host.cells).toBe(1);
    } finally {
      close();
    }
  });

  it('supports touch and Safari gestures without double scaling or per-move commits', async () => {
    const { host, cells, paint, close } = await setup();
    try {
      expect(gesture(cells, 'touchstart', { touches: [touches(100)[0]] }).defaultPrevented).toBe(
        false,
      );
      expect(gesture(cells, 'touchstart', { touches: touches(100) }).defaultPrevented).toBe(true);
      gesture(cells, 'touchmove', { touches: touches(120) });
      paint();
      expect(host.cells).toBe(1);
      gesture(cells, 'gesturestart', { scale: 1 });
      gesture(cells, 'touchmove', { touches: touches(150) });
      gesture(cells, 'gesturechange', { scale: 1.25, clientX: 50, clientY: 50 });
      paint();
      expect(cells.querySelector<HTMLElement>('.scaled')!.style.transform).toBe('scale(1.5)');
      gesture(cells, 'gestureend');
      gesture(cells, 'touchend', { touches: [] });
      expect(host.cells).toBe(1.5);
      expect(host.commits).toEqual([1.5]);
    } finally {
      close();
    }
  });

  it('leaves native zoom sticky headers aligned during scrolling and removes its listener', async () => {
    const { fixture, cells, close } = await setup();
    const directive = fixture.debugElement
      .query(By.directive(ViewZoomDirective))
      .injector.get(ViewZoomDirective);
    directive.viewZoom = 2;
    directive.ngOnChanges();
    cells.scrollLeft = 100;
    cells.scrollTop = 80;
    gesture(cells, 'scroll');
    expect(cells.style.getPropertyValue('--sticky-shift-x')).toBe('0px');
    expect(cells.style.getPropertyValue('--sticky-shift-y')).toBe('0px');
    directive.viewZoom = 0.5;
    directive.ngOnChanges();
    expect(cells.style.getPropertyValue('--sticky-shift-x')).toBe('0px');
    close();
    cells.scrollLeft = 50;
    gesture(cells, 'scroll');
    expect(cells.style.getPropertyValue('--sticky-shift-x')).toBe('0px');
  });

  it('anchors the pointer in the same frame as the visual scale and scroll bounds', async () => {
    const { host, cells, paint, close } = await setup();
    const content = cells.querySelector<HTMLElement>('.scaled')!;
    vi.spyOn(content, 'getBoundingClientRect').mockReturnValue({ left: 50, top: 100 } as DOMRect);
    cells.scrollLeft = 30;
    cells.scrollTop = 40;
    try {
      wheel(cells, -Math.log(1.2) * 100, { clientX: 100, clientY: 200 });
      expect(cells.scrollLeft).toBe(30);
      paint();
      expect(cells.scrollLeft).toBeCloseTo(40);
      expect(cells.scrollTop).toBeCloseTo(60);
      expect(cells.querySelector<HTMLElement>('.sheet-grid-frame')!.style.width).toBe('600px');
      expect(host.commits).toEqual([]);
      gesture(cells, 'gestureend');
      expect(host.cells).toBeCloseTo(1.2);
    } finally {
      close();
    }
  });

  it('settles wheel zoom after idle and cancels pending work when destroyed', async () => {
    const state = await setup();
    wheel(state.cells, -10);
    state.paint();
    expect(state.host.commits).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 180));
    expect(state.host.commits).toHaveLength(1);
    wheel(state.cells, -10);
    state.close();
    await new Promise((resolve) => setTimeout(resolve, 180));
    expect(state.host.commits).toHaveLength(1);
  });

  it('settles before chart interaction and lets toolbar changes supersede a preview', async () => {
    const { fixture, host, cells, paint, close } = await setup();
    try {
      wheel(cells, -10);
      paint();
      gesture(cells.querySelector('reaktiv-plotly')! as HTMLElement, 'pointerdown');
      expect(host.commits).toHaveLength(1);
      fixture.detectChanges();
      wheel(cells, -10);
      paint();
      host.cells = 0.8;
      fixture.changeDetectorRef.markForCheck();
      fixture.detectChanges();
      expect(cells.querySelector<HTMLElement>('.scaled')!.style.transform).toBe('');
      expect(cells.querySelector<HTMLElement>('.scaled')!.style.zoom).toBe('0.8');
      gesture(cells, 'gestureend');
      expect(host.commits).toHaveLength(1);
    } finally {
      close();
    }
  });
});
