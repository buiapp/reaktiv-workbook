import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { connectionBoxes } from './cell-connections';
import type { CellMovePreview } from './cell-placement';

/** Metadata-only overlay; lives inside the pane's zoomed grid. */
@Component({
  selector: 'app-cell-drop-preview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (box of boxes(); track box.id; let first = $first) {
      <div class="footprint" [class.invalid]="preview().invalid"
        [style.left.px]="box.x" [style.top.px]="box.y" [style.width.px]="box.width" [style.height.px]="box.height">
        <span>{{box.id}}</span>
        @if (first) { <strong role="status">{{preview().message}}</strong> }
      </div>
    }
  `,
  styles: `
    :host { position:absolute; inset:0; pointer-events:none; z-index:8; }
    .footprint { position:absolute; box-sizing:border-box; border:3px dashed var(--purple, #7252c7);
      background:color-mix(in srgb, var(--purple, #7252c7) 15%, transparent); color:var(--ink); }
    .footprint.invalid { border-color:var(--red, #c63333); background:rgb(198 51 51 / 14%); }
    span, strong { display:block; width:fit-content; max-width:100%; box-sizing:border-box;
      padding:3px 6px; background:var(--paper, white); border:1px solid currentColor;
      font:600 12px/1.3 system-ui; overflow-wrap:anywhere; }
    strong { margin-top:2px; max-width:360px; }
  `,
})
export class CellDropPreviewComponent {
  readonly preview = input.required<CellMovePreview>();
  readonly sheet = input.required<string>();
  readonly columns = input.required<readonly string[]>();
  readonly rows = input.required<readonly number[]>();
  readonly columnWidths = input.required<Record<string, number>>();
  readonly rowHeights = input.required<Record<string, number>>();
  readonly boxes = computed(() => [...connectionBoxes(this.preview().cells, this.sheet(), this.columns(), this.rows(),
    this.columnWidths(), this.rowHeights())].map(([id, box]) => ({id, ...box})));
}
