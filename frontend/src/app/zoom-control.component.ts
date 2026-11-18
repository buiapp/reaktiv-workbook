import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * The zoom control of every canvas (note page, cell grid, graph): floats in the bottom-right
 * corner over the content instead of taking a toolbar row. Same look and order everywhere.
 */
@Component({
  selector: 'app-zoom-control',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'zoom-overlay', role: 'group', '[attr.aria-label]': 'label()' },
  template: `
    <button type="button" [attr.aria-label]="outLabel()" [title]="outLabel() + ' (Ctrl/Cmd+scroll or pinch)'" (click)="zoomOut.emit()">−</button>
    <button type="button" data-view-zoom-value title="Reset zoom" (click)="reset.emit()">{{ (zoom() * 100).toFixed(0) }}%</button>
    <button type="button" [attr.aria-label]="inLabel()" [title]="inLabel() + ' (Ctrl/Cmd+scroll or pinch)'" (click)="zoomIn.emit()">+</button>
    @if (fitTitle()) {
      <button type="button" [attr.aria-label]="fitLabel()" [title]="fitTitle()" (click)="fit.emit($event)">Fit</button>
    }
  `,
})
export class ZoomControlComponent {
  readonly zoom = input.required<number>();
  readonly label = input('Zoom');
  readonly outLabel = input('Zoom out');
  readonly inLabel = input('Zoom in');
  readonly fitLabel = input('Fit in view');
  /** Shown as the Fit button's tooltip; no Fit button when empty. */
  readonly fitTitle = input('');
  readonly zoomOut = output<void>();
  readonly zoomIn = output<void>();
  readonly reset = output<void>();
  readonly fit = output<MouseEvent>();
}
