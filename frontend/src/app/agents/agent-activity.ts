import { computed, signal } from '@angular/core';
import type { CellDefinition } from '../sheet.types';
import { DocumentChanges } from '../workbook/document-changes';
import type { AgentCommand } from './live-agent-workbook';

export type AgentActivityKind = 'read' | 'write' | 'command';
export interface AgentActivityEntry {
  id: number;
  kind: AgentActivityKind;
  label: string;
  status: 'running' | 'completed' | 'failed';
  cellIds: string[];
  cellCount: number;
  time: number;
  error?: string;
}
export interface AgentCellFeedback {
  activity?: AgentActivityKind;
  origin?: 'created' | 'edited';
}
interface Mark { origin: 'created' | 'edited'; cell: CellDefinition; }
const WRITES = new Set<AgentCommand['operation']>(['edit', 'colors', 'resize', 'tracks', 'move', 'label', 'grid-lines', 'action-edit', 'worksheets', 'environment', 'asset']);
const COMMANDS = new Set<AgentCommand['operation']>(['action-run', 'action-cancel', 'kernel-control', 'save']);
const LABELS: Record<AgentCommand['operation'], string> = {
  tracks: 'Size rows and columns', move: 'Move cells', label: 'Refactor cell label', 'grid-lines': 'Insert or delete rows/columns',
  worksheets: 'Manage worksheets', environment: 'Manage shared code and packages', asset: 'Add image', visual: 'Inspect visual content',
  read: 'Read workbook', context: 'Read current view', overview: 'Inspect workbook overview', inspect: 'Read cells',
  dependencies: 'Inspect dependencies', logs: 'Read logs', diagnostics: 'Inspect diagnostics', 'kernel-status': 'Read kernel status',
  'kernel-control': 'Control kernel', actions: 'Inspect actions', 'action-edit': 'Edit action', 'action-run': 'Run action',
  'action-cancel': 'Cancel action', colors: 'Color cells', resize: 'Resize worksheet', edit: 'Edit cells', save: 'Save workbook',
};

/** Per-window presentation only. Source and results stay with the workbook owners. */
export class AgentActivity {
  readonly showOrigins = signal((() => {try {return localStorage.getItem('reaktiv-workbook:agent-badges') !== 'hidden';} catch {return true;}})());
  setShowOrigins(show: boolean): void {
    this.showOrigins.set(show);
    try {localStorage.setItem('reaktiv-workbook:agent-badges', show ? 'shown' : 'hidden');} catch { /* Window preference only. */ }
  }
  readonly entries = signal<readonly AgentActivityEntry[]>([]);
  private readonly active = signal<ReadonlyMap<number, AgentActivityEntry>>(new Map());
  private readonly pulses = signal<ReadonlyMap<number, {kind: AgentActivityKind; ids: string[]}>>(new Map());
  private readonly marks = signal<ReadonlyMap<string, Mark>>(new Map());
  private readonly changes = new DocumentChanges();
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();
  private sequence = 0;
  private generation = 0;
  readonly pending = computed(() => this.active().size);
  readonly feedback = computed(() => {
    const result = new Map<string, AgentCellFeedback>();
    for (const cell of this.cells()) {
      const mark = this.marks().get(cell.id);
      if (mark && this.changes.same(mark.cell, cell)) result.set(cell.id, {origin: mark.origin});
    }
    const show = (ids: readonly string[], kind: AgentActivityKind) => {
      for (const id of ids) {
        const previous = result.get(id);
        // A concurrent status/read request must not obscure an in-flight write.
        if (previous?.activity === 'write' && kind !== 'write') continue;
        result.set(id, {...previous, activity: kind});
      }
    };
    for (const pulse of this.pulses().values()) show(pulse.ids, pulse.kind);
    for (const entry of this.active().values()) show(entry.cellIds, entry.kind);
    return result;
  });
  readonly created = computed(() => [...this.feedback().values()].filter(item => item.origin === 'created').length);
  readonly edited = computed(() => [...this.feedback().values()].filter(item => item.origin === 'edited').length);

  constructor(private readonly cells: () => readonly CellDefinition[]) {}

  /** Called at the actual mutation boundary, including a commit whose evaluation later fails. */
  recordChanges(before: readonly CellDefinition[], after: readonly CellDefinition[]): void {
    const old = new Map(before.map(cell => [cell.id, cell]));
    const marks = new Map(this.marks());
    for (const cell of after) {
      const previous = old.get(cell.id);
      if (this.changes.same(previous, cell)) continue;
      const mark = marks.get(cell.id);
      const origin = !previous || (mark?.origin === 'created' && this.changes.same(mark.cell, previous)) ? 'created' : 'edited';
      marks.set(cell.id, {origin, cell});
    }
    const existing = new Set(after.map(cell => cell.id));
    for (const id of marks.keys()) if (!existing.has(id)) marks.delete(id);
    this.marks.set(marks);
  }

  async observe(command: AgentCommand, execute: () => Promise<Record<string, unknown>>): Promise<Record<string, unknown>> {
    const generation = this.generation, id = ++this.sequence;
    const kind: AgentActivityKind = command.operation === 'environment' && command.payload['read'] === true ? 'read' : WRITES.has(command.operation) ? 'write' : COMMANDS.has(command.operation) ? 'command' : 'read';
    const requested = this.requestedIds(command);
    const entry: AgentActivityEntry = {id, kind, label: LABELS[command.operation], status: 'running',
      cellIds: requested.slice(0, 200), cellCount: requested.length, time: Date.now()};
    this.active.update(active => new Map(active).set(id, entry));
    this.entries.update(entries => [entry, ...entries].slice(0, 50));
    try {
      const result = await execute();
      if (generation === this.generation) {
        const ids = kind === 'read' ? this.returnedIds(command, result) : requested;
        this.finish({...entry, status: 'completed', cellIds: ids.slice(0, 200), cellCount: ids.length});
        this.pulses.update(pulses => new Map(pulses).set(id, {kind, ids}));
        this.timers.set(id, setTimeout(() => {
          this.pulses.update(pulses => {const next = new Map(pulses); next.delete(id); return next;});
          this.timers.delete(id);
        }, 1600));
      }
      return result;
    } catch (error) {
      if (generation === this.generation) this.finish({...entry, status: 'failed',
        error: (error instanceof Error ? error.message : String(error)).slice(0, 500)});
      throw error;
    } finally {
      if (generation === this.generation) this.active.update(active => {const next = new Map(active); next.delete(id); return next;});
    }
  }

  reset(): void {
    this.generation++;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear(); this.entries.set([]); this.active.set(new Map()); this.pulses.set(new Map()); this.marks.set(new Map());
  }

  private finish(entry: AgentActivityEntry): void {
    this.entries.update(entries => entries.map(item => item.id === entry.id ? entry : item));
  }
  private requestedIds(command: AgentCommand): string[] {
    const ids: string[] = [];
    if (typeof command.payload['cellId'] === 'string') ids.push(command.payload['cellId']);
    for (const value of [command.payload['cellIds'], command.payload['delete']])
      if (Array.isArray(value)) ids.push(...value.filter((id): id is string => typeof id === 'string'));
    const edits = command.payload['cells'];
    if (Array.isArray(edits)) for (const edit of edits)
      if (edit && typeof edit === 'object' && typeof edit.id === 'string') ids.push(edit.id);
    return [...new Set(ids)];
  }
  private returnedIds(command: AgentCommand, result: Record<string, unknown>): string[] {
    // Only highlight cells actually returned, not guessed dependency/evaluation activity.
    if (command.operation === 'visual' && typeof result['cellId'] === 'string') return [result['cellId']];
    const document = result['document'];
    const items = result['cells'] ?? result['nodes'] ??
      (command.operation === 'read' && document && typeof document === 'object' && 'cells' in document ? document.cells : undefined);
    if (Array.isArray(items)) return [...new Set(items.flatMap((item: unknown) => {
      if (!item || typeof item !== 'object' || !('id' in item) || typeof item.id !== 'string') return [];
      return [item.id];
    }))];
    return [];
  }
}
