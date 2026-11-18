import { describe, expect, it } from 'vitest';
import { buildProblems, filterLogs, isRoutineStatus, logsAsText, problemsAsText } from './log-view';
import { CellResult, LogEntry } from './sheet.types';

function cell(id: string, error: string | null, errorDetail?: CellResult['errorDetail']): CellResult {
  return { id, display: error ? '#ERROR' : '1', value: null, valueType: 'int', error, errorDetail };
}

const logs: LogEntry[] = [
  { timestamp: '2026-10-02T08:00:01.000Z', cellId: 'A1', level: 'info', message: 'loaded 3 rows' },
  { timestamp: '2026-10-02T08:00:02.000Z', cellId: 'A2', level: 'error', message: 'ZeroDivisionError: division by zero', traceback: 'Traceback\n  Cell A2, line 1', line: 1 },
  { timestamp: '2026-10-02T08:00:03.000Z', cellId: '', level: 'info', message: 'Python and reaktiv ready' },
  { timestamp: '2026-10-02T08:00:04.000Z', cellId: 'A3', level: 'warning', message: 'careful' },
];

describe('buildProblems', () => {
  it('lists root causes and groups the cells that fail because of them', () => {
    const problems = buildProblems([
      cell('A1', null),
      cell('A2', 'ZeroDivisionError: division by zero', { line: 1, source: '100 / count', traceback: 'tb' }),
      cell('A3', 'ZeroDivisionError: division by zero', { origin: 'A2' }),
      cell('B1', 'ZeroDivisionError: division by zero', { origin: 'A2' }),
      cell('A4', 'NameError: x', { line: 2 }),
      // The origin is not failing any more (stale): reported on its own.
      cell('A5', 'KeyError: 1', { origin: 'Z9' }),
    ]);
    expect(problems.map((problem) => [problem.cellId, problem.affected])).toEqual([
      ['A2', ['A3', 'B1']],
      ['A4', []],
      ['A5', []],
    ]);
    expect(problems[0]).toMatchObject({ line: 1, source: '100 / count', traceback: 'tb' });
    expect(problemsAsText(problems.slice(0, 1), (id) => (id === 'A2' ? 'ratio' : ''))).toBe(
      'A2 (ratio): ZeroDivisionError: division by zero\n  tb\n  Also failing because of it: A3, B1',
    );
  });
});

describe('filterLogs', () => {
  it('filters by level and source, newest first', () => {
    expect(filterLogs(logs, 'all', '').map((entry) => entry.cellId)).toEqual(['A3', '', 'A2', 'A1']);
    expect(filterLogs(logs, 'error', '').map((entry) => entry.cellId)).toEqual(['A2']);
    expect(filterLogs(logs, 'warning', '').map((entry) => entry.cellId)).toEqual(['A3']);
    expect(filterLogs(logs, 'info', '').map((entry) => entry.cellId)).toEqual(['A1']);
    expect(filterLogs(logs, 'system', '').map((entry) => entry.message)).toEqual(['Python and reaktiv ready']);
  });

  it('keeps the order of entries written in the same millisecond', () => {
    const same: LogEntry[] = [
      { timestamp: '2026-10-02T08:00:01.000+00:00', cellId: 'A1', level: 'info', message: 'before' },
      { timestamp: '2026-10-02T08:00:01.000+00:00', cellId: 'A1', level: 'error', message: 'boom' },
      { timestamp: '2026-10-02T08:00:01.000Z', cellId: '', level: 'info', message: 'app' },
    ];
    expect(filterLogs(same, 'all', '').map((entry) => entry.message)).toEqual(['app', 'boom', 'before']);
  });

  it('searches messages, tracebacks, ids and labels', () => {
    expect(filterLogs(logs, 'all', 'zerodiv').map((entry) => entry.cellId)).toEqual(['A2']);
    expect(filterLogs(logs, 'all', 'line 1').map((entry) => entry.cellId)).toEqual(['A2']);
    expect(filterLogs(logs, 'all', 'revenue', (id) => (id === 'A1' ? 'revenue' : '')).map((entry) => entry.cellId)).toEqual(['A1']);
  });

  it('formats entries as text with their traceback', () => {
    expect(logsAsText(logs.slice(1, 3))).toBe(
      '2026-10-02T08:00:02.000Z [error] A2: ZeroDivisionError: division by zero\n  Traceback\n    Cell A2, line 1\n' +
        '2026-10-02T08:00:03.000Z [info] app: Python and reaktiv ready',
    );
  });
});

describe('isRoutineStatus', () => {
  it('keeps kernel events and drops per-evaluation chatter', () => {
    expect(isRoutineStatus('Evaluating reactive graph')).toBe(true);
    expect(isRoutineStatus('Updated A1 in place')).toBe(true);
    expect(isRoutineStatus('Installing 2 document packages')).toBe(false);
    expect(isRoutineStatus('Python and reaktiv ready')).toBe(false);
  });
});
