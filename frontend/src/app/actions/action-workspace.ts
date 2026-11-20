import { randomId } from '../random-id';
import { canonicalActionSource } from '../sheet-file';
import { signal } from '@angular/core';
import type { ActionDefinition, ActionBinding, ActionInvocation, GraphResult, SheetDocument } from '../sheet.types';
import type { WidgetActionFeedback } from '../widget-action';
import type { WorkbookCommandQueue } from '../workbook-command-queue';
import type { RuntimeService } from '../runtime.service';
import type { WorkbookState } from '../workbook/workbook-state';
import { affectedCellIds } from '../workbook/cell-model';
import { pythonErrorMessage } from '../runtime/error-message';

export interface ActionWorkspacePorts {
  state: WorkbookState;
  commands: WorkbookCommandQueue;
  runtime: Pick<RuntimeService, 'status' | 'updateAction' | 'noteMoveDocument' | 'runAction' | 'cancelAction' | 'onSnapshot'>;
  document(): SheetDocument;
  requireKernel(): boolean;
  recordHistory(label?: string): void;
  evaluate(propagateError: boolean): Promise<void>;
  acceptGraph(graph: GraphResult): void;
  acceptLiveGraph(graph: GraphResult): void;
  flash(ids: ReadonlySet<string>): void;
  settle(): void;
  runEffect(cellId: string): Promise<void>;
}

/** Action editing/running lifecycle; independent of menus, DOM and note layout. */
export class ActionWorkspace {
  readonly actionError = signal('');
  readonly actionApplying = signal(false);
  readonly actionApplied = signal<ActionDefinition | null>(null);
  readonly runningAction = signal<string | null>(null);
  readonly invocations = signal<{id: string; name: string}[]>([]);
  readonly cancellingIds = signal<ReadonlySet<string>>(new Set());
  readonly selectedAction = signal('');
  readonly actionInitialSource = signal('');
  readonly actionRunnerOpen = signal(false);
  readonly lastInvokedAction = signal('');
  readonly widgetActionFeedback = signal<WidgetActionFeedback | null>(null);

  constructor(private readonly ports: ActionWorkspacePorts) {}

  private snapshots: {generation: number; users: number; unsubscribe: () => void} | null = null;
  private listenSnapshots(generation: number): () => void {
    let entry = this.snapshots;
    if (!entry || entry.generation !== generation) {
      entry = {generation, users: 0, unsubscribe: this.ports.runtime.onSnapshot(graph => {
        if (generation === this.ports.commands.generation) this.ports.acceptLiveGraph(graph);
      })};
      this.snapshots = entry;
    }
    const shared = entry;
    shared.users++;
    return () => {
      if (--shared.users === 0) {
        shared.unsubscribe();
        if (this.snapshots === shared) this.snapshots = null;
      }
    };
  }

  private pendingApply: Promise<void> | null = null;
  waitForApply(): Promise<void> { return this.actionApplying() ? this.pendingApply ?? Promise.resolve() : Promise.resolve(); }
  apply(definition: ActionDefinition, request?: { check(): void; historyLabel?: string }): Promise<void> {
    if (this.actionApplying()) return Promise.resolve();
    return this.pendingApply = this.applyDefinition(definition, request);
  }
  private async applyDefinition(definition: ActionDefinition, request?: { check(): void; historyLabel?: string }): Promise<void> {
    if (!this.ports.requireKernel() || this.actionApplying()) return;
    if (this.runningAction()) {
      this.actionError.set('Action definitions cannot change while invocations are running. Wait for them to finish or cancel them first.');
      return;
    }
    const generation = this.ports.commands.generation;
    this.actionApplying.set(true);
    this.actionError.set('');
    this.actionApplied.set(null);
    try {
      await this.ports.commands.run(async () => {
        request?.check();
        const next = { ...definition, source: canonicalActionSource(definition.source) };
        const previous = this.ports.state.actions();
        const graph = await this.ports.runtime.updateAction(next);
        if (generation !== this.ports.commands.generation) return;
        const applied = graph.appliedAction;
        if (!applied || applied.name !== next.name || applied.source !== next.source) throw new Error('The kernel did not confirm the action definition.');
        this.ports.recordHistory(request?.historyLabel);
        this.ports.state.actions.set([...previous.filter(item => item.name !== applied.name), applied]);
        this.ports.acceptGraph(graph);
        this.ports.runtime.noteMoveDocument(this.ports.document());
        this.selectedAction.set(next.name);
        this.actionInitialSource.set('');
        this.actionError.set('');
        this.actionApplied.set(applied);
      });
    } catch (error) {
      if (generation === this.ports.commands.generation)
        this.actionError.set(`Action ${definition.name} edits were not confirmed. Your draft is kept; the previous version may still be active.\n${error instanceof Error ? error.message : String(error)}\nCorrect the reported problem and Apply again before running.`);
    } finally {
      if (generation === this.ports.commands.generation) this.actionApplying.set(false);
    }
  }
  async remove(name: string): Promise<void> {
    if (!this.ports.requireKernel() || this.actionApplying()) return;
    if (this.runningAction()) {
      this.actionError.set('Action definitions cannot change while invocations are running. Wait for them to finish or cancel them first.');
      return;
    }
    this.ports.recordHistory();
    this.ports.state.actions.update((items) => items.filter((item) => item.name !== name));
    this.selectedAction.set('');
    await this.ports.evaluate(false);
  }
  async saveBindings(event: {
    name: string;
    bindings: Record<string, ActionBinding>;
  }): Promise<void> {
    const definition = this.ports.state.actions().find((item) => item.name === event.name);
    if (definition) await this.apply({ ...definition, bindings: event.bindings });
  }
  async invoke(event: { name: string; arguments: Record<string, ActionBinding> }, check?: () => void): Promise<ActionInvocation | undefined> {
    if (this.invocations().some(run => run.name === event.name)) {
      this.actionError.set(`Action ${event.name} is already running.`);
      return;
    }
    if (this.actionApplying()) {
      this.actionError.set('Wait for action edits to finish applying before running an action.');
      return;
    }
    if (
      !this.ports.requireKernel() ||
      (this.ports.runtime.status() === 'running' && !this.runningAction())
    )
      return;
    const generation = this.ports.commands.generation;
    this.actionRunnerOpen.set(false);
    const runId = randomId();
    this.invocations.update(items => [...items, {id: runId, name: event.name}]);
    this.runningAction.set(event.name);
    this.lastInvokedAction.set(event.name);
    this.actionError.set('');
    try {
      if (event.name.startsWith('effect:')) await this.ports.runEffect(event.name.slice(7));
      else {
        const graph = await this.ports.commands.start(async () => {
          check?.();
          const unsubscribe = this.listenSnapshots(generation);
          try {
            const result = await this.ports.runtime.runAction(event.name, event.arguments, runId);
            if (generation !== this.ports.commands.generation) return;
            this.ports.acceptGraph(result);
            return result;
          } finally {
            unsubscribe();
          }
        });
        if (!graph) return;
        const action = graph.actions?.find(item => item.name === event.name);
        const receipt: ActionInvocation | undefined = action?.runs?.find(run => run.id === runId) ?? (action ? {
          id: runId, name: event.name, status: action.cancelled ? 'cancelled' : action.error ? 'failed' : 'succeeded',
          error: action.cancelled ? 'Action cancelled' : action.error, output: action.output,
        } : undefined);
        const feedback = this.widgetActionFeedback();
        if (feedback?.name === event.name)
          this.widgetActionFeedback.set({
            ...feedback,
            error: receipt?.error ?? '',
          });
        this.ports.flash(affectedCellIds(graph.changed, graph.dependencies));
        return receipt;
      }
    } catch (error) {
      if (generation !== this.ports.commands.generation) return;
      this.actionError.set(pythonErrorMessage(error));
      const feedback = this.widgetActionFeedback();
      if (feedback?.name === event.name)
        this.widgetActionFeedback.set({
          ...feedback,
          error: pythonErrorMessage(error),
        });
    } finally {
      // HTTP polling may miss the last cell end event once the action response arrives.
      if (generation === this.ports.commands.generation) {
        this.invocations.update(items => items.filter(item => item.id !== runId));
        this.cancellingIds.update(ids => new Set([...ids].filter(id => id !== runId)));
        this.runningAction.set(this.invocations().at(-1)?.name ?? null);
        if (!this.invocations().length) this.ports.settle();
      }
    }
    return undefined;
  }
  async cancel(name: string, runId?: string): Promise<void> {
    const run = this.invocations().find(item => item.name === name && (!runId || item.id === runId));
    const key = run?.id ?? runId ?? name;
    if (this.cancellingIds().has(key)) return;
    this.cancellingIds.update(ids => new Set(ids).add(key));
    try {
      await this.ports.runtime.cancelAction(name, run?.id ?? runId);
    } catch (error) {
      this.cancellingIds.update(ids => new Set([...ids].filter(id => id !== key)));
      this.actionError.set(pythonErrorMessage(error));
    }
  }
}
