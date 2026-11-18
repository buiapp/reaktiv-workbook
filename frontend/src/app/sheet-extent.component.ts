import { Component, ChangeDetectionStrategy, input, output, OnDestroy } from '@angular/core';

@Component({
  selector: 'app-sheet-extent',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<button type="button" aria-label="Resize sheet dimensions" title="Drag right for columns, down for rows. Arrow keys change one at a time. Occupied cells are preserved."
    (pointerdown)="start($event)" (keydown)="key($event)">↘ {{ columns() }} × {{ rows() }}</button>`,
  styles: `button { touch-action: none; cursor: nwse-resize; padding: 5px 8px; border: 1px solid var(--line); border-radius: 6px; color: var(--muted); background: var(--paper); font: inherit; white-space: nowrap; font-variant-numeric: tabular-nums; } button:hover { color: var(--purple); }`,
})
export class SheetExtentComponent implements OnDestroy {
  readonly columns = input.required<number>();
  readonly rows = input.required<number>();
  readonly minColumns = input(1);
  readonly minRows = input(1);
  readonly started = output<void>();
  readonly changed = output<{ columns: number; rows: number }>();
  private stop?: () => void;

  private emit(columns: number, rows: number): void {
    this.changed.emit({ columns: Math.max(this.minColumns(), columns, 1), rows: Math.max(this.minRows(), rows, 1) });
  }

  start(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    this.started.emit();
    this.stop?.();
    const origin = { x: event.clientX, y: event.clientY, columns: this.columns(), rows: this.rows() };
    const move = (pointer: PointerEvent) => {
      if (pointer.pointerId !== event.pointerId) return;
      this.emit(origin.columns + Math.round((pointer.clientX - origin.x) / 32), origin.rows + Math.round((pointer.clientY - origin.y) / 24));
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
    const step = event.shiftKey ? 10 : 1;
    const deltas: Record<string, [number, number]> = { ArrowRight: [step, 0], ArrowLeft: [-step, 0], ArrowDown: [0, step], ArrowUp: [0, -step] };
    const delta = deltas[event.key];
    if (!delta) return;
    event.preventDefault();
    this.started.emit();
    this.emit(this.columns() + delta[0], this.rows() + delta[1]);
  }

  ngOnDestroy(): void { this.stop?.(); }
}
