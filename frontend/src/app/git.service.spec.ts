import { TestBed } from '@angular/core/testing';
import { diffWorkbooks, GitService, gitMessage, lineDiff, parseStatus, type GitOutput, HttpGitTransport } from './git.service';
import { createSheetDocument } from './sheet-file';
import type { CellDefinition } from './sheet.types';

const cell = (id: string, source: string, name?: string, kind: CellDefinition['kind'] = 'formula'): CellDefinition => ({
  id,
  kind,
  source,
  enabled: true,
  ...(name ? { name } : {}),
});
const workbook = (cells: CellDefinition[], packages: string[] = []) => createSheetDocument('Budget', 10, 16, cells, packages);

describe('git status', () => {
  it('reads branch, distance to the remote, and changed files', () => {
    const status = parseStatus(
      [
        '# branch.oid 1234',
        '# branch.head main',
        '# branch.upstream origin/main',
        '# branch.ab +2 -1',
        '1 .M N... 100644 100644 100644 aaa bbb notes/budget.sheet.py',
        '2 R. N... 100644 100644 100644 aaa bbb R100 notes/assets/new name.webp',
        'notes/assets/old.webp',
        '? notes/assets/0123456789abcdef.png',
        '',
      ].join('\0'),
    );
    expect(status).toEqual({
      branch: 'main',
      upstream: 'origin/main',
      ahead: 2,
      behind: 1,
      changes: [
        { path: 'notes/budget.sheet.py', state: 'changed' },
        { path: 'notes/assets/new name.webp', state: 'renamed' },
        { path: 'notes/assets/0123456789abcdef.png', state: 'new' },
      ],
    });
    expect(parseStatus('# branch.head (detached)\0').branch).toBeNull();
  });
});

describe('diff by cell', () => {
  it('lines added and removed', () => {
    expect(lineDiff('a\nb\nc', 'a\nc\nd')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'removed', text: 'b' },
      { kind: 'same', text: 'c' },
      { kind: 'added', text: 'd' },
    ]);
    expect(lineDiff('', 'x')).toEqual([{ kind: 'added', text: 'x' }]);
  });

  it('names added, removed, changed and moved cells, and workbook settings', () => {
    const before = workbook([
      cell('A1', '10', 'rate', 'input'),
      cell('A2', 'rate * 2', 'double'),
      cell('A3', 'rate + 1'),
      cell('B1', 'print(rate)', 'log', 'effect'),
    ]);
    const after = workbook(
      [
        cell('A1', '10', 'rate', 'input'), // unchanged: not listed
        cell('C5', 'rate * 2', 'double'), // moved
        cell('A3', 'rate + 2'), // changed
        cell('B1', 'print(rate)', 'logger', 'effect'), // relabelled
        cell('D1', 'rate ** 2', 'square'), // added
      ],
      ['numpy'],
    );
    const changes = diffWorkbooks(before, after);
    expect(changes.workbook).toEqual(['packages']);
    expect(changes.cells.map((change) => [change.id, change.change, change.from ?? null, change.details])).toEqual([
      ['A3', 'changed', null, []],
      ['B1', 'changed', null, ['label log → logger']],
      ['C5', 'moved', 'A2', []],
      ['D1', 'added', null, []],
    ]);
    expect(changes.cells[0].lines).toEqual([
      { kind: 'removed', text: 'rate + 1' },
      { kind: 'added', text: 'rate + 2' },
    ]);
    // Removed cells, and a workbook that was never committed.
    expect(diffWorkbooks(after, workbook([cell('A1', '10', 'rate', 'input')])).cells.map((change) => change.change)).toEqual([
      'removed',
      'removed',
      'removed',
      'removed',
    ]);
    expect(diffWorkbooks(null, after).workbook).toEqual(['new workbook']);
  });
});

describe('GitService', () => {
  const ok = (stdout = ''): GitOutput => ({ code: 0, stdout, stderr: '' });
  let calls: string[][];
  let answers: GitOutput[];
  let service: GitService;

  beforeEach(() => {
    calls = [];
    answers = [];
    service = TestBed.inject(GitService);
    service.transport = {
      run: async (_workbook, args) => {
        calls.push(args);
        return answers.shift() ?? ok();
      },
    };
  });

  it('commits only the workbook and its changed images', async () => {
    answers = [ok(), ok('[main 1a2b3c4] Use the new tax rate\n 1 file changed')];
    const result = await service.commit('/repo/notes/budget.sheet.py', 'Use the new tax rate', [
      'notes/budget.sheet.py',
      'notes/assets/0123456789abcdef.png',
    ]);
    expect(result).toBe('[main 1a2b3c4] Use the new tax rate');
    expect(calls).toEqual([
      ['add', '--', 'budget.sheet.py', ':(top)notes/budget.sheet.py', ':(top)notes/assets/0123456789abcdef.png'],
      [
        'commit',
        '--message=Use the new tax rate',
        '--only',
        '--',
        'budget.sheet.py',
        ':(top)notes/budget.sheet.py',
        ':(top)notes/assets/0123456789abcdef.png',
      ],
    ]);
  });

  it('publishes a branch without upstream, and pulls fast-forward only', async () => {
    answers = [{ code: 128, stdout: '', stderr: 'fatal: The current branch topic has no upstream branch.' }, ok()];
    await service.push('/repo/budget.sheet.py');
    expect(calls).toEqual([['push'], ['push', '--set-upstream', 'origin', 'HEAD']]);
    calls = [];
    await service.pull('/repo/budget.sheet.py');
    expect(calls).toEqual([['pull', '--ff-only']]);
  });

  it('reads the committed version, or none for a new file', async () => {
    answers = [ok('# file'), { code: 128, stdout: '', stderr: "fatal: path 'x' exists on disk, but not in 'HEAD'" }];
    expect(await service.committedSource('/repo/budget.sheet.py')).toBe('# file');
    expect(calls[0]).toEqual(['show', 'HEAD:./budget.sheet.py']);
    expect(await service.committedSource('/repo/budget.sheet.py')).toBeNull();
  });

  it("explains git's errors in the app's words", () => {
    expect(gitMessage({ code: 1, stdout: '', stderr: 'hint: x\nfatal: Not possible to fast-forward, aborting.' })).toContain(
      'Merge them in your git tool',
    );
    expect(gitMessage({ code: 128, stdout: '', stderr: 'git@github.com: Permission denied (publickey).' })).toContain(
      'Set up your credentials',
    );
    expect(gitMessage({ code: 1, stdout: '', stderr: 'hint: only a hint\nerror: something else' })).toBe('error: something else');
  });
});

it('shows a linked override change even when its formula is unchanged', () => {
  const before = workbook([cell('B1', 'base * 2', 'price', 'linked')]);
  const after = workbook([{ ...cell('B1', 'base * 2', 'price', 'linked'), override: '7' }]);
  const changes = diffWorkbooks(before, after);
  expect(changes.cells).toHaveLength(1);
  expect(changes.cells[0].details).toEqual(['override derived → 7']);
});

describe('git through the CLI session', () => {
  it('sends only the arguments; the session decides where git runs', async () => {
    const sent: string[][] = [];
    const transport = new HttpGitTransport(async args => {
      sent.push(args);
      return { code: 0, stdout: '/repo\n', stderr: '' };
    });
    const service = new GitService();
    service.transport = transport;
    expect(service.available).toBe(true);
    await expect(service.repository('/elsewhere/budget.workbook.py')).resolves.toBe('/repo');
    expect(sent).toEqual([['rev-parse', '--show-toplevel']]);
  });
});
