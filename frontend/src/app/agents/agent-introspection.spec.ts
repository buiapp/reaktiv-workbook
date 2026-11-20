import { describe, expect, it } from 'vitest';
import { createSheetDocument } from '../sheet-file';
import type { CellDefinition, GraphResult, LogEntry } from '../sheet.types';
import { cellPreview, dependencyContext, queryLogs, workbookOverview } from './agent-introspection';

const cells: CellDefinition[] = ['A1', 'B1', 'C1', 'Other!A1'].map(id => ({ id, kind: 'formula', source: '1', enabled: true }));
const document = createSheetDocument('Book', 10, 16, cells, []);
const graph: GraphResult = { cells: [], dependencies: { B1: ['A1'], C1: ['B1'], A1: ['C1'] },
  sourceDependencies: { B1: ['A1', 'Other!A1'] }, dependencyStates: { B1: 'partial' },
  effects: [], logs: [], changed: [], rebuilt: false, updateMode: 'incremental' };

describe('Agent introspection', () => {
  it('distinguishes static references from observed reads and follows cycles once', () => {
    const observed = dependencyContext(document, graph, { cellIds: ['A1'], direction: 'downstream', depth: 10 });
    expect(observed['edges']).toHaveLength(3);
    expect(observed['nodes']).toHaveLength(3);
    const source = dependencyContext(document, graph, { cellIds: ['B1'], direction: 'upstream', mode: 'source' });
    expect(source['edges']).toEqual([{ consumer: 'B1', dependency: 'A1' }, { consumer: 'B1', dependency: 'Other!A1' }]);
    expect(source['nodes']).toContainEqual(expect.objectContaining({ id: 'B1', observation: 'partial' }));
    expect(dependencyContext(document, graph, { cellIds: ['B1'], mode: 'widget' })['available']).toBe(false);
    expect(() => dependencyContext(document, graph, { cellIds: ['missing'] })).toThrow('Unknown');
    expect(() => dependencyContext(document, graph, { cellIds: ['A1'], depth: 11 })).toThrow('integer');
  });

  it('bounds a large traversal and reports truncation', () => {
    const dependencies = { A1: Array.from({ length: 1100 }, (_, i) => `X${i}`) };
    const result = dependencyContext(document, { ...graph, dependencies }, { cellIds: ['A1'] });
    expect(result['nodes']).toHaveLength(1000);
    expect(result['truncated']).toBe(true);
  });

  it('queries retained logs with deduplication, chronology, filters and limits', () => {
    const entries: LogEntry[] = [
      { id: '1', cellId: 'A1', timestamp: '2026-11-04T12:00:00Z', level: 'info', message: 'first' },
      { id: '2', cellId: 'B1', timestamp: '2026-11-04T14:30:00+01:00', level: 'error', message: 'failure', traceback: 'Trace detail' },
      { id: '3', cellId: '', timestamp: '2026-11-04T13:00:00Z', level: 'warning', message: 'system' },
    ];
    const queried = queryLogs([...entries, entries[1]], { limit: 2 });
    expect(queried['entries']).toEqual([entries[1], entries[2]]);
    expect(queried['totalMatched']).toBe(3); expect(queried['truncated']).toBe(true);
    expect(queryLogs(entries, { cellIds: ['B1'], search: 'trace', level: 'error' })['entries']).toEqual([entries[1]]);
    expect(queryLogs(entries, { since: '2026-11-04T13:00:00Z' })['entries']).toEqual([entries[1]]);
    expect(queryLogs(entries, { level: 'system' })['entries']).toEqual([entries[2]]);
    expect(() => queryLogs(entries, { limit: 501 })).toThrow();
    expect(() => queryLogs(entries, { since: 'bad' })).toThrow();
    expect(() => queryLogs(entries, { level: 'debug' })).toThrow();
  });

  it('omits environment secrets from overview and binary outputs from targeted previews', () => {
    const overview = workbookOverview({ ...document, environment: { ...document.environment, variables: { API_KEY: 'secret' } } }, graph);
    expect(overview['environmentVariableNames']).toEqual(['API_KEY']);
    expect(JSON.stringify(overview)).not.toContain('secret');
    const preview = cellPreview({ id: 'A1', value: null, display: 'plot', valueType: 'plot', error: null,
      richOutput: { mimeType: 'image/png', dataBase64: 'binary-secret' } });
    expect(preview['richOutput']).toEqual({ mimeType: 'image/png' });
    expect(JSON.stringify(preview)).not.toContain('binary-secret');
  });
});
