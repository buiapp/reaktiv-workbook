import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { UiIconComponent, type UiIconName } from './ui-icon.component';
import type { CellKind } from './sheet.types';

// Common editing tasks first; keep creation and filtering menus consistent.
export const CELL_TYPE_ORDER: readonly CellKind[] = ['input', 'formula', 'linked', 'markdown', 'resource', 'effect'];

export const CELL_TYPES: Readonly<
  Record<CellKind, { label: string; symbol: string; icon: UiIconName; color: string }>
> = {
  input: { icon: 'input-signal', label: 'Input', symbol: '○', color: 'light-dark(#2e66b8, #8fb5fa)' },
  linked: { icon: 'link', label: 'Linked input', symbol: '↔', color: 'light-dark(#157e70, #70cdbc)' },
  formula: { icon: 'function', label: 'Formula', symbol: 'ƒ', color: 'light-dark(#7157d9, #b5a3ff)' },
  resource: { icon: 'async-resource', label: 'Async resource', symbol: '◷', color: 'light-dark(#986819, #ebc476)' },
  markdown: { icon: 'note', label: 'Note', symbol: '¶', color: 'light-dark(#4f6d7c, #94bdcf)' },
  effect: { icon: 'bolt', label: 'Effect', symbol: '↯', color: 'light-dark(#b45625, #f4ae82)' },
};

@Component({
  selector: 'app-cell-type-badge',
  imports: [UiIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[style.--cell-kind-color]': 'type().color' },
  template: `<span class="type-badge"
    ><app-ui-icon [name]="type().icon" />{{ type().label }}</span
  >`,
  styles: `
    :host {
      display: inline-flex;
      min-width: 0;
    }
    .type-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 1px 5px;
      border-radius: 4px;
      font:
        650 9px/16px system-ui,
        sans-serif;
      color: var(--cell-kind-color);
      background: color-mix(in srgb, var(--cell-kind-color) 12%, var(--paper));
      white-space: nowrap;
    }
    app-ui-icon {
      width: 12px;
      height: 12px;
      flex-basis: 12px;
    }
  `,
})
export class CellTypeBadgeComponent {
  readonly kind = input.required<CellKind>();
  readonly type = computed(() => CELL_TYPES[this.kind()]);
}
