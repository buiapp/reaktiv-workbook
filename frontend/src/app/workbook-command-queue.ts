/** Order apply/move commands. A new document invalidates queued work. */
export class WorkbookCommandQueue {
  private tail: Promise<unknown> = Promise.resolve();
  generation = 0;
  private readonly actions = new Set<Promise<unknown>>();
  run<T>(operation: () => Promise<T>): Promise<T | undefined> {
    const generation = this.generation;
    const result = this.tail.then(async () => {
      if (this.actions.size) await Promise.allSettled([...this.actions]);
      return generation === this.generation ? operation() : undefined;
    });
    this.tail = result.catch(() => undefined);
    return result;
  }
  /** Order invocation startup against structural edits, without holding the queue. */
  start<T>(operation: () => Promise<T>): Promise<T | undefined> {
    const generation = this.generation;
    const started = this.tail.then(() => {
      if (generation !== this.generation) return undefined;
      const pending = operation();
      this.actions.add(pending);
      void pending.finally(() => this.actions.delete(pending)).catch(() => undefined);
      return {pending};
    });
    this.tail = started.then(() => undefined, () => undefined);
    return started.then(value => value?.pending);
  }
  reset(): void {
    this.generation++;
    this.actions.clear();
    this.tail = Promise.resolve();
  }
}
