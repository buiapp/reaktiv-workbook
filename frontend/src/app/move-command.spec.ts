import { RuntimeService, applyDefinitionPatch } from './runtime.service';
import type { CellDefinition, GraphResult, SheetDocument } from './sheet.types';

const base: GraphResult = {
  cells: [],
  dependencies: {},
  effects: [],
  logs: [],
  changed: [],
  rebuilt: false,
  updateMode: 'incremental',
};
const cells: CellDefinition[] = [
  {
    id: 'A1',
    kind: 'input',
    source: '[' + '255,'.repeat(250000) + '255]',
    enabled: true,
  },
];
const document: SheetDocument = {
  format: 'reaktiv-workbook',
  version: 4,
  name: 'Move',
  grid: { columns: 10, rows: 16 },
  environment: { packages: [], variables: {} },
  layout: { columnWidths: {}, rowHeights: {}, zoom: 1 },
  cells,
};

describe('live move commands', () => {
  const saved = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = saved;
  });
  for (const legacy of [false, true])
    it(
      legacy
        ? 'retains legacy kernels without replaying a new command'
        : 'sends a small revisioned command without the buffer or a second apply',
      async () => {
        const calls: { path: string; body: Record<string, unknown> }[] = [];
        globalThis.fetch = vi.fn(async (input, init) => {
          const path = String(input).split('/').at(-1)!;
          const body = JSON.parse(String(init?.body ?? '{}'));
          calls.push({ path, body });
          const result =
            path === 'progress'
              ? { seq: 0, events: [] }
              : path === 'apply'
                ? { ...base, ...(!legacy ? { workbookRevision: 'first' } : {}) }
                : path === 'move-workbook'
                  ? {
                      patches: [{ previousId: 'A1', changes: { id: 'A2' } }],
                      actions: [],
                      graph: { ...base, workbookRevision: 'second' },
                    }
                  : path === 'move-cells'
                    ? [{ ...cells[0], id: 'A2' }]
                    : {};
          return new Response(JSON.stringify(result));
        });
        const service = new RuntimeService();
        await service.configureKernel('remote', 'http://localhost:8765', [], {});
        await service.apply(cells, [], ['Sheet1'], '', true, document);
        const result = await service.moveWorkbookCells(
          cells,
          'A1',
          'A2',
          undefined,
          ['Sheet1'],
          [],
          '',
          document,
        );
        expect(result.cells[0]).toEqual({ ...cells[0], id: 'A2' });
        expect(calls.filter((c) => c.path === 'apply')).toHaveLength(legacy ? 2 : 1);
        const command = calls.find((c) => c.path === 'move-workbook');
        if (legacy) expect(command).toBeUndefined();
        else {
          expect(command?.body).toEqual({
            expectedRevision: 'first',
            sourceId: 'A1',
            targetId: 'A2',
          });
          expect(JSON.stringify(command).length).toBeLessThan(200);
        }
      },
    );
  it('does not retry, fall back, or automatically resync after a stale command', async () => {
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (input) => {
      const path = String(input).split('/').at(-1)!;
      calls.push(path);
      if (path === 'move-workbook')
        return new Response(JSON.stringify({ error: 'Move conflict: changed' }), { status: 409 });
      return new Response(
        JSON.stringify(
          path === 'progress'
            ? { seq: 0, events: [] }
            : path === 'apply'
              ? { ...base, workbookRevision: 'first' }
              : {},
        ),
      );
    });
    const service = new RuntimeService();
    await service.configureKernel('remote', 'http://localhost:8765', [], {});
    await service.apply(cells, [], ['Sheet1'], '', true, document);
    await expect(
      service.moveWorkbookCells(cells, 'A1', 'A2', undefined, ['Sheet1'], [], '', document),
    ).rejects.toThrow('Move conflict');
    await expect(
      service.moveWorkbookCells(cells, 'A1', 'A2', undefined, ['Sheet1'], [], '', document),
    ).rejects.toThrow('needs review');
    expect(calls.filter((c) => c === 'move-workbook')).toHaveLength(1);
    expect(calls.filter((c) => c === 'apply')).toHaveLength(1);
    expect(calls).not.toContain('move-cells');
  });
  it('allows a corrected move after a preflight refusal without reapplying or replaying it', async () => {
    const calls: {path: string; body: Record<string, unknown>}[] = [];
    globalThis.fetch = vi.fn(async (input, init) => {
      const path = String(input).split('/').at(-1)!;
      const body = JSON.parse(String(init?.body ?? '{}'));
      calls.push({path, body});
      if (path === 'move-workbook' && body.targetId === 'B2') {
        return new Response(JSON.stringify({error: 'MoveRejected: Cell B2 would overlap cell B1.'}), {status: 400});
      }
      return new Response(JSON.stringify(path === 'progress' ? {seq: 0, events: []}
        : path === 'apply' ? {...base, workbookRevision: 'first'}
        : {patches: [{previousId: 'A1', changes: {id: 'A2'}}], actions: [], graph: {...base, workbookRevision: 'second'}}));
    });
    const service = new RuntimeService();
    await service.configureKernel('remote', 'http://localhost:8765', [], {});
    await service.apply(cells, [], ['Sheet1'], '', true, document);
    await expect(service.moveWorkbookCells(cells, 'A1', 'B2', undefined, ['Sheet1'], [], '', document)).rejects.toThrow('overlap');
    expect(service.status()).toBe('ready');
    const result = await service.moveWorkbookCells(cells, 'A1', 'A2', undefined, ['Sheet1'], [], '', document);
    expect(result.cells[0].id).toBe('A2');
    expect(calls.filter(call => call.path === 'apply')).toHaveLength(1);
    expect(calls.filter(call => call.path === 'move-workbook').map(call => call.body)).toEqual([
      {expectedRevision: 'first', sourceId: 'A1', targetId: 'B2'},
      {expectedRevision: 'first', sourceId: 'A1', targetId: 'A2'},
    ]);
  });

  it('keeps uncertain transport failures blocked until an explicit reapply', async () => {
    let commands = 0;
    globalThis.fetch = vi.fn(async input => {
      const path = String(input).split('/').at(-1)!;
      if (path === 'move-workbook') { commands++; throw new Error('Connection closed'); }
      return new Response(JSON.stringify(path === 'progress' ? {seq: 0, events: []} : {...base, workbookRevision: 'first'}));
    });
    const service = new RuntimeService();
    await service.configureKernel('remote', 'http://localhost:8765', [], {});
    await service.apply(cells, [], ['Sheet1'], '', true, document);
    await expect(service.moveWorkbookCells(cells, 'A1', 'A2', undefined, ['Sheet1'], [], '', document)).rejects.toThrow('Connection closed');
    await expect(service.moveWorkbookCells(cells, 'A1', 'A3', undefined, ['Sheet1'], [], '', document)).rejects.toThrow('needs review');
    expect(commands).toBe(1);
    await service.apply(cells, [], ['Sheet1'], '', true, document);
    await expect(service.moveWorkbookCells(cells, 'A1', 'A3', undefined, ['Sheet1'], [], '', document)).rejects.toThrow('Connection closed');
    expect(commands).toBe(2);
  });

  it('applies swaps against the original definitions rather than overwriting either side', () => {
    const right = { ...cells[0], id: 'B1', source: '2' };
    const swapped = applyDefinitionPatch(
      [...cells, right],
      [
        { previousId: 'A1', changes: { id: 'B1' } },
        { previousId: 'B1', changes: { id: 'A1' } },
      ],
    );
    expect(swapped[0].source).toBe(cells[0].source);
    expect(swapped[0].id).toBe('B1');
    expect(swapped[1].source).toBe('2');
    expect(swapped[1].id).toBe('A1');
  });
});
