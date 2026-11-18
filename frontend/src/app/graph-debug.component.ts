import { ChangeDetectionStrategy, Component, computed, input, output, ViewEncapsulation } from '@angular/core';
import type { CellDefinition } from './sheet.types';
import type { GraphError } from './graph-errors';

@Component({
  selector: 'app-graph-debug',
  // Graph-only styles load with these deferred controls, including error markers on nodes.
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (section() !== 'diagnostics') {
    <div class="graph-debug-filters" role="group" aria-label="Graph debugging filters">
      <label class="inline-toggle" title="Text and heading cells can read live values; hide them to reduce visual clutter">
        <input type="checkbox" [checked]="hideText()" [disabled]="errorsOnly()" (change)="filterChanged.emit({kind: 'text', enabled: $any($event.target).checked})" />
        Hide text / headings
      </label>
      <label class="inline-toggle" title="No observed dependencies or dependents in the workbook. Not-run or failed cells may still have undiscovered links.">
        <input type="checkbox" [checked]="hideIsolated()" [disabled]="errorsOnly()" (change)="filterChanged.emit({kind: 'isolated', enabled: $any($event.target).checked})" />
        Hide unconnected
      </label>
      <label class="inline-toggle" title="Show failed cells and reported origins, including hidden text, notes and unconnected cells. A focused selection stays visible.">
        <input type="checkbox" [checked]="errorsOnly()" (change)="filterChanged.emit({kind: 'errors', enabled: $any($event.target).checked})" />
        Errors only
      </label>
    </div>
    }
    @if (section() !== 'filters' && errors().size > 0) {
      <div class="graph-diagnostics" role="region" aria-label="Graph errors">
        <button type="button" class="text-button" (click)="problemsRequested.emit()">{{ errors().size }} {{ errors().size === 1 ? 'error' : 'errors' }} · Details</button>
        @if (errors().get(selectedId()); as problem) {
          <span class="graph-error-message" [title]="problem.message">{{ selectedLabel() }}: {{ problem.message }}</span>
          @if (problem.origin; as origin) {
            @if (origin !== selectedId()) {
              @if (hasOrigin(origin)) {
                <button type="button" class="secondary-button" (click)="originRequested.emit(origin)">Go to origin {{ origin }}</button>
              } @else { <span>Reported origin: {{ origin }}</span> }
            } @else { <span class="graph-origin-label">Error origin</span> }
          } @else { <span>Origin unavailable</span> }
          <button type="button" class="text-button" (click)="inspectRequested.emit(selectedId())">Inspect error</button>
        } @else {
          <span>Select a failed cell to trace its reported origin.</span>
        }
      </div>
    }
  `,
  styles: `
    app-graph-debug { display: block; }
    app-graph-debug .graph-debug-filters { display: flex; flex-direction: column; gap: 8px; }
    app-graph-debug[section="diagnostics"]:empty, app-graph-debug[section="diagnostics"]:not(:has(.graph-diagnostics)) { display: none; }
    app-graph-debug label { display: inline-flex; align-items: center; gap: 4px; }
    app-graph-debug button { padding: 4px 8px; border: 1px solid var(--line); border-radius: 5px; background: var(--paper); color: var(--ink); font: inherit; cursor: pointer; }
    app-graph-debug button:hover { background: var(--hover); }

/* Errors retain their meaning through selection and dependency highlighting. */
app-root .app-shell .graph-node.error { border-color: var(--danger); background: light-dark(#fff3f3, #27191a); }
app-root .app-shell .graph-node.error-origin { border-width: 2px; }
app-root .app-shell .graph-node.propagated-error { border-style: dashed; }
app-root .app-shell .graph-node .graph-error-badge { color: var(--danger); font-weight: 700; }
app-root .app-shell .graph-edges path.error-edge { stroke: var(--danger); stroke-width: 2; opacity: 1; }
app-root .graph-toolbar { flex-wrap: wrap; gap: 8px 12px; }
app-root .graph-toolbar > * { flex-shrink: 0; }
app-root .graph-node-meta { overflow: hidden; white-space: nowrap; }
app-root .graph-diagnostics {
  display: flex; align-items: center; flex-wrap: wrap; gap: 6px 12px;
  padding: 6px 12px; border-bottom: 1px solid var(--line);
  background: light-dark(#fff6f4, #23191a); font-size: 11px;
}
app-root .graph-error-message { flex: 1 1 180px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--danger); }
app-root .graph-origin-label { font-weight: 700; color: var(--danger); }
app-root .graph-empty { padding: 16px; color: var(--muted); }
  `,
})
export class GraphDebugComponent {
  /** The filters (View options) and the error bar render separately; both by default. */
  readonly section = input<'all' | 'filters' | 'diagnostics'>('all');
  readonly errors = input.required<ReadonlyMap<string, GraphError>>();
  readonly cells = input.required<readonly CellDefinition[]>();
  readonly selectedId = input.required<string>();
  readonly hideText = input.required<boolean>();
  readonly hideIsolated = input.required<boolean>();
  readonly errorsOnly = input.required<boolean>();
  readonly filterChanged = output<{kind: 'text' | 'isolated' | 'errors'; enabled: boolean}>();
  readonly originRequested = output<string>();
  readonly inspectRequested = output<string>();
  readonly problemsRequested = output<void>();
  private readonly cellMap = computed(() => new Map(this.cells().map(cell => [cell.id, cell])));
  readonly selectedLabel = computed(() => this.cellMap().get(this.selectedId())?.name || this.selectedId());
  hasOrigin(id: string): boolean { return this.cellMap().has(id); }
}
