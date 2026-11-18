import { Component, input, computed, ChangeDetectionStrategy } from '@angular/core';
import type { CellMemory } from './sheet.types';

@Component({
  selector: 'app-cell-memory',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `@if (measurement(); as memory) { <span [title]="memory.limited ? 'Partial estimate: large containers are bounded; custom objects are shallow.' : 'Estimated value size, including container contents. Shared data may appear in multiple cells. Not a share of process RAM.'">≈ {{ label() }}{{ memory.limited ? '+' : '' }}</span> }`,
  styles: `:host { display: inline; font-size: 9px; color: var(--muted); font-variant-numeric: tabular-nums; } span { white-space: nowrap; } :host(.grid-memory) { position: absolute; left: 5px; bottom: 2px; pointer-events: auto; }`,
})
export class CellMemoryComponent {
  readonly measurement = input<CellMemory | undefined>();
  readonly label = computed(() => {
    const bytes = this.measurement()?.bytes ?? 0;
    return bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MiB` : bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KiB` : `${bytes} B`;
  });
}
