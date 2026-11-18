/**
 * Which cells are waiting for a new value and which one is computing right now.
 * Kept free of heavy imports: it is part of the
 * initial bundle.
 *
 * - `expect(ids)` when an update starts: the cells that depend on the edit are pending.
 * - `progress(...)` while Python runs: each cell's start and end (worker messages, or the
 *   HTTP kernel's /v1/progress).
 * - `settle()` when the result arrives: nothing is pending or running any more.
 */
import { computed, signal } from '@angular/core';
import type { CellProgress } from './sheet.types';

export type CellActivity = 'pending' | 'running';

export interface RunningCell {
  id: string;
  /** performance.now() when it started. */
  since: number;
}

export class CellActivityTracker {
  private readonly pendingIds = signal<ReadonlySet<string>>(new Set());
  /** Started and not finished, in start order. */
  private readonly runningCells = signal<readonly RunningCell[]>([]);

  constructor(private readonly now: () => number = () => performance.now()) {}

  /** The cell computing right now: the last one that started and has not finished. A cell
   * that started earlier is waiting for it (it reads it), so it shows as pending. */
  readonly current = computed<RunningCell | null>(() => this.runningCells().at(-1) ?? null);

  /** Every cell that is pending or running, for views that mark several at once. */
  readonly states = computed<ReadonlyMap<string, CellActivity>>(() => {
    const states = new Map<string, CellActivity>();
    for (const id of this.pendingIds()) states.set(id, 'pending');
    for (const cell of this.runningCells()) states.set(cell.id, 'pending');
    const current = this.current();
    if (current !== null) states.set(current.id, 'running');
    return states;
  });

  activity(cellId: string): CellActivity | null {
    return this.states().get(cellId) ?? null;
  }

  isRunning(cellId: string): boolean {
    return this.runningCells().some(cell => cell.id === cellId);
  }

  expect(cellIds: Iterable<string>): void {
    const next = new Set(this.pendingIds());
    for (const id of cellIds) next.add(id);
    if (next.size !== this.pendingIds().size) this.pendingIds.set(next);
  }

  progress({ event, cellId }: CellProgress): void {
    if (event === 'start') {
      this.runningCells.update((cells) => [...cells.filter((cell) => cell.id !== cellId), { id: cellId, since: this.now() }]);
      return;
    }
    this.runningCells.update((cells) => cells.filter((cell) => cell.id !== cellId));
    if (this.pendingIds().has(cellId)) {
      const next = new Set(this.pendingIds());
      next.delete(cellId);
      this.pendingIds.set(next);
    }
  }

  settle(): void {
    if (this.pendingIds().size > 0) this.pendingIds.set(new Set());
    if (this.runningCells().length > 0) this.runningCells.set([]);
  }
}

/** Mark rendered note values (`[data-cells]`, the cells a value reads) as pending or
 * running. Classes only: the notes are not re-rendered for every progress event. */
export function markActivity(root: ParentNode, states: ReadonlyMap<string, CellActivity>): void {
  for (const element of root.querySelectorAll<HTMLElement>('[data-cells]')) {
    const ids = (element.dataset['cells'] ?? '').split(' ').filter(Boolean);
    const found = ids.map((id) => states.get(id));
    element.classList.toggle('cell-running', found.includes('running'));
    element.classList.toggle('cell-pending', !found.includes('running') && found.includes('pending'));
  }
}
