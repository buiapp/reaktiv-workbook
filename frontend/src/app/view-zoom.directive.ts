import {
  Directive,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  inject,
} from '@angular/core';

interface ScaleGesture extends Event {
  scale: number;
  clientX: number;
  clientY: number;
}
interface ZoomPreview {
  content: HTMLElement | null;
  frame: HTMLElement | null;
  label: HTMLElement | null;
  base: number;
  target: number;
  notes: boolean;
  cssZoom: boolean;
  width: number;
  height: number;
  scrollX: number;
  scrollY: number;
  originX: number;
  originY: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  transform: string;
  transformOrigin: string;
  willChange: string;
  frameWidth: string;
  frameHeight: string;
  headers: { element: HTMLElement; axis: 'x' | 'y' | 'both'; transform: string }[];
  applied: number;
}

/** Gestures preview on the DOM; domain/persistence state changes once on completion. */
@Directive({ selector: '[viewZoom]' })
export class ViewZoomDirective implements OnInit, OnChanges, OnDestroy {
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  @Input() viewZoom = 1;
  @Input() viewZoomMin = 0.1;
  @Input() viewZoomMax = 2;
  @Input() zoomContent = '';
  @Output() readonly viewZoomChange = new EventEmitter<number>();
  private readonly removeListeners: (() => void)[] = [];
  private touchDistance = 0;
  private gestureScale = 0;
  private frame: number | null = null;
  private idle: ReturnType<typeof setTimeout> | null = null;
  private preview: ZoomPreview | null = null;

  ngOnChanges(): void {
    // Toolbar buttons, document switches and history can change zoom mid-gesture.
    if (this.preview && this.viewZoom !== this.preview.base) this.cancel();
    this.syncStickyOffsets();
  }

  private syncStickyOffsets(x = this.element.scrollLeft, y = this.element.scrollTop): void {
    if (this.zoomContent !== '.sheet-grid') return;
    // Native layout zoom keeps sticky headers aligned. Only the temporary
    // transform preview needs compensation, relative to its settled zoom.
    const correction = this.preview ? 1 / this.preview.applied - 1 / this.preview.base : 0;
    if (this.preview) {
      for (const header of this.preview.headers) {
        const dx = header.axis === 'y' ? 0 : x * correction,
          dy = header.axis === 'x' ? 0 : y * correction;
        header.element.style.transform = `translate(${dx}px, ${dy}px)`;
      }
      return;
    }
    for (const [axis, value] of [
      ['x', x * correction],
      ['y', y * correction],
    ] as const) {
      const name = '--sticky-shift-' + axis,
        next = `${value}px`;
      if (this.element.style.getPropertyValue(name) !== next)
        this.element.style.setProperty(name, next);
    }
  }

  ngOnInit(): void {
    this.element.addEventListener('scroll', this.handleScroll, { passive: true });
    this.removeListeners.push(() => this.element.removeEventListener('scroll', this.handleScroll));
    const listen = (name: string, handler: (event: Event) => void, capture = false) => {
      this.element.addEventListener(name, handler, { passive: false, capture });
      this.removeListeners.push(() => this.element.removeEventListener(name, handler, capture));
    };
    // Settle the final layout before charts, editors or toolbar controls handle input.
    const finishOnPointer = () => this.finish();
    this.element.ownerDocument.addEventListener('pointerdown', finishOnPointer, true);
    this.removeListeners.push(() =>
      this.element.ownerDocument.removeEventListener('pointerdown', finishOnPointer, true),
    );
    this.element.ownerDocument.addEventListener('keydown', finishOnPointer, true);
    this.removeListeners.push(() =>
      this.element.ownerDocument.removeEventListener('keydown', finishOnPointer, true),
    );
    listen('wheel', (event) => this.wheel(event as WheelEvent));
    listen('gesturestart', (event) => {
      if (!this.accept(event)) return;
      event.preventDefault();
      this.gestureScale = (event as ScaleGesture).scale || 1;
    });
    listen('gesturechange', (event) => {
      if (!this.gestureScale || !this.accept(event)) return;
      event.preventDefault();
      const gesture = event as ScaleGesture;
      this.scale(gesture.scale / this.gestureScale, gesture.clientX, gesture.clientY);
      this.gestureScale = gesture.scale;
    });
    listen('gestureend', (event) => {
      if (this.gestureScale) event.preventDefault();
      this.gestureScale = 0;
      this.finish();
    });
    listen('touchstart', (event) => {
      const touch = event as TouchEvent;
      if (touch.touches.length !== 2 || !this.accept(event)) {
        this.touchDistance = 0;
        return;
      }
      event.preventDefault();
      this.touchDistance = this.distance(touch);
    });
    listen('touchmove', (event) => {
      const touch = event as TouchEvent;
      if (!this.touchDistance || touch.touches.length !== 2) return;
      event.preventDefault();
      const distance = this.distance(touch);
      if (!this.gestureScale && distance > 0) {
        this.scale(
          distance / this.touchDistance,
          (touch.touches[0].clientX + touch.touches[1].clientX) / 2,
          (touch.touches[0].clientY + touch.touches[1].clientY) / 2,
        );
      }
      this.touchDistance = distance;
    });
    const endTouch = () => {
      this.touchDistance = 0;
      this.finish();
    };
    listen('touchend', endTouch);
    listen('touchcancel', endTouch);
  }

  private readonly handleScroll = (): void => this.syncStickyOffsets();

  private accept(event: Event): boolean {
    return (
      !event.defaultPrevented &&
      !(
        event.target instanceof Element &&
        event.target.closest('reaktiv-plotly, reaktiv-anywidget, iframe')
      )
    );
  }

  private wheel(event: WheelEvent): void {
    if ((!event.ctrlKey && !event.metaKey) || !this.accept(event)) return;
    event.preventDefault();
    if (this.gestureScale) return;
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.element.clientHeight : 1;
    this.scale(Math.exp(-event.deltaY * unit * 0.01), event.clientX, event.clientY);
    if (this.idle !== null) clearTimeout(this.idle);
    this.idle = setTimeout(() => this.finish(), 160);
  }

  private distance(event: TouchEvent): number {
    return Math.hypot(
      event.touches[0].clientX - event.touches[1].clientX,
      event.touches[0].clientY - event.touches[1].clientY,
    );
  }

  private scale(factor: number, x: number, y: number): void {
    if (!Number.isFinite(factor) || factor <= 0) return;
    const before = this.preview?.target ?? this.viewZoom;
    const after = Math.min(this.viewZoomMax, Math.max(this.viewZoomMin, before * factor));
    if (after === before) return;
    if (!this.preview) {
      const content = this.zoomContent
        ? this.element.querySelector<HTMLElement>(this.zoomContent)
        : null;
      const rect = content?.getBoundingClientRect();
      const frame = content?.parentElement?.matches('.sheet-grid-frame, .graph-zoom-frame')
        ? content.parentElement
        : null;
      this.preview = {
        content,
        frame,
        label: (this.element.querySelector('[data-view-zoom-value]') ??
          this.element.parentElement?.querySelector(
            '[data-view-zoom-value]',
          )) as HTMLElement | null,
        base: this.viewZoom,
        target: after,
        notes: !!content?.matches('.note-page, .raw-source'),
        cssZoom: !!content?.matches('.sheet-grid, .note-page, .raw-source'),
        width: frame ? parseFloat(frame.style.width) || frame.offsetWidth : 0,
        height: frame ? parseFloat(frame.style.height) || frame.offsetHeight : 0,
        scrollX: this.element.scrollLeft,
        scrollY: this.element.scrollTop,
        originX: x - (rect?.left ?? x),
        originY: y - (rect?.top ?? y),
        startX: x,
        startY: y,
        x,
        y,
        transform: content?.style.transform ?? '',
        transformOrigin: content?.style.transformOrigin ?? '',
        willChange: content?.style.willChange ?? '',
        frameWidth: frame?.style.width ?? '',
        frameHeight: frame?.style.height ?? '',
        applied: this.viewZoom,
        headers:
          this.zoomContent !== '.sheet-grid'
            ? []
            : [
                ...this.element.querySelectorAll<HTMLElement>(
                  '.row-header, .column-header, .corner-cell',
                ),
              ].map((element) => ({
                element,
                axis: element.matches('.row-header')
                  ? 'x'
                  : element.matches('.column-header')
                    ? 'y'
                    : 'both',
                transform: element.style.transform,
              })),
      };
      if (content) content.style.willChange = 'transform';
    } else {
      this.preview.target = after;
      this.preview.x = x;
      this.preview.y = y;
    }
    if (this.frame === null)
      this.frame = requestAnimationFrame(() => {
        this.frame = null;
        this.paint();
      });
  }

  private paint(): void {
    const preview = this.preview;
    if (!preview) return;
    const { content, frame, target, base } = preview;
    const ratio = target / base;
    // Keep settled layout zoom during the gesture; reflow and paint sharp text
    // once on completion, without notifying Angular or resizing charts per event.
    if (content) {
      content.style.transformOrigin = '0 0';
      content.style.transform = `scale(${preview.cssZoom ? ratio : target})`;
    }
    if (frame) {
      frame.style.width = `${preview.width * ratio}px`;
      frame.style.height = `${preview.height * ratio}px`;
    }
    if (preview.label) preview.label.textContent = `${Math.round(target * 100)}%`;
    const x = preview.scrollX + preview.originX * (ratio - 1) + preview.startX - preview.x;
    const y = preview.scrollY + preview.originY * (ratio - 1) + preview.startY - preview.y;
    preview.applied = target;
    this.syncStickyOffsets(x, y);
    this.element.scrollLeft = x;
    this.element.scrollTop = y;
  }

  private finish(): void {
    if (this.idle !== null) clearTimeout(this.idle);
    this.idle = null;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    const preview = this.preview;
    if (!preview) return;
    this.paint();
    if (preview.content && preview.cssZoom) {
      // Commit native layout zoom so the browser repaints at the final scale.
      preview.content.style.zoom = String(preview.target);
      if (preview.notes) preview.content.style.setProperty('--note-zoom', String(preview.target));
      preview.content.style.transform = preview.transform;
      preview.content.style.transformOrigin = preview.transformOrigin;
      if (preview.notes) {
        // Notes recenter when their layout zoom changes.
        const rect = preview.content.getBoundingClientRect(),
          ratio = preview.target / preview.base;
        this.element.scrollLeft += rect.left + preview.originX * ratio - preview.x;
        this.element.scrollTop += rect.top + preview.originY * ratio - preview.y;
      }
    }
    if (preview.content) {
      preview.content.style.transformOrigin = preview.transformOrigin;
      preview.content.style.willChange = preview.willChange;
    }
    this.preview = null;
    for (const header of preview.headers) header.element.style.transform = header.transform;
    this.viewZoom = preview.target;
    this.syncStickyOffsets();
    this.viewZoomChange.emit(preview.target);
  }

  private cancel(): void {
    if (this.idle !== null) clearTimeout(this.idle);
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.idle = null;
    this.frame = null;
    const preview = this.preview;
    this.preview = null;
    if (preview)
      for (const header of preview.headers) header.element.style.transform = header.transform;
    if (preview?.content) {
      preview.content.style.transform = preview.cssZoom
        ? preview.transform
        : `scale(${this.viewZoom})`;
      preview.content.style.transformOrigin = preview.transformOrigin;
      preview.content.style.willChange = preview.willChange;
      if (preview.cssZoom) preview.content.style.zoom = String(this.viewZoom);
      if (preview.notes) {
        preview.content.style.setProperty('--note-zoom', String(this.viewZoom));
      }
    }
    if (preview?.frame) {
      preview.frame.style.width =
        this.viewZoom === preview.base
          ? preview.frameWidth
          : `${(preview.width * this.viewZoom) / preview.base}px`;
      preview.frame.style.height =
        this.viewZoom === preview.base
          ? preview.frameHeight
          : `${(preview.height * this.viewZoom) / preview.base}px`;
    }
    if (preview?.label) preview.label.textContent = `${Math.round(this.viewZoom * 100)}%`;
  }

  ngOnDestroy(): void {
    this.cancel();
    for (const remove of this.removeListeners) remove();
  }
}
