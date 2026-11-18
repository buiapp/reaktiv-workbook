import {
  Directive,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  inject,
} from '@angular/core';
import { NODE_HEIGHT, NODE_WIDTH, type GraphNodeSize } from '../graph-layout';

/** Preview a card outline during a drag; commit once so charts resize once. */
@Directive({
  selector: 'button[graphNodeResize]',
  host: {
    '(pointerdown)': 'start($event)',
    '(keydown)': 'key($event)',
    '(click)': '$event.stopPropagation()',
    '(dblclick)': 'reset($event)',
    title:
      'Drag to resize · Arrow keys adjust size (Shift for larger steps) · Home or double-click resets · Escape cancels',
  },
})
export class GraphNodeResizeDirective implements OnChanges, OnDestroy {
  @Input({ required: true }) graphNodeResize!: GraphNodeSize;
  @Input() graphResizeZoom = 1;
  @Output() readonly graphSizeChanged = new EventEmitter<GraphNodeSize | null>();
  private readonly element = inject<ElementRef<HTMLButtonElement>>(ElementRef).nativeElement;
  private cancel?: () => void;
  private initial?: { size: GraphNodeSize; zoom: number };

  ngOnChanges(): void {
    if (
      this.initial &&
      (this.initial.zoom !== this.graphResizeZoom ||
        this.initial.size.width !== this.graphNodeResize.width ||
        this.initial.size.height !== this.graphNodeResize.height)
    )
      this.cancel?.();
  }
  private clamp(size: GraphNodeSize): GraphNodeSize {
    return {
      width: Math.max(NODE_WIDTH, Math.round(size.width)),
      height: Math.max(NODE_HEIGHT, Math.round(size.height)),
    };
  }
  start(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    this.cancel?.();
    const card = this.element.closest<HTMLElement>('.graph-node');
    if (!card) return;
    const initial = { size: { ...this.graphNodeResize }, zoom: this.graphResizeZoom };
    this.initial = initial;
    const outline = document.createElement('div');
    outline.className = 'graph-resize-outline';
    outline.setAttribute('aria-hidden', 'true');
    card.append(outline);
    card.classList.add('resizing');
    let frame: number | undefined,
      next = initial.size;
    const sizeAt = (pointer: PointerEvent) =>
      this.clamp({
        width: initial.size.width + (pointer.clientX - event.clientX) / initial.zoom,
        height: initial.size.height + (pointer.clientY - event.clientY) / initial.zoom,
      });
    const paint = () => {
      frame = undefined;
      outline.style.width = `${next.width}px`;
      outline.style.height = `${next.height}px`;
    };
    paint();
    const move = (pointer: PointerEvent) => {
      if (pointer.pointerId !== event.pointerId) return;
      next = sizeAt(pointer);
      if (frame === undefined) frame = requestAnimationFrame(paint);
    };
    const cancel = (pointer?: PointerEvent) => {
      if (pointer && pointer.pointerId !== event.pointerId) return;
      if (frame !== undefined) cancelAnimationFrame(frame);
      outline.remove();
      card.classList.remove('resizing');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', escape, true);
      window.removeEventListener('blur', blur);
      this.cancel = undefined;
      this.initial = undefined;
      if (this.element.hasPointerCapture?.(event.pointerId))
        this.element.releasePointerCapture(event.pointerId);
    };
    const finish = (pointer: PointerEvent) => {
      if (pointer.pointerId !== event.pointerId) return;
      const size = sizeAt(pointer);
      cancel();
      if (size.width !== initial.size.width || size.height !== initial.size.height)
        this.graphSizeChanged.emit(size);
    };
    const escape = (key: KeyboardEvent) => {
      if (key.key === 'Escape') {
        key.preventDefault();
        key.stopPropagation();
        cancel();
      }
    };
    const blur = () => cancel();
    this.cancel = cancel;
    try {
      this.element.setPointerCapture?.(event.pointerId);
    } catch {
      /* Window listeners also support synthetic pointer events. */
    }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', escape, true);
    window.addEventListener('blur', blur);
  }
  key(event: KeyboardEvent): void {
    if (event.key === 'Home') {
      this.reset(event);
      return;
    }
    const step = event.shiftKey ? 80 : 24,
      { width, height } = this.graphNodeResize;
    const sizes: Record<string, GraphNodeSize> = {
      ArrowRight: { width: width + step, height },
      ArrowLeft: { width: width - step, height },
      ArrowDown: { width, height: height + step },
      ArrowUp: { width, height: height - step },
    };
    if (!sizes[event.key]) return;
    event.preventDefault();
    event.stopPropagation();
    this.graphSizeChanged.emit(this.clamp(sizes[event.key]));
  }
  reset(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.cancel?.();
    this.graphSizeChanged.emit(null);
  }
  ngOnDestroy(): void {
    this.cancel?.();
  }
}
