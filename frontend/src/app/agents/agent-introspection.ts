import type { CellResult, GraphResult, LogEntry, SheetDocument } from '../sheet.types';
import { splitCellId } from '../sheet-file';
import { buildProblems } from '../log-view';

export function integerOption(value: unknown, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > maximum)
    throw new Error(`Use an integer between 1 and ${maximum}.`);
  return value;
}

export function cellIds(value: unknown, document: SheetDocument): string[] {
  if (!Array.isArray(value) || !value.length || value.length > 100 || !value.every(id => typeof id === 'string'))
    throw new Error('Provide between 1 and 100 explicit cell IDs.');
  const known = new Set(document.cells.map(cell => cell.id));
  const missing = value.filter(id => !known.has(id));
  if (missing.length) throw new Error(`Unknown cell IDs: ${missing.join(', ')}. Use workbook-qualified IDs from the overview.`);
  return [...new Set(value)] as string[];
}

/** Metadata and already evaluated previews only; never return widget/image buffers. */
export function cellPreview(cell: CellResult): Record<string, unknown> {
  return { id: cell.id, value: cell.value, display: cell.display, valueType: cell.valueType,
    error: cell.error, errorDetail: cell.errorDetail, callable: cell.callable,
    color: cell.color, colorError: cell.colorError, colorDependencies: cell.colorDependencies,
    resourceStatus: cell.resourceStatus, durationMs: cell.durationMs, outputPreparationMs: cell.outputPreparationMs,
    richOutput: cell.richOutput ? { mimeType: cell.richOutput.mimeType } : undefined,
    table: cell.table ? { columns: cell.table.columns, rowCount: cell.table.rowCount, columnCount: cell.table.columnCount, truncated: cell.table.truncated } : undefined,
    artifact: cell.artifact ? { available: true } : undefined };
}

export function workbookOverview(document: SheetDocument, graph: GraphResult | null): Record<string, unknown> {
  const counts: Record<string, number> = {};
  for (const cell of document.cells) counts[cell.kind] = (counts[cell.kind] ?? 0) + 1;
  return { name: document.name, cellCount: document.cells.length, counts,
    worksheets: [document.sheetName ?? 'Sheet1', ...(document.sheets ?? []).map(sheet => sheet.name)],
    worksheetGrids: [{ name: document.sheetName ?? 'Sheet1', ...document.grid }, ...(document.sheets ?? []).map(sheet => ({ name: sheet.name, ...sheet.grid }))],
    cells: document.cells.slice(0, 200).map(({ id, name, kind, enabled }) => ({ id, name, kind, enabled })),
    inventoryTruncated: document.cells.length > 200,
    notes: document.cells.filter(cell => cell.kind === 'markdown').slice(0, 200)
      .map(cell => ({ id: cell.id, name: cell.name, worksheet: splitCellId(cell.id)[0] || document.sheetName || 'Sheet1', page: cell.view?.page !== false })),
    packages: document.environment.packages, imports: document.environment.imports,
    environmentVariableNames: Object.keys(document.environment.variables),
    actions: (document.actions ?? []).map(action => ({ name: action.name, label: action.label, exposed: action.exposed })),
    problems: buildProblems(graph?.cells ?? []) };
}

export function dependencyContext(document: SheetDocument, graph: GraphResult | null, payload: Record<string, unknown>): Record<string, unknown> {
  const roots = cellIds(payload['cellIds'], document);
  const depth = integerOption(payload['depth'], 1, 10);
  const direction = payload['direction'] ?? 'both';
  const mode = payload['mode'] ?? 'observed';
  if (!['upstream', 'downstream', 'both'].includes(String(direction)) || !['observed', 'source', 'widget'].includes(String(mode)))
    throw new Error('Use direction upstream/downstream/both and mode observed/source/widget.');
  const map = mode === 'source' ? graph?.sourceDependencies : mode === 'widget' ? graph?.widgetDependencies : graph?.dependencies;
  const reverse = new Map<string, string[]>();
  for (const [consumer, producers] of Object.entries(map ?? {})) {
    for (const producer of producers) {
      const consumers = reverse.get(producer) ?? [];
      consumers.push(consumer); reverse.set(producer, consumers);
    }
  }
  const nodes = new Set(roots), edges = new Map<string, { consumer: string; dependency: string }>();
  let frontier = roots, truncated = false;
  for (let level = 0; level < depth && frontier.length; level++) {
    const next: string[] = [];
    for (const id of frontier) {
      const adjacent = [
        ...(direction !== 'downstream' ? (map?.[id] ?? []).map(dependency => ({ consumer: id, dependency })) : []),
        ...(direction !== 'upstream' ? (reverse.get(id) ?? []).map(consumer => ({ consumer, dependency: id })) : []),
      ];
      for (const edge of adjacent) {
        const other = edge.consumer === id ? edge.dependency : edge.consumer;
        if ((!nodes.has(other) && nodes.size >= 1000) || edges.size >= 5000) { truncated = true; continue; }
        edges.set(JSON.stringify([edge.consumer, edge.dependency]), edge);
        if (!nodes.has(other)) { nodes.add(other); next.push(other); }
      }
    }
    frontier = next;
  }
  const definitions = new Map(document.cells.map(cell => [cell.id, cell]));
  return { mode, direction, depth, available: map !== undefined, truncated,
    nodes: [...nodes].map(id => ({ id, name: definitions.get(id)?.name, kind: definitions.get(id)?.kind,
      observation: graph?.dependencyStates?.[id] ?? 'unobserved' })), edges: [...edges.values()],
    explanation: 'consumer reads dependency. Observed edges reflect the last evaluation and may be partial/unobserved; source references describe authoring, widget edges describe bindings.' };
}

export function queryLogs(entries: readonly LogEntry[], payload: Record<string, unknown>): Record<string, unknown> {
  const limit = integerOption(payload['limit'], 100, 500), level = payload['level'] ?? 'all';
  if (!['all', 'info', 'warning', 'error', 'system'].includes(String(level))) throw new Error('Unsupported log level.');
  const ids = payload['cellIds'];
  if (ids !== undefined && (!Array.isArray(ids) || ids.length > 100 || !ids.every(id => typeof id === 'string')))
    throw new Error('cellIds must contain at most 100 strings.');
  const search = payload['search'] ?? '';
  if (typeof search !== 'string' || search.length > 1000) throw new Error('search must be a string of at most 1000 characters.');
  const since = payload['since'];
  if (since !== undefined && (typeof since !== 'string' || !Number.isFinite(Date.parse(since)))) throw new Error('since must be a valid timestamp.');
  const needle = search.toLowerCase();
  const seen = new Set<string>();
  const filtered = entries.filter(entry => {
    if (entry.id && seen.has(entry.id)) return false;
    if (entry.id) seen.add(entry.id);
    return (level === 'all' || (level === 'system' ? entry.cellId === '' : entry.level === level)) &&
      (!ids || (ids as string[]).includes(entry.cellId)) &&
      (since === undefined || Date.parse(entry.timestamp) > Date.parse(since as string)) &&
      (!needle || `${entry.message}\n${entry.traceback ?? ''}\n${entry.cellId}`.toLowerCase().includes(needle));
  }).map((entry, index) => ({ entry, index })).sort((a, b) => Date.parse(b.entry.timestamp) - Date.parse(a.entry.timestamp) || b.index - a.index);
  return { entries: filtered.slice(0, limit).map(({ entry }) => entry), totalMatched: filtered.length,
    truncated: filtered.length > limit, order: 'newest-first',
    availableLevels: ['info', 'warning', 'error'], retention: 'Bounded current-window logs; not a durable history. Debug timings and traces are in get_diagnostics.' };
}
