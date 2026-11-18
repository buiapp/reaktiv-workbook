/**
 * The Logs panel: current problems (failed cells, grouped by the cell that caused them)
 * and the log stream (cell output, warnings, errors with tracebacks, and app/kernel events).
 */
import { CellResult, LogEntry } from './sheet.types';

export type LogFilter = 'problems' | 'all' | 'error' | 'warning' | 'info' | 'system';

/** A cell that fails by itself, and the cells that fail only because they read it. */
export interface Problem {
  cellId: string;
  error: string;
  line?: number;
  source?: string;
  traceback?: string;
  affected: string[];
}

/**
 * Failed cells as root causes. A cell whose error came from another failed cell
 * (`errorDetail.origin`) is listed under that cell instead of as a problem of its own.
 */
export function buildProblems(cells: readonly CellResult[]): Problem[] {
  const failed = cells.filter((cell) => cell.error);
  const failedIds = new Set(failed.map((cell) => cell.id));
  const problems = new Map<string, Problem>();
  const followers: Array<[origin: string, cellId: string]> = [];
  for (const cell of failed) {
    const origin = cell.errorDetail?.origin;
    if (origin !== undefined && origin !== cell.id && failedIds.has(origin)) {
      followers.push([origin, cell.id]);
      continue;
    }
    problems.set(cell.id, {
      cellId: cell.id,
      error: cell.error ?? '',
      line: cell.errorDetail?.line,
      source: cell.errorDetail?.source,
      traceback: cell.errorDetail?.traceback,
      affected: [],
    });
  }
  for (const [origin, cellId] of followers) problems.get(origin)?.affected.push(cellId);
  return [...problems.values()];
}

/** Entries of one filter, matching the search text, newest first. */
export function filterLogs(
  entries: readonly LogEntry[],
  filter: LogFilter,
  search: string,
  label: (cellId: string) => string = () => '',
): LogEntry[] {
  const needle = search.trim().toLowerCase();
  return entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => {
      const system = entry.cellId === '';
      if (filter === 'system' ? !system : filter !== 'all' && (system || entry.level !== filter)) {
        return false;
      }
      if (needle === '') return true;
      return [entry.message, entry.cellId, label(entry.cellId), entry.traceback ?? '']
        .join('\n')
        .toLowerCase()
        .includes(needle);
    })
    // Newest first; entries of the same millisecond keep their order (output, then error).
    .sort(
      (left, right) =>
        right.entry.timestamp.slice(0, 23).localeCompare(left.entry.timestamp.slice(0, 23)) ||
        right.index - left.index,
    )
    .map(({ entry }) => entry);
}

/** Plain text of log entries, for pasting into an issue or a chat. */
export function logsAsText(
  entries: readonly LogEntry[],
  label: (cellId: string) => string = () => '',
): string {
  return entries
    .map((entry) => {
      const name = label(entry.cellId);
      const cell = entry.cellId === '' ? 'app' : name ? `${entry.cellId} (${name})` : entry.cellId;
      const head = `${entry.timestamp} [${entry.level}] ${cell}: ${entry.message}`;
      return entry.traceback ? `${head}\n${indent(entry.traceback)}` : head;
    })
    .join('\n');
}

export function problemsAsText(
  problems: readonly Problem[],
  label: (cellId: string) => string = () => '',
): string {
  const cell = (cellId: string) => (label(cellId) ? `${cellId} (${label(cellId)})` : cellId);
  return problems
    .map((problem) =>
      [
        `${cell(problem.cellId)}: ${problem.error}`,
        ...(problem.traceback ? [indent(problem.traceback)] : []),
        ...(problem.affected.length > 0
          ? [`  Also failing because of it: ${problem.affected.map(cell).join(', ')}`]
          : []),
      ].join('\n'),
    )
    .join('\n\n');
}

function indent(text: string): string {
  return text
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
}

/** Status messages of every evaluation: too frequent to be worth a log line. */
export function isRoutineStatus(message: string): boolean {
  return /^(Evaluating|Updated |Graph is up to date|Graph initialized|Running effect|Effect .* finished|Inspecting|Python workbook inspected)/.test(
    message,
  );
}
