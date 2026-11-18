import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { CELL_TYPES, CELL_TYPE_ORDER } from './cell-type-badge.component';
import { UiIconComponent } from './ui-icon.component';
import type { CellKind } from './sheet.types';
@Component({
  selector: 'app-cell-focus',
  imports: [UiIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<label>Focus @if (kind(); as selectedKind) { <app-ui-icon [name]="cellTypes[selectedKind].icon" [style.color]="cellTypes[selectedKind].color" /> } <select aria-label="Focus cell type" [value]="kind()" (change)="changed.emit($any($event.target).value)">
    <option value="">All types</option>
    @for (type of types; track type.kind) { <option [value]="type.kind">{{ type.label }}</option> }
  </select></label>`,
  styles: `:host { flex: 0 0 auto; } label { display: flex; gap: 5px; align-items: center; font-size: 11px; color: var(--muted); } select { max-width: 140px; padding: 4px; font: inherit; border: 1px solid var(--line); border-radius: 6px; color: var(--ink); background: var(--paper); }`,
})
export class CellFocusComponent {
  readonly cellTypes = CELL_TYPES;
  readonly types = CELL_TYPE_ORDER.map(kind => ({kind, ...CELL_TYPES[kind]}));
  readonly kind = input<CellKind | ''>('');
  readonly changed = output<CellKind | ''>();
}
