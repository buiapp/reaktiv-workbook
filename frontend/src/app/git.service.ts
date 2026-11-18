import { Injectable } from '@angular/core';
import type { CellDefinition, SheetDocument } from './sheet.types';

/**
 * Git for workbooks. The CLI session runs the user's own `git`
 * with a fixed set of subcommands (`git_host.py`); everything else — which commands, parsing
 * their output, the diff by cell — is here.
 */
export interface GitOutput {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs git in the folder of a workbook. */
export interface GitTransport {
  run(workbook: string, args: string[]): Promise<GitOutput>;
}

export interface GitStatus {
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  /** Changed paths of this workbook (the file and its images), relative to the repository. */
  changes: Array<{ path: string; state: string }>;
}

/** `git status --porcelain=v2 --branch -z`. */
export function parseStatus(stdout: string): GitStatus {
  const status: GitStatus = { branch: null, upstream: null, ahead: 0, behind: 0, changes: [] };
  const fields = stdout.split('\0');
  for (let index = 0; index < fields.length; index++) {
    const field = fields[index];
    if (field.startsWith('# branch.head ')) {
      const head = field.slice('# branch.head '.length);
      status.branch = head === '(detached)' ? null : head;
    } else if (field.startsWith('# branch.upstream ')) {
      status.upstream = field.slice('# branch.upstream '.length);
    } else if (field.startsWith('# branch.ab ')) {
      const [ahead, behind] = field.slice('# branch.ab '.length).split(' ');
      status.ahead = Math.abs(Number.parseInt(ahead, 10)) || 0;
      status.behind = Math.abs(Number.parseInt(behind, 10)) || 0;
    } else if (field.startsWith('1 ')) {
      const parts = field.split(' ');
      status.changes.push({ path: parts.slice(8).join(' '), state: describeXY(parts[1]) });
    } else if (field.startsWith('2 ')) {
      const parts = field.split(' ');
      status.changes.push({ path: parts.slice(9).join(' '), state: 'renamed' });
      index++; // the original path follows
    } else if (field.startsWith('u ')) {
      status.changes.push({ path: field.split(' ').slice(10).join(' '), state: 'conflict' });
    } else if (field.startsWith('? ')) {
      status.changes.push({ path: field.slice(2), state: 'new' });
    }
  }
  return status;
}

function describeXY(xy: string): string {
  if (xy.includes('D')) return 'deleted';
  if (xy.includes('A')) return 'new';
  return 'changed';
}

export type DiffLine = { kind: 'same' | 'added' | 'removed'; text: string };

/** Line diff (longest common subsequence); cells are short, so quadratic is fine. */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before === '' ? [] : before.split('\n');
  const b = after === '' ? [] : after.split('\n');
  const table = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      lines.push({ kind: 'same', text: a[i] });
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      lines.push({ kind: 'removed', text: a[i++] });
    } else {
      lines.push({ kind: 'added', text: b[j++] });
    }
  }
  while (i < a.length) lines.push({ kind: 'removed', text: a[i++] });
  while (j < b.length) lines.push({ kind: 'added', text: b[j++] });
  return lines;
}

export interface CellChange {
  /** Where the cell is now (or was, when removed). */
  id: string;
  label: string;
  change: 'added' | 'removed' | 'changed' | 'moved';
  /** Where a moved cell was. */
  from?: string;
  /** What else changed: kind, label, trigger, on/off. */
  details: string[];
  lines: DiffLine[];
}

export interface WorkbookChanges {
  cells: CellChange[];
  /** Name, packages, imports, shared code, sheets, environment. */
  workbook: string[];
}

/**
 * What changed between two versions of a workbook, cell by cell. Cells are matched by id; a
 * labelled cell found under its label at another id has moved. Layout and outputs are not
 * changes worth a commit message and are left out.
 */
export function diffWorkbooks(before: SheetDocument | null, after: SheetDocument): WorkbookChanges {
  const old = new Map((before?.cells ?? []).map((cell) => [cell.id, cell]));
  const oldByLabel = new Map((before?.cells ?? []).filter((cell) => cell.name).map((cell) => [cell.name!, cell]));
  // A labelled cell whose label is now at another id moved there.
  const movedFrom = new Map<string, CellDefinition>();
  for (const cell of after.cells) {
    const previous = cell.name ? oldByLabel.get(cell.name) : undefined;
    if (previous !== undefined && previous.id !== cell.id) movedFrom.set(cell.id, previous);
  }
  const movedAway = new Set([...movedFrom.values()].map((cell) => cell.id));
  const matched = new Set<string>();
  const cells: CellChange[] = [];
  for (const cell of after.cells) {
    const moved = movedFrom.get(cell.id);
    if (moved !== undefined) {
      matched.add(moved.id);
      const change = compareCells(moved, cell);
      cells.push({ ...(change ?? baseChange(cell)), change: 'moved', from: moved.id });
      continue;
    }
    const previous = old.get(cell.id);
    if (previous !== undefined && !movedAway.has(previous.id)) {
      matched.add(previous.id);
      const change = compareCells(previous, cell);
      if (change !== null) cells.push(change);
      continue;
    }
    cells.push({ ...baseChange(cell), change: 'added', lines: lineDiff('', cell.source) });
  }
  for (const cell of before?.cells ?? []) {
    if (!matched.has(cell.id)) {
      cells.push({ ...baseChange(cell), change: 'removed', lines: lineDiff(cell.source, '') });
    }
  }
  cells.sort((left, right) => compareIds(left.id, right.id));
  return { cells, workbook: before === null ? ['new workbook'] : workbookChanges(before, after) };
}

function baseChange(cell: CellDefinition): CellChange {
  return { id: cell.id, label: cell.name ?? '', change: 'changed', details: [], lines: [] };
}

function compareCells(before: CellDefinition, after: CellDefinition): CellChange | null {
  const details: string[] = [];
  if (before.kind !== after.kind) details.push(`${before.kind} → ${after.kind}`);
  if ((before.name ?? '') !== (after.name ?? '')) details.push(`label ${before.name || '—'} → ${after.name || '—'}`);
  if (before.trigger !== after.trigger) details.push(`trigger ${before.trigger} → ${after.trigger}`);
  if (before.enabled !== after.enabled) details.push(after.enabled ? 'turned on' : 'turned off');
  if (before.override !== after.override) details.push(`override ${(before.override ?? 'derived').slice(0, 80)} → ${(after.override ?? 'derived').slice(0, 80)}`);
  const sourceChanged = before.source !== after.source;
  if (!sourceChanged && details.length === 0) return null;
  return {
    ...baseChange(after),
    details,
    lines: sourceChanged ? lineDiff(before.source, after.source) : [],
  };
}

function workbookChanges(before: SheetDocument, after: SheetDocument): string[] {
  const changes: string[] = [];
  const same = (left: unknown, right: unknown) => JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
  if (!same(before.layout.noteParents, after.layout.noteParents)) changes.push('note hierarchy');
  if (before.name !== after.name) changes.push(`renamed ${before.name} → ${after.name}`);
  if (!same(before.environment.packages, after.environment.packages)) changes.push('packages');
  if (!same(before.environment.imports, after.environment.imports)) changes.push('imports');
  if ((before.environment.code ?? '') !== (after.environment.code ?? '')) changes.push('shared code');
  if (!same(before.environment.variables, after.environment.variables)) changes.push('environment variables');
  if (!same(before.environment.kernel, after.environment.kernel) || !same(before.environment.python, after.environment.python)) {
    changes.push('kernel');
  }
  const sheets = (document: SheetDocument) => [document.sheetName ?? 'Sheet1', ...(document.sheets ?? []).map((sheet) => sheet.name)];
  if (!same(sheets(before), sheets(after))) changes.push('sheets');
  return changes;
}

function compareIds(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true });
}

/** Git run by the CLI session in its workbook's folder (`/v1/git`); the path is the server's. */
export class HttpGitTransport implements GitTransport {
  constructor(private readonly send: (args: string[]) => Promise<GitOutput>) {}

  run(_workbook: string, args: string[]): Promise<GitOutput> {
    return this.send(args);
  }
}

export class GitError extends Error {}

@Injectable({ providedIn: 'root' })
export class GitService {
  /** Git needs a host that can run it: a CLI session. */
  transport: GitTransport | null = null;

  get available(): boolean {
    return this.transport !== null;
  }

  /** The repository's top folder, or null outside a repository. */
  async repository(workbook: string): Promise<string | null> {
    const output = await this.git(workbook, ['rev-parse', '--show-toplevel'], false);
    return output.code === 0 ? output.stdout.trim() : null;
  }

  /** Branch, distance to its upstream, and the workbook's changed files. */
  async status(workbook: string): Promise<GitStatus> {
    const output = await this.git(workbook, [
      'status',
      '--porcelain=v2',
      '--branch',
      '-z',
      '--untracked-files=all',
      '--',
      fileName(workbook),
      'assets',
    ]);
    return parseStatus(output.stdout);
  }

  /** The workbook's source in the last commit; null when it was never committed. */
  async committedSource(workbook: string): Promise<string | null> {
    const output = await this.git(workbook, ['show', `HEAD:./${fileName(workbook)}`], false);
    return output.code === 0 ? output.stdout : null;
  }

  /** `git diff` of the file against the last commit (the raw text, for the curious). */
  async textDiff(workbook: string): Promise<string> {
    const output = await this.git(workbook, ['diff', '--no-ext-diff', 'HEAD', '--', fileName(workbook)], false);
    return output.code === 0 ? output.stdout : '';
  }

  /**
   * Commit the workbook and its changed images — and nothing else the user may have staged
   * (`--only`).
   */
  async commit(workbook: string, message: string, changedPaths: string[]): Promise<string> {
    // Status paths are relative to the repository; git runs in the workbook's folder.
    const files = [...new Set([fileName(workbook), ...changedPaths.map((path) => `:(top)${path}`)])];
    await this.git(workbook, ['add', '--', ...files]);
    const output = await this.git(workbook, ['commit', `--message=${message}`, '--only', '--', ...files]);
    return output.stdout.split('\n')[0] ?? '';
  }

  /** Push the branch; a branch without upstream is published to `origin`. */
  async push(workbook: string): Promise<string> {
    const output = await this.git(workbook, ['push'], false);
    if (output.code === 0) return summary(output);
    if (/no upstream branch|has no upstream/i.test(output.stderr)) {
      return summary(await this.git(workbook, ['push', '--set-upstream', 'origin', 'HEAD']));
    }
    throw new GitError(gitMessage(output));
  }

  /** Fast-forward only: a diverged branch is merged in a git tool, never here. */
  async pull(workbook: string): Promise<string> {
    return summary(await this.git(workbook, ['pull', '--ff-only']));
  }

  private async git(workbook: string, args: string[], check = true): Promise<GitOutput> {
    if (this.transport === null) throw new GitError('Git is available for workbooks opened with reaktiv-workbook edit.');
    const output = await this.transport.run(workbook, args);
    if (check && output.code !== 0) throw new GitError(gitMessage(output));
    return output;
  }
}

function fileName(workbook: string): string {
  return workbook.split(/[\\/]/).pop() ?? workbook;
}

function summary(output: GitOutput): string {
  return (output.stdout.trim() || output.stderr.trim()).split('\n').at(-1) ?? '';
}

/** git's own words, without hints meant for the terminal. */
export function gitMessage(output: GitOutput): string {
  const text = (output.stderr.trim() || output.stdout.trim())
    .split('\n')
    .filter((line) => !line.startsWith('hint:'))
    .join('\n')
    .trim();
  if (/Not possible to fast-forward|diverging branches|non-fast-forward|fetch first/i.test(text)) {
    return 'The branch and its remote have both changed. Merge them in your git tool, then reopen the workbook.';
  }
  if (/could not read Username|Authentication failed|Permission denied \(publickey\)/i.test(text)) {
    return 'git could not sign in to the remote. Set up your credentials (or SSH key) in a terminal once; the app uses the same.';
  }
  return text || `git exited with ${output.code}`;
}
