import { TestBed } from '@angular/core/testing';
import { GettingStartedComponent, tourPosition } from './getting-started.component';

describe('guided getting started', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (
      this: HTMLDialogElement,
    ) {
      this.open = true;
    });
    vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (
      this: HTMLDialogElement,
    ) {
      this.open = false;
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('navigates both tours, returns to the chooser, and restores the original view on dismissal', async () => {
    await TestBed.configureTestingModule({
      imports: [GettingStartedComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(GettingStartedComponent);
    fixture.componentRef.setInput('initialView', 'split');
    fixture.componentRef.setInput('examples', []);
    const component = fixture.componentInstance;
    const views: string[] = [];
    const closed: string[] = [];
    component.viewRequested.subscribe((view) => views.push(view));
    component.closed.subscribe((view) => closed.push(view));
    fixture.detectChanges();
    component.start('overview');
    fixture.detectChanges();
    component.next();
    component.next();
    fixture.detectChanges();
    expect(views.at(-1)).toBe('sheet');
    const left = new KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true });
    component.onKey(left);
    fixture.detectChanges();
    expect(component.index()).toBe(1);
    expect(left.defaultPrevented).toBe(true);
    component.choose();
    fixture.detectChanges();
    expect(views.at(-1)).toBe('split');
    component.start('concepts');
    fixture.detectChanges();
    expect(component.index()).toBe(0);
    expect(component.steps()).toHaveLength(8);
    for (let i = 0; i < 8; i++) component.next();
    fixture.detectChanges();
    expect(component.tour()).toBeNull();
    component.start('concepts');
    fixture.detectChanges();
    component.onKey(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(closed).toEqual(['split']);
    fixture.destroy();
  });

  it('keeps tooltips within small viewports and falls back to a centered card without a target', () => {
    expect(tourPosition(390, 760, 300, { left: 350, right: 380, top: 700, bottom: 740 })).toEqual({
      left: 12,
      top: 384,
    });
    expect(tourPosition(800, 600, 250, { left: 100, right: 300, top: 20, bottom: 50 })).toEqual({
      left: 100,
      top: 66,
    });
    expect(tourPosition(800, 600, 250)).toEqual({ left: 200, top: 175 });
    expect(tourPosition(390, 300, 600)).toEqual({ left: 12, top: 12 });
  });
});
