import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import type { CellDefinition, CellResult } from './sheet.types';

type Metric = 'evaluation' | 'output' | 'size';

/** Read metadata only: never serialize values or trigger evaluation to profile a cell. */
@Component({
  selector: 'app-cell-performance',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h3>Cell performance</h3>
    <label>Rank by <select aria-label="Rank cells by" [value]="metric()" (change)="setMetric($event)">
      <option value="evaluation">Last evaluation</option>
      <option value="output">Output preparation</option>
      <option value="size">Rich output size</option>
    </select></label>
    <p class="hint">{{ hint() }}</p>
    @if (ranked().length) {
      <ol>
        @for (row of ranked(); track row.id) {
          <li>
            <button type="button" (click)="navigate.emit(row.id)" [title]="'Inspect ' + row.id">
              <span>{{ row.id }}{{ row.name ? ' · ' + row.name : '' }}</span>
              <strong>{{ format(row.cost) }}</strong>
            </button>
          </li>
        }
      </ol>
      <small>Top {{ ranked().length }} cells. Values are observations, not an additive request breakdown.</small>
    } @else {
      <p>No measurements available for this ranking. Run the workbook first.</p>
    }
  `,
  styles: `
    :host { display: block; border-top: 1px solid var(--line); margin-top: 12px; padding-top: 8px; }
    h3 { margin: 0 0 8px; color: var(--ink); font-size: inherit; }
    label { display: flex; align-items: center; gap: 8px; }
    select { min-width: 0; max-width: 100%; color: var(--ink); background: var(--paper); border: 1px solid var(--line); border-radius: 4px; padding: 4px; }
    .hint { margin: 8px 0; }
    ol { margin: 8px 0; padding-left: 24px; }
    button { display: flex; width: 100%; align-items: baseline; gap: 12px; text-align: left; border: 0; background: transparent; color: var(--ink); cursor: pointer; padding: 5px 0; font: inherit; }
    button:hover { color: var(--purple); text-decoration: underline; }
    button span { flex: 1; overflow-wrap: anywhere; min-width: 0; }
    strong { white-space: nowrap; font-variant-numeric: tabular-nums; font-weight: 500; }
  `,
})
export class CellPerformanceComponent {
  readonly cells = input<readonly CellDefinition[]>([]);
  readonly results = input<readonly CellResult[]>([]);
  readonly navigate = output<string>();
  readonly metric = signal<Metric>('evaluation');
  readonly hint = computed(() => ({
    evaluation: 'Cached last execution, including time waiting for dependencies. Large times suggest inspecting code or upstream cells; async resources include waiting for I/O.',
    output: 'Latest snapshot: preparing previews, plots, tables and values in Python. Large times suggest reducing output size. Cache hits can be much faster than initial preparation.',
    size: 'Base64 characters in rich outputs, without decoding. Large plots can increase transfer and rendering costs; try fewer points or smaller images.',
  })[this.metric()]);
  readonly ranked = computed(() => {
    const names = new Map(this.cells().map(cell => [cell.id, cell.name]));
    const metric = this.metric();
    return this.results().map(result => ({
      id: result.id, name: names.get(result.id),
      cost: metric === 'evaluation' ? result.durationMs : metric === 'output' ? result.outputPreparationMs : result.richOutput?.dataBase64.length,
    })).filter((row): row is { id: string; name: string | undefined; cost: number } =>
      row.cost != null && Number.isFinite(row.cost) && row.cost >= 0)
      .sort((a, b) => b.cost - a.cost || a.id.localeCompare(b.id)).slice(0, 10);
  });
  setMetric(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (value === 'evaluation' || value === 'output' || value === 'size') this.metric.set(value);
  }
  format(value: number): string {
    if (this.metric() === 'size') return `${value.toLocaleString()} chars`;
    return value >= 1000 ? `${(value / 1000).toFixed(2)} s` : value < 0.01 ? '<0.01 ms' : `${value.toFixed(1)} ms`;
  }
}
