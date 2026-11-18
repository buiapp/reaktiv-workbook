import { DestroyRef, Directive, ElementRef, afterRenderEffect, inject, input } from '@angular/core';

const MARGIN = 8;

/** Where a `position: fixed` popup opened at (x, y) fits in the window: it opens to the
 * left of / above the pointer when it would cross the right / bottom edge, and is pushed
 * back in when it fits neither way. */
export function placeInView(
  x: number,
  y: number,
  width: number,
  height: number,
  viewport: { width: number; height: number },
): { left: number; top: number } {
  const fit = (start: number, size: number, limit: number) => {
    if (start + size <= limit - MARGIN) return start;
    if (start - size >= MARGIN) return start - size;
    return Math.max(MARGIN, limit - MARGIN - size);
  };
  return { left: fit(x, width, viewport.width), top: fit(y, height, viewport.height) };
}

/** `[appKeepInView]="{ x, y }"` places a fixed context menu at the pointer, inside the
 * window (it scrolls when it is taller than the window), and again when its size changes. */
@Directive({ selector: '[appKeepInView]' })
export class KeepInViewDirective {
  readonly appKeepInView = input.required<{ x: number; y: number }>();
  private readonly element: HTMLElement = inject(ElementRef).nativeElement;

  constructor() {
    afterRenderEffect(() => this.place(this.appKeepInView()));
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => this.place(this.appKeepInView()));
      observer.observe(this.element);
      inject(DestroyRef).onDestroy(() => observer.disconnect());
    }
  }

  private place({ x, y }: { x: number; y: number }): void {
    const style = this.element.style;
    style.maxHeight = `${window.innerHeight - 2 * MARGIN}px`;
    style.overflowY = 'auto';
    const { width, height } = this.element.getBoundingClientRect();
    const { left, top } = placeInView(x, y, width, height, { width: window.innerWidth, height: window.innerHeight });
    style.left = `${left}px`;
    style.top = `${top}px`;
  }
}
