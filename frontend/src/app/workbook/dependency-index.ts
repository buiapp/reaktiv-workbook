/** Navigation metadata only. Python/Reaktiv remains the execution scheduler. */
export type DependentsIndex = ReadonlyMap<string, readonly string[]>;

export function indexDependents(
  dependencies: Readonly<Record<string, readonly string[]>>,
): DependentsIndex {
  const index = new Map<string, string[]>();
  for (const [consumer, producers] of Object.entries(dependencies)) {
    for (const producer of producers) {
      const dependents = index.get(producer);
      if (dependents) dependents.push(consumer);
      else index.set(producer, [consumer]);
    }
  }
  return index;
}

/** Iterative traversal visits each reachable edge once, including cycles. */
export function affectedCells(
  changed: readonly string[],
  dependents: DependentsIndex,
): ReadonlySet<string> {
  const affected = new Set(changed);
  const pending = [...affected];
  for (let cursor = 0; cursor < pending.length; cursor++) {
    for (const consumer of dependents.get(pending[cursor]) ?? []) {
      if (affected.has(consumer)) continue;
      affected.add(consumer);
      pending.push(consumer);
    }
  }
  return affected;
}
