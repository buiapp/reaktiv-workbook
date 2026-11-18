import { Directive, ElementRef, EventEmitter, Input, OnDestroy, Output, inject } from '@angular/core';

/** A bottom-docked panel expands upward. Its owner retains the chosen height. */
@Directive({
  selector: '[panelResize]',
  host: {
    role: 'separator', tabindex: '0', 'aria-orientation': 'horizontal',
    '[attr.aria-valuenow]': 'panelResize', '[attr.aria-valuemin]': 'minimum',
    '[attr.aria-valuemax]': 'maximum',
    '(pointerdown)': 'start($event)', '(keydown)': 'key($event)',
    '(dblclick)': 'panelHeightChange.emit(null)',
    title: 'Drag to resize · Arrow keys adjust height · Double-click to reset',
  },
})
export class PanelResizeDirective implements OnDestroy {
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  @Input() panelResize: number | null = null;
  @Output() panelHeightChange = new EventEmitter<number | null>();
  get minimum(): number { return Math.min(140, this.maximum); }
  // Match the dock CSS limit so keyboard resizing cannot accumulate invisible height.
  get maximum(): number { return Math.max(0, Math.min(window.innerHeight * 0.6, window.innerHeight - 240)); }
  private stop?: () => void;
  private clamp(height: number): number { return Math.min(this.maximum, Math.max(this.minimum, height)); }
  start(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation(); this.stop?.();
    const startY = event.clientY;
    const height = this.element.parentElement?.getBoundingClientRect().height ?? this.minimum;
    const move = (pointer: PointerEvent) => {
      if (pointer.pointerId === event.pointerId) this.panelHeightChange.emit(this.clamp(height + startY - pointer.clientY));
    };
    const stop = (pointer?: PointerEvent) => {
      if (pointer && pointer.pointerId !== event.pointerId) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      this.stop = undefined;
    };
    this.stop = stop;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  }
  key(event: KeyboardEvent): void {
    const height = this.panelResize ?? this.element.parentElement?.getBoundingClientRect().height ?? this.minimum;
    const step = event.shiftKey ? 80 : 24;
    const values: Record<string, number> = {ArrowUp: height + step, ArrowDown: height - step, Home: this.minimum, End: this.maximum};
    if (!(event.key in values)) return;
    event.preventDefault(); event.stopPropagation();
    this.panelHeightChange.emit(this.clamp(values[event.key]));
  }
  ngOnDestroy(): void { this.stop?.(); }
}
