import { computed, signal, type Signal } from '@angular/core';
import {
  buildGraphLayout,
  resizePinnedGraph,
  NODE_WIDTH,
  NODE_HEIGHT,
  type GraphNodeSize,
  type GraphLayout,
  type GraphOptions,
  type GraphDirection,
} from '../graph-layout';
import { graphOutputSizes, sameNodeSizes } from './graph-outputs';
import { GraphLevelScrollState, type GraphConnections } from './graph-levels';
import { updatePath } from '../update-trace';
import type { WorkbookState } from '../workbook/workbook-state';

type TracePath = { id: string; direction: 'upstream' | 'downstream' };

/** Read-only graph projections plus independent user visibility preferences. */
export class GraphWorkspace {
  readonly showOutputs = signal(false);
  readonly direction = signal<GraphDirection>('horizontal');
  readonly scrollableLevels = signal(false);
  readonly inputsFirst = signal(false);
  readonly connections = signal<GraphConnections>('selected');
  private readonly levelStates = new Map<number, GraphLevelScrollState>();
  levelState(index: number): GraphLevelScrollState {
    let state = this.levelStates.get(index);
    if (!state) {state = new GraphLevelScrollState(); this.levelStates.set(index, state);}
    return state;
  }
  private readonly customSizes = signal<ReadonlyMap<string, GraphNodeSize>>(new Map());
  private readonly pins = signal<
    ReadonlyMap<number, { layout: GraphLayout; outputs: boolean; focused: boolean; sheet: string | null }>
  >(new Map());
  private readonly outputSizes = computed(
    () => {
      const sizes = new Map(
        this.showOutputs() ? graphOutputSizes(this.state.cells(), this.state.resultMap()) : [],
      );
      for (const [id, size] of this.customSizes())
        if (this.state.definitionMap().has(id)) sizes.set(id, size);
      return sizes;
    },
    { equal: sameNodeSizes },
  );
  readonly traceUpdates = signal(false);
  readonly updateTracePath = signal<TracePath | null>(null);
  readonly graphFocus = signal(false);
  readonly graphDepth = signal(Infinity);
  readonly graphHideNotes = signal(false);
  readonly graphHideText = signal(true);
  readonly graphHideIsolated = signal(false);
  readonly graphErrorsOnly = signal(false);
  readonly graphThisSheet = signal(false);
  readonly updateTraceIds = computed(() => {
    const path = this.updateTracePath();
    return path
      ? updatePath(this.state.graph().updateTrace, path.id, path.direction)
      : new Set<string>();
  });
  private readonly errorIds = computed(
    () =>
      new Set([
        ...this.state.errors().keys(),
        ...[...this.state.errors().values()].flatMap((error) =>
          error.origin ? [error.origin] : [],
        ),
      ]),
  );
  private readonly liveLayout = computed(() =>
    buildGraphLayout(
      this.state.cells(),
      this.state.graphDependencies(),
      this.options(this.graphThisSheet() ? this.activeSheet() : null),
    ),
  );

  readonly layout = computed(() => this.pinnedLayout(-1) ?? this.liveLayout());

  isPinned(index: number): boolean {
    return this.pins().has(index);
  }
  outputsShown(index: number): boolean {
    return this.pins().get(index)?.outputs ?? this.showOutputs();
  }
  focused(index: number): boolean {
    return this.pins().get(index)?.focused ?? this.graphFocus();
  }
  scope(index: number, sheet: string): string | null {
    const pin = this.pins().get(index);
    return pin ? pin.sheet : this.graphThisSheet() ? sheet : null;
  }
  pin(index: number, layout: GraphLayout, sheet = this.activeSheet()): void {
    this.pins.update((pins) =>
      new Map(pins).set(index, { layout, outputs: this.showOutputs(), focused: this.graphFocus(), sheet: this.graphThisSheet() ? sheet : null }),
    );
  }
  unpin(index: number): void {
    if (!this.isPinned(index)) return;
    this.pins.update((pins) => {
      const next = new Map(pins);
      next.delete(index);
      return next;
    });
  }
  swapPins(): void {
    const firstLevels = this.levelStates.get(0), secondLevels = this.levelStates.get(1);
    this.levelStates.delete(0); this.levelStates.delete(1);
    if (firstLevels) this.levelStates.set(1, firstLevels);
    if (secondLevels) this.levelStates.set(0, secondLevels);
    const next = new Map(this.pins()),
      first = next.get(0),
      second = next.get(1);
    next.delete(0);
    next.delete(1);
    if (first) next.set(1, first);
    if (second) next.set(0, second);
    this.pins.set(next);
  }
  clearPins(): void {
    this.pins.set(new Map());
  }

  resizeNode(index: number, id: string, requested: GraphNodeSize | null): void {
    const cell = this.state.definitionMap().get(id);
    if (!cell) return;
    const size =
      requested === null
        ? ((this.outputsShown(index)
            ? graphOutputSizes([cell], this.state.resultMap()).get(id)
            : undefined) ?? { width: NODE_WIDTH, height: NODE_HEIGHT })
        : {
            width: Math.max(NODE_WIDTH, Math.round(requested.width)),
            height: Math.max(NODE_HEIGHT, Math.round(requested.height)),
          };
    this.customSizes.update((sizes) => {
      const next = new Map([...sizes].filter(([id]) => this.state.definitionMap().has(id)));
      if (requested === null) next.delete(id);
      else next.set(id, size);
      return next;
    });
    const layout = this.pinnedLayout(index);
    if (layout)
      this.pins.update((pins) => {
        const next = new Map(pins),
          pin = next.get(index)!;
        next.set(index, { ...pin, layout: resizePinnedGraph(layout, id, size) });
        return next;
      });
  }
  resetViews(): void {
    this.levelStates.clear();
    this.clearPins();
    this.customSizes.set(new Map());
  }

  private pinnedLayout(index: number): GraphLayout | undefined {
    const pin = this.pins().get(index);
    if (!pin) return undefined;
    const definitions = this.state.definitionMap();
    const nodes = pin.layout.nodes
      .filter((node) => definitions.has(node.id))
      .map((node) => {
        const kind = definitions.get(node.id)!.kind;
        return node.kind === kind ? node : { ...node, kind };
      });
    if (
      definitions.size === pin.layout.total &&
      nodes.length === pin.layout.nodes.length &&
      nodes.every((node, i) => node === pin.layout.nodes[i])
    )
      return pin.layout;
    const ids = new Set(nodes.map((node) => node.id));
    return {
      ...pin.layout,
      nodes,
      edges: pin.layout.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to)),
      total: definitions.size,
      hidden: definitions.size - nodes.length,
    };
  }

  constructor(
    private readonly state: WorkbookState,
    private readonly selectedId: Signal<string>,
    private readonly activeSheet: Signal<string>,
  ) {}

  /** Merely creating/rendering a notes or cells pane must not lay out a graph. */
  paneLayout(sheet: string, index = -1): Signal<GraphLayout> {
    return computed(
      () =>
        this.pinnedLayout(index) ??
        (this.graphThisSheet()
          ? buildGraphLayout(
              this.state.cells(),
              this.state.graphDependencies(),
              this.options(sheet),
            )
          : this.liveLayout()),
    );
  }

  private options(sheet: string | null): GraphOptions {
    const tracing = this.updateTracePath() !== null;
    return {
      direction: this.direction(),
      inputsFirst: this.inputsFirst(),
      nodeSizes: this.outputSizes(),
      focus: !tracing && this.graphFocus() ? this.selectedId() : null,
      depth: this.graphDepth(),
      hideNotes: !tracing && !this.graphErrorsOnly() && this.graphHideNotes(),
      hideText: !tracing && !this.graphErrorsOnly() && this.graphHideText(),
      hideIsolated: !tracing && !this.graphErrorsOnly() && this.graphHideIsolated(),
      onlyIds: tracing ? this.updateTraceIds() : this.graphErrorsOnly() ? this.errorIds() : null,
      sheet: tracing ? null : sheet,
    };
  }

  settings(): string {
    return JSON.stringify({
      direction: this.direction(),
      inputsFirst: this.inputsFirst(),
      scrollableLevels: this.scrollableLevels(),
      connections: this.connections(),
      outputs: this.showOutputs(),
      focus: this.graphFocus(),
      depth: Number.isFinite(this.graphDepth()) ? this.graphDepth() : 'all',
      hideNotes: this.graphHideNotes(),
      hideText: this.graphHideText(),
      hideIsolated: this.graphHideIsolated(),
      errorsOnly: this.graphErrorsOnly(),
      thisSheet: this.graphThisSheet(),
    });
  }

  restore(serialized: string | null): void {
    if (serialized === null) return;
    let value: unknown;
    try {
      value = JSON.parse(serialized);
    } catch {
      return;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const settings = value as Record<string, unknown>;
    this.direction.set(settings['direction'] === 'vertical' ? 'vertical' : 'horizontal');
    this.scrollableLevels.set(settings['scrollableLevels'] === true);
    this.inputsFirst.set(settings['inputsFirst'] === true);
    this.connections.set(settings['connections'] === 'all' ? 'all' : 'selected');
    this.showOutputs.set(settings['outputs'] === true);
    this.graphFocus.set(settings['focus'] === true);
    this.graphDepth.set(typeof settings['depth'] === 'number' ? settings['depth'] : Infinity);
    this.graphHideNotes.set(settings['hideNotes'] === true);
    this.graphHideText.set(settings['hideText'] !== false);
    this.graphHideIsolated.set(settings['hideIsolated'] === true);
    this.graphErrorsOnly.set(settings['errorsOnly'] === true);
    this.graphThisSheet.set(settings['thisSheet'] === true);
  }
}
