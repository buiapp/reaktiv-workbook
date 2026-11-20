import { computed } from '@angular/core';
import { WorkbookState } from './workbook-state';
import { affectedCells, indexDependents } from './dependency-index';
import type { CellDefinition } from '../sheet.types';

describe('WorkbookState', () => {
  const input: CellDefinition = {
    id: 'A1',
    name: 'amount',
    kind: 'input',
    source: '2',
    enabled: true,
  };

  it('derives paused inputs and live results without copying state in effects', () => {
    const state = new WorkbookState([input]);
    const display = computed(() => state.resultMap().get('A1')?.value);
    expect(display()).toBe(2);
    const index = state.definitionMap();
    state.graph.update((graph) => ({
      ...graph,
      cells: [{ id: 'A1', display: '7', value: 7, valueType: 'int', error: null }],
    }));
    expect(display()).toBe(7);
    expect(state.definitionMap()).toBe(index);
    expect(state.cells()[0].source).toBe('2');
  });

  it('isolates workbook windows and computes the dependency index independently of selection', () => {
    const first = new WorkbookState([input]),
      second = new WorkbookState();
    first.graph.update((graph) => ({ ...graph, dependencies: { B1: ['A1'], C1: ['B1'] } }));
    expect(first.dependents().get('A1')).toEqual(['B1']);
    expect(second.cells()).toEqual([]);
    expect(second.dependents().size).toBe(0);
    const index = first.dependents();
    first.graph.update((graph) => ({
      ...graph,
      logs: [{ timestamp: '', level: 'info', cellId: '', message: 'ready' }],
    }));
    expect(first.dependents()).toBe(index);
  });
});

describe('dependency traversal', () => {
  it('handles a long reverse-ordered chain and cycles with one indexing pass', () => {
    let reads = 0;
    const dependencies: Record<string, string[]> = {};
    for (let index = 4000; index > 0; index--) {
      Object.defineProperty(dependencies, `node${index}`, {
        enumerable: true,
        get: () => {
          reads++;
          return [`node${index - 1}`];
        },
      });
    }
    dependencies['node0'] = ['node4000'];
    const affected = affectedCells(['node0'], indexDependents(dependencies));
    expect(affected.size).toBe(4001);
    expect(reads).toBe(4000);
    expect(affectedCells(['missing'], indexDependents({ A1: ['B1'] }))).toEqual(
      new Set(['missing']),
    );
  });
});
