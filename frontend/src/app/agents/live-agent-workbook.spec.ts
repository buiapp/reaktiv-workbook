import { describe, expect, it, vi } from 'vitest';
import { createSheetDocument } from '../sheet-file';
import type { CellDefinition, GraphResult } from '../sheet.types';
import { LiveAgentWorkbook, type AgentCommand, type LiveAgentPorts } from './live-agent-workbook';

const cell = (id: string, source: string): CellDefinition => ({ id, source, kind: 'input', enabled: true, trigger: 'auto' });
const command = (operation: AgentCommand['operation'], payload = {}): AgentCommand => ({
  id: 'command', operation, payload, expiresAt: Date.now() + 60000,
});

function model() {
  let document = createSheetDocument('Live', 10, 16, [cell('A1', '4')], []);
  let graph: GraphResult = { cells: [], dependencies: {}, effects: [], changed: [], logs: [], rebuilt: false, updateMode: 'incremental' };
  let drafts: string[] = [];
  let running = true;
  const ports: LiveAgentPorts = {
    document: () => document, graph: () => graph, drafts: () => drafts, kernelRunning: () => running,
    validate: vi.fn(async () => undefined), save: vi.fn(async () => undefined),
    commit: vi.fn(async cells => { document = { ...document, cells }; }),
  };
  const workbook = new LiveAgentWorkbook(ports);
  return { ports, workbook, document: () => document, setDocument: (next: typeof document) => { document = next; },
    change: () => { document = { ...document, cells: [cell('A1', '8')] }; },
    setGraph: (next: GraphResult) => { graph = next; },
    draft: (ids: string[]) => { drafts = ids; }, stop: () => { running = false; },
  };
}

describe('LiveAgentWorkbook', () => {
  it('includes passive layout feedback for only the explicitly inspected IDs', async () => {
    const m = model();
    m.ports.cellLayouts = vi.fn(() => []);
    m.stop();
    const inspected = await m.workbook.execute(command('inspect', {cellIds:['A1']}), () => {});
    expect(inspected['layout']).toEqual([]);
    expect(m.ports.cellLayouts).toHaveBeenCalledWith(['A1']);
    expect(m.ports.commit).not.toHaveBeenCalled(); expect(m.ports.validate).not.toHaveBeenCalled();
  });
  it('reads without evaluating and keeps revision stable until source or results change', () => {
    const m = model(), first = m.workbook.read();
    expect(m.workbook.read()['revision']).toBe(first['revision']);
    expect(m.ports.commit).not.toHaveBeenCalled();
    m.change();
    expect(m.workbook.read()['revision']).not.toBe(first['revision']);
    const revision = m.workbook.read()['revision'];
    m.setGraph({ cells: [{ id: 'A1', value: 8, display: '8', valueType: 'int', error: null,
      richOutput: { mimeType: 'image/png', dataBase64: 'large-data' } }],
      dependencies: {}, effects: [], logs: [], changed: ['A1'], rebuilt: false, updateMode: 'incremental' });
    const read = m.workbook.read();
    expect(read['revision']).not.toBe(revision);
    expect(JSON.stringify(read)).not.toContain('large-data');
  });

  it('reads diagnostics and targeted cells passively and gates destructive kernel controls', async () => {
    const m = model();
    m.ports.logs = () => [{ cellId: 'A1', timestamp: '2026-11-04T12:00:00Z', level: 'error', message: 'failure' }];
    m.ports.kernelStatus = () => ({ status: 'ready' });
    m.ports.controlKernel = vi.fn(async (_action, _force, check) => { check(); });
    const revision = m.workbook.read()['revision'];
    expect((await m.workbook.execute(command('overview'), () => {}))['cellCount']).toBe(1);
    expect((await m.workbook.execute(command('inspect', { cellIds: ['A1'] }), () => {}))['cells']).toEqual(m.document().cells.map(cell => ({...cell, modelReference: 'self.Sheet1.a1'})));
    expect((await m.workbook.execute(command('logs'), () => {}))['totalMatched']).toBe(1);
    expect((await m.workbook.execute(command('diagnostics'), () => {}))['updateTraceAvailable']).toBe(false);
    expect((await m.workbook.execute(command('kernel-status'), () => {}))['status']).toBe('ready');
    expect(m.workbook.read()['revision']).toBe(revision);
    expect(m.ports.commit).not.toHaveBeenCalled();
    await expect(m.workbook.execute(command('kernel-control', { action: 'restart' }), () => {})).rejects.toThrow('conflict');
    m.draft(['A1']);
    await expect(m.workbook.execute(command('kernel-control', { action: 'restart', revision }), () => {})).rejects.toThrow('drafts');
    await m.workbook.execute(command('kernel-control', { action: 'interrupt' }), () => {});
    expect(m.ports.controlKernel).toHaveBeenCalledWith('interrupt', false, expect.any(Function));
    await expect(m.workbook.execute(command('kernel-control', { action: 'interrupt', force: true, revision }), () => {})).rejects.toThrow('drafts');
    m.draft([]);
    await m.workbook.execute(command('kernel-control', { action: 'restart', revision }), () => {});
    expect(m.ports.controlKernel).toHaveBeenCalledWith('restart', false, expect.any(Function));
  });

  it('rechecks consent and revisions when a kernel control waits for the app queue', async () => {
    const m = model(), revision = m.workbook.read()['revision'];
    m.ports.controlKernel = vi.fn(async (_action, _force, check) => { m.change(); check(); });
    await expect(m.workbook.execute(command('kernel-control', { action: 'restart', revision }), () => {})).rejects.toThrow('changed');
    expect(m.ports.commit).not.toHaveBeenCalled();
  });

  it('edits action definitions without invoking them and runs only explicit exposed actions', async () => {
    const m = model();
    const definition = { name: 'add', source: 'def add(self, amount=1):\n    return amount', label: 'Add', references: {}, bindings: {}, exposed: true };
    m.ports.actionDrafts = () => false;
    m.ports.editAction = vi.fn(async (next, check) => { check(); m.setDocument({ ...m.document(), actions: [next] }); });
    m.ports.runAction = vi.fn(async (_name, _args, check) => { check(); });
    await m.workbook.execute(command('action-edit', { revision: m.workbook.read()['revision'], definition }), () => {});
    expect(m.ports.validate).toHaveBeenCalledWith(expect.objectContaining({ actions: [definition] }));
    expect(m.ports.runAction).not.toHaveBeenCalled();
    const revision = m.workbook.read()['revision'];
    await m.workbook.execute(command('action-run', { revision, name: 'add', arguments: { amount: { cell: 'A1' } } }), () => {});
    expect(m.ports.runAction).toHaveBeenCalledWith('add', { amount: { cell: 'A1' } }, expect.any(Function));
    m.draft(['A1']);
    await expect(m.workbook.execute(command('action-run', { revision, name: 'add' }), () => {})).rejects.toThrow('drafts');
    m.draft([]); m.ports.actionDrafts = () => true;
    await expect(m.workbook.execute(command('action-edit', { revision, definition }), () => {})).rejects.toThrow('action drafts');
    m.ports.actionDrafts = () => false;
    await expect(m.workbook.execute(command('action-run', { revision, name: 'missing' }), () => {})).rejects.toThrow('Unknown');
    await expect(m.workbook.execute(command('action-run', { revision, name: 'add', arguments: { amount: { cell: 'missing' } } }), () => {})).rejects.toThrow('Unknown');
  });

  it('rechecks sharing, revision and action drafts after asynchronous action validation', async () => {
    const m = model();
    m.ports.editAction = vi.fn();
    m.ports.validate = vi.fn(async () => { m.change(); });
    await expect(m.workbook.execute(command('action-edit', { revision: m.workbook.read()['revision'],
      definition: { name: 'add', source: 'def add(self):\n    return 1' } }), () => {})).rejects.toThrow('conflict');
    expect(m.ports.editAction).not.toHaveBeenCalled();
  });

  it('includes resolved colors and errors in targeted MCP inspection', async () => {
    const m = model();
    m.setGraph({cells: [{id: 'A1', value: 4, display: '4', valueType: 'int', error: null,
      color: '#ffcccc', colorDependencies: ['B1'], colorError: 'Invalid color'}],
      dependencies: {}, effects: [], logs: [], changed: [], rebuilt: false, updateMode: 'incremental'});
    const inspected = await m.workbook.execute(command('inspect', {cellIds: ['A1']}), () => {});
    expect(inspected['results']).toEqual([expect.objectContaining({color: '#ffcccc', colorDependencies: ['B1'], colorError: 'Invalid color'})]);
  });

  it('exposes reactive color expressions while preserving fixed-color operation with a stopped kernel', async () => {
    const m = model();
    m.ports.colorCells = vi.fn(async () => {});
    const revision = m.workbook.read()['revision'];
    await m.workbook.execute(command('colors', {revision, cellIds: ['A1'], color: '#EEEEEE', expression: "'#ffcccc' if A1 > 5 else None"}), () => {});
    expect(m.ports.colorCells).toHaveBeenCalledWith(['A1'], '#eeeeee', "'#ffcccc' if A1 > 5 else None");
    m.stop();
    await expect(m.workbook.execute(command('colors', {revision, cellIds: ['A1'], color: '', expression: 'A1'}), () => {})).rejects.toThrow('kernel');
  });

  it('allows presentation changes with a stopped kernel while checking revision, color and grid bounds', async () => {
    const m = model(); m.stop(); m.draft(['A1']);
    m.ports.colorCells = vi.fn(async (ids, color) => { m.setDocument({ ...m.document(), cells: m.document().cells.map(cell => ids.includes(cell.id) ? { ...cell, color } : cell) }); });
    m.ports.resizeWorksheet = vi.fn(async (_sheet, columns, rows) => ({ columns, rows }));
    const oldRevision = m.workbook.read()['revision'];
    await m.workbook.execute(command('colors', { revision: oldRevision, cellIds: ['A1'], color: '#CDE7AE' }), () => {});
    expect(m.document().cells[0].source).toBe('4');
    expect(m.document().cells[0].color).toBe('#cde7ae');
    expect(m.ports.commit).not.toHaveBeenCalled();
    await expect(m.workbook.execute(command('colors', { revision: oldRevision, cellIds: ['A1'], color: '' }), () => {})).rejects.toThrow('conflict');
    const revision = m.workbook.read()['revision'];
    await expect(m.workbook.execute(command('colors', { revision, cellIds: ['A1'], color: 'red' }), () => {})).rejects.toThrow('#RRGGBB');
    await expect(m.workbook.execute(command('resize', { revision, worksheet: 'missing', columns: 10, rows: 30 }), () => {})).rejects.toThrow('worksheet');
    await expect(m.workbook.execute(command('resize', { revision, worksheet: m.document().sheetName ?? 'Sheet1', columns: 1000, rows: 1000 }), () => {})).rejects.toThrow('100000');
    await m.workbook.execute(command('resize', { revision, worksheet: m.document().sheetName ?? 'Sheet1', columns: 12, rows: 30 }), () => {});
    expect(m.ports.resizeWorksheet).toHaveBeenCalledWith('', 12, 30);
  });

  it('rejects MCP placements over resized cells before validation or commit and permits an atomic relocation', async () => {
    const m = model();
    m.setDocument({ ...m.document(), cells: [{ ...cell('A1', '4'), view: { span: [3, 3] } }, cell('E1', '8')] });
    const revision = m.workbook.read()['revision'];
    for (const payload of [
      { cells: [cell('B2', '8')], delete: ['E1'] },
      { cells: [{ ...cell('C1', '4'), view: { span: [3, 3] } }], delete: ['A1'] },
      { cells: [{ ...cell('A1', '4'), view: { span: [5, 3] } }] },
    ]) await expect(m.workbook.execute(command('edit', { revision, ...payload }), () => {})).rejects.toThrow('overlap');
    expect(m.ports.validate).not.toHaveBeenCalled(); expect(m.ports.commit).not.toHaveBeenCalled();
    expect(m.workbook.read()['revision']).toBe(revision);
    await m.workbook.execute(command('edit', { revision, cells: [
      { ...cell('C1', '4'), view: { span: [3, 3] } }, cell('G1', '8'),
    ], delete: ['A1', 'E1'] }), () => {});
    expect(m.document().cells.map(cell => cell.id)).toEqual(['C1', 'G1']);
    expect(m.ports.commit).toHaveBeenCalledOnce();
  });

  it('creates a note, updates and deletes cells as one validated batch', async () => {
    const m = model();
    const revision = m.workbook.read()['revision'];
    const note = { ...cell('B1', '# Results\n{{ amount }}'), kind: 'markdown', name: 'report' };
    await m.workbook.execute(command('edit', { revision, cells: [note], delete: ['A1'] }), () => {});
    expect(m.document().cells).toEqual([note]);
    expect(m.ports.validate).toHaveBeenCalledOnce();
    expect(m.ports.commit).toHaveBeenCalledOnce();
    expect(m.ports.save).not.toHaveBeenCalled();
  });

  it('rejects stale state, stopped kernels, duplicate edits and user drafts without applying', async () => {
    const m = model(), revision = m.workbook.read()['revision'];
    const edit = () => m.workbook.execute(command('edit', { revision, cells: [cell('A1', '5')] }), () => {});
    m.draft(['A1']);
    await expect(edit()).rejects.toThrow('User drafts');
    m.draft([]);
    await expect(m.workbook.execute(command('edit', { revision, cells: [cell('A1', '5'), cell('A1', '6')] }), () => {})).rejects.toThrow('Duplicate');
    m.change();
    await expect(edit()).rejects.toThrow('conflict');
    m.stop();
    await expect(m.workbook.execute(command('edit', { revision: m.workbook.read()['revision'], cells: [cell('A1', '5')] }), () => {})).rejects.toThrow('kernel');
    expect(m.ports.commit).not.toHaveBeenCalled();
  });

  it.each(['source', 'draft', 'revoke', 'kernel'] as const)('rechecks %s while asynchronous validation runs', async kind => {
    const m = model(), revision = m.workbook.read()['revision'];
    let finish!: () => void, shared = true;
    vi.mocked(m.ports.validate).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const edit = m.workbook.execute(command('edit', { revision, cells: [cell('A1', '5')] }), () => {
      if (!shared) throw new Error('revoked');
    });
    if (kind === 'source') m.change();
    if (kind === 'draft') m.draft(['A1']);
    if (kind === 'revoke') shared = false;
    if (kind === 'kernel') m.stop();
    finish();
    await expect(edit).rejects.toThrow();
    expect(m.ports.commit).not.toHaveBeenCalled();
  });

  it('preserves unrelated drafts and rejects an expired queued edit', async () => {
    const m = model(), revision = m.workbook.read()['revision'];
    m.draft(['B2']);
    await m.workbook.execute(command('edit', { revision, cells: [cell('A1', '5')] }), () => {});
    expect(m.workbook.read()['draftedCells']).toEqual(['B2']);
    await expect(m.workbook.execute({ ...command('edit', { cells: [] }), expiresAt: 0 }, () => {})).rejects.toThrow('expired');
  });

  it('saves source without starting a stopped kernel and protects outstanding user drafts', async () => {
    const m = model(); m.stop();
    const revision = m.workbook.read()['revision'];
    await m.workbook.execute(command('save', { revision }), () => {});
    expect(m.ports.save).toHaveBeenCalledOnce();
    expect(m.ports.commit).not.toHaveBeenCalled();
    m.draft(['A1']);
    await expect(m.workbook.execute(command('save', { revision }), () => {})).rejects.toThrow('User drafts');
    expect(m.ports.save).toHaveBeenCalledOnce();
  });
});

describe('agent workbook management', () => {
  it('reads environment without evaluating or exposing variable values', async () => {
    const m = model();
    m.setDocument({...m.document(), environment: {...m.document().environment, code:'FACTOR = 2', variables:{SECRET:'private'}}});
    const result = await m.workbook.execute(command('environment', {read:true}), () => {});
    expect(result['code']).toBe('FACTOR = 2');
    expect(JSON.stringify(result)).not.toContain('private');
    expect(m.ports.validate).not.toHaveBeenCalled();
  });
  it('validates partial environment changes and rejects stale or drafted mutations', async () => {
    const m = model();
    m.ports.updateEnvironment = vi.fn(async (change, check) => {check(); m.setDocument({...m.document(), environment:{...m.document().environment,...change}});});
    let revision = m.workbook.read()['revision'];
    await m.workbook.execute(command('environment', {revision, packages:['schemdraw']}), () => {});
    expect(m.ports.updateEnvironment).toHaveBeenCalledWith({packages:['schemdraw']}, expect.any(Function));
    expect(m.document().environment.packages).toEqual(['schemdraw']);
    await expect(m.workbook.execute(command('environment', {revision, code:''}), () => {})).rejects.toThrow('conflict');
    revision = m.workbook.read()['revision']; m.draft(['A1']);
    await expect(m.workbook.execute(command('environment', {revision, code:''}), () => {})).rejects.toThrow('drafts');
  });
  it('rechecks revision after environment validation awaits', async () => {
    const m = model(); m.ports.updateEnvironment = vi.fn();
    m.ports.validate = async () => {m.change();};
    await expect(m.workbook.execute(command('environment', {revision:m.workbook.read()['revision'], code:'X=1'}), () => {})).rejects.toThrow('conflict');
    expect(m.ports.updateEnvironment).not.toHaveBeenCalled();
  });
  it('routes explicit worksheet changes and preserves the existing edit gate', async () => {
    const m = model(); m.ports.manageWorksheet = vi.fn(async (_change, check) => check());
    const revision = m.workbook.read()['revision'];
    await m.workbook.execute(command('worksheets', {revision,action:'create',name:'Circuits',columns:20,rows:30}), () => {});
    expect(m.ports.manageWorksheet).toHaveBeenCalledWith(expect.objectContaining({action:'create',name:'Circuits',columns:20,rows:30}),expect.any(Function));
    m.stop();
    await expect(m.workbook.execute(command('worksheets', {revision,action:'delete',name:'Circuits'}), () => {})).rejects.toThrow('kernel');
  });
  it('returns durable uploaded image references and keeps visual reads passive', async () => {
    const m = model(); m.ports.addImage = vi.fn(async (_mime, _data, check) => {check(); return 'assets/1234567890abcdef.png';});
    const image = await m.workbook.execute(command('asset', {revision:m.workbook.read()['revision'],mimeType:'image/png',dataBase64:'aGVsbG8='}), () => {});
    expect(image['inserted']).toBe(false); expect(image['markdown']).toContain('assets/1234567890abcdef.png');
    m.ports.inspectVisual = vi.fn(async () => ({mimeType:'image/png',dataBase64:'abc'})); m.stop();
    expect((await m.workbook.execute(command('visual', {cellId:'A1'}), () => {}))['dataBase64']).toBe('abc');
    await expect(m.workbook.execute(command('visual', {cellId:'Missing'}), () => {})).rejects.toThrow('Unknown');
    expect(m.ports.commit).not.toHaveBeenCalled();
  });
});

describe('LiveAgentWorkbook relayout commands', () => {
  it('allows passive track sizing with kernel stopped and refuses stale revisions', async () => {
    const m = model(); m.stop(); m.ports.setTracks = vi.fn(async () => {});
    const payload = {revision: m.workbook.read()['revision'], worksheet: 'Sheet1', rowHeights: {'2': 64}};
    await m.workbook.execute(command('tracks', payload), () => {});
    expect(m.ports.setTracks).toHaveBeenCalledWith({worksheet: 'Sheet1', rowHeights: {'2': 64}, columnWidths: undefined});
    expect(m.ports.commit).not.toHaveBeenCalled();
    m.change();
    await expect(m.workbook.execute(command('tracks', payload), () => {})).rejects.toThrow('conflict');
  });
  it('moves through the atomic port and protects drafts and occupied destinations', async () => {
    const m = model(); m.ports.moveCells = vi.fn(async () => {});
    const payload = {revision: m.workbook.read()['revision'], cellId: 'A1', targetId: 'B2'};
    m.draft(['C3']);
    await expect(m.workbook.execute(command('move', payload), () => {})).rejects.toThrow('drafts');
    m.draft([]);
    await m.workbook.execute(command('move', payload), () => {});
    expect(m.ports.moveCells).toHaveBeenCalledWith('A1', 'B2', undefined);
    expect(m.ports.commit).not.toHaveBeenCalled();
    m.setDocument({...m.document(), cells: [...m.document().cells, cell('B2', '3')]});
    await expect(m.workbook.execute(command('move', {...payload, revision: m.workbook.read()['revision']}), () => {})).rejects.toThrow('occupied');
  });
});
