import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { connectionBoxes, connectionCurve, traceCellConnections } from './cell-connections';
import type { ConnectionSettings } from './cell-connections';
import type { CellDefinition } from './sheet.types';

@Component({
  selector: 'app-cell-connection-controls',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      [attr.aria-pressed]="settings().upstream"
      title="Show cells read by the selection (upstream)"
      (click)="toggle('upstream')"
    >
      <i class="upstream"></i>Dependencies
    </button>
    <button
      type="button"
      [attr.aria-pressed]="settings().downstream"
      title="Show cells that read the selection (downstream)"
      (click)="toggle('downstream')"
    >
      <i class="downstream"></i>Dependents
    </button>
    <label
      >Depth
      <select
        aria-label="Cell connection depth"
        [value]="settings().depth"
        (change)="setDepth($any($event.target).value)"
      >
        <option value="0">0 (Off)</option>
        <option value="1">1</option>
        <option value="2">2</option>
        <option value="3">3</option>
        <option value="5">5</option>
        <option value="10">10</option>
        <option value="Infinity">All</option>
      </select></label
    >
  `,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      flex: none;
      gap: 10px;
      font-size: 11px;
    }
    button,
    select {
      font: inherit;
      color: inherit;
      background: transparent;
      border: 1px solid transparent;
      border-radius: 5px;
    }
    button {
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 4px 2px;
      cursor: pointer;
    }
    button[aria-pressed='false'] {
      opacity: 0.5;
    }
    button:hover {
      background: var(--hover);
    }
    button[aria-pressed='true'] {
      color: var(--ink);
    }
    i {
      width: 9px;
      height: 9px;
      border-radius: 2px;
    }
    .upstream {
      background: var(--purple);
    }
    .downstream {
      background: var(--lime-dark);
    }
    label {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    select {
      border-color: var(--line);
      background: var(--paper);
      padding: 2px;
    }
    @media (max-width: 640px) {
      :host {
        gap: 5px;
      }
    }
  `,
})
export class CellConnectionControlsComponent {
  readonly settings = input.required<ConnectionSettings>();
  readonly changed = output<ConnectionSettings>();
  toggle(direction: 'upstream' | 'downstream'): void {
    this.changed.emit({ ...this.settings(), [direction]: !this.settings()[direction] });
  }
  setDepth(value: string): void {
    this.changed.emit({ ...this.settings(), depth: Number(value) });
  }
}

let overlayId = 0;
@Component({
  selector: 'app-cell-connections',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg width="100%" height="100%" aria-hidden="true">
      <defs>
        <marker
          [id]="id + '-upstream'"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto"
        >
          <path class="upstream-fill" d="M 1 1 L 9 5 L 1 9 Z" />
        </marker>
        <marker
          [id]="id + '-downstream'"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto"
        >
          <path class="downstream-fill" d="M 1 1 L 9 5 L 1 9 Z" />
        </marker>
      </defs>
      @for (edge of model().paths; track edge.from + ':' + edge.to) {
        <path
          class="connection"
          [class.upstream]="edge.direction === 'upstream'"
          [class.downstream]="edge.direction === 'downstream'"
          [attr.d]="edge.path"
          [attr.data-from]="edge.from"
          [attr.data-to]="edge.to"
          [attr.marker-end]="'url(#' + id + '-' + edge.direction + ')'"
          [style.opacity]="edge.distance === 1 ? 0.9 : 0.65"
        />
      }
    </svg>
    @if (model().external.length || model().truncated) {
      <button
        class="connection-details"
        type="button"
        [style.left.px]="model().badge.x"
        [style.top.px]="model().badge.y"
        [attr.popovertarget]="id + '-details'"
        title="Connections on other sheets and overlay limits"
        aria-label="More cell connections"
      >
        {{ model().external.length ? '↗ ' + model().external.length : '…' }}
      </button>
      <section
        popover
        [id]="id + '-details'"
        class="connections-popover"
        aria-label="Cell connections"
      >
        <strong>Cell connections</strong>
        @if (model().truncated) {
          <p>
            Showing the first 300 connections. Reduce the depth or use Graph to explore further.
          </p>
        }
        @if (model().external.length) {
          <p>Connections to other sheets:</p>
        }
        @for (edge of model().external; track edge.from + ':' + edge.to) {
          <button
            type="button"
            [attr.popovertarget]="id + '-details'"
            popovertargetaction="hide"
            (click)="cellSelected.emit(edge.remote)"
          >
            {{ label(edge.from) }} → {{ label(edge.to) }}
          </button>
        }
      </section>
    }
  `,
  styles: `
    :host {
      position: absolute;
      inset: 0;
      z-index: 2;
      pointer-events: none;
    }
    svg {
      display: block;
      overflow: hidden;
    }
    .connection {
      fill: none;
      stroke-width: 1.8;
      vector-effect: non-scaling-stroke;
    }
    .upstream {
      stroke: var(--purple);
    }
    .downstream {
      stroke: var(--lime-dark);
    }
    .upstream-fill {
      fill: var(--purple);
    }
    .downstream-fill {
      fill: var(--lime-dark);
    }
    .connection-details {
      position: absolute;
      pointer-events: auto;
      padding: 1px 4px;
      border: 1px solid var(--line);
      border-radius: 5px;
      color: var(--purple);
      background: var(--paper);
      font:
        10px ui-monospace,
        monospace;
      cursor: pointer;
    }
    .connections-popover {
      pointer-events: auto;
      position: fixed;
      inset: auto 12px 36px auto;
      margin: 0;
      width: min(360px, calc(100vw - 24px));
      max-height: 60dvh;
      overflow: auto;
      padding: 14px;
      box-sizing: border-box;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: var(--paper);
      color: var(--ink);
      box-shadow: 0 8px 30px light-dark(#0002, #0008);
      font-size: 12px;
    }
    .connections-popover button {
      display: block;
      width: 100%;
      margin: 4px 0;
      padding: 7px;
      border: 0;
      border-radius: 5px;
      text-align: left;
      overflow-wrap: anywhere;
      color: inherit;
      background: var(--hover);
      cursor: pointer;
      font: inherit;
    }
  `,
})
export class CellConnectionsComponent {
  readonly id = `cell-connections-${overlayId++}`;
  readonly selected = input.required<string>();
  readonly dependencies = input.required<Record<string, string[]>>();
  readonly settings = input.required<ConnectionSettings>();
  readonly cells = input.required<readonly CellDefinition[]>();
  readonly sheet = input.required<string>();
  readonly columns = input.required<readonly string[]>();
  readonly rows = input.required<readonly number[]>();
  readonly columnWidths = input.required<Record<string, number>>();
  readonly rowHeights = input.required<Record<string, number>>();
  readonly covered = input.required<ReadonlyMap<string, string>>();
  readonly cellSelected = output<string>();
  private readonly labels = computed(
    () =>
      new Map(
        this.cells().map((cell) => [cell.id, cell.name ? `${cell.name} (${cell.id})` : cell.id]),
      ),
  );
  label(id: string): string {
    return this.labels().get(id) ?? id;
  }
  private readonly boxes = computed(() =>
    connectionBoxes(
      this.cells(),
      this.sheet(),
      this.columns(),
      this.rows(),
      this.columnWidths(),
      this.rowHeights(),
    ),
  );
  readonly model = computed(() => {
    const traced = traceCellConnections(this.selected(), this.dependencies(), this.settings());
    const boxes = this.boxes();
    const paths = [],
      external = [];
    for (const edge of traced.edges) {
      const fromId = this.covered().get(edge.from) ?? edge.from,
        toId = this.covered().get(edge.to) ?? edge.to;
      const from = boxes.get(fromId),
        to = boxes.get(toId);
      if (from && to && fromId !== toId) paths.push({ ...edge, path: connectionCurve(from, to) });
      else if (!!from !== !!to) external.push({ ...edge, remote: from ? edge.to : edge.from });
    }
    const selected = boxes.get(this.covered().get(this.selected()) ?? this.selected());
    return {
      paths,
      external,
      truncated: traced.truncated,
      badge: {
        x: selected ? selected.x + selected.width - 38 : 42,
        y: selected ? selected.y + 2 : 36,
      },
    };
  });
}
