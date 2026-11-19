import { ActionPanelComponent } from './action-panel.component';
import type { AgentViewContext } from './agents/agent-context';
import { WorkbookSourceService } from './workbook-source.service';
import { AssetStore } from './asset-store';
import { serializeResult } from '../../../tests/python-writer';
import type { SheetDocument } from './sheet.types';
import type { CellMemoryReport } from './sheet.types';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { vi } from 'vitest';
import { marked } from 'marked';
import { App } from './app';
import { embedCellImages, embedCellImageSources } from './notes/note-rendering';
import { exampleAssetUrl, isExampleFile } from './files/workbook-paths';
import { literalInputResult } from './workbook/cell-model';
import { sortNotes } from './notes/note-model';
import { sharedCodeNames } from './editor/python-authoring';
import { pythonErrorMessage } from './runtime/error-message';
import { MarkdownCellEditorComponent } from './markdown-cell-editor.component';
import { PythonEditorComponent } from './python-editor.component';
import { GitService } from './git.service';
import { RuntimeService } from './runtime.service';
import { createSheetDocument } from './sheet-file';
import type { CellDefinition, CellResult, GraphResult } from './sheet.types';
import { WorkbookFileService } from './workbook-file.service';
import type { LiveAgentWorkbook } from './agents/live-agent-workbook';
import type { WorkbookCommandQueue } from './workbook-command-queue';

const graph: GraphResult = {
  rebuilt: true,
  updateMode: 'initialized',
  changed: ['A1', 'A2', 'A3', 'B1', 'B2', 'C1', 'D1'],
  dependencies: {
    A3: ['A1', 'A2'],
    B1: ['A1', 'A3'],
    B2: ['A1'],
    C1: ['B1'],
    D1: ['B1', 'B2'],
  },
  cells: [
    { id: 'A1', display: '125000', value: 125000, valueType: 'int', error: null },
    { id: 'A2', display: '0.18', value: 0.18, valueType: 'float', error: null },
    { id: 'A3', display: '22500', value: 22500, valueType: 'float', error: null },
    {
      id: 'B1',
      display: '102500',
      value: 102500,
      valueType: 'float',
      error: null,
      durationMs: 0.125,
    },
    { id: 'B2', display: '126833.3333', value: 126833.3333, valueType: 'float', error: null },
    { id: 'C1', display: 'Effect on', value: null, valueType: 'effect', error: null },
    {
      id: 'D1',
      display: '# Financial snapshot\n\nNet income is **102,500**.',
      value: '# Financial snapshot\n\nNet income is **102,500**.',
      valueType: 'markdown',
      error: null,
    },
    {
      id: 'E1',
      display: 'forecast.png',
      value: {
        filename: 'forecast.png',
        mimeType: 'image/png',
        size: 8,
        sha256: 'plot-digest',
      },
      valueType: 'artifact',
      error: null,
      artifact: {
        filename: 'forecast.png',
        mimeType: 'image/png',
        size: 8,
        sha256: 'plot-digest',
        dataBase64: 'iVBORw0KGgo=',
      },
    },
  ],
  effects: [
    {
      id: 'C1',
      enabled: true,
      trigger: 'auto',
      triggerCount: 1,
      lastTriggered: '2026-09-21T08:00:00.000+00:00',
      output: 'Net income updated: 102,500.00',
      error: null,
      status: 'succeeded',
      durationMs: 0.2,
    },
  ],
  logs: [],
};

/** The small financial workbook most tests work on (the app itself starts blank). */
const FINANCIAL_CELLS: CellDefinition[] = [
  { id: 'A1', name: 'revenue', kind: 'input', source: '125000', enabled: true, trigger: 'auto' },
  { id: 'A2', name: 'tax_rate', kind: 'input', source: '0.18', enabled: true, trigger: 'auto' },
  { id: 'A3', name: 'tax', kind: 'formula', source: 'revenue * tax_rate', enabled: true, trigger: 'auto' },
  { id: 'B1', name: 'net_income', kind: 'formula', source: 'revenue - tax', enabled: true, trigger: 'auto' },
  { id: 'B2', name: 'average_revenue', kind: 'formula', source: 'np.mean(np.array([118000, revenue, 137500]))', enabled: true, trigger: 'auto' },
  { id: 'C1', name: 'income_log', kind: 'effect', source: 'print(f"Net income updated: {net_income:,.2f}")', enabled: true, trigger: 'auto' },
  {
    id: 'D1',
    name: 'financial_snapshot',
    kind: 'markdown',
    source: '# Financial snapshot\n\nNet income is **{{ net_income }}**.\n\nAverage revenue: `{{ average_revenue }}`',
    enabled: true,
    trigger: 'auto',
  },
];

/** Start the app on the financial workbook, as if it had been open before (a restored draft). */
function createWithFinancialModel(requireExplicitStart = false) {
  localStorage.setItem(
    'reaktiv-workbook:auto-draft:v1',
    JSON.stringify({
      savedAt: '2026-09-21T08:00:00.000Z',
      requireExplicitStart,
      document: {
        format: 'reaktiv-workbook',
        version: 4,
        name: 'Financial model',
        grid: { columns: 10, rows: 16 },
        environment: { packages: [], variables: {} },
        layout: { columnWidths: {}, rowHeights: {}, zoom: 1 },
        cells: FINANCIAL_CELLS,
      },
    }),
  );
  return TestBed.createComponent(App);
}

class RuntimeServiceStub {
  memoryDiagnostics():object { return {kind:"local",usage:this.usage()}; }
  readonly consoleSession = signal(0);
  readonly usage = signal<import('./sheet.types').ResourceUsage | null>(null);
  monitorUsage(): () => void { return () => {}; }
  cellMemoryCalls = 0;
  cellMemory(): Promise<CellMemoryReport> { this.cellMemoryCalls++; return Promise.resolve({A1: {bytes: 1024, limited: false}}); }
  readonly status = signal<'ready' | 'running' | 'loading' | 'idle' | 'error'>('ready');
  readonly statusMessage = signal('Python and reaktiv ready');
  readonly error = signal<string | null>(null);
  readonly kernel = signal<'pyodide' | 'remote' | 'local'>('pyodide');
  readonly stoppedCells = signal<ReadonlySet<string>>(new Set());
  /** Set to make the stub a kernel that checks types. */
  typeCheckResult: { available: boolean; diagnostics: unknown[] } | null = null;
  readonly typeCheckCalls: Array<{ document: unknown; mode: string }> = [];
  canCheckTypes(): boolean {
    return this.typeCheckResult !== null;
  }
  checkTypes(document: unknown, mode: string): Promise<unknown> {
    this.typeCheckCalls.push({ document, mode });
    return Promise.resolve(this.typeCheckResult);
  }
  readonly stopCalls: Array<{ cellId: string | null; force: boolean }> = [];
  releaseCells(ids: Iterable<string>): void {
    const next = new Set(this.stoppedCells());
    for (const id of ids) next.delete(id);
    this.stoppedCells.set(next);
  }
  holdCells(ids: Iterable<string>): void {
    this.stoppedCells.set(new Set([...this.stoppedCells(), ...ids]));
  }
  cancelAction(_name: string, _runId?: string): Promise<void> { return Promise.resolve(); }
  cancelResource(_cellId: string): Promise<boolean> { return Promise.resolve(true); }
  setInputs(_sources: Record<string,string>): Promise<GraphResult> { return Promise.reject(new Error("Legacy test runtime")); }
  queueActionInputs(_sources: Record<string,string>): Promise<boolean> { return Promise.resolve(false); }
  stopRun(cellId: string | null, force = false): Promise<'restarted'> {
    this.stopCalls.push({ cellId, force });
    if (cellId !== null) this.holdCells([cellId]);
    return Promise.resolve('restarted');
  }
  readonly configureCalls: Array<{
    kind: string;
    packages: string[];
    variables: Record<string, string>;
  }> = [];
  readonly restartCalls: string[][] = [];
  readonly applyCalls: Array<{ cells: CellDefinition[]; imports: string[] }> = [];
  initialize(): Promise<void> {
    return Promise.resolve();
  }

  /** Set to keep the next apply running until it is called (to look at cell activity). */
  holdApply: Promise<void> | null = null;
  readonly progressListeners: Array<(progress: { event: 'start' | 'end'; cellId: string }) => void> = [];

  readonly logListeners: Array<(entry: import('./sheet.types').LogEntry) => void> = [];
  readonly snapshotListeners: Array<(graph: GraphResult) => void> = [];
  onSnapshot(listener: (graph: GraphResult) => void): () => void {
    this.snapshotListeners.push(listener);
    return () => { this.snapshotListeners.splice(this.snapshotListeners.indexOf(listener), 1); };
  }
  onLog(listener: (entry: import('./sheet.types').LogEntry) => void): () => void {
    this.logListeners.push(listener);
    return () => undefined;
  }

  onProgress(listener: (progress: { event: 'start' | 'end'; cellId: string }) => void): () => void {
    this.progressListeners.push(listener);
    return () => undefined;
  }

  async apply(cells: CellDefinition[], imports: string[] = []): Promise<GraphResult> {
    this.applyCalls.push({ cells, imports });
    if (this.holdApply !== null) await this.holdApply;
    return graph;
  }

  async updateAction(definition: import('./sheet.types').ActionDefinition): Promise<GraphResult> {
    return {...graph, appliedAction: definition};
  }

  noteMoveDocument():void {}
  async moveWorkbookCells(cells:CellDefinition[],source:string,target:string,ids:string[] | undefined,
    sheets:string[],imports:string[],code:string,document:SheetDocument) {
    const moved=await this.moveCells(cells,source,target);
    return {cells:moved,graph:await this.apply(moved,imports),actions:document.actions ?? []};
  }

  moveCells(
    cells: CellDefinition[],
    sourceId: string,
    targetId: string,
  ): Promise<CellDefinition[]> {
    const occupied = cells.some((cell) => cell.id === targetId);
    return Promise.resolve(
      cells.map((cell) => ({
        ...cell,
        id: cell.id === sourceId ? targetId : occupied && cell.id === targetId ? sourceId : cell.id,
        source: cell.kind === 'markdown' ? cell.source.replaceAll(sourceId, targetId) : cell.source,
      })),
    );
  }

  configureKernel(
    kind: string,
    _remoteUrl: string,
    packages: string[],
    variables: Record<string, string>,
  ): Promise<void> {
    this.configureCalls.push({ kind, packages, variables });
    return Promise.resolve();
  }

  suspend(): void {}

  restart(packages: string[]): Promise<void> {
    this.restartCalls.push(packages);
    return Promise.resolve();
  }

  dismissError(): void {
    this.error.set(null);
  }
}

function switchView(element: HTMLElement, label: string): void {
  const button = [...element.querySelectorAll<HTMLButtonElement>('.view-switch button')].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (button === undefined) throw new Error(`Missing ${label} view button`);
  button.click();
}

class WorkbookSourceStub {
  memoryDiagnostics():object { return {active:false,wasmHeapBytes:null}; }
  verifyProblems: string[] = [];
  readonly verifyCalls: string[] = [];
  validateActions(document:SheetDocument) {
    return this.serialize({...document,environment:{packages:[],imports:[],variables:{}},
      cells:document.cells.map(cell=>({id:cell.id,name:cell.name,kind:'input',source:'None',enabled:true,trigger:'auto'}))});
  }
  serialize(document: SheetDocument) {
    const result = serializeResult(document);
    this.verifyCalls.push(result.source);
    return Promise.resolve({...result, problems: this.verifyProblems.length ? this.verifyProblems : result.problems});
  }
}

describe('App', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [{ provide: RuntimeService, useClass: RuntimeServiceStub }, {provide: WorkbookSourceService, useClass: WorkbookSourceStub}],
    }).compileComponents();
  });

  it('opens MCP server information from the named More menu command', async () => {
    const fixture = createWithFinancialModel(true); fixture.detectChanges(); await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    host.querySelector<HTMLButtonElement>('[aria-label="More actions"]')!.click();
    fixture.detectChanges();
    const entry = host.querySelector<HTMLButtonElement>('[aria-label="MCP server and agent access"]')!;
    expect(entry.textContent).toContain('MCP server');
    entry.click(); fixture.detectChanges();
    expect(host.querySelector('app-agent-access h2')?.textContent).toContain('MCP server');
    fixture.destroy();
  });

  it('reports live pane, note and inspector context without evaluating on navigation', async () => {
    const fixture = createWithFinancialModel(); fixture.detectChanges(); await fixture.whenStable();
    const app = fixture.componentInstance as unknown as {
      agentWorkbook: LiveAgentWorkbook; workbookCommands: WorkbookCommandQueue; selectCell(id: string): void;
      viewMode: ReturnType<typeof signal<'notes' | 'sheet' | 'graph' | 'split'>>;
      setInspectorVisible(visible: boolean): void;
      splitViews: ReturnType<typeof signal<['notes' | 'sheet' | 'graph', 'notes' | 'sheet' | 'graph']>>;
      splitSheets: ReturnType<typeof signal<[string, string]>>;
      activeSplitPane: ReturnType<typeof signal<number>>;
    };
    const runtime = TestBed.inject(RuntimeService) as unknown as RuntimeServiceStub;
    await app.workbookCommands.run(async () => undefined);
    app.selectCell('A1'); app.viewMode.set('sheet'); app.setInspectorVisible(true);
    const revision = app.agentWorkbook.read()['revision'];
    const before = runtime.applyCalls.length;
    const context = async () => (await app.agentWorkbook.execute({ id: 'context', operation: 'context',
      expiresAt: Date.now() + 60000, payload: {} }, () => {}))['context'] as AgentViewContext;
    const inspected = await context();
    const layout = await app.agentWorkbook.execute({id:'layout',operation:'inspect',expiresAt:Date.now()+60000,payload:{cellIds:['A1']}}, () => {});
    expect(layout['layout']).toEqual([expect.objectContaining({cellId:'A1',worksheet:'Sheet1',units:'unzoomed-css-pixels',status:'unmeasured'})]);
    expect(inspected.selectedCell?.id).toBe('A1');
    expect(inspected.inspectedCell?.id).toBe('A1');
    expect(inspected.editorCellId).toBe('A1');
    app.viewMode.set('notes');
    const notes = await context();
    expect(notes.panes[0].view).toBe('notes');
    expect(notes.panes[0].note?.kind).toBe('markdown');
    app.viewMode.set('split'); app.splitViews.set(['sheet', 'notes']);
    app.splitSheets.set(['', '']); app.activeSplitPane.set(1); app.setInspectorVisible(false);
    const split = await context();
    expect(split.panes.map(pane => pane.view)).toEqual(['sheet', 'notes']);
    expect(split.panes[1].note?.id).toBe(notes.panes[0].note?.id);
    expect(split.activePane).toBe(1);
    expect(split.inspectedCell).toBeNull();
    expect(app.agentWorkbook.read()['revision']).toBe(revision);
    expect(runtime.applyCalls).toHaveLength(before);
    fixture.destroy();
  });

  it('applies a live agent batch through the existing runtime with one labelled undo step', async () => {
    const fixture = createWithFinancialModel(); fixture.detectChanges(); await fixture.whenStable();
    const runtime = TestBed.inject(RuntimeService) as unknown as RuntimeServiceStub;
    const app = fixture.componentInstance as unknown as {
      agentWorkbook: LiveAgentWorkbook; workbookCommands: WorkbookCommandQueue;
      cells(): CellDefinition[]; undo(): void; redo(): void; undoLabel(): string | null;
      markDocumentSaved(): void; hasUnsavedChanges(): boolean;
      agentActivity: import('./agents/agent-activity').AgentActivity;
    };
    await app.workbookCommands.run(async () => undefined);
    app.markDocumentSaved();
    const before = app.cells(), restarts = runtime.restartCalls.length, starts = runtime.configureCalls.length;
    const revision = app.agentWorkbook.read()['revision'];
    await app.workbookCommands.run(() => app.agentWorkbook.execute({
      id: 'agent-batch', operation: 'edit', expiresAt: Date.now() + 60000,
      payload: { revision, cells: [
        { id: 'F1', name: 'agent_note', kind: 'markdown', source: '# Agent note\n{{ net_income }}' },
        { id: 'F2', name: 'agent_amount', kind: 'input', source: '42' },
      ] },
    }, () => {}));
    fixture.detectChanges(); await fixture.whenStable();
    expect(app.cells().find(cell => cell.id === 'F1')?.source).toContain('# Agent note');
    expect(runtime.applyCalls.at(-1)?.cells.find(cell => cell.id === 'F2')?.source).toBe('42');
    expect(runtime.restartCalls).toHaveLength(restarts);
    expect(runtime.configureCalls).toHaveLength(starts);
    expect(app.hasUnsavedChanges()).toBe(true);
    expect(app.undoLabel()).toBe('Agent cell edits');
    expect(app.agentActivity.feedback().get('F1')?.origin).toBe('created');
    expect(app.agentActivity.feedback().get('F2')?.origin).toBe('created');
    expect(app.agentActivity.entries()[0]).toMatchObject({status: 'completed', kind: 'write', cellCount: 2});
    app.undo(); fixture.detectChanges(); await fixture.whenStable();
    expect(app.agentActivity.created()).toBe(0);
    expect(app.cells()).toEqual(before);
    expect(app.hasUnsavedChanges()).toBe(false);
    app.redo(); fixture.detectChanges(); await fixture.whenStable();
    expect(app.cells().find(cell => cell.id === 'F2')?.source).toBe('42');
    expect(app.agentActivity.feedback().get('F2')?.origin).toBe('created');
    expect(app.undoLabel()).toBe('Agent cell edits');
    fixture.destroy();
  });

  it('answers agent status/logs and delivers interrupt while the workbook queue is blocked', async () => {
    const fixture = createWithFinancialModel(); fixture.detectChanges(); await fixture.whenStable();
    const runtime = TestBed.inject(RuntimeService) as unknown as RuntimeServiceStub;
    const app = fixture.componentInstance as unknown as {
      workbookCommands: WorkbookCommandQueue;
      agentAccess: { execute(command: import('./agents/live-agent-workbook').AgentCommand, check: () => void): Promise<Record<string, unknown>> };
      stopRunningCell(force?: boolean): Promise<void>; evaluationError: string | null;
    };
    await app.workbookCommands.run(async () => undefined);
    let release!: () => void;
    const blocked = app.workbookCommands.run(() => new Promise<void>(resolve => { release = resolve; }));
    await Promise.resolve();
    runtime.status.set('running');
    const stop = vi.spyOn(app, 'stopRunningCell').mockResolvedValue();
    const execute = (operation: import('./agents/live-agent-workbook').AgentCommand['operation'], payload = {}) => app.agentAccess.execute({
      id: 'agent-inspection', operation, payload, expiresAt: Date.now() + 60000,
    }, () => {});
    try {
      expect((await execute('kernel-status'))['status']).toBe('running');
      expect((await execute('logs'))['entries']).toBeDefined();
      await execute('kernel-control', { action: 'interrupt' });
      expect(stop).toHaveBeenCalledWith(false, expect.any(Function));
      stop.mockImplementation(async () => { app.evaluationError = 'Remote interrupt failed'; });
      await expect(execute('kernel-control', { action: 'interrupt' })).rejects.toThrow('Remote interrupt failed');
      await expect(execute('kernel-control', { action: 'restart', revision: (await execute('kernel-status'))['revision'] })).rejects.toThrow('busy');
    } finally { release(); await blocked; fixture.destroy(); }
  });

  it('manages worksheets through the bridge queue with undo and no kernel restart', async () => {
    const fixture = createWithFinancialModel(); fixture.detectChanges(); await fixture.whenStable();
    const runtime = TestBed.inject(RuntimeService) as unknown as RuntimeServiceStub;
    const app = fixture.componentInstance as unknown as {
      agentWorkbook: LiveAgentWorkbook; workbookCommands: WorkbookCommandQueue; actionDefinitions: import('@angular/core').WritableSignal<import('./sheet.types').ActionDefinition[]>; extraSheets(): string[]; activeSheet(): string;
      cells(): CellDefinition[]; undo(): void; undoLabel(): string | null;
      agentAccess: {execute(command: import('./agents/live-agent-workbook').AgentCommand, check: () => void): Promise<Record<string,unknown>>};
    };
    await app.workbookCommands.run(async () => undefined);
    const execute = (payload: Record<string,unknown>) => app.agentAccess.execute({id:'sheet-change',operation:'worksheets',
      expiresAt:Date.now()+60000,payload:{revision:app.agentWorkbook.read()['revision'],...payload}},()=>{});
    const restarts = runtime.restartCalls.length, active = app.activeSheet();
    await execute({action:'create',name:'Circuits',columns:12,rows:20});
    expect(app.extraSheets()).toContain('Circuits'); expect(app.activeSheet()).toBe(active);
    app.actionDefinitions.set([{name:'read_circuit',label:'Read circuit',source:'def read_circuit(self):\n    return self.cells.Circuits.A1()',references:{},bindings:{},exposed:true}]);
    await execute({action:'update',name:'Circuits',newName:'Schematics'});
    expect(app.actionDefinitions()[0].source).toContain('self.cells.Schematics.A1()');
    expect(app.extraSheets()).toContain('Schematics'); expect(app.extraSheets()).not.toContain('Circuits');
    await expect(execute({action:'delete',name:'Schematics'})).rejects.toThrow('referenced');
    await execute({action:'delete',name:'Schematics',allowBrokenReferences:true});
    expect(app.extraSheets()).not.toContain('Schematics');
    expect(app.undoLabel()).toBe('Agent worksheet delete');
    app.undo(); fixture.detectChanges(); await fixture.whenStable();
    expect(app.extraSheets()).toContain('Schematics');
    expect(runtime.restartCalls).toHaveLength(restarts);
    fixture.destroy();
  });

  it('refuses embedded-session asset uploads until assets can be synchronized safely', async () => {
    const fixture = createWithFinancialModel(); fixture.detectChanges(); await fixture.whenStable();
    const app = fixture.componentInstance as unknown as {
      workbookCommands: WorkbookCommandQueue; agentWorkbook: LiveAgentWorkbook;
      embeddedSession: import('@angular/core').WritableSignal<boolean>;
    };
    await app.workbookCommands.run(async () => undefined); app.embeddedSession.set(true);
    await expect(app.agentWorkbook.execute({id:'image',operation:'asset',expiresAt:Date.now()+60000,
      payload:{revision:app.agentWorkbook.read()['revision'],mimeType:'image/png',dataBase64:'aGVsbG8='}},()=>{}))
      .rejects.toThrow('do not synchronize image assets');
    fixture.destroy();
  });

  it('stores agent packages without restarting, applies shared code, and restores it with undo', async () => {
    const fixture = createWithFinancialModel(); fixture.detectChanges(); await fixture.whenStable();
    const runtime = TestBed.inject(RuntimeService) as unknown as RuntimeServiceStub;
    const app = fixture.componentInstance as unknown as {
      agentWorkbook: LiveAgentWorkbook; workbookCommands: WorkbookCommandQueue; sharedCode(): string; packages(): string[];
      undo(): void; redo(): void;
      agentAccess: {execute(command: import('./agents/live-agent-workbook').AgentCommand, check: () => void): Promise<Record<string,unknown>>};
    };
    await app.workbookCommands.run(async () => undefined);
    const execute = (payload: Record<string,unknown>) => app.agentAccess.execute({id:'environment',operation:'environment',
      expiresAt:Date.now()+60000,payload:{revision:app.agentWorkbook.read()['revision'],...payload}},()=>{});
    const restarts = runtime.restartCalls.length, starts = runtime.configureCalls.length, applies = runtime.applyCalls.length;
    await execute({packages:['schemdraw']});
    expect(app.packages()).toEqual(['schemdraw']); expect(runtime.applyCalls).toHaveLength(applies);
    expect(runtime.restartCalls).toHaveLength(restarts); expect(runtime.configureCalls).toHaveLength(starts);
    await execute({code:'FACTOR = 2'}); expect(app.sharedCode()).toBe('FACTOR = 2');
    expect(runtime.applyCalls.length).toBeGreaterThan(applies);
    app.undo(); fixture.detectChanges(); await fixture.whenStable(); expect(app.sharedCode()).toBe('');
    app.redo(); fixture.detectChanges(); await fixture.whenStable(); expect(app.sharedCode()).toBe('FACTOR = 2');
    fixture.destroy();
  });

  it('runs an agent restart through existing kernel actions without nesting the workbook queue', async () => {
    const fixture = createWithFinancialModel(); fixture.detectChanges(); await fixture.whenStable();
    const runtime = TestBed.inject(RuntimeService) as unknown as RuntimeServiceStub;
    const app = fixture.componentInstance as unknown as {
      workbookCommands: WorkbookCommandQueue; agentWorkbook: LiveAgentWorkbook;
      agentAccess: { execute(command: import('./agents/live-agent-workbook').AgentCommand, check: () => void): Promise<Record<string, unknown>> };
    };
    await app.workbookCommands.run(async () => undefined);
    const revision = app.agentWorkbook.read()['revision'], restarts = runtime.restartCalls.length;
    await app.agentAccess.execute({ id: 'restart', operation: 'kernel-control', payload: { action: 'restart', revision },
      expiresAt: Date.now() + 60000 }, () => {});
    expect(runtime.restartCalls).toHaveLength(restarts + 1);
    fixture.destroy();
  });

  it('stops an agent restart if sharing is revoked during asynchronous kernel configuration', async () => {
    const fixture = createWithFinancialModel(); fixture.detectChanges(); await fixture.whenStable();
    const runtime = TestBed.inject(RuntimeService) as unknown as RuntimeServiceStub;
    const app = fixture.componentInstance as unknown as {
      workbookCommands: WorkbookCommandQueue; agentWorkbook: LiveAgentWorkbook;
      agentAccess: { execute(command: import('./agents/live-agent-workbook').AgentCommand, check: () => void): Promise<Record<string, unknown>> };
    };
    await app.workbookCommands.run(async () => undefined);
    const revision = app.agentWorkbook.read()['revision'], restarts = runtime.restartCalls.length, applies = runtime.applyCalls.length;
    let shared = true;
    vi.spyOn(runtime, 'configureKernel').mockImplementation(async () => { shared = false; });
    await expect(app.agentAccess.execute({ id: 'revoke-restart', operation: 'kernel-control', payload: { action: 'restart', revision },
      expiresAt: Date.now() + 60000 }, () => { if (!shared) throw new Error('Sharing revoked'); })).rejects.toThrow('revoked');
    expect(runtime.restartCalls).toHaveLength(restarts);
    expect(runtime.applyCalls).toHaveLength(applies);
    fixture.destroy();
  });

  it('colors only requested cells without evaluation or discarding the current editor draft', async () => {
    const fixture = createWithFinancialModel(); fixture.detectChanges(); await fixture.whenStable();
    const runtime = TestBed.inject(RuntimeService) as unknown as RuntimeServiceStub;
    const app = fixture.componentInstance as unknown as {
      agentWorkbook: LiveAgentWorkbook; workbookCommands: WorkbookCommandQueue;
      agentAccess: { execute(command: import('./agents/live-agent-workbook').AgentCommand, check: () => void): Promise<Record<string, unknown>> };
      cells(): CellDefinition[]; selectCell(id: string): void; editorSource: string; editorColor: string;
      selectedIds: ReturnType<typeof signal<ReadonlySet<string>>>; undoLabel(): string | null;
      undo(): void;
    };
    await app.workbookCommands.run(async () => undefined);
    app.selectCell('A1'); app.selectedIds.set(new Set(['A1', 'B1'])); app.editorSource = '# user draft\n77';
    const before = runtime.applyCalls.length;
    await app.agentAccess.execute({ id: 'colors', operation: 'colors', expiresAt: Date.now() + 60000,
      payload: { revision: app.agentWorkbook.read()['revision'], cellIds: ['A1'], color: '#CDE7AE' } }, () => {});
    expect(app.cells().find(cell => cell.id === 'A1')?.color).toBe('#cde7ae');
    expect(app.cells().find(cell => cell.id === 'B1')?.color).toBeUndefined();
    expect(app.editorSource).toBe('# user draft\n77'); expect(app.editorColor).toBe('#cde7ae');
    expect(runtime.applyCalls).toHaveLength(before);
    expect(app.undoLabel()).toBe('Agent cell colors');
    app.undo(); fixture.detectChanges(); await fixture.whenStable();
    expect(app.cells().find(cell => cell.id === 'A1')?.color).toBeUndefined();
    fixture.destroy();
  });

  it('resizes an inactive worksheet while preserving spans, drafts, hidden sizes and navigation', async () => {
    const fixture = createWithFinancialModel(); fixture.detectChanges(); await fixture.whenStable();
    const runtime = TestBed.inject(RuntimeService) as unknown as RuntimeServiceStub;
    const app = fixture.componentInstance as unknown as {
      agentWorkbook: LiveAgentWorkbook; workbookCommands: WorkbookCommandQueue;
      cells: ReturnType<typeof signal<CellDefinition[]>>; extraSheets: ReturnType<typeof signal<string[]>>;
      storedLayouts: ReturnType<typeof signal<Record<string, { columns: number; rows: number; columnWidths: Record<string, number>; rowHeights: Record<string, number> }>>>;
      cellDrafts: ReturnType<typeof signal<ReadonlyMap<string, { kind: 'input'; name: string; source: string }>>>;
      activeSheet(): string; selectedId(): string; undoLabel(): string | null; undo(): void; redo(): void;
    };
    await app.workbookCommands.run(async () => undefined);
    app.extraSheets.set(['Budget']);
    app.cells.update(cells => [...cells, { id: 'Budget!D12', kind: 'input', source: '1', enabled: true, trigger: 'auto', view: { span: [2, 3] } }]);
    const layout = { columns: 15, rows: 30, columnWidths: { T: 140 }, rowHeights: { '40': 88 } };
    app.storedLayouts.set({ Budget: layout });
    app.cellDrafts.set(new Map([['Budget!G20', { kind: 'input', name: 'draft', source: '3' }]]));
    const active = app.activeSheet(), selected = app.selectedId(), before = runtime.applyCalls.length;
    const result = await app.agentWorkbook.execute({ id: 'resize', operation: 'resize', expiresAt: Date.now() + 60000,
      payload: { revision: app.agentWorkbook.read()['revision'], worksheet: 'Budget', columns: 2, rows: 2 } }, () => {});
    expect(result['dimensions']).toEqual({ columns: 7, rows: 20 });
    expect(app.storedLayouts()['Budget']).toEqual({ ...layout, columns: 7, rows: 20 });
    expect(app.cellDrafts().has('Budget!G20')).toBe(true);
    expect(app.activeSheet()).toBe(active); expect(app.selectedId()).toBe(selected);
    expect(runtime.applyCalls).toHaveLength(before); expect(app.undoLabel()).toBe('Agent worksheet size');
    app.undo(); fixture.detectChanges(); await fixture.whenStable();
    expect(app.storedLayouts()['Budget']).toEqual(layout);
    app.redo(); fixture.detectChanges(); await fixture.whenStable();
    expect(app.storedLayouts()['Budget']).toEqual({ ...layout, columns: 7, rows: 20 });
    fixture.destroy();
  });

  it('changes track sizes without evaluation and restores them with undo/redo', async () => {
    const fixture = createWithFinancialModel(); fixture.detectChanges(); await fixture.whenStable();
    const runtime = TestBed.inject(RuntimeService) as unknown as RuntimeServiceStub;
    const app = fixture.componentInstance as unknown as {
      agentWorkbook: LiveAgentWorkbook; workbookCommands: WorkbookCommandQueue;
      cells: ReturnType<typeof signal<CellDefinition[]>>;
      rowHeights: ReturnType<typeof signal<Record<string, number>>>;
      columnWidths: ReturnType<typeof signal<Record<string, number>>>;
      activeSheet(): string; selectedId(): string; sheetName(): string;
      undo(): void; redo(): void;
    };
    await app.workbookCommands.run(async () => undefined);
    const before = runtime.applyCalls.length, active = app.activeSheet(), selected = app.selectedId();
    await app.workbookCommands.run(() => app.agentWorkbook.execute({id: 'tracks', operation: 'tracks', expiresAt: Date.now()+60000,
      payload: {revision: app.agentWorkbook.read()['revision'], worksheet: app.sheetName(), rowHeights: {'2':64}, columnWidths: {B:300}}}, () => {}));
    expect(app.rowHeights()['2']).toBe(64); expect(app.columnWidths()['B']).toBe(300);
    expect(app.activeSheet()).toBe(active); expect(app.selectedId()).toBe(selected);
    // A runtime/source update outside this layout history must not be rolled back.
    app.cells.update(cells => cells.map(cell => cell.id === 'A1' ? {...cell, source: '777'} : cell));
    app.undo(); fixture.detectChanges(); await fixture.whenStable();
    expect(app.cells().find(cell => cell.id === 'A1')?.source).toBe('777');
    expect(app.rowHeights()['2']).toBeUndefined(); expect(app.columnWidths()['B']).toBeUndefined();
    app.redo(); fixture.detectChanges(); await fixture.whenStable();
    expect(app.rowHeights()['2']).toBe(64); expect(app.columnWidths()['B']).toBe(300);
    expect(app.cells().find(cell => cell.id === 'A1')?.source).toBe('777');
    expect(runtime.applyCalls).toHaveLength(before);
    fixture.destroy();
  });

  it('refactors labels through MCP in one undo step, including action source', async () => {
    const fixture = createWithFinancialModel(); fixture.detectChanges(); await fixture.whenStable();
    const app = fixture.componentInstance as unknown as {
      agentWorkbook: LiveAgentWorkbook; workbookCommands: WorkbookCommandQueue;
      cells: ReturnType<typeof signal<CellDefinition[]>>;
      actionDefinitions: ReturnType<typeof signal<NonNullable<SheetDocument['actions']>>>;
      undo(): void; redo(): void; syncEditor(): void;
      editorCellId: string | null;
      cellDrafts: ReturnType<typeof signal<ReadonlyMap<string, never>>>;
      activeNoteId: ReturnType<typeof signal<string>>; noteDraft: ReturnType<typeof signal<string>>;
    };
    await app.workbookCommands.run(async () => undefined);
    app.cells.set([{id:'A1',kind:'input',source:'10',enabled:true,trigger:'auto'},
      {id:'B1',kind:'formula',source:'A1 * 2',enabled:true,trigger:'auto'}]);
    app.actionDefinitions.set([{name:'adjust',source:'def adjust(self):\n    self.a1.set(20)',references:{a1:'A1'},bindings:{},label:'',exposed:true}]);
    app.editorCellId = null; app.cellDrafts.set(new Map<string, never>()); app.activeNoteId.set(''); app.noteDraft.set(''); app.syncEditor();
    await app.workbookCommands.run(() => app.agentWorkbook.execute({id:'label',operation:'label',expiresAt:Date.now()+60000,
      payload:{revision:app.agentWorkbook.read()['revision'],cellId:'A1',label:'voltage'}}, () => {}));
    expect(app.cells()[1].source).toBe('voltage * 2');
    expect(app.actionDefinitions()[0].source).toContain('self.voltage.set(20)');
    app.undo(); fixture.detectChanges(); await fixture.whenStable();
    expect(app.cells()[1].source).toBe('A1 * 2'); expect(app.actionDefinitions()[0].source).toContain('self.a1.set(20)');
    app.redo(); fixture.detectChanges(); await fixture.whenStable();
    expect(app.cells()[1].source).toBe('voltage * 2');
    fixture.destroy();
  });

  it('creates and edits agent actions through confirmed kernel updates without invoking or restarting', async () => {
    const fixture = createWithFinancialModel(); fixture.detectChanges(); await fixture.whenStable();
    const runtime = TestBed.inject(RuntimeService) as unknown as RuntimeServiceStub;
    const app = fixture.componentInstance as unknown as {
      agentWorkbook: LiveAgentWorkbook; workbookCommands: WorkbookCommandQueue;
      actionWorkspacePanel: ActionPanelComponent;
      actionDefinitions(): import('./sheet.types').ActionDefinition[]; undoLabel(): string | null;
      agentAccess: { execute(command: import('./agents/live-agent-workbook').AgentCommand, check: () => void): Promise<Record<string, unknown>> };
    };
    await app.workbookCommands.run(async () => undefined);
    const update = vi.spyOn(runtime, 'updateAction'), run = vi.fn(); Object.assign(runtime, { runAction: run });
    const before = runtime.applyCalls.length, restarts = runtime.restartCalls.length;
    const definition = { name: 'agent_add', source: 'def agent_add(self, amount: int = 1):\n    return amount', label: 'Add', references: {}, bindings: {}, exposed: true };
    const edit = (next: typeof definition) => app.agentAccess.execute({ id: 'action', operation: 'action-edit', expiresAt: Date.now() + 60000,
      payload: { revision: app.agentWorkbook.read()['revision'], definition: next } }, () => {});
    await edit(definition);
    expect(app.actionDefinitions().find(action => action.name === 'agent_add')?.label).toBe('Add');
    const panel = new ActionPanelComponent();
    panel.definitions = app.actionDefinitions(); panel.selected = definition.name; panel.ngOnChanges();
    app.actionWorkspacePanel = panel;
    expect(panel.editing).toBe(false); expect(panel.hasUnappliedDrafts).toBe(false);
    await edit({ ...definition, source: 'def agent_add(self, amount: int = 1):\n    return amount * 2' });
    panel.definitions = app.actionDefinitions(); panel.ngOnChanges();
    expect(panel.hasUnappliedDrafts).toBe(false);
    panel.edit(); // Entering Edit without typing must also stay safe for MCP.
    await edit({...definition, source:'def agent_add(self, amount: int = 1):\n    return amount * 3'});
    panel.definitions = app.actionDefinitions();
    expect(panel.hasUnappliedDrafts).toBe(false);
    panel.ngOnChanges(); expect(panel.draftSource).toContain('amount * 3');
    panel.draftSource += '\n    # user draft';
    await expect(edit(definition)).rejects.toThrow('User action drafts');
    expect(panel.draftSource).toContain('# user draft');
    panel.cancelEdit();
    expect(update).toHaveBeenCalledTimes(3); expect(run).not.toHaveBeenCalled();
    expect(runtime.applyCalls).toHaveLength(before); expect(runtime.restartCalls).toHaveLength(restarts);
    expect(app.undoLabel()).toBe('Agent action edits');
    const result = { name: 'agent_add', label: 'Add', description: '', parameters: [], bindings: {}, running: false, error: null,
      output: { id: 'action:agent_add', value: 6, display: '6', valueType: 'int', error: null }, status: 'succeeded' };
    run.mockResolvedValue({ ...graph, actions: [result] });
    await app.agentAccess.execute({ id: 'run', operation: 'action-run', expiresAt: Date.now() + 60000,
      payload: { revision: app.agentWorkbook.read()['revision'], name: 'agent_add', arguments: { amount: { value: 3 } } } }, () => {});
    expect(run).toHaveBeenCalledWith('agent_add', { amount: { value: 3 } }, expect.any(String));
    fixture.destroy();
  });

  it.each([true, false])('sends widget inputs beside the action queue and preserves completion-race clicks (%s)', async accepted => {
    const fixture = createWithFinancialModel(); fixture.detectChanges(); await fixture.whenStable();
    const runtime = TestBed.inject(RuntimeService) as unknown as RuntimeServiceStub;
    const app = fixture.componentInstance as unknown as {
      workbookCommands: WorkbookCommandQueue; cells: ReturnType<typeof signal<CellDefinition[]>>;
      runningAction: ReturnType<typeof signal<string | null>>;
      updateInputFromWidget(change:{cellId:string;source:string}):void;
    };
    await app.workbookCommands.run(async () => undefined);
    const enqueue = vi.spyOn(runtime, 'setInputs').mockImplementation(async sources => {
      if (!accepted) throw new Error('Legacy backend');
      return {...graph, cellChanges:FINANCIAL_CELLS.filter(cell => cell.id in sources).map(cell=>({...cell,source:sources[cell.id]}))};
    });
    let finish!: () => void;
    const held = app.workbookCommands.run(() => new Promise<void>(resolve => {finish=resolve;}));
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    app.runningAction.set('measure');
    const before = runtime.applyCalls.length;
    app.updateInputFromWidget({cellId:'A1',source:'True'});
    await vi.waitFor(() => expect(enqueue).toHaveBeenCalledWith({A1:'True'}));
    expect(runtime.applyCalls).toHaveLength(before);
    if (!accepted) {
      // An already-created final action snapshot may contain an older input source.
      app.cells.update(cells => cells.map(cell => cell.id==='A1' ? {...cell,source:'False'} : cell));
    }
    app.runningAction.set(null); finish(); await held;
    await app.workbookCommands.run(async () => undefined);
    expect(app.cells().find(cell => cell.id==='A1')?.source).toBe('True');
    expect(runtime.applyCalls.length).toBe(before + (accepted ? 0 : 1));
    fixture.destroy();
  });

  it('keeps separate widget clicks when several admissions race action completion', async () => {
    const fixture = createWithFinancialModel(); fixture.detectChanges(); await fixture.whenStable();
    const runtime = TestBed.inject(RuntimeService) as unknown as RuntimeServiceStub;
    const app = fixture.componentInstance as unknown as {
      workbookCommands:WorkbookCommandQueue; cells:ReturnType<typeof signal<CellDefinition[]>>;
      runningAction:ReturnType<typeof signal<string|null>>;
      updateInputFromWidget(change:{cellId:string;source:string}):void;
    };
    await app.workbookCommands.run(async()=>undefined);
    vi.spyOn(runtime,'setInputs').mockRejectedValue(new Error('Legacy backend'));
    let finish!:()=>void;
    const held=app.workbookCommands.run(()=>new Promise<void>(resolve=>finish=resolve));
    await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
    app.runningAction.set('measure');
    app.updateInputFromWidget({cellId:'A1',source:'True'});
    app.updateInputFromWidget({cellId:'A2',source:'False'});
    await Promise.resolve(); await Promise.resolve();
    app.cells.update(cells=>cells.map(cell=>cell.id==='A1'?{...cell,source:'125000'}:cell.id==='A2'?{...cell,source:'0.18'}:cell));
    app.runningAction.set(null); finish(); await held;
    await app.workbookCommands.run(async()=>undefined);
    expect(app.cells().find(cell=>cell.id==='A1')?.source).toBe('True');
    expect(app.cells().find(cell=>cell.id==='A2')?.source).toBe('False');
    fixture.destroy();
  });

  it('acknowledges a live widget source even when the final receipt matches the optimistic edit', async () => {
    const fixture = createWithFinancialModel(); fixture.detectChanges(); await fixture.whenStable();
    const app = fixture.componentInstance as unknown as {
      cells: ReturnType<typeof signal<CellDefinition[]>>;
      completedCells: ReturnType<typeof signal<ReadonlyMap<string,CellDefinition>>>;
      acceptGraph(graph:GraphResult):void;
    };
    app.cells.update(cells => cells.map(cell => cell.id==='A1' ? {...cell, source:'True'} : cell));
    const written = app.cells().find(cell=>cell.id==='A1')!;
    app.acceptGraph({...graph, cellChanges:[written]});
    expect(app.completedCells().get('A1')?.source).toBe('True');
    fixture.destroy();
  });

  it('rejects delayed display frames while acknowledging independent input receipts', async()=>{
    const fixture=createWithFinancialModel();fixture.detectChanges();await fixture.whenStable();
    const app=fixture.componentInstance as unknown as {graph():GraphResult;cells():CellDefinition[];acceptGraph(graph:GraphResult):void};
    app.acceptGraph({...graph,snapshotEpoch:'owner',snapshotSequence:20,cellChanges:[{...FINANCIAL_CELLS[0],source:'8'}]});
    app.acceptGraph({...graph,snapshotEpoch:'owner',snapshotSequence:10,cellChanges:[{...FINANCIAL_CELLS[0],source:'2'},{...FINANCIAL_CELLS[1],source:'0.5'}]});
    expect(app.graph().snapshotSequence).toBe(20);
    expect(app.cells().find(cell=>cell.id==='A1')?.source).toBe('8');
    expect(app.cells().find(cell=>cell.id==='A2')?.source).toBe('0.5');
    fixture.destroy();
  });

  it('protects the current user editor draft against an agent edit', async () => {
    const fixture = createWithFinancialModel(); fixture.detectChanges(); await fixture.whenStable();
    const app = fixture.componentInstance as unknown as {
      agentWorkbook: LiveAgentWorkbook; selectCell(id: string): void; editorSource: string;
      cells(): CellDefinition[];
    };
    app.selectCell('A1'); app.editorSource = '# unapplied user change\n777';
    const revision = app.agentWorkbook.read()['revision'];
    expect(app.agentWorkbook.read()['draftedCells']).toContain('A1');
    await expect(app.agentWorkbook.execute({ id: 'conflict', operation: 'edit', expiresAt: Date.now() + 60000,
      payload: { revision, cells: [{ id: 'A1', kind: 'input', source: '9' }] },
    }, () => {})).rejects.toThrow('User drafts conflict');
    expect(app.editorSource).toContain('777');
    expect(app.cells().find(cell => cell.id === 'A1')?.source).not.toBe('9');
    fixture.destroy();
  });

  it('tracks edits and undo back to saved source without serializing the workbook', async () => {
    const fixture=createWithFinancialModel(true);fixture.detectChanges();await fixture.whenStable();
    const app=fixture.componentInstance as unknown as {
      cells:ReturnType<typeof signal<CellDefinition[]>>; markDocumentSaved():void; hasUnsavedChanges():boolean;
    };
    app.markDocumentSaved();
    const original=app.cells();
    const encode=vi.spyOn(JSON,'stringify');
    try {
      app.cells.set(original.map((cell,index)=>index===0?{...cell,source:'2'}:cell)); fixture.detectChanges();
      expect(app.hasUnsavedChanges()).toBe(true);
      app.cells.set(original.map(cell=>({...cell}))); fixture.detectChanges();
      expect(app.hasUnsavedChanges()).toBe(false);
      expect(encode.mock.calls.some(args => (args[0] as SheetDocument)?.format === 'reaktiv-workbook')).toBe(false);
    } finally {encode.mockRestore();fixture.destroy();}
  });

  it('writes source recovery promptly and throttles optional output sidecars separately', async () => {
    const fixture=createWithFinancialModel(true);fixture.detectChanges();await fixture.whenStable();
    const app=fixture.componentInstance as unknown as {
      currentDraftDocument():SheetDocument; writeDraft(document:SheetDocument,start:boolean):void;
      scheduleDraftSave(document:SheetDocument,start:boolean):void; cancelRecoveryOutputs():void;
      snapshotForSave():unknown; saveOutputs:ReturnType<typeof signal<boolean>>;
    };
    app.cancelRecoveryOutputs();
    vi.useFakeTimers();
    const snapshot=vi.spyOn(app,'snapshotForSave').mockReturnValue({savedAt:'now',cells:[],dependencies:{}});
    try {
      app.scheduleDraftSave(app.currentDraftDocument(),true);
      vi.advanceTimersByTime(500);
      const key='reaktiv-workbook:auto-draft:v1';
      expect(JSON.parse(localStorage.getItem(key)!).document.snapshot).toBeUndefined();
      expect(snapshot).not.toHaveBeenCalled();
      vi.advanceTimersByTime(9500);
      expect(snapshot).toHaveBeenCalledTimes(1);
      const outputKey='reaktiv-workbook:outputs:'+key;
      expect(JSON.parse(localStorage.getItem(outputKey)!).snapshot.savedAt).toBe('now');
      app.scheduleDraftSave(app.currentDraftDocument(),true);
      vi.advanceTimersByTime(15000);
      expect(snapshot).toHaveBeenCalledTimes(1); // unchanged previews are not re-encoded while typing
      app.saveOutputs.set(false);fixture.detectChanges();
      expect(localStorage.getItem(outputKey)).toBeNull();
      app.scheduleDraftSave(app.currentDraftDocument(),true);
      vi.advanceTimersByTime(20000);
      expect(snapshot).toHaveBeenCalledTimes(1);
    } finally {snapshot.mockRestore();fixture.destroy();vi.useRealTimers();}
  });

  it('hides update tracing by default while leaving graph error diagnostics available', async () => {
    const fixture=createWithFinancialModel(true);fixture.detectChanges();await fixture.whenStable();
    const app=fixture.componentInstance as unknown as {viewMode:ReturnType<typeof signal<string>>;setTraceUpdates(value:boolean):void;traceUpdates():boolean};
    app.viewMode.set('graph');app.setTraceUpdates(true);fixture.detectChanges();await fixture.whenStable();fixture.detectChanges();
    expect(app.traceUpdates()).toBe(false);
    expect(fixture.nativeElement.querySelector('app-update-trace')).toBeNull();
    expect(fixture.nativeElement.querySelector('app-graph-debug')).not.toBeNull();
    fixture.destroy();
  });

  it('reuses unchanged large Markdown cells when their working set exceeds the shared cache', async () => {
    const fixture = createWithFinancialModel(true);
    fixture.detectChanges();
    await fixture.whenStable();
    const app = fixture.componentInstance as unknown as {
      cells: ReturnType<typeof signal<CellDefinition[]>>;
      graph: ReturnType<typeof signal<GraphResult>>;
      markdownHtmlMap(): Map<string, string>;
    };
    // Exercise real cache sizes and app projections without paying parser cost in the test.
    const parse = vi.spyOn(marked, 'parse').mockImplementation(source => `<p>${source}</p>`);
    try {
      const cells: CellDefinition[] = Array.from({length: 40}, (_, index) => ({
        id: `A${index + 1}`, kind: 'markdown', source: `Note ${index}\n${'explanation '.repeat(6000)}`,
        enabled: true, trigger: 'auto',
      }));
      app.cells.set(cells);
      app.graph.set({...graph, cells: cells.map(cell => ({id: cell.id, display: cell.source, value: cell.source, valueType: 'markdown', error: null}))});
      const first = app.markdownHtmlMap();
      expect(first.size).toBe(40);
      expect(parse).toHaveBeenCalledTimes(40);
      parse.mockClear();
      app.graph.update(value => ({...value, cells: value.cells.map(cell => ({...cell}))}));
      expect(app.markdownHtmlMap()).toEqual(first);
      expect(parse.mock.calls.length).toBe(0);
      app.graph.update(value => ({...value, cells: value.cells.map(cell => cell.id === 'A1' ? {...cell, display: 'Changed note'} : {...cell})}));
      expect(app.markdownHtmlMap().get('A1')).toContain('Changed note');
      expect(parse).toHaveBeenCalledTimes(1);
    } finally { parse.mockRestore(); fixture.destroy(); }
  });

  it('refreshes referenced images even when a note reuses its Markdown rendering', async () => {
    const fixture = createWithFinancialModel(true);
    fixture.detectChanges();
    await fixture.whenStable();
    const app = fixture.componentInstance as unknown as {
      cells: ReturnType<typeof signal<CellDefinition[]>>;
      graph: ReturnType<typeof signal<GraphResult>>;
      markdownHtmlMap(): Map<string, string>;
    };
    const parse = vi.spyOn(marked, 'parse');
    try {
      app.cells.set([{id: 'A1', kind: 'markdown', source: '![Plot](#cell-B1)', enabled: true, trigger: 'auto'}]);
      app.graph.set({...graph, cells: [
        {id: 'A1', display: '![Plot](#cell-B1)', value: '', valueType: 'markdown', error: null},
        {id: 'B1', display: 'Plot', value: null, valueType: 'rich-output', error: null, richOutput: {mimeType: 'image/png', dataBase64: 'first'}},
      ]});
      expect(app.markdownHtmlMap().get('A1')).toContain('base64,first');
      parse.mockClear();
      app.graph.update(value => ({...value, cells: value.cells.map(cell => cell.id === 'B1' ? {...cell, richOutput: {mimeType: 'image/png', dataBase64: 'second'}} : {...cell})}));
      expect(app.markdownHtmlMap().get('A1')).toContain('base64,second');
      expect(parse).not.toHaveBeenCalled();
    } finally { parse.mockRestore(); fixture.destroy(); }
  });

  it('refreshes cell renderings when note asset display URLs change', async () => {
    const fixture = createWithFinancialModel(true);
    fixture.detectChanges(); await fixture.whenStable();
    const app = fixture.componentInstance as unknown as {
      cells: ReturnType<typeof signal<CellDefinition[]>>;
      graph: ReturnType<typeof signal<GraphResult>>;
      markdownHtmlMap(): Map<string, string>;
    };
    const assets = TestBed.inject(AssetStore);
    let url = 'blob:first';
    const display = vi.spyOn(assets, 'toDisplay').mockImplementation(source => source.replace('assets/0123456789abcdef.png', url));
    const parse = vi.spyOn(marked, 'parse');
    try {
      const source = '![](assets/0123456789abcdef.png)';
      app.cells.set([{id: 'A1', kind: 'markdown', source, enabled: true, trigger: 'auto'}]);
      app.graph.set({...graph, cells: [{id: 'A1', display: source, value: source, valueType: 'markdown', error: null}]});
      expect(app.markdownHtmlMap().get('A1')).toContain('blob:first');
      parse.mockClear();
      url = 'blob:second'; assets.revision.update(value => value + 1);
      expect(app.markdownHtmlMap().get('A1')).toContain('blob:second');
      expect(parse.mock.calls.length).toBe(1);
    } finally { parse.mockRestore(); display.mockRestore(); fixture.destroy(); }
  });

  it('prunes removed notes and disabled Markdown string outputs from current render records', async () => {
    const fixture = createWithFinancialModel(true);
    fixture.detectChanges(); await fixture.whenStable();
    const app = fixture.componentInstance as unknown as {
      cells: ReturnType<typeof signal<CellDefinition[]>>;
      graph: ReturnType<typeof signal<GraphResult>>;
      markdownHtmlMap(): Map<string, string>;
      stringMarkdownAt(id: string): unknown;
      noteRenderer: {diagnostics(): {activeCells: {entries: number}}};
    };
    try {
      app.cells.set([
        {id: 'A1', kind: 'markdown', source: '**note**', enabled: true, trigger: 'auto'},
        {id: 'B1', kind: 'formula', source: "'**value**'", enabled: true, trigger: 'auto'},
      ]);
      app.graph.set({...graph, cells: [
        {id: 'A1', display: '**note**', value: '**note**', valueType: 'markdown', error: null},
        {id: 'B1', display: '**value**', value: '**value**', valueType: 'str', error: null},
      ]});
      app.markdownHtmlMap(); app.stringMarkdownAt('B1');
      expect(app.noteRenderer.diagnostics().activeCells.entries).toBe(2);
      app.cells.update(cells => cells.filter(cell => cell.id !== 'A1').map(cell => ({...cell, view: {markdown: false}})));
      expect(app.markdownHtmlMap().size).toBe(0);
      expect(app.noteRenderer.diagnostics().activeCells.entries).toBe(0);
    } finally { fixture.destroy(); }
  });

  it('shares a resizable bottom dock without losing the console when switching tools', async () => {
    const fixture = createWithFinancialModel();
    fixture.detectChanges(); await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const app = fixture.componentInstance as unknown as {
      toggleLogs(): void; toggleConsole(): void; toggleArtifacts(): void; openProblems(): void;
      bottomDockHeight: ReturnType<typeof signal<number | null>>;
    };
    const dock = root.querySelector<HTMLElement>('.bottom-dock')!;
    expect(dock.hidden).toBe(true);
    app.toggleLogs(); fixture.detectChanges();
    expect(dock.hidden).toBe(false);
    expect(dock.querySelector('.logs-panel')).not.toBeNull();
    app.bottomDockHeight.set(280); fixture.detectChanges();
    expect(dock.style.height).toBe('280px');
    app.toggleConsole(); fixture.detectChanges();
    const consoleElement = dock.querySelector<HTMLElement>('app-debug-console')!;
    expect(consoleElement.hidden).toBe(false);
    expect(dock.querySelector('.logs-panel')).toBeNull();
    app.toggleArtifacts(); fixture.detectChanges();
    expect(consoleElement.hidden).toBe(true);
    expect(dock.querySelector('.artifacts-panel')).not.toBeNull();
    app.openProblems(); fixture.detectChanges();
    expect(dock.querySelector('.artifacts-panel')).toBeNull();
    expect(dock.querySelector('.logs-panel')).not.toBeNull();
    app.toggleConsole(); fixture.detectChanges();
    expect(dock.querySelector('app-debug-console')).toBe(consoleElement);
    expect(dock.style.height).toBe('280px');
    const divider = dock.querySelector<HTMLElement>('[role=separator]')!;
    divider.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowUp', bubbles: true}));
    fixture.detectChanges();
    expect(dock.style.height).toBe('304px');
    app.toggleConsole(); fixture.detectChanges();
    expect(dock.hidden).toBe(true);
    expect(dock.querySelector('app-debug-console')).toBe(consoleElement);
    fixture.destroy();
  });

  it('renders resolved cell colors and falls back only on expression errors', async () => {
    const fixture = createWithFinancialModel(); fixture.detectChanges(); await fixture.whenStable();
    const app = fixture.componentInstance as unknown as {
      cells: ReturnType<typeof signal<CellDefinition[]>>; graph: ReturnType<typeof signal<GraphResult>>;
      cellHighlight(id: string): string | null; setCellColor(id: string, color: string): void;
    };
    app.cells.set([{id: 'A1', kind: 'input', source: '1', enabled: true, trigger: 'auto', color: '#eeeeee', view: {color: {expr: 'status_color'}}}]);
    app.graph.set({...graph, cells: [{id: 'A1', display: '1', value: 1, valueType: 'int', error: null, color: '#ffcccc'}]});
    expect(app.cellHighlight('A1')).toBe('#ffcccc');
    app.graph.update(graph => ({...graph, cells: graph.cells.map(cell => ({...cell, color: ''}))}));
    expect(app.cellHighlight('A1')).toBeNull();
    app.graph.update(graph => ({...graph, cells: graph.cells.map(cell => ({...cell, color: undefined, colorError: 'Invalid color'}))}));
    expect(app.cellHighlight('A1')).toBe('#eeeeee');
    app.setCellColor('A1', '#123456');
    expect(app.cells()[0].view?.color).toBeUndefined();
    expect(app.cellHighlight('A1')).toBe('#123456');
    fixture.destroy();
  });

  it('exposes logs directly and replaces live entries with the final snapshot', async () => {
    const fixture = createWithFinancialModel();
    fixture.detectChanges();
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const button = root.querySelector<HTMLButtonElement>('footer button[aria-label="Open runtime logs"]')!;
    expect(button).not.toBeNull();
    expect(button.closest('[popover]')).toBeNull();
    button.click(); fixture.detectChanges();
    const runtime = TestBed.inject(RuntimeService) as unknown as RuntimeServiceStub;
    const entry: import('./sheet.types').LogEntry = {id:'live-1',timestamp:'2026-10-28T10:00:00Z',cellId:'action:measure',level:'info',message:'measurement started'};
    for (const listener of runtime.logListeners) listener(entry);
    fixture.detectChanges();
    expect(root.querySelector('.logs-panel')?.textContent).toContain('measurement started');
    const app = fixture.componentInstance as unknown as {acceptGraph(graph:GraphResult):void};
    app.acceptGraph({...graph,logs:[entry]});
    fixture.detectChanges();
    expect([...root.querySelectorAll('.log-entry .log-message')]
      .filter(element => element.textContent?.includes('measurement started'))).toHaveLength(1);
    fixture.destroy();
  });

  it('keeps documentation copy shortcuts out of the worksheet clipboard',async()=>{
    const fixture=createWithFinancialModel();fixture.detectChanges();await fixture.whenStable();
    const app=fixture.componentInstance as unknown as {viewMode:ReturnType<typeof signal<string>>;copyCellsToClipboard():boolean};
    app.viewMode.set('sheet');fixture.detectChanges();
    const copy=vi.spyOn(app,'copyCellsToClipboard').mockReturnValue(true);
    const docs=document.createElement('div');docs.className='cm-tooltip';document.body.append(docs);
    try {
      const event=new KeyboardEvent('keydown',{key:'c',ctrlKey:true,bubbles:true,cancelable:true});
      docs.dispatchEvent(event);
      expect(copy).not.toHaveBeenCalled();expect(event.defaultPrevented).toBe(false);
    } finally {docs.remove();fixture.destroy();}
  });

  it('offers common cell kinds first with SVG icons outside text-only selectors', async () => {
    const fixture = createWithFinancialModel();
    fixture.detectChanges();
    await fixture.whenStable();
    (fixture.componentInstance as unknown as { setWorkbookEditing(value: boolean): void }).setWorkbookEditing(true); // the formula bar is an edit-mode tool
    (fixture.componentInstance as unknown as { viewMode: ReturnType<typeof signal<string>> }).viewMode.set('sheet');
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const expected = ['input', 'formula', 'linked', 'markdown', 'resource', 'effect'];
    for (const selector of ['select[aria-label="Cell type"]', '#inspector-kind']) {
      const choices = [...root.querySelectorAll<HTMLOptionElement>(`${selector} option`)];
      expect(choices.map(option => option.value)).toEqual(expected);
      expect(choices.slice(0, 3).map(option => option.textContent?.trim())).toEqual(['Input signal', 'Computed formula', 'Linked input']);
      for (const choice of choices) expect(choice.textContent?.trim()).not.toMatch(/^[○ƒ↔¶◷↯]/);
      expect(root.querySelector(`${selector} svg`)).toBeNull();
      expect(root.querySelector(selector)?.parentElement?.querySelector('app-ui-icon svg')).not.toBeNull();
    }
    const app = fixture.componentInstance as unknown as { editorKind: string };
    for (const kind of expected) {
      app.editorKind = kind;
      fixture.changeDetectorRef.markForCheck();
      fixture.detectChanges();
      const icons = [...root.querySelectorAll('.cell-type-select app-ui-icon svg')];
      expect(icons).toHaveLength(2);
      expect(icons[0].innerHTML).toBe(icons[1].innerHTML);
      expect(icons[0].querySelector('path, rect')).not.toBeNull();
      expect(icons[0].querySelector('text')).toBeNull();
    }
  });

  it('keeps linked computation drafts across selection and clears overrides when applied', async () => {
    const fixture = createWithFinancialModel();
    fixture.detectChanges();
    await fixture.whenStable();
    const app = fixture.componentInstance as unknown as {
      cells: ReturnType<typeof signal<CellDefinition[]>>;
      selectCell(id: string): void;
      applyCell(): void;
      editorComputation: string;
      hasCellDraft(id: string): boolean;
      cellDrafts(): ReadonlyMap<string, {computation?: string}>;
    };
    app.cells.set([
      {id: 'A1', kind: 'input', source: '10', enabled: true, trigger: 'auto'},
      {id: 'B1', kind: 'linked', source: 'A1', computation: 'source', override: '5', enabled: true, trigger: 'auto'},
    ]);
    app.selectCell('B1');
    expect(app.editorComputation).toBe('source');
    app.editorComputation = 'min(source, previous.value) if previous is not None else source';
    expect(app.hasCellDraft('B1')).toBe(true);
    app.selectCell('A1');
    expect(app.cellDrafts().get('B1')?.computation).toContain('previous.value');
    app.selectCell('B1');
    expect(app.editorComputation).toContain('previous.value');
    app.applyCell();
    expect(app.cells().find(cell => cell.id === 'B1')?.computation).toContain('previous.value');
    expect(app.cells().find(cell => cell.id === 'B1')?.override).toBeUndefined();
    app.editorComputation = '';
    app.applyCell();
    expect(app.cells().find(cell => cell.id === 'B1')?.computation).toBeUndefined();
  });

  it('keeps multiline drafts compact until the code field is opened', async () => {
    const fixture = createWithFinancialModel();
    fixture.detectChanges();
    await fixture.whenStable();
    (fixture.componentInstance as unknown as { setWorkbookEditing(value: boolean): void }).setWorkbookEditing(true); // the formula bar is an edit-mode tool
    const app = fixture.componentInstance as unknown as {
      selectCell(id: string): void;
      updateEditorSource(source: string): void;
      formulaExpanded: ReturnType<typeof signal<boolean>>;
      toggleFormulaExpanded(): void;
      openFormulaEditor(editor: PythonEditorComponent): void;
      collapseFormulaEditor(event?: KeyboardEvent): void;
      editorSource: string;
      viewMode: ReturnType<typeof signal<string>>;
    };
    app.viewMode.set('sheet');
    app.selectCell('A1');
    expect(app.formulaExpanded()).toBe(false);
    app.toggleFormulaExpanded();
    app.updateEditorSource('amount = 10\namount * 2');
    app.selectCell('A2');
    expect(app.formulaExpanded()).toBe(false);
    app.selectCell('A1');
    expect(app.formulaExpanded()).toBe(false);
    expect(app.editorSource).toBe('amount = 10\namount * 2');
    fixture.detectChanges();
    const editor = fixture.debugElement.queryAll(By.directive(PythonEditorComponent))
      .find(element => element.nativeElement.classList.contains('formula-code-editor'))!;
    expect(editor.componentInstance.singleLine).toBe(true);
    app.openFormulaEditor(editor.componentInstance);
    fixture.detectChanges();
    expect(editor.componentInstance.singleLine).toBe(false);
    expect(editor.componentInstance.resizable).toBe(true);
    app.collapseFormulaEditor(new KeyboardEvent('keydown', {key: 'Escape'}));
    fixture.detectChanges();
    expect(editor.componentInstance.singleLine).toBe(true);
    expect(app.editorSource).toBe('amount = 10\namount * 2');
  });

  it('reapplies a stopped cell even when its source is unchanged', async () => {
    const fixture = createWithFinancialModel();
    fixture.detectChanges();
    await fixture.whenStable();
    const app = fixture.componentInstance as unknown as {selectCell(id: string): void; applyCell(): void};
    const runtime = TestBed.inject(RuntimeService) as unknown as RuntimeServiceStub;
    app.selectCell('A1');
    runtime.holdCells(['A1']);
    const apply = vi.spyOn(runtime, 'apply');
    app.applyCell();
    await fixture.whenStable();
    expect(apply).toHaveBeenCalled();
    expect(runtime.stoppedCells().has('A1')).toBe(false);
  });

  it('keeps kernel controls visible and interrupts commands without a running cell', async () => {
    const fixture = createWithFinancialModel();
    fixture.detectChanges();
    await fixture.whenStable();
    const runtime = TestBed.inject(RuntimeService) as unknown as RuntimeServiceStub;
    const stop = vi.spyOn(runtime, 'stopRun').mockResolvedValue('restarted');
    const app = fixture.componentInstance as unknown as {stopRunningCell(): Promise<void>};
    runtime.status.set('running');
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    // One kernel button: Stop while Python runs, Restart when idle.
    const kernel = () => root.querySelectorAll<HTMLButtonElement>('.kernel-controls button');
    expect(kernel()).toHaveLength(1);
    const interrupt = root.querySelector<HTMLButtonElement>('.kernel-controls [aria-label="Interrupt kernel"]')!;
    expect(interrupt.disabled).toBe(false);
    await app.stopRunningCell();
    expect(stop).toHaveBeenCalledWith(null, false);
    expect(runtime.stoppedCells().size).toBe(0);
    runtime.status.set('ready');
    fixture.detectChanges();
    expect(kernel()).toHaveLength(1);
    expect(root.querySelector('.kernel-controls [aria-label="Interrupt kernel"]')).toBeNull();
    expect(root.querySelector('.kernel-controls [aria-label="Restart Python kernel"]')).not.toBeNull();
  });

  it('cancels a selected resource without interrupting Python or unrelated resources', async () => {
    const fixture = createWithFinancialModel(true); fixture.detectChanges(); await fixture.whenStable();
    const runtime = TestBed.inject(RuntimeService) as unknown as RuntimeServiceStub;
    const app = fixture.componentInstance as unknown as {
      cells: ReturnType<typeof signal<CellDefinition[]>>; selectCell(id: string): void;
      switchFromNotes(view: 'sheet'): void; cancelResource(id: string): Promise<void>;
      canCancelResource(id: string): boolean; stopRunningCell(): Promise<void>;
    };
    app.cells.update(cells => [...cells,
      {id:'B3',name:'download',kind:'resource',source:'await asyncio.sleep(100)',enabled:true,trigger:'auto'},
      {id:'C3',kind:'resource',source:'await asyncio.sleep(100)',enabled:true,trigger:'auto'},
    ]);
    app.switchFromNotes('sheet'); app.selectCell('B3');
    fixture.detectChanges(); await fixture.whenStable();
    runtime.status.set('running');
    for (const id of ['B3','C3']) runtime.progressListeners.forEach(listener=>listener({event:'start',cellId:id}));
    fixture.detectChanges();
    let finish!: (value:boolean)=>void;
    const cancel = vi.spyOn(runtime,'cancelResource').mockImplementation(()=>new Promise(resolve=>finish=resolve));
    const host = fixture.nativeElement as HTMLElement;
    const button = [...host.querySelectorAll<HTMLButtonElement>('.inspector button')].find(button=>button.textContent?.includes('Cancel load'))!;
    expect(button).toBeDefined(); button.click(); fixture.detectChanges();
    expect(button.disabled).toBe(true); expect(button.textContent).toContain('Cancelling');
    expect(cancel).toHaveBeenCalledExactlyOnceWith('B3');
    finish(true); await fixture.whenStable(); fixture.detectChanges();
    expect(host.querySelector('.resource-cancel-message')?.textContent).toContain('Cancelled download (B3)');
    runtime.progressListeners.forEach(listener=>listener({event:'end',cellId:'B3'})); fixture.detectChanges();
    expect(app.canCancelResource('C3')).toBe(true); expect(app.canCancelResource('B3')).toBe(false);
    cancel.mockResolvedValue(true); await app.stopRunningCell();
    expect(cancel).toHaveBeenLastCalledWith('C3'); expect(runtime.stopCalls).toEqual([]);
    cancel.mockRejectedValue(new Error('connection lost'));
    runtime.progressListeners.forEach(listener=>listener({event:'start',cellId:'C3'}));
    fixture.detectChanges();
    await app.cancelResource('C3'); app.selectCell('C3'); fixture.detectChanges();
    expect(host.querySelector('.resource-cancel-message')?.textContent).toContain('Could not cancel');
  });

  it('gives the workspace the full height whenever the formula bar is hidden', () => {
    const fixture = createWithFinancialModel();
    fixture.detectChanges();
    const app = fixture.componentInstance as unknown as {
      viewMode: ReturnType<typeof signal<string>>; setWorkbookEditing(value: boolean): void;
    };
    const shell = () => (fixture.nativeElement as HTMLElement).querySelector('.app-shell')!;
    const bar = () => (fixture.nativeElement as HTMLElement).querySelector('.formula-bar');
    // The shell's rows reserve a formula bar row only while one is shown.
    for (const [view, editing] of [['sheet', true], ['sheet', false], ['split', false], ['notes', true]] as const) {
      app.viewMode.set(view);
      app.setWorkbookEditing(editing);
      fixture.detectChanges();
      expect(shell().classList.contains('without-formula-bar')).toBe(bar() === null);
    }
    fixture.destroy();
  });

  it('updates a tile input while typing only when its widget has a debounce', () => {
    const fixture = createWithFinancialModel();
    fixture.detectChanges();
    const app = fixture.componentInstance as unknown as {
      inputTileWidget(event: Event, cellId: string, widget: {type: 'text' | 'number'; debounce?: number}): void;
      updateInputFromWidget(change: {cellId: string; source: string}): void;
      widgetDraftFor(cellId: string): string | null;
    };
    const updates: {cellId: string; source: string}[] = [];
    app.updateInputFromWidget = change => { updates.push(change); };
    const typed = (value: string) => ({target: {value}}) as unknown as Event;
    app.inputTileWidget(typed('ab'), 'A1', {type: 'text'});
    expect(updates).toEqual([]);
    expect(app.widgetDraftFor('A1')).toBeNull();
    app.inputTileWidget(typed('abc'), 'A1', {type: 'text', debounce: 0});
    expect(updates).toEqual([{cellId: 'A1', source: '"abc"'}]);
    expect(app.widgetDraftFor('A1')).toBe('abc');
    // An emptied number field is not 0.
    app.inputTileWidget(typed(''), 'A2', {type: 'number', debounce: 0});
    expect(updates).toHaveLength(1);
    fixture.destroy();
  });

  it('renames the workbook from its title, with cancel and blank-name protection', async () => {
    const fixture = createWithFinancialModel();
    fixture.detectChanges();
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const app = fixture.componentInstance as unknown as {
      documentName: ReturnType<typeof signal<string>>;
      hasUnsavedChanges: ReturnType<typeof signal<boolean>>;
    };
    const original = app.documentName();
    const initiallyUnsaved = app.hasUnsavedChanges();
    const edit = async (value: string, key: string) => {
      root.querySelector<HTMLButtonElement>('[aria-label="Rename workbook"]')!.click();
      fixture.detectChanges();
      const input = root.querySelector<HTMLInputElement>('[aria-label="Workbook name"]')!;
      input.value = value;
      input.dispatchEvent(new Event('input', {bubbles: true}));
      fixture.detectChanges();
      await fixture.whenStable();
      input.dispatchEvent(new KeyboardEvent('keydown', {key, bubbles: true}));
      fixture.detectChanges();
      await fixture.whenStable();
    };
    await edit('Cancelled name', 'Escape');
    expect(app.documentName()).toBe(original);
    expect(app.hasUnsavedChanges()).toBe(initiallyUnsaved);
    await edit('  Revised model  ', 'Enter');
    expect(app.documentName()).toBe('Revised model');
    expect(app.hasUnsavedChanges()).toBe(true);
    expect(root.querySelector('.document-save-state')?.textContent).toContain('Unsaved');
    await edit('  ', 'Enter');
    expect(app.documentName()).toBe('Revised model');
    expect(root.querySelector('.document-activity')).toBeNull();
    expect(root.querySelector('.document-save-state')?.getAttribute('title')).toContain('Edited:');
    fixture.destroy();
  });

  it.each(['success', 'failure'])('clears action input activity after %s even when the last progress end is not polled', async outcome => {
    // Exercise the action lifecycle without starting a concurrent workbook restoration.
    const fixture = TestBed.createComponent(App);
    const runtime = TestBed.inject(RuntimeService) as unknown as RuntimeServiceStub;
    let resolve!: (value: GraphResult) => void;
    let reject!: (error: Error) => void;
    const response = new Promise<GraphResult>((yes, no) => {resolve = yes; reject = no;});
    Object.assign(runtime, {runAction: vi.fn(() => response)});
    const app = fixture.componentInstance as unknown as {
      invokeAction(event: {name: string; arguments: {}}): Promise<void>;
      runningAction(): string | null;
      activity: {activity(id: string): string | null; current(): unknown};
      cells: ReturnType<typeof signal<CellDefinition[]>>;
      graph(): GraphResult;
      actionError(): string;
    };
    app.cells.set(FINANCIAL_CELLS);
    const invocation = app.invokeAction({name: 'start_measurement', arguments: {}});
    for (const receive of runtime.progressListeners) {
      receive({event: 'start', cellId: 'A1'});
      receive({event: 'start', cellId: 'B1'});
      receive({event: 'end', cellId: 'B1'});
    }
    expect(app.activity.activity('A1')).toBe('running');
    expect(app.runningAction()).toBe('start_measurement');
    if (outcome === 'success') resolve({...graph, changed: ['A1'], cells: graph.cells.map(cell => cell.id === 'A1' ? {...cell, value: 7, display: '7'} : cell)});
    else reject(new Error('Measurement failed'));
    await invocation;
    expect(app.runningAction()).toBeNull();
    expect(app.activity.activity('A1')).toBeNull();
    expect(app.activity.current()).toBeNull();
    if (outcome === 'success') expect(app.graph().cells.find(cell => cell.id === 'A1')?.value).toBe(7);
    else expect(app.actionError()).toBe('Measurement failed');
  });

  it('runs global commands without changing the view or the method being edited', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const app = fixture.componentInstance as unknown as {
      viewMode: ReturnType<typeof signal<string>>;
      selectedAction: ReturnType<typeof signal<string>>;
      runnerSelectedAction: ReturnType<typeof signal<string>>;
      lastInvokedAction: ReturnType<typeof signal<string>>;
      actionRunnerOpen: ReturnType<typeof signal<boolean>>;
      openActionRunner(name: string): void;
      invokeAction(event: {name: string; arguments: {}}): Promise<void>;
    };
    const runAction = vi.fn().mockResolvedValue(graph);
    Object.assign(TestBed.inject(RuntimeService), {runAction});
    app.viewMode.set('graph');
    app.selectedAction.set('method_with_draft');
    app.openActionRunner('reset');
    expect(app.runnerSelectedAction()).toBe('reset');
    expect(app.selectedAction()).toBe('method_with_draft');
    await app.invokeAction({name: 'reset', arguments: {}});
    expect(runAction).toHaveBeenCalledWith('reset', {}, expect.any(String));
    expect(app.actionRunnerOpen()).toBe(false);
    expect(app.viewMode()).toBe('graph');
    expect(app.selectedAction()).toBe('method_with_draft');
    expect(app.lastInvokedAction()).toBe('reset');
  });

  it('preserves the current editor draft for search and focuses cell types without changing cells', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const app = fixture.componentInstance as unknown as {
      cells: ReturnType<typeof signal<CellDefinition[]>>;
      viewMode: ReturnType<typeof signal<string>>;
      editorSource: string;
      selectCell: (id: string) => void;
      openCellSearch: () => void;
      cellSearchOpen: ReturnType<typeof signal<boolean>>;
      searchableCells: () => CellDefinition[];
      cellTypeFocus: ReturnType<typeof signal<string>>;
      focusedTypeIds: () => Set<string>;
    };
    app.cells.set([{id: 'A1', kind: 'input', source: '2', enabled: true, trigger: 'auto'}, {id: 'A2', kind: 'formula', source: 'A1 * 2', enabled: true, trigger: 'auto'}]);
    app.viewMode.set('sheet'); app.selectCell('A1');
    app.editorSource = 'new_debug_keyword';
    app.openCellSearch();
    expect(app.searchableCells().find(cell => cell.id === 'A1')?.source).toBe('new_debug_keyword');
    expect(app.editorSource).toBe('new_debug_keyword');
    app.cellTypeFocus.set('input');
    expect([...app.focusedTypeIds()]).toEqual(['A1']);
    expect(app.cells()[0].source).toBe('2');
    app.cellSearchOpen.set(false); fixture.destroy();
  });

  it('preserves nesting through sheet copies and undo, and rejects descendant parents', async () => {
    const fixture = TestBed.createComponent(App); fixture.detectChanges();
    const app = fixture.componentInstance as unknown as {
      cells: ReturnType<typeof signal<CellDefinition[]>>;
      pendingStart: ReturnType<typeof signal<boolean>>;
      activeNoteId: ReturnType<typeof signal<string>>;
      noteDraft: ReturnType<typeof signal<string>>;
      noteParents: ReturnType<typeof signal<Record<string,string>>>;
      organizeNote: (id:string,parent:string) => void;
      validNoteParents: () => Record<string,string>;
      duplicateSheet: (prefix:string,name:string) => void;
      selectCell: (id:string) => void;
      undo: () => void;
    };
    app.pendingStart.set(false);
    app.cells.set(['A1','A2','A3'].map(id=>({id,kind:'markdown',source:'# '+id,enabled:true,trigger:'auto'})));
    app.activeNoteId.set('A1');app.noteDraft.set('# A1');app.selectCell('A1');
    app.organizeNote('A2','A1');app.organizeNote('A3','A2');app.organizeNote('A1','A3');
    expect(app.validNoteParents()).toEqual({A2:'A1',A3:'A2'});
    app.duplicateSheet('', 'Budget');
    expect(app.validNoteParents()).toMatchObject({'Budget!A2':'Budget!A1','Budget!A3':'Budget!A2'});
    app.undo();
    expect(app.validNoteParents()).toEqual({A2:'A1',A3:'A2'});
    fixture.destroy();
  });

  it('deletes the context target while preserving another note draft and its children, with undo', () => {
    const fixture = TestBed.createComponent(App); fixture.detectChanges();
    const app = fixture.componentInstance as unknown as {
      cells: ReturnType<typeof signal<CellDefinition[]>>;
      pendingStart: ReturnType<typeof signal<boolean>>;
      activeNoteId: ReturnType<typeof signal<string>>;
      noteDraft: ReturnType<typeof signal<string>>;
      noteParents: ReturnType<typeof signal<Record<string, string>>>;
      validNoteParents: () => Record<string, string>;
      selectCell: (id: string) => void;
      deleteNote: (id: string) => void;
      undo: () => void;
    };
    app.pendingStart.set(false);
    app.cells.set(['A1', 'A2', 'A3'].map(id => ({id, kind: 'markdown', source: '# ' + id, enabled: true, trigger: 'auto'})));
    app.noteParents.set({A3: 'A2'});
    app.activeNoteId.set('A1'); app.noteDraft.set('# A1'); app.selectCell('A1');
    app.noteDraft.set('# Unsaved edits');
    app.deleteNote('A2');
    expect(app.cells().map(cell => cell.id)).toEqual(['A1', 'A3']);
    expect(app.activeNoteId()).toBe('A1');
    expect(app.noteDraft()).toBe('# Unsaved edits');
    expect(app.cells()[0].source).toBe('# Unsaved edits');
    expect(app.validNoteParents()).toEqual({});
    app.undo();
    expect(app.cells().map(cell => cell.id)).toEqual(['A1', 'A2', 'A3']);
    expect(app.validNoteParents()).toEqual({A3: 'A2'});
    expect(app.cells()[0].source).toBe('# Unsaved edits');
    fixture.destroy();
  });

  it('keeps explicit resource parameters in drafts and supports apply, undo and discard', async () => {
    const fixture = TestBed.createComponent(App); fixture.detectChanges();
    const app = fixture.componentInstance as unknown as {
      cells: ReturnType<typeof signal<CellDefinition[]>>;
      pendingStart: ReturnType<typeof signal<boolean>>;
      editorResourceExplicit: boolean; editorParams: string; editorSource: string;
      selectCell: (id:string) => void; applyCell: () => void; undo: () => void;
      discardCellDraft: () => void;
    };
    app.pendingStart.set(false);
    app.cells.set([{id:'A1',kind:'input',source:'1',enabled:true,trigger:'auto'},
      {id:'B1',kind:'resource',source:'return params',enabled:true,trigger:'auto'}]);
    app.selectCell('B1'); app.editorResourceExplicit = true; app.editorParams = 'A1';
    app.selectCell('A1'); app.selectCell('B1');
    expect(app.editorParams).toBe('A1'); expect(app.editorResourceExplicit).toBe(true);
    app.applyCell(); await fixture.whenStable();
    expect(app.cells().find(cell => cell.id === 'B1')?.params).toBe('A1');
    app.undo(); await fixture.whenStable();
    expect(app.cells().find(cell => cell.id === 'B1')?.params).toBeUndefined();
    app.selectCell('B1'); app.editorResourceExplicit = true; app.editorParams = 'None';
    app.discardCellDraft();
    expect(app.editorResourceExplicit).toBe(false);
    fixture.destroy();
  });

  it('keeps equality edits in drafts and applies them with undo', async () => {
    const fixture = TestBed.createComponent(App); fixture.detectChanges();
    const app = fixture.componentInstance as unknown as {
      cells: ReturnType<typeof signal<CellDefinition[]>>;
      pendingStart: ReturnType<typeof signal<boolean>>;
      editorEqual: string;
      selectCell: (id: string) => void;
      applyCell: () => void;
      undo: () => void;
    };
    app.pendingStart.set(false);
    app.cells.set([{id:'A1',kind:'input',source:'1',enabled:true,trigger:'auto'}, {id:'B1',kind:'formula',source:'A1 * 2',enabled:true,trigger:'auto'}]);
    app.selectCell('A1');
    app.editorEqual = 'lambda previous, current: abs(previous - current) < 0.01';
    app.selectCell('B1'); app.selectCell('A1');
    expect(app.editorEqual).toContain('< 0.01');
    app.applyCell(); await fixture.whenStable();
    expect(app.cells()[0].equal).toBe(app.editorEqual);
    app.undo(); await fixture.whenStable();
    expect(app.cells()[0].equal).toBeUndefined();
    fixture.destroy();
  });

  it('preserves an unapplied cell draft when accepting external session changes', () => {
    const fixture = TestBed.createComponent(App); fixture.detectChanges();
    const app = fixture.componentInstance as unknown as {
      cells: ReturnType<typeof signal<CellDefinition[]>>;
      pendingStart: ReturnType<typeof signal<boolean>>;
      editorSource: string;
      selectCell: (id:string) => void;
      acceptSessionState: (state: {revision:number;document:ReturnType<typeof createSheetDocument>;graph:GraphResult}) => void;
    };
    app.pendingStart.set(false);
    const cells:CellDefinition[] = [{id:'A1',kind:'input',source:'1',enabled:true,trigger:'auto'}, {id:'B1',kind:'formula',source:'A1 * 2',enabled:true,trigger:'auto'}];
    app.cells.set(cells);app.selectCell('B1');app.editorSource = 'A1 * 3';
    app.acceptSessionState({revision:2,document:createSheetDocument('Host',2,2,[{...cells[0],source:'2'},cells[1]]),graph});
    expect(app.editorSource).toBe('A1 * 3');
    expect(app.cells()[0].source).toBe('2');
    fixture.destroy();
  });

  it('retains the rejected applied code as a draft after a session revision conflict', async () => {
    const fixture = TestBed.createComponent(App); fixture.detectChanges();
    const app = fixture.componentInstance as unknown as {
      cells: ReturnType<typeof signal<CellDefinition[]>>;
      completedCells: ReturnType<typeof signal<Map<string,CellDefinition>>>;
      pendingStart: ReturnType<typeof signal<boolean>>;
      editorSource: string;
      selectCell: (id:string) => void;
      recoverSessionConflict: () => Promise<void>;
    };
    app.pendingStart.set(false);
    const cell:CellDefinition = {id:'A1',kind:'formula',source:'10',enabled:true,trigger:'auto'};
    app.cells.set([cell]);app.selectCell('A1');app.editorSource='20';
    app.completedCells.set(new Map([['A1',cell]]));
    app.cells.set([{...cell,source:'20'}]);
    const runtime = TestBed.inject(RuntimeService) as unknown as {readSession: () => Promise<unknown>};
    runtime.readSession = async () => ({revision:2,document:createSheetDocument('Host',2,2,[cell]),graph});
    await app.recoverSessionConflict();
    expect(app.editorSource).toBe('20');
    expect(app.cells()[0].source).toBe('10');
    fixture.destroy();
  });

  it.each(['edit', 'run'])('uses CLI %s mode while keeping the session interactive', async mode => {
    const fixture = TestBed.createComponent(App); fixture.detectChanges();
    const app = fixture.componentInstance as unknown as {
      sessionLink: {endpoint: string; token: string}; openEmbeddedSession(): Promise<void>;
      appRun(): boolean; workbookEditing(): boolean; setWorkbookEditing(value: boolean): void;
      saveSheet(): Promise<void>; kernelRunning(): boolean; openActions(): void; actionsOpen(): boolean;
    };
    const document = createSheetDocument('Standalone', 2, 2, [
      {id: 'A1', kind: 'input', source: '1', enabled: true, trigger: 'auto'},
    ]);
    const runtime = TestBed.inject(RuntimeService) as unknown as {
      attachSession(): Promise<unknown>; monitorSession(): () => void;
    };
    runtime.attachSession = async () => ({revision: 1, mode, document, graph});
    runtime.monitorSession = () => () => {};
    app.sessionLink = {endpoint: 'http://127.0.0.1:8765', token: 'token'};
    await app.openEmbeddedSession(); fixture.detectChanges();
    expect(app.kernelRunning()).toBe(true);
    expect(app.appRun()).toBe(mode === 'run');
    expect(app.workbookEditing()).toBe(mode === 'edit');
    const host = fixture.nativeElement as HTMLElement;
    if (mode === 'run') {
      expect(host.querySelector('[aria-label="Workbook edit mode"]')).toBeNull();
      expect(host.querySelector('.formula-bar')).toBeNull();
      app.setWorkbookEditing(true); expect(app.workbookEditing()).toBe(false);
      app.openActions(); expect(app.actionsOpen()).toBe(false);
      await app.saveSheet();
    } else expect(host.querySelector('[aria-label="Workbook edit mode"]')).not.toBeNull();
    fixture.destroy();
  });

  it('keeps original worksheet kernel preferences when attached through a script', async () => {
    const fixture = TestBed.createComponent(App); fixture.detectChanges();
    const app = fixture.componentInstance as unknown as {
      sessionLink: {endpoint:string;token:string};
      openEmbeddedSession: () => Promise<void>;
      currentDraftDocument: () => ReturnType<typeof createSheetDocument>;
    };
    const document = createSheetDocument('Host',2,2,[{id:'A1',kind:'input',source:'1',enabled:true,trigger:'auto'}],[],undefined,{},[],undefined,{kernel:'local',python:'3.12'});
    const runtime = TestBed.inject(RuntimeService) as unknown as {
      attachSession: () => Promise<unknown>;
      monitorSession: () => (()=>void);
    };
    runtime.attachSession = async () => ({revision:1,document,graph});
    runtime.monitorSession = () => () => {};
    app.sessionLink = {endpoint:'http://127.0.0.1:8765',token:'token'};
    await app.openEmbeddedSession();
    expect(app.currentDraftDocument().environment.kernel).toBe('local');
    expect(app.currentDraftDocument().environment.python).toBe('3.12');
    fixture.destroy();
  });

  it.each([['A2', 'notes'], ['Guide!A2', 'notes'], ['Guide!A2', 'split']])('shows the opened note %s in %s before and after starting Python', async (noteId, view) => {
    const fixture = createWithFinancialModel();
    fixture.detectChanges(); await fixture.whenStable();
    const app = fixture.componentInstance as unknown as {
      openDocument(document: SheetDocument, path: null, start: boolean): void;
      viewMode: ReturnType<typeof signal<string>>;
      activeSheet(): string; selectedId(): string;
      startWorkbook(): Promise<void>;
    };
    const document = createSheetDocument('Notes on open', 2, 3, [
      {id: 'A1', kind: 'input', source: '1', enabled: true, trigger: 'auto'},
      {id: noteId, kind: 'markdown', source: '# Workbook instructions', enabled: true, trigger: 'auto'},
    ]);
    document.sheets = [{name: 'Guide', grid: {columns: 4, rows: 5}, layout: {columnWidths: {A: 180}, rowHeights: {}}}];
    app.viewMode.set(view);
    app.openDocument(document, null, true);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const assertNote = () => {
      expect(host.querySelector('.notes-empty')).toBeNull();
      const editor = fixture.debugElement.query(By.directive(MarkdownCellEditorComponent));
      expect(editor.componentInstance.source).toBe('# Workbook instructions');
      expect(app.activeSheet()).toBe(noteId.includes('!') ? 'Guide' : '');
      expect(app.selectedId()).toBe(noteId);
    };
    assertNote();
    expect(fixture.debugElement.query(By.directive(MarkdownCellEditorComponent)).componentInstance.readOnly).toBe(true);
    await app.startWorkbook(); await fixture.whenStable(); fixture.detectChanges();
    assertNote();
    fixture.destroy();
  });

  it('explains read-only mode in every view and starts Python from the notice', async () => {
    const fixture = createWithFinancialModel();
    fixture.detectChanges();
    await fixture.whenStable();
    const app = fixture.componentInstance as unknown as {
      pendingStart: ReturnType<typeof signal<boolean>>;
      viewMode: ReturnType<typeof signal<string>>;
      actionsOpen: ReturnType<typeof signal<boolean>>;
    };
    const runtime = TestBed.inject(RuntimeService) as unknown as RuntimeServiceStub;
    app.pendingStart.set(true);
    runtime.status.set('idle');
    const root = fixture.nativeElement as HTMLElement;
    for (const view of ['notes', 'sheet', 'split', 'graph']) {
      app.viewMode.set(view);
      fixture.detectChanges();
      const notice = root.querySelector<HTMLElement>('.kernel-notice')!;
      expect(notice.hidden).toBe(false);
      expect(notice.textContent).toContain('Read-only');
      expect(notice.textContent).toContain('edit cells and notes, change inputs and run actions');
      expect(notice.querySelector('button')?.textContent?.trim()).toBe('Start Python');
    }
    app.actionsOpen.set(true);
    fixture.detectChanges();
    expect(root.querySelector<HTMLElement>('.kernel-notice')?.hidden).toBe(false);
    const configureCalls = runtime.configureCalls.length;
    root.querySelector<HTMLButtonElement>('.kernel-notice button')!.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(runtime.configureCalls.length).toBe(configureCalls + 1);
    runtime.status.set('ready');
    fixture.detectChanges();
    expect(root.querySelector<HTMLElement>('.kernel-notice')?.hidden).toBe(true);
    expect(root.querySelector('.kernel-notice-slot > .kernel-notice')).not.toBeNull();
    expect(root.querySelector('.kernel-notice-slot')?.parentElement).toBe(root.querySelector('.app-shell'));
  });

  it('shows startup progress and offers recovery when Python fails', async () => {
    const fixture = createWithFinancialModel();
    fixture.detectChanges();
    await fixture.whenStable();
    const app = fixture.componentInstance as unknown as {
      pendingStart: ReturnType<typeof signal<boolean>>;
      embeddedSession: ReturnType<typeof signal<boolean>>;
      restartKernel(): Promise<void>;
    };
    const runtime = TestBed.inject(RuntimeService) as unknown as RuntimeServiceStub;
    const root = fixture.nativeElement as HTMLElement;
    app.pendingStart.set(true);
    runtime.status.set('loading');
    fixture.detectChanges();
    const notice = root.querySelector<HTMLElement>('.kernel-notice')!;
    expect(notice.textContent).toContain('Starting Python');
    expect(notice.getAttribute('aria-busy')).toBe('true');
    expect(notice.querySelector('button')!.disabled).toBe(true);
    runtime.status.set('error');
    fixture.detectChanges();
    expect(notice.querySelector('button')!.textContent?.trim()).toBe('Restart Python');
    const restart = vi.spyOn(app, 'restartKernel').mockResolvedValue();
    notice.querySelector('button')!.click();
    await fixture.whenStable();
    expect(restart).toHaveBeenCalledOnce();
    app.embeddedSession.set(true);
    fixture.detectChanges();
    expect(notice.querySelector('button')!.textContent?.trim()).toBe('Reconnect to Python');
    expect(notice.textContent).toContain('Reconnect to the Python script');
  });

  it('keeps cells read-only until Python is running', async () => {
    const fixture = TestBed.createComponent(App);
    const runtime = TestBed.inject(RuntimeService) as unknown as { status: ReturnType<typeof signal<string>> };
    fixture.detectChanges();
    await fixture.whenStable();
    switchView(fixture.nativeElement as HTMLElement, 'Cells');
    runtime.status.set('loading');
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const apply = compiled.querySelector<HTMLButtonElement>('.formula-bar [aria-label="Apply cell"]')!;
    expect(apply.disabled).toBe(true);
    expect(compiled.querySelector('.read-only-note')?.textContent).toContain('Read-only');
    runtime.status.set('ready');
    fixture.detectChanges();
    expect(apply.disabled).toBe(false);
    expect(compiled.querySelector('.read-only-note')).toBeNull();
  });

  it('offers names defined in shared code while typing formulas', () => {
    expect(
      sharedCodeNames('import math\nVAT = 0.19\n\ndef gross(net):\n    x = 1\n    return net\n\nclass Money:\n    pass').map(
        (completion) => `${completion.type}:${completion.label}`,
      ),
    ).toEqual(['variable:VAT', 'function:gross', 'class:Money']);
  });

  it('reorders sheets, relabelling first-sheet ids and note links', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const app = fixture.componentInstance as unknown as {
      cells: { (): CellDefinition[]; set(cells: CellDefinition[]): void };
      extraSheets: { (): string[]; set(names: string[]): void };
      sheetName: () => string;
      reorderSheets(order: string[]): void;
      undo(): void;
    };
    app.extraSheets.set(['Budget']);
    app.cells.set([
      { id: 'A1', kind: 'input', source: '1', enabled: true, trigger: 'auto' },
      { id: 'Budget!B2', kind: 'formula', source: 'Sheet1.A1 + A1', enabled: true, trigger: 'auto' },
      { id: 'C1', kind: 'markdown', source: '[see](#cell-Budget!B2) [a](#cell-A1)', enabled: true, trigger: 'auto' },
    ]);

    app.reorderSheets(['Budget', 'Sheet1']);
    expect(app.sheetName()).toBe('Budget');
    expect(app.extraSheets()).toEqual(['Sheet1']);
    const byId = new Map(app.cells().map((cell) => [cell.id, cell]));
    expect([...byId.keys()].sort()).toEqual(['B2', 'Sheet1!A1', 'Sheet1!C1']);
    expect(byId.get('B2')?.source).toBe('Sheet1.A1 + A1');
    expect(byId.get('Sheet1!C1')?.source).toBe('[see](#cell-B2) [a](#cell-Sheet1!A1)');

    app.undo();
    expect(app.sheetName()).toBe('Sheet1');
    expect(app.extraSheets()).toEqual(['Budget']);
    expect(app.cells().map((cell) => cell.id).sort()).toEqual(['A1', 'Budget!B2', 'C1']);
  });

  it('inserts clicked cells as references only while "Pick cells" is on', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const app = fixture.componentInstance as unknown as {
      cells: { set(cells: CellDefinition[]): void };
      extraSheets: { set(names: string[]): void };
      selectCell(id: string): void;
      togglePickReferences(editor: unknown): void;
      referenceEditor: () => unknown;
      handleGlobalShortcut(event: KeyboardEvent, file: HTMLInputElement): void;
      pickReference(event: MouseEvent, id: string): void;
    };
    app.extraSheets.set(['Budget']);
    app.cells.set([
      { id: 'A1', name: 'rent', kind: 'input', source: '1', enabled: true, trigger: 'auto' },
      { id: 'A2', kind: 'input', source: '2', enabled: true, trigger: 'auto' },
      { id: 'Budget!B2', kind: 'formula', source: '1', enabled: true, trigger: 'auto' },
    ]);
    app.selectCell('Budget!B2');
    const editor = { insertAtCursor: vi.fn(), focus: vi.fn() };
    const click = () => new MouseEvent('mousedown', { button: 0, cancelable: true });
    // Off by default: a click is an ordinary click (it selects the cell).
    const plain = click();
    app.pickReference(plain, 'A1');
    expect(plain.defaultPrevented).toBe(false);
    expect(editor.insertAtCursor).not.toHaveBeenCalled();

    app.togglePickReferences(editor);
    expect(editor.focus).toHaveBeenCalled();
    app.pickReference(click(), 'A1');
    app.pickReference(click(), 'A2');
    app.pickReference(click(), 'Budget!B2'); // the edited cell itself: ignored
    expect(editor.insertAtCursor.mock.calls).toEqual([['Sheet1.rent'], ['Sheet1.A2']]);

    // Escape ends the mode; so does selecting another cell.
    app.handleGlobalShortcut(new KeyboardEvent('keydown', { key: 'Escape' }), document.createElement('input'));
    expect(app.referenceEditor()).toBeNull();
    app.pickReference(click(), 'A1');
    expect(editor.insertAtCursor).toHaveBeenCalledTimes(2);
    app.togglePickReferences(editor);
    app.selectCell('A1');
    expect(app.referenceEditor()).toBeNull();
  });

  it('resolves note references relative to the note sheet', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const app = fixture.componentInstance as unknown as {
      cells: { set(cells: CellDefinition[]): void };
      extraSheets: { set(names: string[]): void };
      activeNoteId: { set(id: string): void };
      noteValues: () => Array<{ reference: string; cellId: string }>;
    };
    app.extraSheets.set(['Budget']);
    app.cells.set([
      { id: 'A1', kind: 'input', source: '1', enabled: true, trigger: 'auto' },
      { id: 'Budget!A1', kind: 'input', source: '2', enabled: true, trigger: 'auto' },
      { id: 'Budget!B1', kind: 'markdown', source: '{{ A1 }} {{ Sheet1.A1 }}', enabled: true, trigger: 'auto' },
    ]);
    app.activeNoteId.set('Budget!B1');
    const byReference = new Map(app.noteValues().map((value) => [value.reference, value.cellId]));
    expect(byReference.get('A1')).toBe('Budget!A1');
    expect(byReference.get('Sheet1.A1')).toBe('A1');
  });

  it('sorts notes manually, by title, or in sheet order', () => {
    const notes = [{ id: 'A1', t: 'Zeta' }, { id: 'A2', t: 'alpha' }, { id: 'B1', t: 'Mid' }];
    const title = (note: { t: string }) => note.t;
    const ids = (list: { id: string }[]) => list.map((note) => note.id);
    expect(ids(sortNotes(notes, 'sheet', ['B1'], title))).toEqual(['A1', 'A2', 'B1']);
    expect(ids(sortNotes(notes, 'title', [], title))).toEqual(['A2', 'B1', 'A1']);
    expect(
      ids(sortNotes([{ id: 'A1', t: '🧭 Life' }, { id: 'A2', t: '❤️ Health' }], 'title', [], title)),
    ).toEqual(['A2', 'A1']);
    // Unlisted (new) notes follow the manual order in sheet order.
    expect(ids(sortNotes(notes, 'manual', ['B1', 'A1'], title))).toEqual(['B1', 'A1', 'A2']);
  });

  it('configures dependencies before resuming an executable auto-draft', async () => {
    localStorage.setItem(
      'reaktiv-workbook:auto-draft:v1',
      JSON.stringify({
        savedAt: '2026-09-23T08:00:00.000Z',
        requireExplicitStart: false,
        document: {
          format: 'reaktiv-workbook',
          version: 4,
          name: 'Restored',
          grid: { columns: 2, rows: 2 },
          environment: { packages: ['pandas==2.3.2'], variables: { REGION: 'eu' } },
          layout: { columnWidths: {}, rowHeights: {}, zoom: 1, noteZoom: 1.2 },
          cells: [
            {
              id: 'A1',
              name: 'amount',
              kind: 'input',
              source: '2',
              enabled: true,
              trigger: 'auto',
            },
          ],
        },
      }),
    );
    const fixture = TestBed.createComponent(App);
    const runtime = TestBed.inject(RuntimeService) as unknown as RuntimeServiceStub;

    fixture.detectChanges();
    await vi.waitFor(() => expect(runtime.configureCalls).toHaveLength(1));

    expect(runtime.configureCalls[0]).toEqual({
      kind: 'pyodide',
      packages: ['pandas==2.3.2'],
      variables: { REGION: 'eu' },
    });
  });

  it('opens as a note-first workspace and can show the spreadsheet', async () => {
    const fixture = createWithFinancialModel();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.brand-name')?.textContent).toContain('Reaktiv Workbook');
    expect(compiled.querySelector('.document-name')?.textContent).toContain('Financial model');
    expect(compiled.textContent).not.toContain('Browser workspace');
    expect(compiled.querySelector('.top-actions')?.textContent).not.toContain('Apply to graph');
    expect(compiled.querySelector('app-markdown-cell-editor')).not.toBeNull();
    switchView(compiled, 'Cells');
    fixture.detectChanges();
    expect(compiled.querySelectorAll('.sheet-cell')).toHaveLength(160);
    expect(compiled.querySelector('#cell-A1')?.textContent).toContain('125000');
    expect(compiled.querySelector('#cell-A1')?.textContent).toContain('revenue');
  });

  it('opens a first-run guide and can create a named project', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('app-getting-started')?.textContent).toContain(
      'Your first reactive workbook',
    );
    (
      compiled.querySelector('app-getting-started .primary-button') as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(compiled.querySelector('.new-project-dialog')).not.toBeNull();

    const name = compiled.querySelector('#new-project-name') as HTMLInputElement;
    name.value = 'Research notebook';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    (compiled.querySelector('.new-project-dialog .primary-button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(compiled.querySelector('.document-name')?.textContent).toContain('Research notebook');
    expect(compiled.querySelector('app-markdown-cell-editor')?.textContent).toContain(
      'Research notebook',
    );
  });

  it('undoes and redoes unapplied note edits from the global toolbar', async () => {
    const fixture = createWithFinancialModel();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const editor = fixture.debugElement.query(By.directive(MarkdownCellEditorComponent))
      .componentInstance as MarkdownCellEditorComponent;
    editor.sourceChange.emit('# Revised note\n\nDraft text\n');
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const undo = compiled.querySelector('[aria-label="Undo"]') as HTMLButtonElement;
    const redo = compiled.querySelector('[aria-label="Redo"]') as HTMLButtonElement;
    expect(undo.disabled).toBe(false);
    undo.click();
    fixture.detectChanges();
    expect(editor.source).toContain('# Financial snapshot');
    expect(redo.disabled).toBe(false);

    redo.click();
    fixture.detectChanges();
    expect(editor.source).toContain('# Revised note');
  });

  it('offers workbook cells to every Python editor completion source', async () => {
    const fixture = createWithFinancialModel();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    switchView(compiled, 'Cells');
    fixture.detectChanges();
    (compiled.querySelector('#cell-A1') as HTMLElement).click();
    fixture.detectChanges();

    const editors = fixture.debugElement.queryAll(By.directive(PythonEditorComponent));
    expect(editors.length).toBeGreaterThan(0);
    const labels = (editors[0].componentInstance as PythonEditorComponent).completions.map(
      (completion) => completion.label,
    );
    expect(labels).toContain('revenue');
    expect(labels).toContain('A1');
    expect(labels).toContain('np');
  });

  it('briefly marks recalculated cells and their dependents as updated', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    switchView(compiled, 'Cells');

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(compiled.querySelector('#cell-A1')?.classList).toContain('updated');
      expect(compiled.querySelector('#cell-D1')?.classList).toContain('updated');
    });
  });

  it('marks cells pending while an update runs and the cell Python is computing as running', async () => {
    const runtime = TestBed.inject(RuntimeService) as unknown as RuntimeServiceStub;
    let finish = () => {};
    runtime.holdApply = new Promise<void>((resolve) => (finish = resolve));
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    switchView(compiled, 'Cells');
    await vi.waitFor(() => expect(runtime.applyCalls.length).toBeGreaterThan(0));
    fixture.detectChanges();
    // A new workbook: its note (A1) waits for its first value.
    expect(compiled.querySelector('#cell-A1')?.classList).toContain('pending');

    for (const listener of runtime.progressListeners) listener({ event: 'start', cellId: 'A1' });
    fixture.detectChanges();
    expect(compiled.querySelector('#cell-A1')?.classList).toContain('running');

    finish();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(compiled.querySelector('#cell-A1')?.classList).not.toContain('running');
      expect(compiled.querySelector('#cell-A1')?.classList).not.toContain('pending');
    });
  });

  it('pastes copied cells, renaming labels that are taken and refusing to overwrite', async () => {
    const runtime = TestBed.inject(RuntimeService) as unknown as RuntimeServiceStub & { inspectDocument?: unknown };
    const copied = (cells: CellDefinition[]) => ({
      format: 'reaktiv-workbook', version: 4, name: 'Copied cells', grid: { columns: 4, rows: 4 },
      environment: { packages: [], variables: {} }, layout: { columnWidths: {}, rowHeights: {}, zoom: 1 }, cells,
    });
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const app = fixture.componentInstance as unknown as {
      cells(): CellDefinition[];
      pasteCopiedCells(text: string, target: string): Promise<void>;
      evaluationError: string | null;
    };
    runtime.inspectDocument = vi.fn().mockResolvedValue(
      copied([
        { id: 'C3', kind: 'input', source: '12', name: 'price', enabled: true, trigger: 'auto' },
        { id: 'D3', kind: 'formula', source: 'price * 2', name: 'twice', enabled: true, trigger: 'auto' },
      ]),
    );
    await app.pasteCopiedCells('# /// script', 'C3');
    const first = app.cells().filter((cell) => cell.id === 'C3' || cell.id === 'D3');
    expect(first.map((cell) => [cell.id, cell.name])).toEqual([['C3', 'price'], ['D3', 'twice']]);
    // The same cells once more: their labels are taken now, the copies refer to each other.
    runtime.moveCells = vi.fn(async (cells: CellDefinition[]) =>
      cells.map((cell) => ({ ...cell, id: cell.id.replace('3', '6') })),
    ) as never;
    await app.pasteCopiedCells('# /// script', 'C6');
    const second = app.cells().filter((cell) => cell.id === 'C6' || cell.id === 'D6');
    expect(second.map((cell) => [cell.id, cell.name, cell.source])).toEqual([
      ['C6', 'price_2', '12'],
      ['D6', 'twice_2', 'price_2 * 2'],
    ]);
    // Again onto the same cells: nothing is overwritten.
    const before = app.cells().length;
    await app.pasteCopiedCells('# /// script', 'C3');
    expect(app.cells().length).toBe(before);
    expect(app.evaluationError).toContain('Paste would overwrite C3, D3');
  });

  it('keeps unapplied cell edits as drafts while other cells are looked at', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    switchView(compiled, 'Cells');
    fixture.detectChanges();
    const app = fixture.componentInstance as unknown as {
      selectCell(id: string): void;
      updateEditorSource(value: string): void;
      applyCell(): void;
      discardCellDraft(): void;
      cells(): CellDefinition[];
      editorSource: string;
      cellDrafts(): ReadonlyMap<string, { source: string }>;
    };
    app.selectCell('B2');
    app.updateEditorSource('price * 2');
    app.selectCell('C3'); // look something up
    fixture.detectChanges();
    expect(app.cellDrafts().get('B2')?.source).toBe('price * 2');
    expect(compiled.querySelector('#cell-B2')?.classList).toContain('drafted');
    expect(app.editorSource).toBe('');

    app.selectCell('B2'); // back: the draft is in the editor
    expect(app.editorSource).toBe('price * 2');
    fixture.detectChanges();
    expect(compiled.textContent).toContain('Discard draft');

    // An existing cell's draft can be discarded: the editor shows the applied code again.
    const existing = app.cells()[0];
    app.selectCell(existing.id);
    app.updateEditorSource(`${existing.source} changed`);
    app.selectCell('C3');
    app.selectCell(existing.id);
    app.discardCellDraft();
    expect(app.editorSource).toBe(existing.source);
    expect(app.cellDrafts().has(existing.id)).toBe(false);

    // Applying turns the draft into the cell.
    app.selectCell('B2');
    app.applyCell();
    expect(app.cellDrafts().has('B2')).toBe(false);
    expect(app.cells().find((cell) => cell.id === 'B2')?.source).toBe('price * 2');
  });

  it('replaces drafts at pasted destinations, including the current editor', async () => {
    const runtime = TestBed.inject(RuntimeService) as unknown as RuntimeServiceStub & { inspectDocument: unknown };
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const app = fixture.componentInstance as unknown as {
      selectCell(id: string): void;
      updateEditorSource(value: string): void;
      pasteCopiedCells(text: string, target: string): Promise<void>;
      editorSource: string;
      cellDrafts(): ReadonlyMap<string, { source: string }>;
    };
    runtime.inspectDocument = vi.fn().mockResolvedValue({
      cells: ['H20', 'I20'].map((id) => ({ id, kind: 'input', source: '12', enabled: true, trigger: 'auto' })),
    });
    app.selectCell('I20');
    app.updateEditorSource('stashed draft');
    app.selectCell('H20');
    app.updateEditorSource('current draft');
    await app.pasteCopiedCells('# /// script', 'H20');
    expect(app.editorSource).toBe('12');
    expect(app.cellDrafts().has('H20')).toBe(false);
    expect(app.cellDrafts().has('I20')).toBe(false);
    app.selectCell('I20');
    expect(app.editorSource).toBe('12');
    expect(app.cellDrafts().has('H20')).toBe(false);
  });

  it('offers discard immediately and clears draft-only cells completely', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    switchView(compiled, 'Cells');
    const app = fixture.componentInstance as unknown as {
      selectCell(id: string): void;
      updateEditorSource(value: string): void;
      deleteSelected(): void;
      editorName: string;
      editorAnnotation: string;
      editorSource: string;
      cellDrafts(): ReadonlyMap<string, { source: string }>;
    };
    app.selectCell('H20');
    app.editorName = 'draft_name';
    app.editorAnnotation = 'float';
    app.updateEditorSource('123');
    fixture.detectChanges();
    const discard = [...compiled.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.trim() === 'Discard draft');
    expect(discard).toBeDefined();
    discard!.click();
    expect(app.editorSource).toBe('');
    expect(app.editorName).toBe('');
    app.updateEditorSource('456');
    app.selectCell('I20');
    app.selectCell('H20');
    app.deleteSelected();
    app.selectCell('I20');
    expect(app.cellDrafts().has('H20')).toBe(false);
    app.selectCell('H20');
    expect(app.editorSource).toBe('');
    expect(app.editorAnnotation).toBe('');
  });

  it('exports memory counts without workbook source, values or asset names', async () => {
    const fixture=TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const app=fixture.componentInstance as unknown as {
      cells: {set(cells:CellDefinition[]):void};
      memoryDiagnostics():Promise<{frontend:{cells:number;cellSourceChars:number;serializer:{active:boolean}}}>;
    };
    const source='"private_workbook_value_019283"';
    app.cells.set([{id:'A1',name:'private_label_019283',kind:'input',source,enabled:true,trigger:'auto'}]);
    const report=await app.memoryDiagnostics();
    expect(report.frontend.cells).toBe(1);
    expect(report.frontend.cellSourceChars).toBe(source.length);
    expect(report.frontend.serializer.active).toBe(false);
    expect(JSON.stringify(report)).not.toContain('private_workbook_value_019283');
    expect(JSON.stringify(report)).not.toContain('private_label_019283');
  });

  it('shows and clears pane-scoped drag footprints without changing workbook state', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges(); await fixture.whenStable();
    const app = fixture.componentInstance as unknown as {
      cells: ReturnType<typeof signal<CellDefinition[]>>;
      viewMode: ReturnType<typeof signal<string>>;
      startDrag(event: DragEvent, id: string): void;
      previewCellDrop(event: DragEvent, id: string, pane: number): void;
      endCellDrag(): void;
      dropCell(event: DragEvent, id: string): Promise<void>;
      cellDropPreview(): {invalid: boolean; pane: number} | null;
    };
    const cells: CellDefinition[] = [
      {id: 'A1', kind: 'input', source: '1', enabled: true, trigger: 'auto', view: {span: [2, 2]}},
      {id: 'D1', kind: 'input', source: '2', enabled: true, trigger: 'auto'},
    ];
    app.cells.set(cells); app.viewMode.set('sheet');
    let source = 'A1';
    const transfer = {effectAllowed: '', dropEffect: '', setData: vi.fn(), getData: () => source};
    const event = {preventDefault: vi.fn(), dataTransfer: transfer} as unknown as DragEvent;
    app.startDrag(event, source); app.previewCellDrop(event, 'B4', -1); fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('app-cell-drop-preview')?.textContent).toContain('B4');
    expect(app.cellDropPreview()).toMatchObject({pane: -1, invalid: false});
    expect(transfer.dropEffect).toBe('move'); expect(app.cells()).toEqual(cells);
    app.endCellDrag(); fixture.detectChanges();
    expect(host.querySelector('app-cell-drop-preview')).toBeNull();
    source = 'D1'; app.startDrag(event, source); app.previewCellDrop(event, 'B2', -1); fixture.detectChanges();
    expect(host.querySelector('.footprint.invalid')).not.toBeNull();
    expect(transfer.dropEffect).toBe('none'); expect(app.cells()).toEqual(cells);
    await app.dropCell(event, 'D1'); fixture.detectChanges();
    expect(app.cellDropPreview()).toBeNull();
    expect(host.querySelector('app-cell-drop-preview')).toBeNull();
    fixture.destroy();
  });

  for (const method of ['drag', 'cut'] as const) it(`grows the grid for a ${method} move's full tile footprint after kernel success`, async () => {
    const fixture = createWithFinancialModel(); fixture.detectChanges(); await fixture.whenStable();
    const runtime = TestBed.inject(RuntimeService) as unknown as RuntimeServiceStub;
    const app = fixture.componentInstance as unknown as {
      cells: ReturnType<typeof signal<CellDefinition[]>>;
      viewMode: ReturnType<typeof signal<string>>;
      selectCell(id: string): void;
      dropCell(event: DragEvent, target: string): Promise<void>;
      moveCellGroup(ids: string[], anchor: string, target: string): Promise<boolean>;
      columns(): string[]; rows(): number[];
    };
    const cell: CellDefinition = {id: 'B16', kind: 'input', source: '1', enabled: true, trigger: 'auto', view: {span: [2, 3]}};
    app.cells.set([cell]); app.viewMode.set('sheet'); app.selectCell(cell.id);
    vi.spyOn(runtime, 'moveWorkbookCells').mockResolvedValue({cells: [{...cell, id: 'J16'}], graph, actions: []});
    expect([app.columns().length, app.rows().length]).toEqual([10, 16]);
    if (method === 'drag') await app.dropCell({preventDefault: vi.fn(), dataTransfer: {getData: () => cell.id}} as unknown as DragEvent, 'J16');
    else expect(await app.moveCellGroup([cell.id], cell.id, 'J16')).toBe(true);
    expect([app.columns().length, app.rows().length]).toEqual([11, 18]);
    expect(app.cells().find(cell => cell.id === 'J16')?.view?.span).toEqual([2, 3]);
    fixture.destroy();
  });

  it('rejects drag, cut/paste, copied cells and new cells inside spans before changing source, drafts, history or grid size', async () => {
    const fixture = createWithFinancialModel(); fixture.detectChanges(); await fixture.whenStable();
    const runtime = TestBed.inject(RuntimeService) as unknown as RuntimeServiceStub;
    const app = fixture.componentInstance as unknown as {
      cells: ReturnType<typeof signal<CellDefinition[]>>; workbookCommands: WorkbookCommandQueue;
      activeNoteId: ReturnType<typeof signal<string>>; noteDraft: ReturnType<typeof signal<string>>;
      selectCell(id: string): void; editorSource: string; applyCell(): void;
      dropCell(event: DragEvent, target: string): Promise<void>;
      moveCellGroup(ids: string[], anchor: string, target: string): Promise<boolean>;
      pasteCopiedCells(text: string, target: string): Promise<void>;
      evaluationError: string | null; undoLabel(): string | null; columns(): string[]; rows(): number[];
    };
    await app.workbookCommands.run(async () => undefined);
    const base = (id: string): CellDefinition => ({ id, kind: 'input', source: '1', enabled: true, trigger: 'auto' });
    const definitions = [{ ...base('A1'), view: { span: [3, 3] as [number, number] } }, base('E1'),
      { ...base('F1'), kind: 'markdown' as const, source: '# Original' }];
    app.cells.set(definitions); app.activeNoteId.set('F1'); app.noteDraft.set('# Unapplied note');
    app.selectCell('E1'); app.editorSource = '99';
    const beforeHistory = app.undoLabel(), beforeApply = runtime.applyCalls.length;
    const move = vi.spyOn(runtime, 'moveWorkbookCells');
    await app.dropCell({ preventDefault: vi.fn(), dataTransfer: { getData: () => 'E1' } } as unknown as DragEvent, 'B2');
    expect(app.evaluationError).toContain('overlap'); expect(app.evaluationError).toContain('A1');
    expect(await app.moveCellGroup(['E1'], 'E1', 'B2')).toBe(false);
    Object.assign(runtime, { inspectDocument: vi.fn().mockResolvedValue({ cells: [base('B2')], sheetName: 'Sheet1' }) });
    await app.pasteCopiedCells('copied', 'B2');
    expect(app.cells()).toEqual(definitions); expect(app.editorSource).toBe('99');
    expect(app.noteDraft()).toBe('# Unapplied note'); expect(app.cells().find(cell => cell.id === 'F1')?.source).toBe('# Original');
    expect(move).not.toHaveBeenCalled(); expect(runtime.applyCalls).toHaveLength(beforeApply);
    app.selectCell('B2'); app.editorSource = '7'; app.applyCell();
    expect(app.evaluationError).toContain('overlap'); expect(app.editorSource).toBe('7');
    expect(app.cells().some(cell => cell.id === 'B2')).toBe(false);
    app.cells.update(cells => cells.map(cell => cell.id === 'A1' ? { ...cell, view: { span: [50, 50] } } : cell));
    const dimensions = [app.columns().length, app.rows().length];
    expect(await app.moveCellGroup(['E1'], 'E1', 'Z30')).toBe(false);
    expect([app.columns().length, app.rows().length]).toEqual(dimensions);
    expect(app.undoLabel()).toBe(beforeHistory); expect(move).not.toHaveBeenCalled();
    fixture.destroy();
  });

  it('places new notes outside resized footprints, including spans clipped by current grid dimensions', async () => {
    const fixture = createWithFinancialModel(); fixture.detectChanges(); await fixture.whenStable();
    const app = fixture.componentInstance as unknown as {
      cells: ReturnType<typeof signal<CellDefinition[]>>; activeNoteId: ReturnType<typeof signal<string>>;
      noteDraft: ReturnType<typeof signal<string>>; createNote(): void;
      workbookCommands: WorkbookCommandQueue; rows(): number[];
    };
    await app.workbookCommands.run(async () => undefined);
    const tile: CellDefinition = { id: 'A1', kind: 'input', source: '1', enabled: true, trigger: 'auto', view: { span: [3, 3] } };
    app.cells.set([tile]); app.activeNoteId.set(''); app.noteDraft.set('');
    app.createNote();
    expect(app.activeNoteId()).toBe('D1');
    await app.workbookCommands.run(async () => undefined);
    app.cells.set([{ ...tile, view: { span: [50, 50] } }]); app.activeNoteId.set(''); app.noteDraft.set('');
    app.createNote();
    expect(app.activeNoteId()).toBe('A51'); expect(app.rows().length).toBe(51);
    await app.workbookCommands.run(async () => undefined);
    fixture.destroy();
  });

  it('waits for a pending apply before moving and prevents a second pending move', async () => {
    const runtime = TestBed.inject(RuntimeService) as unknown as RuntimeServiceStub;
    let release!: () => void;
    runtime.holdApply = new Promise<void>(resolve => { release = resolve; });
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await vi.waitFor(() => expect(runtime.applyCalls.length).toBeGreaterThan(0));
    const app = fixture.componentInstance as unknown as {
      cells(): CellDefinition[];
      pendingMove(): boolean;
      dropCell(event: DragEvent, target: string): Promise<void>;
    };
    const source = app.cells()[0].id;
    const move = vi.spyOn(runtime, 'moveWorkbookCells');
    const drop = (target: string) => app.dropCell({
      preventDefault: vi.fn(), dataTransfer: { getData: () => source },
    } as unknown as DragEvent, target);
    const pending = drop('I20');
    expect(app.pendingMove()).toBe(true);
    expect(move).not.toHaveBeenCalled();
    await drop('H20');
    expect(move).not.toHaveBeenCalled();
    release();
    await pending;
    expect(move).toHaveBeenCalledTimes(1);
    expect(app.pendingMove()).toBe(false);
    expect(app.cells().some(cell => cell.id === 'I20')).toBe(true);
    expect(app.cells().some(cell => cell.id === source)).toBe(false);
  });

  it('moves drafts on drag-and-drop and swaps drafts with occupied cells', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const app = fixture.componentInstance as unknown as {
      selectCell(id: string): void;
      updateEditorSource(value: string): void;
      applyCell(): void;
      dropCell(event: DragEvent, target: string): Promise<void>;
      cells(): CellDefinition[];
      editorSource: string;
      cellDrafts(): ReadonlyMap<string, { source: string }>;
    };
    const first = app.cells()[0];
    app.selectCell('I20');
    app.updateEditorSource('42');
    app.applyCell();
    const second = app.cells().find((cell) => cell.id === 'I20')!;
    const drop = (source: string, target: string) => app.dropCell({
      preventDefault: vi.fn(), dataTransfer: { getData: () => source },
    } as unknown as DragEvent, target);
    app.selectCell(second.id);
    app.updateEditorSource('target draft');
    app.selectCell(first.id);
    app.updateEditorSource('source draft');
    await drop(first.id, second.id);
    expect(app.cellDrafts().get(first.id)?.source).toBe('target draft');
    expect(app.cellDrafts().get(second.id)?.source).toBe('source draft');
    expect(app.editorSource).toBe('source draft');
    await drop(second.id, 'H20');
    expect(app.cellDrafts().has(second.id)).toBe(false);
    expect(app.cellDrafts().get('H20')?.source).toBe('source draft');
    app.selectCell(second.id);
    expect(app.editorSource).toBe('');
    expect(app.cellDrafts().has(second.id)).toBe(false);
  });

  it('type hints go into the file, and type findings show on their cells', async () => {
    const runtime = TestBed.inject(RuntimeService) as unknown as RuntimeServiceStub;
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    switchView(compiled, 'Cells');
    fixture.detectChanges();
    const app = fixture.componentInstance as unknown as {
      cells(): CellDefinition[];
      selectCell(id: string): void;
      applyCell(): void;
      editorAnnotation: string;
      editorKind: string;
      updateEditorSource(value: string): void;
      setTypeChecking(mode: string): void;
      selectedEditorDiagnostics(): Array<{ line: number; message: string }>;
    };
    app.selectCell('C4');
    app.editorKind = 'formula';
    app.updateEditorSource('1 + 1');
    app.applyCell();
    const formula = app.cells().find((cell) => cell.id === 'C4')!;
    app.selectCell(formula.id);
    fixture.detectChanges();
    const hint = compiled.querySelector<HTMLInputElement>('#inspector-annotation')!;
    expect(hint).not.toBeNull();
    app.editorAnnotation = ' list[ float ] ';
    app.applyCell();
    expect(app.cells().find((cell) => cell.id === formula.id)?.annotation).toBe('list[ float ]');
    await fixture.whenStable();

    // A kernel that checks types: findings land on their cell.
    runtime.typeCheckResult = {
      available: true,
      diagnostics: [
        {
          cellId: formula.id,
          line: 1,
          severity: 'error',
          rule: 'reportReturnType',
          message: 'Type "int" is not assignable to return type "list[float]"',
          detail: '"int" is not assignable to "list[float]"',
        },
      ],
    };
    app.setTypeChecking('standard');
    await new Promise((resolve) => setTimeout(resolve, 10));
    fixture.detectChanges();
    expect(runtime.typeCheckCalls.at(-1)?.mode).toBe('standard');
    expect(compiled.querySelector('.status-types')?.textContent).toContain('1 type hint');
    expect(compiled.querySelector(`#cell-${formula.id}`)?.classList).toContain('type-finding');
    expect(compiled.querySelector('.type-findings')?.textContent).toContain('not assignable to return type');
    expect(app.selectedEditorDiagnostics()).toEqual([
      { line: 1, severity: 'error', message: 'Type "int" is not assignable to return type "list[float]"\n"int" is not assignable to "list[float]"' },
    ]);

    // Off: nothing is checked or shown.
    app.setTypeChecking('off');
    fixture.detectChanges();
    expect(compiled.querySelector('.status-types')).toBeNull();
    expect(compiled.querySelector('.type-findings')).toBeNull();
    runtime.typeCheckResult = null;
    localStorage.removeItem('reaktiv-workbook:type-checking');
  });

  it('shows what changed since the last commit, cell by cell, and commits the workbook', async () => {
    const runtime = TestBed.inject(RuntimeService) as unknown as RuntimeServiceStub & { inspectDocument?: unknown };
    const git = TestBed.inject(GitService);
    const calls: string[][] = [];
    git.transport = {
      run: async (_workbook, args) => {
        calls.push(args);
        if (args[0] === 'rev-parse') return { code: 0, stdout: '/repo\n', stderr: '' };
        if (args[0] === 'status') {
          const stdout = ['# branch.head main', '# branch.ab +1 -0', '1 .M N... 1 1 1 a b budget.sheet.py', ''].join('\0');
          return { code: 0, stdout, stderr: '' };
        }
        if (args[0] === 'show') return { code: 0, stdout: '# committed', stderr: '' };
        if (args[0] === 'commit') return { code: 0, stdout: '[main abc1234] Double it\n', stderr: '' };
        return { code: 0, stdout: '', stderr: '' };
      },
    };
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const app = fixture.componentInstance as unknown as {
      cells(): CellDefinition[];
      sessionWorkbookPath: string | null;
      refreshGit(): Promise<void>;
      openGitPanel(): Promise<void>;
      commitMessage: string;
      commitWorkbook(): Promise<void>;
    };
    const committed = app.cells().map((cell) => ({ ...cell }));
    const changed = committed.find((cell) => cell.kind !== 'markdown') ?? committed[0];
    runtime.inspectDocument = vi.fn().mockResolvedValue(
      createSheetDocument('Untitled workbook', 10, 16, committed.map((cell) => (cell === changed ? { ...cell, source: 'old code' } : cell))),
    );
    app.sessionWorkbookPath = '/repo/budget.sheet.py';
    await app.refreshGit();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.git-button')?.textContent).toContain('main');
    expect(compiled.querySelector('.git-button')?.textContent).toContain('↑1');

    await app.openGitPanel();
    fixture.detectChanges();
    const listed = [...compiled.querySelectorAll('.git-change')].map((item) => item.textContent ?? '');
    expect(listed).toHaveLength(1);
    expect(listed[0]).toContain(changed.id);
    expect(listed[0]).toContain('- old code');

    app.commitMessage = 'Double it';
    await app.commitWorkbook();
    expect(calls.find((args) => args[0] === 'commit')).toEqual([
      'commit',
      '--message=Double it',
      '--only',
      '--',
      'budget.sheet.py',
      ':(top)budget.sheet.py',
    ]);
    fixture.detectChanges();
    expect(compiled.querySelector('.git-message')?.textContent).toContain('[main abc1234] Double it');
    git.transport = null;
  });

  it('stops a cell that hangs and keeps it stopped until it is applied', async () => {
    const runtime = TestBed.inject(RuntimeService) as unknown as RuntimeServiceStub;
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const app = fixture.componentInstance as unknown as {
      cells(): CellDefinition[];
      selectCell(id: string): void;
      applyCell(): void;
    };
    const cellId = app.cells().find((cell) => cell.kind !== 'input')!.id;
    let finish!: () => void;
    runtime.holdApply = new Promise((resolve) => (finish = resolve));
    app.selectCell(cellId);
    app.applyCell(); // an update that does not end
    for (const listener of runtime.progressListeners) listener({ event: 'start', cellId });
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '.', metaKey: true, bubbles: true }));
    runtime.holdApply = null;
    finish();
    await fixture.whenStable();
    expect(runtime.stopCalls).toEqual([{ cellId, force: false }]);
    expect(runtime.stoppedCells().has(cellId)).toBe(true);

    // Applying the cell (changed or not) lets it run again.
    app.selectCell(cellId);
    app.applyCell();
    expect(runtime.stoppedCells().has(cellId)).toBe(false);
  });

  it('opens workbooks in a new window unless this one is still untouched', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue({ close: vi.fn() } as unknown as Window);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const app = fixture.componentInstance as unknown as {
      newProjectName: string;
      createNewProject(): void;
      documentName(): string;
      selectCell(id: string): void;
      updateEditorSource(value: string): void;
      applyCell(): void;
    };
    // The window still holds the new workbook it started with: the new one replaces it.
    app.newProjectName = 'First';
    app.createNewProject();
    await fixture.whenStable();
    expect(open).not.toHaveBeenCalled();
    expect(app.documentName()).toBe('First');

    // Now it holds a workbook the user chose: the next one gets its own window.
    app.newProjectName = 'Second';
    app.createNewProject();
    await fixture.whenStable();
    expect(open).toHaveBeenCalledOnce();
    expect(app.documentName()).toBe('First');
    const id = new URL(String(open.mock.calls[0][0])).searchParams.get('window');
    const key = `reaktiv-workbook:opening:v1:${id}`;
    expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({ kind: 'new', name: 'Second', template: 'note' });
    localStorage.removeItem(key);
    open.mockRestore();
  });

  it('a window opened for a workbook starts with it, not with a draft or Getting started', async () => {
    localStorage.setItem(
      'reaktiv-workbook:opening:v1:main',
      JSON.stringify({ kind: 'new', name: 'Handed over', columns: 5, rows: 6, template: 'empty' }),
    );
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));
    const app = fixture.componentInstance as unknown as {
      documentName(): string;
      gettingStartedOpen(): boolean;
    };
    expect(app.documentName()).toBe('Handed over');
    expect(app.gettingStartedOpen()).toBe(false);
    expect(localStorage.getItem('reaktiv-workbook:opening:v1:main')).toBeNull();
  });

  it('Ctrl/Cmd+Alt+N starts a new workbook', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const app = fixture.componentInstance as unknown as { newProjectOpen(): boolean };
    // Option+N on a Mac keyboard types a dead key: the shortcut reads the physical key.
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Dead', code: 'KeyN', metaKey: true, altKey: true, bubbles: true }),
    );
    expect(app.newProjectOpen()).toBe(true);
  });

  it('offers a larger code editor and remembers it', async () => {
    localStorage.removeItem('reaktiv-workbook:editor-expanded');
    localStorage.setItem('reaktiv-workbook:inspector-collapsed:v2', 'false'); // the cell panel was opened before
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    switchView(compiled, 'Cells');
    fixture.detectChanges();
    const toggle = () => compiled.querySelector<HTMLButtonElement>('.editor-expand-toggle')!;
    expect(toggle().textContent).toContain('Larger editor');
    expect(compiled.querySelector('.workspace')?.classList).not.toContain('editor-expanded');

    toggle().click();
    fixture.detectChanges();
    expect(compiled.querySelector('.workspace')?.classList).toContain('editor-expanded');
    expect(toggle().getAttribute('aria-pressed')).toBe('true');
    expect(localStorage.getItem('reaktiv-workbook:editor-expanded')).toBe('true');

    // A new window starts with the larger editor; notes keep their own layout.
    const next = TestBed.createComponent(App);
    next.detectChanges();
    await next.whenStable();
    expect((next.nativeElement as HTMLElement).querySelector('.editor-expand-toggle')?.textContent).toContain(
      'Smaller editor',
    );
    switchView(compiled, 'Notes');
    fixture.detectChanges();
    expect(compiled.querySelector('.workspace')?.classList).not.toContain('editor-expanded');
    localStorage.removeItem('reaktiv-workbook:editor-expanded');
  });

  it('moving a cell leaves no draft behind, and a draft moves with its cell', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const app = fixture.componentInstance as unknown as {
      selectCell(id: string): void;
      updateEditorSource(value: string): void;
      moveCellGroup(ids: string[], anchorId: string, targetId: string): Promise<boolean>;
      cells(): CellDefinition[];
      editorSource: string;
      cellDrafts(): ReadonlyMap<string, { source: string }>;
    };
    const free = (column: string) =>
      Array.from({ length: 30 }, (_, row) => `${column}${row + 1}`).filter((id) => !app.cells().some((cell) => cell.id === id));
    const cell = app.cells()[0];
    app.selectCell(cell.id);
    const [first, second] = free('H');
    // A draft-only destination is replaced, even while its editor is still active.
    app.selectCell(first);
    app.updateEditorSource('destination draft');
    expect(await app.moveCellGroup([cell.id], cell.id, first)).toBe(true);
    expect(app.editorSource).toBe(cell.source);
    expect(app.cellDrafts().size).toBe(0);
    app.selectCell(cell.id); // the emptied origin
    expect(app.editorSource).toBe('');

    // A draft on the moved cell goes with it.
    app.selectCell(first);
    app.updateEditorSource(`${cell.source} edited`);
    expect(await app.moveCellGroup([first], first, second)).toBe(true);
    expect([...app.cellDrafts().keys()]).toEqual([second]);
    expect(app.editorSource).toBe(`${cell.source} edited`);
    app.selectCell(cell.id);
    expect([...app.cellDrafts().keys()]).toEqual([second]);
  });

  it('merges effect writes into saved inputs and history without re-evaluating or discarding drafts', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const app = fixture.componentInstance as unknown as {
      cells: ReturnType<typeof signal<CellDefinition[]>>;
      editorSource: string;
      selectCell(id: string): void;
      acceptGraph(graph: GraphResult): void;
      cellDrafts: () => ReadonlyMap<string, {source: string}>;
      undo(): void;
    };
    const original: CellDefinition = {id: 'A1', name: 'counter', kind: 'input', source: '0', enabled: true, trigger: 'auto'};
    app.cells.set([original]); app.selectCell('A1');
    app.editorSource = '99';
    const runtime = TestBed.inject(RuntimeService) as unknown as RuntimeServiceStub;
    const calls = runtime.applyCalls.length;
    app.acceptGraph({...graph, cellChanges: [{...original, source: '2'}]});
    expect(app.cells()[0].source).toBe('2');
    expect(app.editorSource).toBe('99');
    expect(app.cellDrafts().get('A1')?.source).toBe('99');
    expect(runtime.applyCalls.length).toBe(calls);
    app.undo(); await fixture.whenStable();
    expect(app.cells()[0].source).toBe('0');
    fixture.destroy();
  });

  it('renders intermediate action snapshots without committing input source, drafts or history', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges(); await fixture.whenStable();
    const app = fixture.componentInstance as unknown as {
      cells: ReturnType<typeof signal<CellDefinition[]>>;
      graph: () => GraphResult;
      editorSource: string;
      selectCell(id: string): void;
      acceptGraph(graph: GraphResult): void;
      undoStack: unknown[];
      invokeAction(event: {name: string; arguments: {}}): Promise<void>;
    };
    const original: CellDefinition = {id: 'A1', name: 'counter', kind: 'input', source: '0', enabled: true, trigger: 'auto'};
    app.cells.set([original]); app.selectCell('A1'); app.editorSource = '99';
    const runtime = TestBed.inject(RuntimeService) as unknown as RuntimeServiceStub;
    let finish!: (graph: GraphResult) => void;
    Object.assign(runtime, {runAction: () => new Promise<GraphResult>(resolve => { finish = resolve; })});
    const running = app.invokeAction({name: 'live', arguments: {}});
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    const before = app.undoStack.length;
    const frame = {...graph, cells: [{id: 'A1', value: 2, display: '2', valueType: 'int', error: null}], cellChanges: [{...original, source: '2'}]};
    for (const listener of runtime.snapshotListeners) listener(frame);
    fixture.detectChanges();
    expect(app.graph().cells[0].value).toBe(2);
    expect(app.cells()[0].source).toBe('0');
    expect(app.editorSource).toBe('99');
    expect(app.undoStack.length).toBe(before);
    finish(frame); await running;
    expect(app.cells()[0].source).toBe('2');
    expect(app.undoStack.length).toBe(before + 1);
    expect(runtime.snapshotListeners).toHaveLength(0);
    fixture.destroy();
  });

  it('zooms notes independently from the spreadsheet', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const zoomIn = compiled.querySelector('[aria-label="Zoom note in"]') as HTMLButtonElement;
    zoomIn.click();
    fixture.detectChanges();

    expect((compiled.querySelector('.note-page') as HTMLElement).style.zoom).toBe('1.1');
  });

  it('applies a persistent highlight color from the cell context menu', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    switchView(compiled, 'Cells');
    fixture.detectChanges();

    (compiled.querySelector('#cell-A1') as HTMLElement).dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, clientX: 20, clientY: 20 }),
    );
    fixture.detectChanges();
    (compiled.querySelector('.color-swatch') as HTMLButtonElement).click();
    fixture.detectChanges();

    const cell = compiled.querySelector('#cell-A1') as HTMLElement;
    expect(cell.classList).toContain('colored');
    expect(cell.style.getPropertyValue('--cell-color')).toBe('#f7c6c7');
  });

  it('allows a repeated label on another sheet and rejects it within the same sheet', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const app = fixture.componentInstance as unknown as {
      cells: { (): CellDefinition[]; set(cells: CellDefinition[]): void };
      extraSheets: { set(names: string[]): void };
      selectCell(id: string): void;
      editorName: string;
      editorKind: string;
      editorSource: string;
      evaluationError: string | null;
      applyCell(): void;
    };
    app.extraSheets.set(['Budget']);
    app.cells.set([{ id: 'A1', name: 'amount', kind: 'input', source: '10', enabled: true, trigger: 'auto' }]);
    app.selectCell('Budget!A1');
    app.editorName = 'amount';
    app.editorKind = 'input';
    app.editorSource = '20';
    app.applyCell();
    expect(app.cells().find((cell) => cell.id === 'Budget!A1')?.name).toBe('amount');
    app.selectCell('Budget!A2');
    app.editorName = 'amount';
    app.editorKind = 'input';
    app.editorSource = '30';
    app.applyCell();
    expect(app.evaluationError).toContain('already used by Budget!A1');
    expect(app.cells().find((cell) => cell.id === 'Budget!A2')).toBeUndefined();
  });

  it.each(['single', 'split'] as const)('keeps a restored worksheet scope visible in the %s graph selector', async mode => {
    localStorage.setItem('reaktiv-workbook:graph-settings:v1', JSON.stringify({thisSheet:true}));
    const fixture=createWithFinancialModel(true);fixture.detectChanges();await fixture.whenStable();
    const app=fixture.componentInstance as unknown as {
      cells:ReturnType<typeof signal<CellDefinition[]>>; graph:ReturnType<typeof signal<GraphResult>>;
      extraSheets:ReturnType<typeof signal<string[]>>; sheetName:ReturnType<typeof signal<string>>;
      graphThisSheet():boolean; switchFromNotes(view:'graph'):void; selectCell(id:string):void;
      showSplit():void; setSplitView(index:number,view:'graph'|'sheet'):void;
    };
    app.sheetName.set('Messung');app.extraSheets.set(['Intern']);
    app.cells.set(['B12','B13','J2','Intern!A10'].map(id=>({id,kind:id.startsWith('B')?'input':'formula',source:'1',enabled:true,trigger:'auto'})));
    app.graph.set({...graph,dependencies:{J2:['B12','B13','Intern!A10']}});
    app.selectCell('J2');
    if(mode==='single') app.switchFromNotes('graph');
    else {app.showSplit();app.setSplitView(0,'graph');app.setSplitView(1,'sheet');}
    fixture.detectChanges();await fixture.whenStable();fixture.detectChanges();
    const host=fixture.nativeElement as HTMLElement;
    const select=host.querySelector<HTMLSelectElement>(mode==='single'?'[aria-label="Graph worksheet"]':'[aria-label="Left graph worksheet"]')!;
    expect(app.graphThisSheet()).toBe(true);
    expect(select.value).toBe('');
    expect(select.selectedOptions[0].textContent).toContain('Messung');
    expect(host.querySelector('[aria-label="Graph cell Intern!A10"]')).toBeNull();
    select.value='*';select.dispatchEvent(new Event('change',{bubbles:true}));
    fixture.detectChanges();await fixture.whenStable();fixture.detectChanges();
    expect(app.graphThisSheet()).toBe(false);
    expect(select.value).toBe('*');
    expect(host.querySelector('[aria-label="Graph cell Intern!A10"]')).not.toBeNull();
    fixture.destroy();
  });

  it('switches graph worksheets, preserves drafts, and releases the chosen pin without evaluating', async () => {
    const fixture = createWithFinancialModel(true); fixture.detectChanges(); await fixture.whenStable();
    const app = fixture.componentInstance as unknown as {
      switchFromNotes(view: 'graph'): void; selectCell(id: string): void;
      extraSheets: {set(sheets: string[]): void}; cells: ReturnType<typeof signal<CellDefinition[]>>;
      editorSource: string; activeSheet(): string; selectedId(): string;
      graphIsPinned(index: number): boolean; showSplit(): void;
      setSplitView(index: number, view: 'graph' | 'sheet'): void; splitSheets(): readonly string[];
    };
    app.extraSheets.set(['Budget']);
    app.cells.update(cells => [...cells, {id:'Budget!A1',kind:'input',source:'20',enabled:true,trigger:'auto'}]);
    app.switchFromNotes('graph'); app.selectCell('A1'); app.editorSource = '125001'; fixture.detectChanges();
    const runtime = TestBed.inject(RuntimeService) as unknown as RuntimeServiceStub;
    const runs = runtime.applyCalls.length, host = fixture.nativeElement as HTMLElement;
    const choose = (label: string, value: string) => {
      const select = host.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
      expect(select).not.toBeNull(); select.value = value;
      select.dispatchEvent(new Event('change', {bubbles:true})); fixture.detectChanges();
    };
    const nodes = () => [...host.querySelectorAll<HTMLElement>('.graph-node')].map(node => node.dataset['cellId']);
    choose('Graph worksheet', 'Budget');
    expect(app.activeSheet()).toBe('Budget'); expect(nodes()).toEqual(['Budget!A1']);
    host.querySelector<HTMLButtonElement>('[aria-label="Pin graph view"]')!.click(); fixture.detectChanges();
    expect(app.graphIsPinned(-1)).toBe(true);
    choose('Graph worksheet', ''); expect(app.graphIsPinned(-1)).toBe(false);
    expect(app.selectedId()).toBe('A1'); expect(app.editorSource).toBe('125001');
    expect(nodes()).toContain('A1'); expect(nodes()).not.toContain('Budget!A1');
    choose('Graph worksheet', '*'); expect(nodes()).toContain('Budget!A1');
    app.showSplit(); app.setSplitView(0,'graph'); app.setSplitView(1,'sheet'); fixture.detectChanges();
    choose('Left graph worksheet', 'Budget');
    expect(app.splitSheets()).toEqual(['Budget','']);
    expect(host.querySelector('[aria-label="Graph worksheet"]')).toBeNull();
    expect(host.querySelector('[aria-label="Right pane sheet"]')).not.toBeNull();
    expect(app.cells().find(cell => cell.id === 'A1')?.source).toBe('125000');
    expect(runtime.applyCalls.length).toBe(runs);
  });

  it('keeps the inspector collapsed across cell selection and views until explicitly opened', async () => {
    const fixture = createWithFinancialModel(true); fixture.detectChanges(); await fixture.whenStable();
    const app = fixture.componentInstance as unknown as {
      switchFromNotes(view: 'sheet' | 'graph'): void; selectGridCell(id: string): void;
      editCell(id: string): void; showSplit(): void; editorSource: string;
      inspectorVisible(): boolean;
    };
    const host = fixture.nativeElement as HTMLElement;
    app.switchFromNotes('sheet'); fixture.detectChanges();
    const toggle = () => host.querySelector<HTMLButtonElement>('#inspector-toggle')!;
    // The cell panel opens on demand: closed at first, opened and closed again explicitly.
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(toggle().parentElement).toBe(host.querySelector('.top-actions'));
    expect(toggle().parentElement?.lastElementChild).toBe(toggle());
    toggle().click(); fixture.detectChanges();
    expect(app.inspectorVisible()).toBe(true);
    expect(localStorage.getItem('reaktiv-workbook:inspector-collapsed:v2')).toBe('false');
    app.editorSource = '125001'; toggle().click(); fixture.detectChanges();
    expect(app.inspectorVisible()).toBe(false);
    expect(host.querySelector('.workspace.inspector-collapsed')).not.toBeNull();
    expect(host.querySelector('.inspector.workspace-hidden')).not.toBeNull();
    expect(localStorage.getItem('reaktiv-workbook:inspector-collapsed:v2')).toBe('true');
    app.selectGridCell('A1'); app.switchFromNotes('graph'); fixture.detectChanges();
    expect(app.inspectorVisible()).toBe(false); expect(toggle().getAttribute('aria-expanded')).toBe('false');
    app.showSplit(); app.selectGridCell('A2'); fixture.detectChanges();
    expect(app.inspectorVisible()).toBe(false);
    app.editCell('A1'); fixture.detectChanges(); expect(app.inspectorVisible()).toBe(true);
    expect(localStorage.getItem('reaktiv-workbook:inspector-collapsed:v2')).toBe('false');
    host.querySelector<HTMLButtonElement>('.inspector-close')!.click(); fixture.detectChanges();
    expect(app.inspectorVisible()).toBe(false);
    toggle().click(); fixture.detectChanges(); expect(app.inspectorVisible()).toBe(true);
  });

  it('shows navigation only in graph views and keeps navigation in the graph', async () => {
    const fixture = createWithFinancialModel(); fixture.detectChanges(); await fixture.whenStable();
    const app = fixture.componentInstance as unknown as {
      selectCell(id: string): void; switchFromNotes(view: 'graph' | 'sheet'): void; selectedId(): string; viewMode(): string; showSplit(): void; setSplitView(index: number, view: 'graph'): void;
    };
    const compiled = fixture.nativeElement as HTMLElement;
    const back = () => compiled.querySelector<HTMLButtonElement>('[aria-label="Previous selection"]')!;
    const forward = () => compiled.querySelector<HTMLButtonElement>('[aria-label="Next selection"]')!;
    expect(back()).toBeNull(); expect(forward()).toBeNull();
    app.switchFromNotes('graph'); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(back().disabled).toBe(true); expect(forward().disabled).toBe(true);
    expect(compiled.querySelector('.topbar app-selection-navigation')).toBeNull();
    expect(compiled.querySelector('.graph-toolbar app-selection-navigation')).not.toBeNull();
    app.selectCell('B1'); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(back().disabled).toBe(false);
    back().click(); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(app.selectedId()).toBe('D1'); expect(app.viewMode()).toBe('graph');
    expect(forward().disabled).toBe(false);
    forward().click(); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(app.selectedId()).toBe('B1'); expect(app.viewMode()).toBe('graph');
    back().click(); fixture.detectChanges(); await fixture.whenStable();
    app.selectCell('C1'); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(forward().disabled).toBe(true);
    app.switchFromNotes('sheet'); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(back()).toBeNull(); expect(forward()).toBeNull();
    app.showSplit(); fixture.detectChanges(); await fixture.whenStable();
    expect(back()).toBeNull();
    app.setSplitView(1, 'graph'); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(compiled.querySelector('.graph-toolbar app-selection-navigation')).not.toBeNull();
    back().click(); fixture.detectChanges(); await fixture.whenStable();
    expect(app.viewMode()).toBe('split');
  });

  it('restores a selection on another sheet without applying its draft', async () => {
    const fixture = createWithFinancialModel(); fixture.detectChanges(); await fixture.whenStable();
    const app = fixture.componentInstance as unknown as {
      selectCell(id: string): void; switchFromNotes(view: 'graph' | 'sheet'): void; navigateSelection(direction: -1 | 1): void;
      selectedId(): string; activeSheet(): string; editorSource: string; switchSheet(sheet: string): void;
      cells: { (): CellDefinition[]; update(fn: (cells: CellDefinition[]) => CellDefinition[]): void };
      extraSheets: { set(names: string[]): void };
    };
    app.switchFromNotes('graph'); app.selectCell('A1'); fixture.detectChanges(); await fixture.whenStable();
    app.editorSource = '125001';
    app.extraSheets.set(['Budget']);
    app.cells.update(cells => [...cells, { id: 'Budget!A1', kind: 'input', source: '2', enabled: true, trigger: 'auto' }]);
    app.switchSheet('Budget'); app.selectCell('Budget!A1'); fixture.detectChanges(); await fixture.whenStable();
    app.navigateSelection(-1); fixture.detectChanges(); await fixture.whenStable();
    expect(app.activeSheet()).toBe(''); expect(app.selectedId()).toBe('A1');
    expect(app.editorSource).toBe('125001');
    expect(app.cells().find(cell => cell.id === 'A1')?.source).toBe('125000');
    app.extraSheets.set([]); fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[aria-label="Next selection"]')?.disabled).toBe(true);
  });

  it('supports selection navigation shortcuts without intercepting editor keys', async () => {
    const fixture = createWithFinancialModel(); fixture.detectChanges(); await fixture.whenStable();
    const app = fixture.componentInstance as unknown as { selectCell(id: string): void; switchFromNotes(view: 'graph' | 'sheet'): void; selectedId(): string };
    app.switchFromNotes('graph'); fixture.detectChanges(); await fixture.whenStable();
    app.selectCell('B1'); fixture.detectChanges(); await fixture.whenStable();
    const back = new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true, cancelable: true });
    document.body.dispatchEvent(back); fixture.detectChanges(); await fixture.whenStable();
    expect(back.defaultPrevented).toBe(true); expect(app.selectedId()).toBe('D1');
    const editorKey = new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true, cancelable: true });
    (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('#inspector-name')!.dispatchEvent(editorKey);
    expect(editorKey.defaultPrevented).toBe(false); expect(app.selectedId()).toBe('D1');
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true, cancelable: true }));
    fixture.detectChanges(); await fixture.whenStable();
    expect(app.selectedId()).toBe('B1');
    app.switchFromNotes('sheet'); fixture.detectChanges(); await fixture.whenStable();
    const outsideGraph = new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true, cancelable: true });
    document.body.dispatchEvent(outsideGraph);
    expect(outsideGraph.defaultPrevented).toBe(false); expect(app.selectedId()).toBe('B1');
  });

  it('resets selection navigation when another workbook opens', async () => {
    const fixture = createWithFinancialModel(); fixture.detectChanges(); await fixture.whenStable();
    const app = fixture.componentInstance as unknown as {
      selectCell(id: string): void; switchFromNotes(view: 'graph' | 'sheet'): void;
      openDocument(document: ReturnType<typeof createSheetDocument>, path: null, start: boolean): void;
    };
    app.switchFromNotes('graph'); fixture.detectChanges(); await fixture.whenStable();
    app.selectCell('B1'); fixture.detectChanges(); await fixture.whenStable();
    app.openDocument(createSheetDocument('Another workbook', 4, 4, [{ id: 'A1', kind: 'input', source: '1', enabled: true, trigger: 'auto' }]), null, true);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector<HTMLButtonElement>('[aria-label="Previous selection"]')?.disabled).toBe(true);
    expect(compiled.querySelector<HTMLButtonElement>('[aria-label="Next selection"]')?.disabled).toBe(true);
  });

  it('renames a cell and rewrites its dependent formulas', async () => {
    const fixture = createWithFinancialModel();
    fixture.detectChanges();
    await fixture.whenStable();
    (fixture.componentInstance as unknown as {setWorkbookEditing(value:boolean):void}).setWorkbookEditing(true);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    switchView(compiled, 'Cells');
    fixture.detectChanges();

    (compiled.querySelector('#cell-A1') as HTMLElement).click();
    fixture.detectChanges();
    const name = compiled.querySelector('#inspector-name') as HTMLInputElement;
    name.value = 'sales';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    (compiled.querySelector('.editor-actions .primary-button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(compiled.querySelector('#cell-A1')?.textContent).toContain('sales');
    const app = fixture.componentInstance as unknown as { cells: () => CellDefinition[] };
    expect(app.cells().find(cell => cell.id === 'B1')?.source).toContain('sales');
    expect((compiled.querySelector('#cell-B1') as HTMLElement).title).toBe('');
  });

  it('highlights direct dependents of the selected cell', async () => {
    const fixture = createWithFinancialModel();
    fixture.detectChanges();
    await fixture.whenStable();
    await (fixture.componentInstance as unknown as { startWorkbook(): Promise<void> }).startWorkbook();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    switchView(compiled, 'Cells');
    fixture.detectChanges();
    (compiled.querySelector('#cell-A1') as HTMLElement).click();
    fixture.detectChanges();
    expect(compiled.querySelector('#cell-A3')?.classList).toContain('dependent');
    expect(compiled.querySelector('#cell-B1')?.classList).toContain('dependent');
    expect(compiled.querySelector('#cell-C1')?.classList).not.toContain('dependent');
  });

  it('renders interpolated Markdown and highlights its dependencies', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const fixture = createWithFinancialModel();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    switchView(compiled, 'Cells');
    fixture.detectChanges();
    // The restored workbook starts asynchronously: wait for its first results.
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(compiled.querySelector('#cell-D1 h1')).not.toBeNull();
    });
    expect(compiled.querySelector('#cell-D1 h1')?.textContent).toBe('Financial snapshot');
    expect(compiled.querySelector('#cell-D1 strong')?.textContent).toBe('102,500');

    // Selecting a note stays in the grid; "Open in Notes" switches to the note view.
    (compiled.querySelector('#cell-D1') as HTMLElement).click();
    fixture.detectChanges();
    expect(compiled.querySelector('.notes-sidebar')).toBeNull();
    expect(compiled.querySelector('.inspector h2')?.textContent).toBe('D1');
    (compiled.querySelector('.open-note-button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(compiled.querySelector('app-markdown-cell-editor')).not.toBeNull();
    expect(compiled.querySelector('.notes-sidebar')).not.toBeNull();
    expect(compiled.querySelector('.inspector')?.classList).toContain('workspace-hidden');
  });

  it('extends the grid and opens a cell for editing with Enter', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    switchView(compiled, 'Cells');
    fixture.detectChanges();
    (compiled.querySelector('[title="Add column"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(compiled.querySelectorAll('.sheet-cell')).toHaveLength(176);

    compiled
      .querySelector('#cell-B1')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    fixture.detectChanges();
    expect(compiled.querySelector('.inspector h2')?.textContent).toContain('B1');
  });

  it('provides cell tools, execution timing, type prefixes, and keyboard deletion', async () => {
    const fixture = createWithFinancialModel();
    fixture.detectChanges();
    await fixture.whenStable();
    (fixture.componentInstance as unknown as {setWorkbookEditing(value:boolean):void}).setWorkbookEditing(true);
    await (fixture.componentInstance as unknown as { startWorkbook(): Promise<void> }).startWorkbook();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    switchView(compiled, 'Cells');
    fixture.detectChanges();
    expect(compiled.querySelector('.cell-toolbar [aria-label="Copy reference"]')).not.toBeNull();

    (compiled.querySelector('#cell-B1') as HTMLElement).click();
    fixture.detectChanges();
    expect(compiled.querySelector('#cell-B1 .cell-duration')?.textContent).toContain('0.13 ms');

    (compiled.querySelector('#cell-J16') as HTMLElement).click();
    fixture.detectChanges();
    const formulaEditor = fixture.debugElement
      .queryAll(By.directive(PythonEditorComponent))
      .find((editor) => editor.nativeElement.classList.contains('formula-code-editor'))
      ?.componentInstance as PythonEditorComponent;
    formulaEditor.valueChange.emit('=');
    fixture.detectChanges();
    expect(compiled.querySelector('.type-badge')?.textContent).toContain('formula');

    // Applying keeps the formula, not the typed '=' prefix, in the editor: no leftover draft.
    const editing = fixture.componentInstance as unknown as { applyCell(): void; hasCellDraft(id: string): boolean; editorSource: string };
    formulaEditor.valueChange.emit('=A1 * 2');
    editing.applyCell();
    fixture.detectChanges();
    expect(editing.editorSource).toBe('A1 * 2');
    expect(editing.hasCellDraft('J16')).toBe(false);

    (compiled.querySelector('#cell-A1') as HTMLElement).click();
    compiled
      .querySelector('#cell-A1')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    fixture.detectChanges();
    expect(compiled.querySelector('#cell-A1 .cell-label')).toBeNull();
  });

  it('multi-selects cells and applies a highlight to the selection', async () => {
    const fixture = createWithFinancialModel();
    fixture.detectChanges();
    await fixture.whenStable();
    (fixture.componentInstance as unknown as {setWorkbookEditing(value:boolean):void}).setWorkbookEditing(true);
    const compiled = fixture.nativeElement as HTMLElement;
    switchView(compiled, 'Cells');
    fixture.detectChanges();

    compiled.querySelector('#cell-A1')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    compiled
      .querySelector('#cell-A2')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    fixture.detectChanges();

    expect(compiled.querySelector('.cell-toolbar strong')?.textContent).toContain('2 cells');
    (compiled.querySelector('.cell-toolbar .color-swatch') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(compiled.querySelector('#cell-A1')?.classList).toContain('colored');
    expect(compiled.querySelector('#cell-A2')?.classList).toContain('colored');
  });

  it('opens the command palette with Ctrl/Cmd+K and the cell panel on demand (I, double-click in view mode)', async () => {
    const fixture = createWithFinancialModel();
    fixture.detectChanges();
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    const app = fixture.componentInstance as unknown as {
      inspectorVisible(): boolean; workbookEditing(): boolean; setWorkbookEditing(value: boolean): void;
      actionDefinitions: ReturnType<typeof signal<import('./sheet.types').ActionDefinition[]>>; appRun: ReturnType<typeof signal<boolean>>;
    };
    app.actionDefinitions.set([{ name: 'add', label: 'Add items', source: 'def add(self):\n    pass', references: {}, bindings: {}, exposed: true }]);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }));
    fixture.detectChanges();
    const palette = host.querySelector('app-command-palette');
    expect(palette).not.toBeNull();
    expect(palette!.textContent).toContain('Open workbook…');
    expect(palette!.textContent).toContain('Run action: Add items');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }));
    fixture.detectChanges();
    expect(host.querySelector('app-command-palette')).toBeNull();

    switchView(host, 'Cells');
    fixture.detectChanges();
    expect(app.inspectorVisible()).toBe(false);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', bubbles: true, cancelable: true }));
    fixture.detectChanges();
    expect(app.inspectorVisible()).toBe(true);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', bubbles: true, cancelable: true }));
    fixture.detectChanges();
    expect(app.inspectorVisible()).toBe(false);
    app.setWorkbookEditing(false);
    fixture.detectChanges();
    host.querySelector('[data-cell-id="A1"]')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    fixture.detectChanges();
    expect(app.inspectorVisible()).toBe(true);
    // Run mode keeps the action launcher (only when there are actions) but no editing tools.
    app.appRun.set(true);
    fixture.detectChanges();
    expect(host.querySelector('.action-launcher')).not.toBeNull();
    app.actionDefinitions.set([]);
    fixture.detectChanges();
    expect(host.querySelector('.action-launcher')).toBeNull();
    fixture.destroy();
  });

  it('gives every view the same header row, options button and floating zoom', async () => {
    const fixture = createWithFinancialModel();
    fixture.detectChanges();
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    for (const [view, options] of [['Notes', 0], ['Cells', 1], ['Graph', 1]] as const) {
      switchView(compiled, view);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(compiled.querySelectorAll('.view-header').length, view).toBe(1);
      expect(compiled.querySelectorAll('app-zoom-control').length, view).toBe(1);
      expect(compiled.querySelectorAll('.view-header app-view-options').length, view).toBe(options);
    }
    expect(compiled.querySelector('.legend-bar')).toBeNull();
    fixture.destroy();
  });

  it('nudges towards labels for filled cells that are named after their position', async () => {
    const fixture = createWithFinancialModel();
    fixture.detectChanges();
    await fixture.whenStable();
    const app = fixture.componentInstance as unknown as {
      openDocument(document: SheetDocument, start: boolean): void; selectCell(id: string): void;
    };
    app.openDocument(createSheetDocument('Labels', 3, 3, [
      { id: 'A1', kind: 'input', source: '1', name: 'rate', enabled: true, trigger: 'auto' },
      { id: 'B1', kind: 'formula', source: 'rate * 2', enabled: true, trigger: 'auto' },
    ]), true);
    (fixture.componentInstance as unknown as { setWorkbookEditing(value: boolean): void }).setWorkbookEditing(true); // the formula bar is an edit-mode tool
    const compiled = fixture.nativeElement as HTMLElement;
    switchView(compiled, 'Cells');
    app.selectCell('B1');
    fixture.detectChanges();
    const field = () => compiled.querySelector('.formula-bar .cell-label-field') as HTMLInputElement;
    expect(field().classList).toContain('needs-label');
    expect(field().title).toContain('called b1 in the Python file');
    app.selectCell('A1');
    fixture.detectChanges();
    expect(field().classList).not.toContain('needs-label');
    fixture.destroy();
  });

  it('applies a cell label when Enter is pressed', async () => {
    const fixture = createWithFinancialModel();
    fixture.detectChanges();
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    switchView(compiled, 'Cells');
    fixture.detectChanges();
    (compiled.querySelector('[aria-label="Workbook edit mode"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    (compiled.querySelector('#cell-B1') as HTMLElement).click();
    fixture.detectChanges();

    const label = compiled.querySelector('.formula-bar .cell-label-field') as HTMLInputElement;
    label.value = 'profit_after_tax';
    label.dispatchEvent(new Event('input', { bubbles: true }));
    label.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    await fixture.whenStable();
    fixture.detectChanges();

    expect(compiled.querySelector('#cell-B1 .cell-label')?.textContent).toContain(
      'profit_after_tax',
    );
  });

  it('allows labels to be removed from multiple cells', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    switchView(compiled, 'Cells');
    fixture.detectChanges();

    for (const cellId of ['A1', 'A2']) {
      (compiled.querySelector(`#cell-${cellId}`) as HTMLElement).click();
      fixture.detectChanges();
      const label = compiled.querySelector('.formula-bar .cell-label-field') as HTMLInputElement;
      label.value = '';
      label.dispatchEvent(new Event('input', { bubbles: true }));
      label.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
      await fixture.whenStable();
      fixture.detectChanges();
    }

    expect(compiled.querySelector('.error-toast[role="alert"]')).toBeNull();
    expect(compiled.querySelector('#cell-A1 .cell-label')).toBeNull();
    expect(compiled.querySelector('#cell-A2 .cell-label')).toBeNull();
  });

  it('refreshes an open note draft after moving an unlabeled dependency', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const component = fixture.componentInstance as unknown as {
      cells: { set(value: CellDefinition[]): void };
      activeNoteId: { set(value: string): void };
      noteDraft: { set(value: string): void; (): string };
      selectedId: { set(value: string): void };
      selectedIds: { set(value: ReadonlySet<string>): void };
      dropCell(event: DragEvent, targetId: string): Promise<void>;
    };
    component.cells.set([
      { id: 'A1', kind: 'input', source: '10', enabled: true, trigger: 'auto' },
      {
        id: 'B1',
        kind: 'markdown',
        source: 'Value:',
        enabled: true,
        trigger: 'auto',
      },
    ]);
    component.activeNoteId.set('B1');
    component.noteDraft.set('Value: {{ A1 }}');
    component.selectedId.set('A1');
    component.selectedIds.set(new Set(['A1']));

    await component.dropCell(
      {
        preventDefault: () => undefined,
        dataTransfer: { getData: () => 'A1' },
      } as unknown as DragEvent,
      'D4',
    );

    expect(component.noteDraft()).toBe('Value: {{ D4 }}');
  });

  it('keeps an open Markdown block when its coordinate is swapped with its dependency', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const component = fixture.componentInstance as unknown as {
      cells: { set(value: CellDefinition[]): void };
      activeNoteId: { set(value: string): void; (): string };
      noteDraft: { set(value: string): void; (): string };
      selectedId: { set(value: string): void };
      selectedIds: { set(value: ReadonlySet<string>): void };
      dropCell(event: DragEvent, targetId: string): Promise<void>;
    };
    component.cells.set([
      { id: 'A1', kind: 'input', source: '10', enabled: true, trigger: 'auto' },
      {
        id: 'B1',
        kind: 'markdown',
        source: 'Value: {{ A1 }}',
        enabled: true,
        trigger: 'auto',
      },
    ]);
    component.activeNoteId.set('B1');
    component.noteDraft.set('Value: {{ A1 }}');
    component.selectedId.set('A1');
    component.selectedIds.set(new Set(['A1']));

    await component.dropCell(
      {
        preventDefault: () => undefined,
        dataTransfer: { getData: () => 'A1' },
      } as unknown as DragEvent,
      'B1',
    );

    expect(component.activeNoteId()).toBe('A1');
    expect(component.noteDraft()).toBe('Value: {{ B1 }}');
  });

  it('coalesces overlapping type checks instead of starting parallel analysis processes', async () => {
    const fixture=TestBed.createComponent(App);fixture.detectChanges();await fixture.whenStable();
    const app=fixture.componentInstance as unknown as {checkTypes():Promise<void>;typeChecking:{set(value:string):void};typeCheckQueued:boolean};
    app.typeChecking.set('standard');
    const runtime=TestBed.inject(RuntimeService) as unknown as RuntimeServiceStub;
    runtime.typeCheckResult={available:true,diagnostics:[]};
    let finish!:(value:{available:boolean;diagnostics:unknown[]})=>void;
    const calls=vi.spyOn(runtime,'checkTypes').mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    const first=app.checkTypes();
    await app.checkTypes();await app.checkTypes();
    expect(calls).toHaveBeenCalledTimes(1);expect(app.typeCheckQueued).toBe(true);
    finish({available:true,diagnostics:[]});await first;
    await vi.waitFor(()=>expect(calls).toHaveBeenCalledTimes(2));
  });

  it('confirms edited actions only after the kernel apply finishes and prevents duplicate submissions', async () => {
    const fixture=TestBed.createComponent(App);fixture.detectChanges();await fixture.whenStable();
    const app=fixture.componentInstance as unknown as {
      saveAction(definition:import('./sheet.types').ActionDefinition):Promise<void>;
      actionApplying():boolean;actionApplied():import('./sheet.types').ActionDefinition | null;
      currentDraftDocument():SheetDocument;actionError():string;
    };
    const runtime=TestBed.inject(RuntimeService) as unknown as RuntimeServiceStub & {
      inspectDocument(source:string):Promise<SheetDocument>;
    };
    const action={name:'change',source:'def change(self):\n    return 42',label:'Change',references:{},bindings:{},exposed:true};
    runtime.inspectDocument=vi.fn(async()=>({...app.currentDraftDocument(),actions:[action]}));
    let finish!:()=>void;
    const held=new Promise<void>(resolve=>{finish=resolve;});
    const applied=vi.spyOn(runtime,'updateAction').mockImplementation(async()=>{
      await held;
      return {...graph,appliedAction:action,actions:[{name:'change',compileError:null} as import('./sheet.types').ActionResult]};
    });
    const pending=app.saveAction(action);
    await vi.waitFor(()=>expect(applied).toHaveBeenCalledTimes(1));
    expect(app.actionApplying()).toBe(true);expect(app.actionApplied()).toBeNull();
    await app.saveAction(action);expect(applied).toHaveBeenCalledTimes(1);
    finish();await pending;
    expect(app.actionApplying()).toBe(false);expect(app.actionApplied()?.source).toBe(action.source);
    expect(app.actionError()).toBe('');
  });

  it('surfaces failed action applies without reporting success', async () => {
    const fixture=TestBed.createComponent(App);fixture.detectChanges();await fixture.whenStable();
    const app=fixture.componentInstance as unknown as {
      saveAction(definition:import('./sheet.types').ActionDefinition):Promise<void>;
      actionApplying():boolean;actionApplied():unknown;actionError():string;currentDraftDocument():SheetDocument;
    };
    const runtime=TestBed.inject(RuntimeService) as unknown as RuntimeServiceStub & {inspectDocument(source:string):Promise<SheetDocument>};
    const action={name:'change',source:'def change(self):\n    return 42',label:'Change',references:{},bindings:{},exposed:true};
    runtime.inspectDocument=vi.fn(async()=>({...app.currentDraftDocument(),actions:[action]}));
    vi.spyOn(runtime,'updateAction').mockRejectedValue(new Error('connection lost'));
    await app.saveAction(action);
    expect(app.actionApplying()).toBe(false);expect(app.actionApplied()).toBeNull();
    expect(app.actionError()).toContain('not confirmed');expect(app.actionError()).toContain('connection lost');
  });

  it('stores output saving with each workbook and exposes it only in workbook settings', async () => {
    // A previous app preference must not leak into another workbook.
    localStorage.setItem('reaktiv-workbook:save-outputs','false');
    const fixture=TestBed.createComponent(App);
    fixture.detectChanges();await fixture.whenStable();
    const runtime=TestBed.inject(RuntimeService) as unknown as RuntimeServiceStub;
    const app=fixture.componentInstance as unknown as {
      saveOutputs():boolean;setSaveOutputs(value:boolean):void;
      currentDraftDocument():SheetDocument;openDocument(doc:SheetDocument):void;
      hasUnsavedChanges():boolean;openSettings(level:'workbook'|'app'):void;
    };
    const baseline=app.currentDraftDocument();
    expect(app.saveOutputs()).toBe(true);
    const applied=runtime.applyCalls.length;
    app.setSaveOutputs(false);fixture.detectChanges();
    expect(app.currentDraftDocument().saveOutputs).toBe(false);
    expect(app.hasUnsavedChanges()).toBe(true);
    expect(runtime.applyCalls.length).toBe(applied);
    const first=app.currentDraftDocument();
    app.openDocument({...baseline,name:'Other workbook'});
    expect(app.saveOutputs()).toBe(true);
    app.openDocument(first);
    expect(app.saveOutputs()).toBe(false);
    app.openSettings('workbook');fixture.detectChanges();
    const root=fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Save output snapshot JSON');
    app.openSettings('app');fixture.detectChanges();
    expect(root.textContent).not.toContain('Save output snapshot JSON');
  });

  it('separates device preferences from workbook configuration without restarting the kernel', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const runtime = TestBed.inject(RuntimeService) as unknown as RuntimeServiceStub;
    const app = fixture.componentInstance as unknown as {
      openSettings(level: 'workbook' | 'app'): void;
      settingsLevel(): 'workbook' | 'app';
      settingsOpen(): boolean;
    };
    const compiled = fixture.nativeElement as HTMLElement;
    const configured = runtime.configureCalls.length;
    const applied = runtime.applyCalls.length;
    app.openSettings('workbook');
    fixture.detectChanges();
    expect(compiled.querySelector('#package-requirements')).not.toBeNull();
    expect(compiled.querySelector('#app-theme')).toBeNull();
    const workbook = compiled.querySelector<HTMLButtonElement>('#settings-workbook-tab')!;
    workbook.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    fixture.detectChanges();
    expect(app.settingsLevel()).toBe('app');
    expect(compiled.querySelector('#package-requirements')).toBeNull();
    expect(compiled.querySelector('#app-theme')).not.toBeNull();
    expect(compiled.querySelector('#type-checking')).not.toBeNull();
    const toggle = [...compiled.querySelectorAll<HTMLInputElement>('.settings-toggle input')]
      .find((input) => input.parentElement?.textContent?.includes('Render string results as Markdown'))!;
    toggle.click();
    fixture.detectChanges();
    expect(localStorage.getItem('reaktiv-workbook:render-strings-as-markdown')).toBe('false');
    [...compiled.querySelectorAll<HTMLButtonElement>('.settings-actions button')]
      .find((button) => button.textContent?.trim() === 'Done')!.click();
    expect(app.settingsOpen()).toBe(false);
    expect(runtime.configureCalls.length).toBe(configured);
    expect(runtime.applyCalls.length).toBe(applied);
  });

  it('renders string results as Markdown and lets the user disable it', async () => {
    const stringResult = graph.cells.find((cell) => cell.id === 'B1')!;
    const original = { ...stringResult };
    Object.assign(stringResult, {
      display: '**Formatted string**',
      value: '**Formatted string**',
      valueType: 'str',
    });
    try {
      const fixture = createWithFinancialModel();
      fixture.detectChanges();
      await fixture.whenStable();
      await (fixture.componentInstance as unknown as { startWorkbook(): Promise<void> }).startWorkbook();
      fixture.detectChanges();
      const compiled = fixture.nativeElement as HTMLElement;
      switchView(compiled, 'Cells');
      fixture.detectChanges();

      expect(compiled.querySelector('#cell-B1 strong')?.textContent).toBe('Formatted string');
      (
        compiled.querySelector('button[aria-label="Settings"]') as HTMLButtonElement
      ).click();
      fixture.detectChanges();
      compiled.querySelector<HTMLButtonElement>('#settings-app-tab')!.click();
      fixture.detectChanges();
      const toggle = [
        ...compiled.querySelectorAll<HTMLInputElement>('.settings-toggle input'),
      ].find((input) =>
        input.parentElement?.textContent?.includes('Render string results as Markdown'),
      )!;
      toggle.click();
      fixture.detectChanges();
      expect(compiled.querySelector('#cell-B1 strong')).toBeNull();
      expect(compiled.querySelector('#cell-B1 .cell-value')?.textContent).toContain(
        '**Formatted string**',
      );
    } finally {
      Object.assign(stringResult, original);
    }
  });

  it('opens a browser workbook with its matching companion even when JSON is selected first', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const runtime = TestBed.inject(RuntimeService) as unknown as { inspectDocument: unknown };
    runtime.inspectDocument = vi.fn().mockResolvedValue(createSheetDocument('Imported', 2, 2, FINANCIAL_CELLS.slice(0, 1), []));
    const app = fixture.componentInstance as unknown as {
      loadSheet(event: Event): Promise<void>;
      snapshotSavedAt(): string | null;
      openWorkbook(opening: unknown, here: () => Promise<void>): Promise<void>;
    };
    vi.spyOn(app, 'openWorkbook').mockImplementation(async (_opening, here) => here());
    const outputs = { savedAt: '2026-10-09T12:00:00.000Z', cells: [], dependencies: {} };
    await app.loadSheet({ target: {
      value: 'selected',
      files: [
        { name: 'imported.sheet.py.snapshot.json', text: async () => JSON.stringify(outputs) },
        { name: 'imported.sheet.py', lastModified: Date.now(), text: async () => '# source' },
      ],
    } } as unknown as Event);
    expect(app.snapshotSavedAt()).toBe(outputs.savedAt);
  });

  it('starts a browser clipboard write during the gesture while Python generates its text', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const app = fixture.componentInstance as unknown as {
      cells(): CellDefinition[]; selectCell(id: string): void; copyCellsToClipboard(): boolean;
    };
    app.selectCell(app.cells()[0].id);
    let finish!: (value: {source: string; problems: string[]}) => void;
    vi.spyOn(TestBed.inject(WorkbookSourceService), 'serialize').mockReturnValue(new Promise(resolve => {finish = resolve;}));
    class Item {
      constructor(readonly data: Record<string, Promise<Blob>>) {}
    }
    const write = vi.fn(async (items: Item[]) => {await items[0].data['text/plain'];});
    const previous = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    vi.stubGlobal('ClipboardItem', Item);
    Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {write}});
    try {
      expect(app.copyCellsToClipboard()).toBe(true);
      expect(write).toHaveBeenCalledTimes(1); // before Python has responded
      finish({source: '# Python clipboard', problems: []});
      const blob = await write.mock.calls[0][0][0].data['text/plain'];
      expect(blob.type).toBe('text/plain');
      expect(blob.size).toBe('# Python clipboard'.length);
    } finally {
      vi.unstubAllGlobals();
      if (previous) Object.defineProperty(navigator, 'clipboard', previous);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('skips output snapshot generation and JSON when disabled', async () => {
    const fixture=TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const files=TestBed.inject(WorkbookFileService);
    const download=vi.spyOn(files,'downloadBrowser').mockImplementation(()=>undefined);
    const app=fixture.componentInstance as unknown as {
      setSaveOutputs(value:boolean):void;saveSheet():Promise<void>;snapshotForSave():unknown;
    };
    const snapshot=vi.spyOn(app,'snapshotForSave').mockImplementation(()=>{throw new Error('Outputs must not be generated');});
    app.setSaveOutputs(false);
    await app.saveSheet();
    expect(snapshot).not.toHaveBeenCalled();
    expect(localStorage.getItem('reaktiv-workbook:save-outputs')).toBeNull();
    expect(download).toHaveBeenCalledTimes(1);
    expect(download.mock.calls[0][1]).toMatch(/\.workbook\.py$/);
  });

  it('saves through static Python when the execution kernel is disconnected', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const runtime = TestBed.inject(RuntimeService) as unknown as RuntimeServiceStub;
    const source = TestBed.inject(WorkbookSourceService) as unknown as WorkbookSourceStub;
    const files = TestBed.inject(WorkbookFileService);
    const download = vi.spyOn(files, 'downloadBrowser').mockImplementation(() => undefined);
    runtime.status.set('error');
    runtime.error.set('PLC kernel disconnected');
    const runs = runtime.applyCalls.length;
    const app = fixture.componentInstance as unknown as {saveSheet(): Promise<void>};
    await app.saveSheet();
    expect(source.verifyCalls).toHaveLength(1);
    expect(download.mock.calls[0][0]).toContain('@workbook_config(');
    expect(runtime.applyCalls).toHaveLength(runs);
    expect(runtime.status()).toBe('error');
  });

  it('keeps edits made during Python generation unsaved after the download completes', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const app = fixture.componentInstance as unknown as {
      documentName: {set(value: string): void}; saveSheet(): Promise<void>; hasUnsavedChanges(): boolean;
    };
    app.documentName.set('Captured for save');
    const files = TestBed.inject(WorkbookFileService);
    const download = vi.spyOn(files, 'downloadBrowser').mockImplementation(() => undefined);
    let finish!: () => void;
    let entered!: () => void;
    const generating = new Promise<void>(resolve => {entered = resolve;});
    vi.spyOn(TestBed.inject(WorkbookSourceService), 'serialize').mockImplementation(document => new Promise(resolve => {
      finish = () => resolve(serializeResult(document));
      entered();
    }));
    const saving = app.saveSheet();
    await generating;
    app.documentName.set('Edited while saving');
    finish();
    await saving;
    expect(download.mock.calls[0][0]).toContain('Captured for save');
    expect(download.mock.calls[0][0]).not.toContain('Edited while saving');
    expect(app.hasUnsavedChanges()).toBe(true);
  });

  it('keeps newer cells when image preparation finishes saving older cells', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const files = TestBed.inject(WorkbookFileService);
    vi.spyOn(files, 'downloadBrowser').mockImplementation(() => undefined);
    const app = fixture.componentInstance as unknown as {
      cells: {(): CellDefinition[]; set(cells: CellDefinition[]): void};
      saveSheet(): Promise<void>; hasUnsavedChanges(): boolean;
      assets: {extractEmbedded(cells: CellDefinition[]): Promise<CellDefinition[]>};
    };
    app.cells.set([{id: 'A1', kind: 'input', source: '1', enabled: true, trigger: 'auto'}]);
    vi.spyOn(app.assets, 'extractEmbedded').mockImplementation(async cells => cells.map(cell => ({...cell, color: '#112233'})));
    let finish!: () => void;
    let entered!: () => void;
    const generating = new Promise<void>(resolve => {entered = resolve;});
    vi.spyOn(TestBed.inject(WorkbookSourceService), 'serialize').mockImplementation(document => new Promise(resolve => {
      finish = () => resolve(serializeResult(document));
      entered();
    }));
    const saving = app.saveSheet();
    await generating;
    app.cells.set(app.cells().map(cell => ({...cell, source: '99'})));
    finish();
    await saving;
    expect(app.cells()[0].source).toBe('99');
    expect(app.hasUnsavedChanges()).toBe(true);
  });

  it('downloads browser note images as files in a ZIP and reopens that ZIP', async () => {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    localStorage.setItem('reaktiv-workbook:auto-draft:v1', JSON.stringify({
      savedAt: '2026-10-19T08:00:00.000Z', requireExplicitStart: true,
      document: { ...createSheetDocument('Image notes', 2, 2, [], []), cells: [
        { id: 'A1', kind: 'markdown', source: `![screenshot](${png})`, enabled: true, trigger: 'auto' },
      ] },
    }));
    const files = TestBed.inject(WorkbookFileService);
    const download = vi.spyOn(files, 'downloadBrowser').mockImplementation(() => undefined);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const app = fixture.componentInstance as unknown as {
      saveSheet(): Promise<void>; loadSheet(event: Event): Promise<void>; cells(): CellDefinition[];
      openWorkbook(opening: unknown, here: () => Promise<void>): Promise<void>;
    };
    await app.saveSheet();
    expect(download).toHaveBeenCalledTimes(1);
    const [blob, filename] = download.mock.calls[0];
    expect(filename).toMatch(/\.workbook\.py\.zip$/);
    expect(blob).toBeInstanceOf(Blob);
    const { readWorkbookArchive } = await import('./workbook-archive');
    const opened = await readWorkbookArchive(blob as Blob);
    expect(opened.source).not.toContain('data:image');
    expect(opened.source).toMatch(/assets\/[0-9a-f]{16}\.png/);
    expect(opened.assets.size).toBe(1);
    expect(app.cells()[0].source).not.toContain('data:image');
    const runtime = TestBed.inject(RuntimeService) as unknown as { inspectDocument: unknown };
    const inspect = vi.fn().mockResolvedValue(createSheetDocument('Image notes', 2, 2, app.cells(), []));
    runtime.inspectDocument = inspect;
    vi.spyOn(app, 'openWorkbook').mockImplementation(async (_opening, here) => here());
    await app.loadSheet({ target: { value: filename, files: [
      new File([blob], filename, { lastModified: Date.now() }),
    ] } } as unknown as Event);
    expect(inspect).toHaveBeenCalledWith(opened.source);
    expect(app.cells()[0].source).toMatch(/assets\/[0-9a-f]{16}\.png/);
  });

  it('does not save a file that would not load back as the workbook', async () => {
    const files = TestBed.inject(WorkbookFileService);
    const download = vi.spyOn(files, 'downloadBrowser').mockImplementation(() => undefined);
    const fixture = TestBed.createComponent(App);
    const sourceService = TestBed.inject(WorkbookSourceService) as unknown as WorkbookSourceStub;
    const runtime = TestBed.inject(RuntimeService) as unknown as RuntimeServiceStub;
    sourceService.verifyProblems = ['Cell C1 (board): its code would change', 'Missing action', 'Invalid metadata', 'Fourth detailed problem'];
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    (compiled.querySelector('button[title^="Save project"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(sourceService.verifyCalls.length).toBe(1));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(sourceService.verifyCalls[0]).toContain('class ');  // the file the app wrote
    expect(download).not.toHaveBeenCalled();
    expect(compiled.querySelector('.unsaved-badge')?.textContent).toContain('Unsaved');
    expect(compiled.textContent).toContain('Not saved: the file would not load back as this workbook');
    expect(compiled.querySelector('[role=alertdialog]')?.textContent).toContain('Cell C1 (board): its code would change');
    expect(compiled.querySelector('[role=alertdialog]')?.textContent).toContain('Fourth detailed problem');

    sourceService.verifyProblems = [];
    (compiled.querySelector('button[title^="Save project"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(download).toHaveBeenCalledTimes(2));
    expect(download.mock.calls[0][0]).not.toContain('__snapshot__');
    expect(download.mock.calls[1][1]).toBe(`${download.mock.calls[0][1]}.snapshot.json`);
    expect(JSON.parse(String(download.mock.calls[1][0])).cells.length).toBeGreaterThan(0);
  });

  it('opens the cell named in a save failure without applying or losing drafts', async () => {
    const fixture = createWithFinancialModel();
    fixture.detectChanges();
    await fixture.whenStable();
    const sourceService = TestBed.inject(WorkbookSourceService) as unknown as WorkbookSourceStub;
    const runtime = TestBed.inject(RuntimeService) as unknown as RuntimeServiceStub;
    sourceService.verifyProblems = ['The workbook could not be checked: Cell A1 (revenue): expected an indented block\nIn the cell editor, code line 2: add an indented body.'];
    const app = fixture.componentInstance as unknown as {
      saveSheet(): Promise<void>; selectedId(): string; viewMode(): string;
      selectCell(id: string): void; updateEditorSource(source: string): void;
      cellDrafts(): ReadonlyMap<string,{source:string}>;
    };
    app.selectCell('A2');
    app.updateEditorSource('0.25  # unsaved draft');
    await app.saveSheet();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const button = [...compiled.querySelectorAll<HTMLButtonElement>('[role=alertdialog] button')]
      .find(control => control.textContent?.includes('Open cell A1'));
    expect(button).toBeDefined();
    const runs = runtime.applyCalls.length;
    button!.click();
    fixture.detectChanges();
    expect(app.selectedId()).toBe('A1');
    expect(app.viewMode()).toBe('sheet');
    expect(app.cellDrafts().get('A2')?.source).toBe('0.25  # unsaved draft');
    expect(runtime.applyCalls.length).toBe(runs);
    expect(compiled.querySelector('[role=alertdialog]')).toBeNull();
  });

  it('explains verification failures and retries without silently downloading an unchecked file', async () => {
    const files = TestBed.inject(WorkbookFileService);
    const download = vi.spyOn(files, 'downloadBrowser').mockImplementation(() => undefined);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const runtime = TestBed.inject(RuntimeService);
    const verify = vi.spyOn(TestBed.inject(WorkbookSourceService), 'serialize').mockRejectedValueOnce(new Error('Connection lost to serializer\nValidation service disconnected'));
    const app = fixture.componentInstance as unknown as { saveSheet(): Promise<void>; saving(): boolean };
    await app.saveSheet();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const dialog = compiled.querySelector('[role=alertdialog]');
    expect(dialog?.textContent).toContain('generate and check the workbook');
    expect(dialog?.textContent).toContain('Validation service disconnected');
    expect(dialog?.textContent).toContain('Connection lost to serializer');
    expect(download).not.toHaveBeenCalled();
    expect(app.saving()).toBe(false);
    (Array.from(dialog!.querySelectorAll('button')).find(button => button.textContent?.includes('Try again'))!).click();
    await vi.waitFor(() => expect(download).toHaveBeenCalled());
    fixture.detectChanges();
    expect(verify).toHaveBeenCalledTimes(2);
    expect(compiled.querySelector('[role=alertdialog]')).toBeNull();
  });

  it('confirms successful saves and can restart the kernel', async () => {
    const files = TestBed.inject(WorkbookFileService);
    vi.spyOn(files, 'downloadBrowser').mockImplementation(() => undefined);
    const fixture = TestBed.createComponent(App);
    const runtime = TestBed.inject(RuntimeService) as unknown as RuntimeServiceStub;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.unsaved-badge')?.textContent).toContain('Unsaved');

    (compiled.querySelector('button[title^="Save project"]') as HTMLButtonElement).click();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(compiled.querySelector('.save-toast')?.textContent).toContain('Downloaded');
      expect(compiled.querySelector('.unsaved-badge')).toBeNull();
      expect(compiled.querySelector('.document-save-state')?.textContent?.trim()).toBe('Saved');
    });
    // The confirmation can be dismissed before it disappears by itself.
    (compiled.querySelector('.save-toast button[aria-label="Dismiss"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(compiled.querySelector('.save-toast')).toBeNull();

    const editor = fixture.debugElement.query(By.directive(MarkdownCellEditorComponent))
      .componentInstance as MarkdownCellEditorComponent;
    editor.sourceChange.emit('# Changed after save');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(compiled.querySelector('.unsaved-badge')?.textContent).toContain('Unsaved');

    const restart = compiled.querySelector(
      'button[aria-label="Restart Python kernel"]',
    ) as HTMLButtonElement;
    restart.click();
    await vi.waitFor(() => expect(runtime.restartCalls).toHaveLength(1));
  });

  it('edits global Python modules in workbook settings', async () => {
    const fixture = TestBed.createComponent(App);
    const runtime = TestBed.inject(RuntimeService) as unknown as RuntimeServiceStub;
    fixture.detectChanges();
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    (compiled.querySelector('button[aria-label="Settings"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    const imports = compiled.querySelector('#global-imports') as HTMLTextAreaElement;
    imports.value = 'import pandas as pd\nfrom datetime import date';
    imports.dispatchEvent(new Event('input'));
    const apply = [
      ...compiled.querySelectorAll<HTMLButtonElement>('.settings-actions button'),
    ].find((button) => button.textContent?.includes('Apply settings'))!;
    apply.click();

    await fixture.whenStable();
    fixture.detectChanges();
    expect(compiled.querySelector('#global-imports')).toBeNull();
    expect(compiled.querySelector('button[aria-label="Restart Python kernel"]')).not.toBeNull();
    expect(runtime.applyCalls.at(-1)?.imports).toEqual([
      'import pandas as pd',
      'from datetime import date',
    ]);
  });

  it('offers common spreadsheet actions from the cell context menu', async () => {
    const fixture = createWithFinancialModel();
    fixture.detectChanges();
    await fixture.whenStable();
    (fixture.componentInstance as unknown as {setWorkbookEditing(value:boolean):void}).setWorkbookEditing(true);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    switchView(compiled, 'Cells');
    fixture.detectChanges();

    compiled.querySelector('#cell-C1')?.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 40,
        clientY: 50,
      }),
    );
    fixture.detectChanges();

    const menu = compiled.querySelector('.cell-context-menu') as HTMLElement;
    expect(menu.textContent).toContain('Copy reference');
    expect(menu.textContent).toContain('Run effect');
    expect(menu.textContent).toContain('Disable effect');
    expect(menu.textContent).toContain('Clear cell');
  });

  it('stores a local recovery draft after workbook changes', () => {
    vi.useFakeTimers();
    try {
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      const compiled = fixture.nativeElement as HTMLElement;
      switchView(compiled, 'Cells');
      fixture.detectChanges();
      (compiled.querySelector('[title="Add column"]') as HTMLButtonElement).click();
      fixture.detectChanges();
      vi.advanceTimersByTime(500);

      const draft = JSON.parse(localStorage.getItem('reaktiv-workbook:auto-draft:v1') ?? '{}');
      expect(draft.document.grid.columns).toBe(11);
      expect(draft.requireExplicitStart).toBe(false);
      fixture.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('switches to a dependency graph backed by the same cells', async () => {
    const fixture = createWithFinancialModel();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const graphButton = [
      ...compiled.querySelectorAll<HTMLButtonElement>('.view-switch button'),
    ].find((button) => button.textContent?.trim() === 'Graph');
    graphButton?.click();
    fixture.detectChanges();

    expect(compiled.querySelectorAll('.graph-node')).toHaveLength(7);
    expect(compiled.querySelectorAll('.graph-edges path[d]').length).toBeGreaterThan(0);
    expect(compiled.querySelector('.sheet-grid')).toBeNull();
  });

  it('scrolls graph levels without changing the workbook and preserves the normal canvas when disabled', async () => {
    const fixture=createWithFinancialModel(true);fixture.detectChanges();await fixture.whenStable();
    const app=fixture.componentInstance as unknown as {
      cells:ReturnType<typeof signal<CellDefinition[]>>;graph:ReturnType<typeof signal<GraphResult>>;
      viewMode:ReturnType<typeof signal<string>>;selectCell(id:string):void;
      currentDraftDocument():SheetDocument;
    };
    app.cells.set([...Array.from({length:20},(_,i)=>({id:'A'+(i+1),kind:'input' as const,source:'1',enabled:true,trigger:'auto' as const})),{id:'B1',kind:'formula',source:'A1',enabled:true,trigger:'auto'}]);
    app.graph.set({...graph,dependencies:{B1:Array.from({length:20},(_,i)=>'A'+(i+1))}});app.selectCell('A1');
    app.viewMode.set('graph');fixture.detectChanges();await fixture.whenStable();
    const source=JSON.stringify(app.currentDraftDocument()), runtime=TestBed.inject(RuntimeService) as unknown as RuntimeServiceStub;
    const apply=vi.spyOn(runtime,'apply'),root=fixture.nativeElement as HTMLElement;
    const toggle=root.querySelector<HTMLInputElement>('[aria-label="Scrollable graph levels"]')!;
    expect(toggle.checked).toBe(false);toggle.click();fixture.detectChanges();await fixture.whenStable();fixture.detectChanges();
    expect(root.querySelectorAll('.graph-level')).toHaveLength(2);expect(root.querySelectorAll('.graph-node')).toHaveLength(21);
    expect(root.querySelectorAll('.levels-edges > path[d]')).toHaveLength(1);
    const connections=root.querySelector<HTMLSelectElement>('[aria-label="Graph connections"]')!;
    expect(connections.value).toBe('selected');connections.value='all';connections.dispatchEvent(new Event('change'));
    fixture.detectChanges();await fixture.whenStable();
    expect(root.querySelectorAll('.levels-edges > path[d]')).toHaveLength(20);
    const inputsFirst=root.querySelector<HTMLInputElement>('[aria-label="Inputs first"]')!;
    expect(inputsFirst.checked).toBe(false);inputsFirst.click();fixture.detectChanges();await fixture.whenStable();
    expect(inputsFirst.checked).toBe(true);
    expect(JSON.stringify(app.currentDraftDocument())).toBe(source);expect(apply).not.toHaveBeenCalled();
    toggle.click();fixture.detectChanges();await fixture.whenStable();
    expect(root.querySelector('app-graph-levels')).toBeNull();expect(root.querySelectorAll('.graph-node')).toHaveLength(21);
    fixture.destroy();
  });

  it('switches graph direction through the toolbar without applying workbook changes', async () => {
    const fixture=createWithFinancialModel(true);fixture.detectChanges();await fixture.whenStable();
    const app=fixture.componentInstance as unknown as {
      viewMode:ReturnType<typeof signal<string>>;graphLayout():import('./graph-layout').GraphLayout;
      toggleGraphPin(index:number,layout:import('./graph-layout').GraphLayout):void;graphIsPinned(index:number):boolean;
      currentDraftDocument():SheetDocument;
    };
    app.viewMode.set('graph');fixture.detectChanges();await fixture.whenStable();fixture.detectChanges();
    const runtime=TestBed.inject(RuntimeService) as unknown as RuntimeServiceStub;
    const apply=vi.spyOn(runtime,'apply'),source=JSON.stringify(app.currentDraftDocument());
    const select=fixture.nativeElement.querySelector('select[aria-label="Graph direction"]') as HTMLSelectElement;
    expect(select.value).toBe('horizontal');
    app.toggleGraphPin(-1,app.graphLayout());expect(app.graphIsPinned(-1)).toBe(true);
    select.value='vertical';select.dispatchEvent(new Event('change'));fixture.detectChanges();await fixture.whenStable();fixture.detectChanges();
    expect(app.graphIsPinned(-1)).toBe(false);expect(app.graphLayout().direction).toBe('vertical');
    const nodes=new Map(app.graphLayout().nodes.map(node=>[node.id,node]));
    for(const edge of app.graphLayout().edges)expect(nodes.get(edge.from)!.y).toBeLessThan(nodes.get(edge.to)!.y);
    select.value='horizontal';select.dispatchEvent(new Event('change'));fixture.detectChanges();await fixture.whenStable();fixture.detectChanges();
    expect(app.graphLayout().direction).toBe('horizontal');
    expect(JSON.stringify(app.currentDraftDocument())).toBe(source);expect(apply).not.toHaveBeenCalled();fixture.destroy();
  });

  it('resizes and resets a pinned plot with zoom compensation without editing or evaluating cells', async () => {
    const fixture=createWithFinancialModel(true);fixture.detectChanges();await fixture.whenStable();
    const app=fixture.componentInstance as unknown as {
      cells:ReturnType<typeof signal<CellDefinition[]>>;graph:ReturnType<typeof signal<GraphResult>>;graphZoom:ReturnType<typeof signal<number>>;
      viewMode:ReturnType<typeof signal<string>>;selectCell(id:string):void;selectedId():string;editCell(id:string):void;
      setGraphOutputs(value:boolean):void;setGraphFocus(value:boolean):void;toggleGraphPin(index:number,layout:import('./graph-layout').GraphLayout):void;
      graphLayout():import('./graph-layout').GraphLayout;graphIsPinned(index:number):boolean;currentDraftDocument():SheetDocument;
    };
    app.cells.set(['A1','B1','C1'].map((id,index)=>({id,kind:index===0?'input':'formula',source:'1',enabled:true,trigger:'auto'})));
    app.graph.set({...graph,dependencies:{B1:['A1']},cells:[{id:'B1',value:null,display:'Plot',valueType:'rich-output',error:null,richOutput:{mimeType:'image/png',dataBase64:'plot'}}]});
    app.viewMode.set('graph');app.setGraphOutputs(true);app.setGraphFocus(true);app.selectCell('B1');app.graphZoom.set(.5);fixture.detectChanges();
    app.toggleGraphPin(-1,app.graphLayout());app.selectCell('C1');fixture.detectChanges();
    const source=JSON.stringify(app.currentDraftDocument());
    const runtime=TestBed.inject(RuntimeService) as unknown as RuntimeServiceStub;
    const apply=vi.spyOn(runtime,'apply'), edit=vi.spyOn(app,'editCell');
    const handle=fixture.nativeElement.querySelector('[aria-label="Resize graph cell B1"]') as HTMLButtonElement;
    expect(handle).not.toBeNull();
    const pointer=(type:string,x:number,y:number)=>{
      const event=new MouseEvent(type,{clientX:x,clientY:y,button:0,bubbles:true,cancelable:true});
      Object.defineProperty(event,'pointerId',{value:1});return event;
    };
    handle.dispatchEvent(pointer('pointerdown',100,100));window.dispatchEvent(pointer('pointermove',150,130));
    expect(app.graphLayout().nodes.find(node=>node.id==='B1')?.width).toBe(320);
    window.dispatchEvent(pointer('pointerup',150,130));fixture.detectChanges();
    expect(app.graphLayout().nodes.find(node=>node.id==='B1')).toMatchObject({width:420,height:300});
    expect(app.graphLayout().nodes.map(node=>node.id)).toEqual(['A1','B1']);expect(app.graphIsPinned(-1)).toBe(true);
    expect(app.selectedId()).toBe('C1');
    handle.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true}));fixture.detectChanges();
    expect(app.graphLayout().nodes.find(node=>node.id==='B1')).toMatchObject({width:320,height:240});
    expect(fixture.nativeElement.querySelector('#graph-cell-B1 img')).not.toBeNull();
    expect(JSON.stringify(app.currentDraftDocument())).toBe(source);expect(apply).not.toHaveBeenCalled();expect(edit).not.toHaveBeenCalled();
    fixture.destroy();
  });

  it('renders shared widgets and plots in graph cards and keeps their live updates independent of a pin', async () => {
    const fixture=createWithFinancialModel(true);fixture.detectChanges();await fixture.whenStable();
    const app=fixture.componentInstance as unknown as {
      cells:ReturnType<typeof signal<CellDefinition[]>>;graph:ReturnType<typeof signal<GraphResult>>;
      pendingStart:ReturnType<typeof signal<boolean>>;viewMode:ReturnType<typeof signal<string>>;selectedId():string;selectCell(id:string):void;
      graphLayout():import('./graph-layout').GraphLayout;setGraphOutputs(value:boolean):void;
      toggleGraphPin(index:number,layout:import('./graph-layout').GraphLayout):void;graphIsPinned(index:number):boolean;
    };
    app.cells.set(['A1','B1','C1','D1','E1'].map((id,index):CellDefinition=>({id,kind:index===0?'input':'formula',source:index===0?'False':'None',enabled:true,trigger:'auto',...(index===0?{view:{widget:{type:'checkbox'}}}:{})})));
    const rows:import('./sheet.types').CellResult[]=[
      {id:'A1',value:false,display:'False',valueType:'bool',error:null},
      {id:'B1',value:null,display:'Plot',valueType:'rich-output',error:null,richOutput:{mimeType:'image/png',dataBase64:'first'}},
      {id:'C1',value:null,display:'Plot',valueType:'rich-output',error:null,richOutput:{mimeType:'application/vnd.plotly.v1+json',dataBase64:btoa('{"data":[],"layout":{}}')}},
      {id:'D1',value:null,display:'Widget',valueType:'rich-output',error:null,richOutput:{mimeType:'application/vnd.anywidget+json',dataBase64:btoa('{"esm":"export default {}","css":"","state":{}}')}},
      {id:'E1',value:null,display:'HTML',valueType:'rich-output',error:null,richOutput:{mimeType:'text/html',dataBase64:btoa('<p>Output</p>')}},
    ];
    app.graph.set({...graph,cells:rows,dependencies:{B1:['A1'],C1:['A1']}});app.viewMode.set('graph');app.pendingStart.set(false);
    app.setGraphOutputs(false);fixture.detectChanges();
    const root=fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.graph-node-output')).toBeNull();
    app.setGraphOutputs(true);fixture.detectChanges();
    expect(root.querySelector('#graph-cell-B1 .graph-node-output img')?.getAttribute('src')).toContain('base64,first');
    expect(root.querySelector('#graph-cell-C1 reaktiv-plotly')).not.toBeNull();
    expect(root.querySelector('#graph-cell-D1 reaktiv-anywidget')?.getAttribute('data-cell')).toBe('D1');
    expect(root.querySelector('#graph-cell-E1 reaktiv-html')).not.toBeNull();
    app.selectCell('B1');fixture.detectChanges();await fixture.whenStable();fixture.detectChanges();
    app.toggleGraphPin(-1,app.graphLayout());fixture.detectChanges();
    const pinned=app.graphLayout();
    expect(root.querySelector('.graph-header .graph-pin-notice')).not.toBeNull();
    expect(root.querySelector('.graph-view > .graph-pin-notice')).toBeNull();
    expect(pinned.nodes.find(node=>node.id==='B1')?.width).toBe(320);
    const runtime=TestBed.inject(RuntimeService) as unknown as RuntimeServiceStub;
    const apply=vi.spyOn(runtime,'apply').mockImplementation(async()=>({...graph,dependencies:{B1:['A1'],C1:['A1']},cells:rows.map(row=>row.id==='A1'?{...row,value:true,display:'True'}:row)}));
    const control=root.querySelector<HTMLInputElement>('#graph-cell-A1 input[type="checkbox"]')!;
    expect(control.disabled).toBe(false);
    control.dispatchEvent(new MouseEvent('pointerdown',{bubbles:true,button:0}));
    expect(root.querySelector('.graph-scroll')?.classList.contains('panning')).toBe(false);
    control.click();await fixture.whenStable();fixture.detectChanges();
    expect(app.selectedId()).toBe('B1');
    expect(app.cells().find(cell=>cell.id==='A1')?.source).toBe('True');
    expect(apply).toHaveBeenCalledTimes(1);expect(app.graphIsPinned(-1)).toBe(true);
    expect(app.graphLayout()).toBe(pinned);
    app.graph.update(value=>({...value,cells:value.cells.map(row=>row.id==='B1'?{...row,richOutput:{mimeType:'image/png',dataBase64:'second'}}:row)}));fixture.detectChanges();
    expect(root.querySelector('#graph-cell-B1 img')?.getAttribute('src')).toContain('base64,second');
    app.setGraphOutputs(false);fixture.destroy();
  });

  it('keeps a pinned focus through inspection and split-pane swaps until explicitly unpinned', async () => {
    const fixture=createWithFinancialModel(true);fixture.detectChanges();await fixture.whenStable();
    const app=fixture.componentInstance as unknown as {
      cells:ReturnType<typeof signal<CellDefinition[]>>;graph:ReturnType<typeof signal<GraphResult>>;
      viewMode:ReturnType<typeof signal<string>>;splitViews:ReturnType<typeof signal<string[]>>;
      selectedId():string;selectCell(id:string):void;setGraphFocus(value:boolean):void;
      graphLayout():import('./graph-layout').GraphLayout;toggleGraphPin(index:number,layout:import('./graph-layout').GraphLayout):void;
      graphIsPinned(index:number):boolean;showSplit():void;toggleSplitSides():void;
    };
    app.cells.set(['A1','B1','C1','D1'].map(id=>({id,kind:'formula',source:'1',enabled:true,trigger:'auto'})));
    app.graph.set({...graph,dependencies:{B1:['A1'],D1:['C1']}});
    app.splitViews.set(['graph','sheet']);app.viewMode.set('graph');app.setGraphFocus(true);app.selectCell('B1');fixture.detectChanges();
    app.toggleGraphPin(-1,app.graphLayout());
    app.selectCell('D1');fixture.detectChanges();
    expect(app.graphLayout().nodes.map(node=>node.id)).toEqual(['A1','B1']);expect(app.selectedId()).toBe('D1');
    app.showSplit();fixture.detectChanges();app.toggleSplitSides();fixture.detectChanges();
    expect(app.graphIsPinned(1)).toBe(true);expect(app.graphIsPinned(0)).toBe(false);
    const root=fixture.nativeElement as HTMLElement;
    expect(root.querySelector('#pane-1-graph-cell-A1')).not.toBeNull();
    expect(root.querySelector('#pane-1-graph-cell-D1')).toBeNull();
    root.querySelector<HTMLButtonElement>('[aria-label="Unpin graph view"]')!.click();fixture.detectChanges();
    expect(root.querySelector('#pane-1-graph-cell-D1')).not.toBeNull();
    expect(root.querySelector('#pane-1-graph-cell-A1')).toBeNull();
    fixture.destroy();
  });

  it('shows persistent update badges and traces dependencies without losing hidden cells', async () => {
    history.replaceState(null, '', '?experimentalUpdateTracing=1');
    const fixture=createWithFinancialModel(true);fixture.detectChanges();await fixture.whenStable();
    const app=fixture.componentInstance as unknown as {
      cells:ReturnType<typeof signal<CellDefinition[]>>; graph:ReturnType<typeof signal<GraphResult>>;
      viewMode:ReturnType<typeof signal<string>>; traceUpdates:ReturnType<typeof signal<boolean>>;
      graphHideText:ReturnType<typeof signal<boolean>>; graphLayout():{nodes:{id:string}[]};
      selectCell(id:string):void; showUpdateTrace(path:{id:string;direction:'upstream'|'downstream'}):void;
      setTraceUpdates(enabled:boolean):void;
    };
    app.cells.set(['A1','B1','C1','D1'].map((id,index):CellDefinition=>({id,kind:index===1?'markdown':'formula',source:'1',enabled:true,trigger:'auto',view:{page:false}})));
    const observed=(status:import('./sheet.types').CellUpdateStatus,dependencies:string[]=[])=>({status,dependencies,executions:status==='equal'?1:0,publishedChanged:status==='changed',changedDependencies:[]});
    app.graph.set({...graph,dependencies:{B1:['A1'],C1:['B1']},updateTrace:{sequence:2,roots:['A1'],cells:{A1:observed('changed'),B1:observed('equal',['A1']),C1:observed('cached',['B1']),D1:observed('unaffected')}}});
    app.graphHideText.set(true);app.viewMode.set('graph');app.selectCell('C1');app.traceUpdates.set(true);
    history.replaceState(null, '', '/');
    fixture.detectChanges();await fixture.whenStable();fixture.detectChanges();
    const root=fixture.nativeElement as HTMLElement;
    expect(root.querySelector('#graph-cell-C1')?.getAttribute('data-update-status')).toBe('cached');
    expect(root.querySelector('#graph-cell-A1')?.textContent).toContain('Changed');
    app.showUpdateTrace({id:'C1',direction:'upstream'});fixture.detectChanges();
    expect(app.graphLayout().nodes.map(node=>node.id).sort()).toEqual(['A1','B1','C1']);
    expect(root.querySelector('#graph-cell-B1')?.classList.contains('trace-equal')).toBe(true);
    expect(root.querySelector('.graph-edges .update-trace-edge')).not.toBeNull();
    app.selectCell('B1');fixture.detectChanges();
    expect(app.graphLayout().nodes.some(node=>node.id==='C1')).toBe(true);
    app.setTraceUpdates(false);fixture.detectChanges();
    expect(root.querySelector('#graph-cell-C1')?.getAttribute('data-update-status')).toBeNull();
    fixture.destroy(); history.replaceState(null, '', '/');
  });

  it('shows graph error origins, traces failures and persists visibility filters', async () => {
    const fixture = createWithFinancialModel(true);
    fixture.detectChanges(); await fixture.whenStable();
    const app = fixture.componentInstance as unknown as {
      cells: ReturnType<typeof signal<CellDefinition[]>>;
      graph: ReturnType<typeof signal<GraphResult>>;
      viewMode: ReturnType<typeof signal<string>>;
      selectedId(): string;
      graphFocus(): boolean;
      graphLayout(): {nodes: {id: string}[]};
      setGraphFilter(kind: 'text'|'isolated'|'errors', enabled: boolean): void;
      selectCell(id: string): void;
    };
    const definitions: CellDefinition[] = [
      {id:'A1',kind:'formula',source:'1/0',enabled:true,trigger:'auto'},
      {id:'B1',kind:'formula',source:'A1+1',enabled:true,trigger:'auto'},
      {id:'C1',kind:'markdown',source:'Heading',enabled:true,trigger:'auto',view:{page:false}},
      {id:'D1',kind:'input',source:'1',enabled:true,trigger:'auto'},
    ];
    app.cells.set(definitions);
    app.graph.set({...graph, dependencies:{B1:['A1']}, cells:[
      {id:'A1',display:'',value:null,valueType:'error',error:'Division by zero'},
      {id:'B1',display:'',value:null,valueType:'error',error:'Cannot read A1',errorDetail:{origin:'A1'}},
      {id:'C1',display:'Heading',value:'Heading',valueType:'markdown',error:null},
      {id:'D1',display:'1',value:1,valueType:'int',error:null},
    ]});
    app.viewMode.set('graph'); app.selectCell('B1'); fixture.detectChanges();
    await fixture.whenStable(); fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('#graph-cell-A1')?.classList.contains('error-origin')).toBe(true);
    expect(root.querySelector('#graph-cell-B1')?.textContent).toContain('From A1');
    expect(root.querySelector('#graph-cell-C1')).toBeNull();
    expect(root.querySelector('.graph-edges .error-edge')).not.toBeNull();
    app.setGraphFilter('isolated',true); fixture.detectChanges();
    expect(root.querySelector('#graph-cell-D1')).toBeNull();
    app.setGraphFilter('text',false); fixture.detectChanges();
    expect(JSON.parse(localStorage.getItem('reaktiv-workbook:graph-settings:v1')!).hideText).toBe(false);
    app.setGraphFilter('errors',true); fixture.detectChanges();
    expect(app.graphLayout().nodes.map(node => node.id).sort()).toEqual(['A1','B1']);
    const originButton = [...root.querySelectorAll<HTMLButtonElement>('.graph-diagnostics button')].find(button=>button.textContent?.includes('Go to origin'))!;
    originButton.click(); fixture.detectChanges();
    expect(app.selectedId()).toBe('A1'); expect(app.graphFocus()).toBe(true);
    expect(root.querySelector('.graph-diagnostics')?.textContent).toContain('Error origin');
  });

  it('centers single-line worksheet labels and headings without centering multiline or rich content', async () => {
    const fixture = createWithFinancialModel();
    fixture.detectChanges(); await fixture.whenStable();
    const app = fixture.componentInstance as unknown as {
      cells: ReturnType<typeof signal<CellDefinition[]>>;
      graph: ReturnType<typeof signal<GraphResult>>;
      viewMode: ReturnType<typeof signal<string>>;
      worksheetLabelIds(): ReadonlySet<string>;
    };
    const sources = ['Voltage **(V)** < 5', '# Settings', 'First line\nSecond line', '![Circuit](#cell-A2)', '- Item', '<table><tr><td>a</td></tr></table>', 'Compact label'];
    const cells: CellDefinition[] = sources.map((source, index) => ({
      id: String.fromCharCode(65 + index) + '1', kind: 'markdown', source, enabled: true, trigger: 'auto',
      view: {page: false, ...(index < 6 ? {display: 'rendered' as const} : {})},
    }));
    app.cells.set(cells);
    app.graph.set({...graph, cells: cells.map(cell => ({id: cell.id, display: cell.source, value: cell.source, valueType: 'markdown', error: null}))});
    app.viewMode.set('sheet'); fixture.detectChanges();
    expect([...app.worksheetLabelIds()]).toEqual(['A1', 'B1', 'G1']);
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('#cell-A1')?.classList.contains('text-label')).toBe(true);
    expect(root.querySelector('#cell-B1 h1')?.textContent).toBe('Settings');
    expect(root.querySelector('#cell-C1')?.classList.contains('text-label')).toBe(false);
    expect(root.querySelector('#cell-G1')?.classList.contains('text-label')).toBe(true);
  });

  it('keeps inspector values lightweight without mounting rich previews', async () => {
    const fixture = createWithFinancialModel();
    fixture.detectChanges(); await fixture.whenStable();
    const app = fixture.componentInstance as unknown as {
      cells: ReturnType<typeof signal<CellDefinition[]>>;
      graph: ReturnType<typeof signal<GraphResult>>;
      viewMode: ReturnType<typeof signal<string>>;
      selectCell(id: string): void;
    };
    app.viewMode.set('sheet');
    const base: CellResult = {id: 'A1', display: 'Output', value: null, valueType: 'object', error: null};
    const results: CellResult[] = [
      {...base, richOutput: {mimeType: 'application/vnd.plotly.v1+json', dataBase64: btoa('{"data":[],"layout":{}}')}},
      {...base, richOutput: {mimeType: 'text/html', dataBase64: btoa('<h1>Expensive preview</h1>')}},
      {...base, richOutput: {mimeType: 'application/vnd.anywidget+json', dataBase64: btoa('{}')}},
      {...base, richOutput: {mimeType: 'image/png', dataBase64: 'cG5n'}},
      {...base, table: {kind: 'DataFrame', columns: ['a'], index: null, indexName: null, rows: [[1]], rowCount: 1, columnCount: 1, truncated: false}},
      {...base, artifact: {filename: 'plot.png', mimeType: 'image/png', size: 3, sha256: 'digest', dataBase64: 'cG5n'}},
      {...base, display: '# Note content', valueType: 'markdown'},
      {...base, display: '**Plain string**', valueType: 'str'},
      {...base, display: '42', value: 42, valueType: 'int'},
      {...base, display: '', error: 'Failed to evaluate'},
    ];
    const root = fixture.nativeElement as HTMLElement;
    for (const result of results) {
      app.cells.set([{id: 'A1', kind: result.valueType === 'markdown' ? 'markdown' : 'formula', source: '1', enabled: true, trigger: 'auto'}]);
      app.graph.set({...graph, cells: [result]});
      app.selectCell('A1'); fixture.detectChanges();
      const card = root.querySelector('.inspector .value-card')!;
      expect(card).not.toBeNull();
      expect(card.querySelector('reaktiv-plotly, reaktiv-html, reaktiv-anywidget, img, table, .markdown-content')).toBeNull();
      if (result.artifact) expect(card.querySelector('.artifact-download-button')).not.toBeNull();
      if (result.valueType === 'markdown') expect(card.querySelector('.copy-markdown-button')).not.toBeNull();
      if (result.valueType === 'int') expect(card.textContent).toContain('42');
      if (result.error) expect(card.textContent).toContain(result.error);
    }
  });

  it('creates clean worksheet headings from empty grid cells and publishes them explicitly', async () => {
    const fixture = createWithFinancialModel();
    fixture.detectChanges(); await fixture.whenStable();
    (fixture.componentInstance as unknown as {setWorkbookEditing(value:boolean):void}).setWorkbookEditing(true);
    const app = fixture.componentInstance as unknown as {
      switchFromNotes(view: 'sheet'): void; cells(): CellDefinition[]; notePages(): CellDefinition[];
      undo(): void; selectedId(): string; graph: ReturnType<typeof signal<GraphResult>>;
    };
    const runtime = TestBed.inject(RuntimeService) as unknown as RuntimeServiceStub;
    app.switchFromNotes('sheet'); fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    compiled.querySelector('#cell-E5')!.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));
    fixture.detectChanges();
    const create = [...compiled.querySelectorAll<HTMLButtonElement>('.cell-context-menu button')]
      .find(button => button.textContent?.trim() === 'Text / heading')!;
    expect(create).toBeDefined(); create.click();
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    const heading = app.cells().find(cell => cell.id === 'E5')!;
    expect(heading).toMatchObject({kind:'markdown',source:'# Heading',view:{page:false,display:'rendered'}});
    expect(app.notePages().some(cell => cell.id === 'E5')).toBe(false);
    app.graph.update(graph => ({...graph,cells:[...graph.cells,{id:'E5',value:'# Heading',display:'# Heading',valueType:'markdown',error:null}]}));
    fixture.detectChanges();
    expect(compiled.querySelector('#cell-E5 h1')?.textContent).toBe('Heading');
    expect(compiled.querySelector('#cell-E5 .cell-kind')).toBeNull();
    expect(compiled.querySelector('.inspector .type-badge')?.textContent).toContain('Text / heading');
    const toggle = compiled.querySelector<HTMLInputElement>('#show-in-notes')!;
    expect(toggle.checked).toBe(false);
    const runs = runtime.applyCalls.length;
    toggle.click(); fixture.detectChanges();
    expect(app.notePages().some(cell => cell.id === 'E5')).toBe(true);
    expect(compiled.querySelector('.inspector .type-badge')?.textContent).toContain('Note page');
    expect(app.cells().find(cell => cell.id === 'E5')?.source).toBe('# Heading');
    expect(runtime.applyCalls.length).toBe(runs);
    app.undo(); fixture.detectChanges(); await fixture.whenStable();
    expect(app.cells().find(cell => cell.id === 'E5')?.view?.page).toBe(false);
    expect(app.notePages().some(cell => cell.id === 'E5')).toBe(false);
  });

  it('offers text creation only for empty cells and preserves existing drafts', async () => {
    const fixture = createWithFinancialModel();
    fixture.detectChanges(); await fixture.whenStable();
    (fixture.componentInstance as unknown as {setWorkbookEditing(value:boolean):void}).setWorkbookEditing(true);
    const app = fixture.componentInstance as unknown as {
      switchFromNotes(view: 'sheet'): void; selectCell(id:string):void; updateEditorSource(source:string):void;
      createWorksheetText(id:string):void; cells():CellDefinition[]; editorSource:string;
    };
    app.switchFromNotes('sheet'); fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    compiled.querySelector('#cell-A1')!.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));
    fixture.detectChanges();
    expect(compiled.querySelector('.cell-context-menu')?.textContent).not.toContain('Text / heading');
    const previous = app.cells().find(cell => cell.id === 'A1');
    app.createWorksheetText('A1');
    expect(app.cells().find(cell => cell.id === 'A1')).toBe(previous);
    app.selectCell('E5'); app.updateEditorSource('my unfinished value');
    app.createWorksheetText('E5');
    expect(app.cells().some(cell => cell.id === 'E5')).toBe(false);
    expect(app.editorSource).toBe('my unfinished value');
  });

  it('creates note pages from the Notes sidebar', async () => {
    const fixture = createWithFinancialModel();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('app-markdown-cell-editor')).not.toBeNull();
    expect(compiled.querySelectorAll('.note-list-item')).toHaveLength(1);
    expect(compiled.querySelector('.note-list-item strong')?.textContent).toContain(
      'Financial snapshot',
    );
    await vi.waitFor(() =>
      expect(compiled.querySelector('.ProseMirror .live-value')?.textContent).toContain('102500'),
    );

    (compiled.querySelector('.new-note-button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(compiled.querySelectorAll('.note-list-item')).toHaveLength(2);
    const added = (fixture.componentInstance as unknown as {cells():CellDefinition[]}).cells().find(cell => cell.source.includes('Untitled note'));
    expect(added?.kind).toBe('markdown'); expect(added?.view?.page).not.toBe(false);
    await vi.waitFor(() =>
      expect(compiled.querySelector('.ProseMirror')?.textContent).toContain('Untitled note'),
    );
  });

  it('keeps widget references intact when renaming a sheet', async () => {
    const fixture = createWithFinancialModel(); fixture.detectChanges(); await fixture.whenStable();
    const app = fixture.componentInstance as unknown as {
      cells: { update(update: (cells: CellDefinition[]) => CellDefinition[]): void; (): CellDefinition[] };
      sheetName(): string;
      renameSheet(prefix: string, name: string): void;
    };
    const before = app.sheetName();
    app.cells.update(cells => [{ ...cells[0], view: { widget: { type: 'number', max: `${before}.A2` } } }, ...cells.slice(1)]);
    app.renameSheet('', 'Renamed');
    expect(app.cells()[0].view?.widget?.max).toBe('Renamed.A2');
  });

  it('overrides and resets linked values without replacing their derivation, and restores overrides on undo', async () => {
    const fixture = createWithFinancialModel(); fixture.detectChanges(); await fixture.whenStable();
    const app = fixture.componentInstance as unknown as {
      cells: ReturnType<typeof signal<CellDefinition[]>>;
      graph: ReturnType<typeof signal<GraphResult>>;
      selectCell(id: string): void; overrideLinkedInput(id: string, source: string): void;
      resetLinkedInput(id: string): void; undo(): void;
    };
    app.cells.set([{ id: 'A1', kind: 'input', source: '10', enabled: true, trigger: 'auto' }, { id: 'B1', kind: 'linked', source: 'A1 * 2', enabled: true, trigger: 'auto' }]);
    app.selectCell('B1');
    app.overrideLinkedInput('B1', '7'); await fixture.whenStable(); fixture.detectChanges();
    expect(app.cells()[1].source).toBe('A1 * 2'); expect(app.cells()[1].override).toBe('7');
    expect((fixture.nativeElement as HTMLElement).querySelector('app-linked-input')?.textContent).toContain('Overridden');
    app.resetLinkedInput('B1'); await fixture.whenStable(); fixture.detectChanges();
    expect(app.cells()[1].override).toBeUndefined();
    expect(app.cells()[1].source).toBe('A1 * 2');
    app.undo(); await fixture.whenStable();
    expect(app.cells()[1].override).toBe('7');
    app.graph.update(graph => ({ ...graph, cells: [...graph.cells.filter(cell => cell.id !== 'B1'), { id: 'B1', display: '24', value: 24, valueType: 'int', error: null, linkedOverride: null }] }));
    fixture.detectChanges(); await fixture.whenStable();
    expect(app.cells()[1].override).toBeUndefined();
    expect(app.cells()[1].source).toBe('A1 * 2');
  });

  it('fits occupied cells with custom dimensions and spans, respects zoom limits, and isolates split panes', async () => {
    const fixture=createWithFinancialModel();fixture.detectChanges();await fixture.whenStable();
    const app=fixture.componentInstance as unknown as {
      openDocument(document: SheetDocument, path: null, start: boolean): void;
      viewMode: ReturnType<typeof signal<string>>; zoom(): number;
      showSplit(): void; setSplitView(index: number, view: 'sheet'): void;
      setSplitSheet(index: number, sheet: string): void;
      splitZooms(): readonly number[]; setPaneZoom(index: number, value: number): void;
    };
    const document=createSheetDocument('Fit',30,60,[
      {id:'C3',kind:'formula',source:'1',enabled:true,trigger:'auto',view:{span:[2,3]}},
      {id:'Other!A1',kind:'input',source:'1',enabled:true,trigger:'auto'},
    ],[],{columnWidths:{A:200},rowHeights:{'1':100},zoom:1});
    document.sheets=[{name:'Other',grid:{columns:4,rows:5},layout:{columnWidths:{A:300},rowHeights:{}}}];
    app.openDocument(document,null,false);await fixture.whenStable();app.viewMode.set('sheet');fixture.detectChanges();
    const root=fixture.nativeElement as HTMLElement;
    const viewport=root.querySelector<HTMLElement>('.sheet-scroll')!;
    let width=476,height=600;
    Object.defineProperty(viewport,'clientWidth',{configurable:true,get:()=>width});
    Object.defineProperty(viewport,'clientHeight',{configurable:true,get:()=>height});
    const scroll=vi.fn();Object.defineProperty(viewport,'scrollTo',{configurable:true,value:scroll});
    const fit=()=>{root.querySelector<HTMLButtonElement>('[aria-label="Fit worksheet in view"]')!.click();fixture.detectChanges();};
    fit();expect(app.zoom()).toBeCloseTo(0.8);expect(scroll).toHaveBeenCalledWith({left:0,top:0,behavior:'instant'});
    width=200;fit();expect(app.zoom()).toBeCloseTo(184/575);
    width=60;fit();expect(app.zoom()).toBe(0.1);
    width=2000;height=2000;fit();expect(app.zoom()).toBe(1);
    height=0;app.setPaneZoom(-1,1.2);fit();expect(app.zoom()).toBe(1.2);
    app.showSplit();app.setSplitView(0,'sheet');app.setSplitView(1,'sheet');app.setSplitSheet(1,'Other');fixture.detectChanges();
    const panes=root.querySelectorAll<HTMLElement>('.sheet-area');
    const right=panes[1].querySelector<HTMLElement>('.sheet-scroll')!;
    Object.defineProperty(right,'scrollTo',{configurable:true,value:vi.fn()});
    Object.defineProperty(right,'clientWidth',{configurable:true,value:220});
    Object.defineProperty(right,'clientHeight',{configurable:true,value:500});
    app.setPaneZoom(0,1.3);
    panes[1].querySelector<HTMLButtonElement>('[aria-label="Fit worksheet in view"]')!.click();fixture.detectChanges();
    expect(app.splitZooms()[0]).toBe(1.3);expect(app.splitZooms()[1]).toBeCloseTo(204/339);
    fixture.destroy();
  });

  it('opens in View mode, keeps input keys local, and requires Edit for layout gestures',async()=>{
    const fixture=createWithFinancialModel();fixture.detectChanges();await fixture.whenStable();
    const app=fixture.componentInstance as unknown as {
      viewMode:ReturnType<typeof signal<string>>; cells:ReturnType<typeof signal<CellDefinition[]>>;
      workbookEditing():boolean;notesEditing():boolean;setWorkbookEditing(editing:boolean):void;selectCell(id:string):void;
      editorSource:string;cellDrafts():Map<string,unknown>;editCell(id:string):void;
    };
    expect(app.workbookEditing()).toBe(false);
    app.editCell('A1');expect(app.workbookEditing()).toBe(false);
    app.cells.set([{id:'A1',kind:'input',source:'"hello"',enabled:true,trigger:'auto',view:{display:'rendered',widget:{type:'text'}}}]);
    app.viewMode.set('sheet');app.selectCell('A1');fixture.detectChanges();await fixture.whenStable();
    const root=fixture.nativeElement as HTMLElement,cell=root.querySelector<HTMLElement>('.sheet-cell[data-cell-id="A1"]')!;
    const edit=vi.spyOn(app,'editCell');
    expect(cell.draggable).toBe(false);cell.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));expect(edit).not.toHaveBeenCalled();
    const input=cell.querySelector<HTMLInputElement>('input')!;expect(input.disabled).toBe(false);
    for(const key of ['Enter',' ']) {
      const event=new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true});input.dispatchEvent(event);expect(event.defaultPrevented).toBe(false);
    }
    root.querySelector<HTMLButtonElement>('[aria-label="Workbook edit mode"]')!.click();fixture.detectChanges();
    expect(app.workbookEditing()).toBe(true);expect(app.notesEditing()).toBe(true);expect(cell.draggable).toBe(true);
    expect(root.querySelectorAll('[aria-label="Workbook edit mode"]')).toHaveLength(1);
    expect(root.querySelector('[aria-label="Edit cell layout"]')).toBeNull();
    input.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));expect(edit).not.toHaveBeenCalled();
    input.dispatchEvent(new Event('pointerdown',{bubbles:true}));expect(cell.draggable).toBe(false);
    window.dispatchEvent(new Event('pointerup'));fixture.detectChanges();expect(cell.draggable).toBe(true);
    cell.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));expect(edit).toHaveBeenCalledWith('A1');
    app.editorSource='"draft"';app.setWorkbookEditing(false);fixture.detectChanges();
    expect(app.cellDrafts().has('A1')).toBe(true);expect(cell.draggable).toBe(false);expect(app.notesEditing()).toBe(false);
    expect(root.querySelector<HTMLSelectElement>('#inspector-kind')?.disabled).toBe(true);
    fixture.destroy();
  });

  it('downloads migrated browser workbooks under a new name and leaves v2 opens unflagged',async()=>{
    const fixture=createWithFinancialModel();fixture.detectChanges();await fixture.whenStable();
    const app=fixture.componentInstance as unknown as {
      openDocument(document:SheetDocument,start:boolean):void;saveSheet():Promise<void>;
      migrationFilename:ReturnType<typeof signal<string>>;workbookMigration():unknown;saveFailure():unknown;
    };
    const files=TestBed.inject(WorkbookFileService),download=vi.spyOn(files,'downloadBrowser').mockImplementation(()=>{});
    const doc=createSheetDocument('Legacy',2,2,[{id:'A1',kind:'input',source:'1',enabled:true,trigger:'auto'}]);
    app.openDocument({...doc,sourceFormatVersion:1,sourceFileName:'original.sheet.py'},true);
    expect(app.migrationFilename()).toBe('original.workbook.py');
    app.migrationFilename.set('original.sheet.py');await app.saveSheet();expect(download).not.toHaveBeenCalled();
    expect(app.saveFailure()).not.toBeNull();app.migrationFilename.set('my-copy.workbook.py');await app.saveSheet();
    expect(download).toHaveBeenCalledWith(expect.stringContaining('@workbook_config('),'my-copy.workbook.py');
    expect(app.workbookMigration()).toBeNull();
    app.openDocument({...doc,sourceFormatVersion:2},true);fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-workbook-migration-notice')).toBeNull();
    fixture.destroy();
  });

  it('upgrades a CLI session format-1 workbook in place when saving, like marimo',async()=>{
    const fixture=createWithFinancialModel();fixture.detectChanges();await fixture.whenStable();
    const app=fixture.componentInstance as unknown as {
      openDocument(document:SheetDocument,start:boolean):void;saveSheet(options?:{saveAs?:boolean}):Promise<void>;
      embeddedSession:ReturnType<typeof signal<boolean>>;workbookMigration():unknown;acceptSessionState(state:unknown):void;
      saveFeedback():string|null;
    };
    const runtime=TestBed.inject(RuntimeService);
    const doc=createSheetDocument('Legacy',2,2,[{id:'A1',kind:'input',source:'1',enabled:true,trigger:'auto'}]);
    app.openDocument({...doc,sourceFormatVersion:1,sourceFileName:'budget.sheet.py'},true);
    app.embeddedSession.set(true);fixture.detectChanges();
    const notice=fixture.nativeElement.querySelector('app-workbook-migration-notice') as HTMLElement;
    expect(notice.textContent).toContain('in place');
    expect(notice.querySelector('input, button')).toBeNull();
    vi.spyOn(app,'acceptSessionState').mockImplementation(()=>undefined);
    const save=vi.fn().mockResolvedValue({mode:'edit',path:'/work/budget.sheet.py',revision:2,document:{...doc,sourceFormatVersion:2},graph:{cells:[],dependencies:{},changed:[]}});
    (runtime as unknown as {saveSession:typeof save}).saveSession=save;
    await app.saveSheet();
    expect(save).toHaveBeenCalledWith(expect.anything(),true,expect.anything());
    expect(app.workbookMigration()).toBeNull();
    expect(app.saveFeedback()).toContain('format 2');
    fixture.destroy();
  });

  it('pairs notes, cells, and graph and keeps cell zoom inside the cell pane', async () => {
    const fixture = createWithFinancialModel();
    fixture.detectChanges(); await fixture.whenStable();
    const app = fixture.componentInstance as unknown as { showSplit(): void; setSplitView(index: number, kind: 'notes' | 'sheet' | 'graph'): void; splitViews(): readonly string[] };
    app.showSplit(); fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.statusbar .zoom-overlay')).toBeNull();
    expect(host.querySelector('.sheet-area .zoom-overlay')).not.toBeNull();
    app.setSplitView(1, 'graph'); fixture.detectChanges();
    expect(host.querySelector('app-markdown-cell-editor')).not.toBeNull();
    expect(host.querySelector('.graph-view')).not.toBeNull();
    expect(host.querySelector('.sheet-area .zoom-overlay')).toBeNull(); // no Cells pane, no Cells zoom
    app.setSplitView(0, 'sheet'); fixture.detectChanges();
    expect(host.querySelector('.sheet-area')).not.toBeNull();
    expect(host.querySelector('.graph-view')).not.toBeNull();
    app.setSplitView(0, 'graph'); fixture.detectChanges();
    expect(app.splitViews()).toEqual(['graph', 'graph']);
    expect(host.querySelectorAll('.graph-view')).toHaveLength(2);
    expect(host.querySelectorAll('.sheet-area')).toHaveLength(0);
  });

  it('shows two worksheets with their own layouts and activates the clicked pane before editing', async () => {
    const fixture = createWithFinancialModel(); fixture.detectChanges(); await fixture.whenStable();
    const app = fixture.componentInstance as unknown as {
      openDocument(document: ReturnType<typeof createSheetDocument>, path: null, start: boolean): void;
      showSplit(): void; setSplitView(index: number, view: 'sheet'): void;
      setSplitSheet(index: number, sheet: string): void; activeSheet(): string;
      selectedId(): string; columns(): string[]; addColumn(): void;
      splitSheets(): readonly string[]; setPaneZoom(index: number, value: number): void;
      workspacePanes(): readonly Record<string,unknown>[]; graphThisSheet: {set(value:boolean):void};
    };
    const document = createSheetDocument('Compare sheets', 2, 3, [
      {id: 'A1', kind: 'input', source: '10', enabled: true, trigger: 'auto'},
      {id: 'Budget!A1', kind: 'input', source: '20', enabled: true, trigger: 'auto'},
    ]);
    document.sheets = [{name: 'Budget', grid: {columns: 4, rows: 5}, layout: {columnWidths: {A: 180}, rowHeights: {}}}];
    app.openDocument(document, null, false); await fixture.whenStable();
    app.showSplit(); app.setSplitView(0, 'sheet'); app.setSplitView(1, 'sheet');
    app.setSplitSheet(1, 'Budget'); fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const panes = host.querySelectorAll('.workspace-pane');
    expect(panes[0].querySelectorAll('.column-header')).toHaveLength(2);
    expect(panes[1].querySelectorAll('.column-header')).toHaveLength(4);
    expect(panes[1].querySelector<HTMLElement>('.sheet-grid')!.style.gridTemplateColumns).toContain('180px');
    const leftCell = panes[0].querySelector<HTMLElement>('[data-cell-id="A1"]')!;
    leftCell.dispatchEvent(new Event('pointerdown', {bubbles: true})); leftCell.click(); fixture.detectChanges();
    expect(app.activeSheet()).toBe(''); expect(app.selectedId()).toBe('A1');
    app.addColumn(); fixture.detectChanges();
    expect(panes[0].querySelectorAll('.column-header')).toHaveLength(3);
    expect(panes[1].querySelectorAll('.column-header')).toHaveLength(4);
    expect(app.splitSheets()).toEqual(['', 'Budget']);
    app.graphThisSheet.set(true);
    const beforeZoom=app.workspacePanes();
    app.setPaneZoom(0, 1.3); fixture.detectChanges();
    const afterZoom=app.workspacePanes();
    for(let index=0;index<2;index++) for(const key of ['columns','rows','values','noteLinks','covered','graph']) expect(afterZoom[index][key]).toBe(beforeZoom[index][key]);
    expect(panes[0].querySelector('.sheet-area .zoom-overlay')?.textContent).toContain('130%');
    expect(panes[1].querySelector('.sheet-area .zoom-overlay')?.textContent).toContain('100%');
    const rightCell = panes[1].querySelector<HTMLElement>('[data-cell-id="Budget!A1"]')!;
    rightCell.dispatchEvent(new FocusEvent('focusin', {bubbles: true})); rightCell.click();
    expect(app.activeSheet()).toBe('Budget'); expect(app.selectedId()).toBe('Budget!A1');
    const ids = [...host.querySelectorAll<HTMLElement>('[id]')].map(element => element.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('can show the same sheet twice and keeps note selections and references independent', async () => {
    const fixture = createWithFinancialModel(); fixture.detectChanges(); await fixture.whenStable();
    const app = fixture.componentInstance as unknown as {
      openDocument(document: ReturnType<typeof createSheetDocument>, path: null, start: boolean): void;
      showSplit(): void; setSplitView(index: number, view: 'notes' | 'sheet'): void;
      setSplitSheet(index: number, sheet: string): void; selectSplitNote(id: string, index: number): void;
      updatePaneNote(index: number, source: string): void; activateSplitPane(index: number): void;
      cells(): CellDefinition[]; setPaneNoteZoom(index: number, value: number): void;
    };
    const document = createSheetDocument('Compare notes', 2, 3, [
      {id: 'A1', name: 'amount', kind: 'input', source: '10', enabled: true, trigger: 'auto'},
      {id: 'A2', kind: 'markdown', source: '# First note', enabled: true, trigger: 'auto'},
      {id: 'B2', kind: 'markdown', source: '# Other first-sheet note', enabled: true, trigger: 'auto'},
      {id: 'Budget!A1', name: 'amount', kind: 'input', source: '20', enabled: true, trigger: 'auto'},
      {id: 'Budget!A2', kind: 'markdown', source: '# Budget note', enabled: true, trigger: 'auto'},
    ]);
    document.sheets = [{name: 'Budget', grid: {columns: 2, rows: 3}, layout: {columnWidths: {}, rowHeights: {}}}];
    app.openDocument(document, null, false); await fixture.whenStable();
    app.showSplit(); app.setSplitView(1, 'notes'); app.setSplitSheet(1, 'Budget');
    fixture.detectChanges(); await fixture.whenStable();
    let editors = fixture.debugElement.queryAll(By.directive(MarkdownCellEditorComponent)).map(node => node.componentInstance as MarkdownCellEditorComponent);
    expect(editors.map(editor => editor.cellId)).toEqual(['A2', 'Budget!A2']);
    expect(editors[0].values.find(value => value.reference === 'amount')?.cellId).toBe('A1');
    expect(editors[1].values.find(value => value.reference === 'amount')?.cellId).toBe('Budget!A1');
    app.updatePaneNote(0, '# First edited'); app.updatePaneNote(1, '# Budget edited');
    app.activateSplitPane(0); fixture.detectChanges(); await fixture.whenStable();
    expect(app.cells().find(cell => cell.id === 'A2')?.source).toBe('# First edited');
    expect(app.cells().find(cell => cell.id === 'Budget!A2')?.source).toBe('# Budget edited');
    app.setSplitSheet(1, ''); app.selectSplitNote('B2', 1); app.setPaneNoteZoom(1, 1.4);
    fixture.detectChanges(); await fixture.whenStable();
    editors = fixture.debugElement.queryAll(By.directive(MarkdownCellEditorComponent)).map(node => node.componentInstance as MarkdownCellEditorComponent);
    expect(editors.map(editor => editor.source)).toEqual(['# First edited', '# Other first-sheet note']);
    expect(editors.map(editor => editor.zoom)).toEqual([1, 1.4]);
    app.setSplitView(0, 'sheet'); app.setSplitView(1, 'sheet'); fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelectorAll('.sheet-area')).toHaveLength(2);
    expect(host.querySelectorAll('[data-cell-id="A1"]')).toHaveLength(2);
  });

  it('retains the Cells DOM and scroll position when switching to Split and back', async () => {
    const fixture = createWithFinancialModel();
    const app = fixture.componentInstance as unknown as {
      viewMode: ReturnType<typeof signal<'sheet' | 'split'>>;
      showSplit(): void;
      setSplitView(index: number, kind: 'notes' | 'sheet' | 'graph'): void;
    };
    for (const slot of [1, 0]) {
      app.viewMode.set('split');
      app.setSplitView(slot, 'sheet');
      app.setSplitView(1 - slot, 'notes');
      app.viewMode.set('sheet');
      fixture.detectChanges();
      const grid = fixture.nativeElement.querySelector('.sheet-grid');
      const scroll = fixture.nativeElement.querySelector('.sheet-scroll');
      scroll.scrollLeft = 240;
      app.showSplit();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.sheet-grid')).toBe(grid);
      expect(fixture.nativeElement.querySelector('.sheet-scroll').scrollLeft).toBe(240);
      app.viewMode.set('sheet');
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.sheet-grid')).toBe(grid);
    }
  });

  it('keeps each worksheet grid size when the sheets are reordered', async () => {
    const fixture = createWithFinancialModel(); fixture.detectChanges(); await fixture.whenStable();
    const app = fixture.componentInstance as unknown as {
      openDocument(document: ReturnType<typeof createSheetDocument>, path: null, start: boolean): void;
      reorderSheets(names: string[]): void; switchSheet(prefix: string): void;
      columns(): readonly string[]; rows(): readonly number[];
    };
    const document = createSheetDocument('Sizes', 2, 3, FINANCIAL_CELLS);
    document.sheetName = 'Main';
    document.sheets = [{name: 'Budget', grid: {columns: 4, rows: 5}, layout: {columnWidths: {}, rowHeights: {}}}];
    app.openDocument(document, null, false); await fixture.whenStable();
    const size = () => [app.columns().length, app.rows().length];
    expect(size()).toEqual([2, 3]);
    // Main is active while Budget moves to the front (and becomes the plain-id sheet).
    app.reorderSheets(['Budget', 'Main']);
    expect(size()).toEqual([2, 3]);
    app.switchSheet('');
    expect(size()).toEqual([4, 5]);
    app.switchSheet('Main');
    expect(size()).toEqual([2, 3]);
    // And back, now with the first sheet active.
    app.switchSheet('');
    app.reorderSheets(['Main', 'Budget']);
    expect(size()).toEqual([4, 5]);
    app.switchSheet('');
    expect(size()).toEqual([2, 3]);
  });

  it('deletes the first sheet: the next one takes its place, with its own size, in one undo step', async () => {
    const fixture = createWithFinancialModel(); fixture.detectChanges(); await fixture.whenStable();
    const app = fixture.componentInstance as unknown as {
      openDocument(document: ReturnType<typeof createSheetDocument>, path: null, start: boolean): void;
      sheetMenu: ReturnType<typeof signal<{ x: number; y: number; prefix: string } | null>>;
      sheetName(): string; extraSheets(): readonly string[]; switchSheet(prefix: string): void;
      cells(): CellDefinition[]; columns(): readonly string[]; rows(): readonly number[]; undo(): void;
    };
    const document = createSheetDocument('Sheets', 2, 3, FINANCIAL_CELLS);
    document.sheetName = 'Main';
    document.cells = [...document.cells, { id: 'Budget!B2', kind: 'input', source: '5', name: 'rent', enabled: true, trigger: 'auto' }];
    document.sheets = [{name: 'Budget', grid: {columns: 4, rows: 5}, layout: {columnWidths: {}, rowHeights: {}}}];
    app.openDocument(document, null, false); await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;

    app.sheetMenu.set({ x: 0, y: 0, prefix: '' }); fixture.detectChanges();
    const remove = [...host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(b => b.textContent?.includes('Delete sheet'));
    expect(remove).toBeDefined();
    remove!.click(); fixture.detectChanges();
    expect(host.querySelector('#delete-sheet-title')?.textContent).toContain('Main');
    (host.querySelector('.close-prompt .danger-button') as HTMLButtonElement).click(); fixture.detectChanges();

    expect([app.sheetName(), ...app.extraSheets()]).toEqual(['Budget']);
    expect(app.cells().map(cell => cell.id)).toEqual(['B2']); // Main's cells are gone, Budget's are plain
    app.switchSheet('');
    expect([app.columns().length, app.rows().length]).toEqual([4, 5]);

    app.undo(); fixture.detectChanges();
    expect([app.sheetName(), ...app.extraSheets()]).toEqual(['Main', 'Budget']);
    expect(app.cells().some(cell => cell.id === 'Budget!B2')).toBe(true);
    expect(app.cells().filter(cell => !cell.id.includes('!')).length).toBe(FINANCIAL_CELLS.length);
  });

  it('keeps split worksheets attached through renaming, reordering, deleting, and swapping', async () => {
    const fixture = createWithFinancialModel(); fixture.detectChanges(); await fixture.whenStable();
    const app = fixture.componentInstance as unknown as {
      openDocument(document: ReturnType<typeof createSheetDocument>, path: null, start: boolean): void;
      showSplit(): void; setSplitSheet(index: number, sheet: string): void;
      renameSheet(prefix: string, name: string): void; reorderSheets(names: string[]): void;
      deleteSheet(prefix: string): void; toggleSplitSides(): void; splitSheets(): readonly string[];
    };
    const document = createSheetDocument('Compare', 2, 3, FINANCIAL_CELLS);
    document.sheetName = 'Main';
    document.sheets = [{name: 'Budget', grid: {columns: 2, rows: 3}, layout: {columnWidths: {}, rowHeights: {}}}];
    app.openDocument(document, null, false); await fixture.whenStable();
    app.showSplit(); app.setSplitSheet(1, 'Budget');
    app.renameSheet('Budget', 'Costs'); expect(app.splitSheets()).toEqual(['', 'Costs']);
    app.reorderSheets(['Costs', 'Main']); expect(app.splitSheets()).toEqual(['Main', '']);
    app.toggleSplitSides(); expect(app.splitSheets()).toEqual(['', 'Main']);
    app.deleteSheet('Main'); expect(app.splitSheets()).toEqual(['', '']);
  });

  it('shows a note and spreadsheet side by side', async () => {
    const fixture = createWithFinancialModel();
    fixture.detectChanges();
    await fixture.whenStable();
    (fixture.componentInstance as unknown as { setWorkbookEditing(value: boolean): void }).setWorkbookEditing(true); // the formula bar is an edit-mode tool
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    switchView(compiled, 'Split');
    fixture.detectChanges();

    expect(compiled.querySelector('.pane-workspace')).not.toBeNull();
    expect(compiled.querySelector('.workspace')?.classList).toContain('split-workspace');
    expect(compiled.querySelector('.workspace')?.classList).not.toContain('markdown-reading');
    expect(getComputedStyle(compiled.querySelector('.app-shell') as HTMLElement).overflow).toBe(
      'hidden',
    );
    expect(
      getComputedStyle(compiled.querySelector('.formula-code-editor') as HTMLElement).minWidth,
    ).toBe('0px');
    expect(compiled.querySelector('app-markdown-cell-editor')).not.toBeNull();
    const divider = compiled.querySelector('.split-resize-handle') as HTMLElement;
    expect(divider).not.toBeNull();
    divider.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
    );
    fixture.detectChanges();
    expect(
      (compiled.querySelector('.pane-workspace') as HTMLElement).style.gridTemplateColumns,
    ).toContain('52fr');
    expect(compiled.querySelectorAll('.sheet-cell')).toHaveLength(160);

    const swapSides = compiled.querySelector(
      'button[aria-label="Swap workspace panes"]',
    ) as HTMLButtonElement;
    swapSides.click();
    fixture.detectChanges();
    expect(compiled.querySelector('.workspace-pane')?.getAttribute('aria-label')).toBe('Cells pane');

    (compiled.querySelector('[data-cell-id="A1"]') as HTMLElement).click();
    fixture.detectChanges();
    expect(compiled.querySelector('.workspace')?.classList).not.toContain('inspector-open'); // on demand
    (compiled.querySelector('#inspector-toggle') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(compiled.querySelector('app-markdown-cell-editor')?.textContent).toContain(
      'Financial snapshot',
    );
    expect(compiled.querySelector('.workspace')?.classList).toContain('split-workspace');
    expect(compiled.querySelector('.workspace')?.classList).toContain('inspector-open');
    expect(compiled.querySelector('.inspector')?.classList).not.toContain('workspace-hidden');
    (compiled.querySelector('.inspector-close') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(compiled.querySelector('.inspector')?.classList).toContain('workspace-hidden');
  });

  it('supports cross-platform workspace keyboard shortcuts', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: '2', ctrlKey: true, bubbles: true, cancelable: true }),
    );
    fixture.detectChanges();
    expect(compiled.querySelector('.workspace')?.classList).toContain('split-workspace');

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: ',', metaKey: true, bubbles: true, cancelable: true }),
    );
    fixture.detectChanges();
    expect(compiled.querySelector('.settings-dialog')).not.toBeNull();
  });

  it('lists and previews generated cell artifacts', async () => {
    const fixture = createWithFinancialModel();
    fixture.detectChanges();
    await fixture.whenStable();
    await (fixture.componentInstance as unknown as { startWorkbook(): Promise<void> }).startWorkbook();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const artifactsButton = [
      ...compiled.querySelectorAll<HTMLButtonElement>('.top-actions button'),
    ].find((button) => button.textContent?.includes('Artifacts'));
    expect(artifactsButton?.textContent).toContain('(1)');
    artifactsButton?.click();
    fixture.detectChanges();

    expect(compiled.querySelector('.artifacts-panel')).not.toBeNull();
    expect(compiled.querySelector('.artifact-card img')?.getAttribute('src')).toBe(
      'data:image/png;base64,iVBORw0KGgo=',
    );
    expect(compiled.querySelector('.artifact-card')?.textContent).toContain('forecast.png');
    switchView(compiled, 'Cells');
    fixture.detectChanges();
    expect(compiled.querySelector('#cell-E1 .artifact-cell-preview')).not.toBeNull();
  });
  it('keeps occupied tiles and cell drafts inside resized sheet dimensions', () => {
    const fixture = createWithFinancialModel();
    const app = fixture.componentInstance as unknown as { cells: ReturnType<typeof signal<CellDefinition[]>>; cellDrafts: ReturnType<typeof signal<Map<string, unknown>>>; resizeSheetExtent: (extent: {columns: number; rows: number}) => void; columns: () => string[]; rows: () => number[] };
    app.cells.set([{id: 'D7', kind: 'input', source: '1', enabled: true, trigger: 'auto', view: {span: [2, 3]}}]);
    app.cellDrafts.set(new Map([['H12', {source: 'pending'}]]));
    app.resizeSheetExtent({columns: 1, rows: 1});
    expect(app.columns()).toHaveLength(8); expect(app.rows()).toHaveLength(12);
  });

  it('profiles individual cells only when the device setting is enabled', async () => {
    const fixture = createWithFinancialModel(); fixture.detectChanges();
    const runtime = TestBed.inject(RuntimeService) as unknown as RuntimeServiceStub;
    const app = fixture.componentInstance as unknown as {setShowCellMemory: (enabled: boolean) => void; cellMemory: () => CellMemoryReport};
    expect(runtime.cellMemoryCalls).toBe(0);
    app.setShowCellMemory(true); fixture.detectChanges();
    await vi.waitFor(() => { fixture.detectChanges(); expect(runtime.cellMemoryCalls).toBeGreaterThan(0); }, {timeout: 5000});
    expect(app.cellMemory()['A1'].bytes).toBe(1024);
    app.setShowCellMemory(false); fixture.detectChanges();
    expect(app.cellMemory()).toEqual({});
  });
  it('preserves the input saving preference through source edits and selection changes', async () => {
    const fixture = createWithFinancialModel(); fixture.detectChanges(); await fixture.whenStable();
    const app = fixture.componentInstance as unknown as {
      cells: ReturnType<typeof signal<CellDefinition[]>>;
      viewMode: ReturnType<typeof signal<string>>;
      editorSource: string;
      selectCell(id: string): void; setInspectorVisible(visible: boolean): void; applyCell(): void;
      currentDraftDocument(): SheetDocument;
    };
    app.viewMode.set('sheet'); app.setInspectorVisible(true); app.selectCell('A1');
    fixture.detectChanges(); await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const checkbox = () => root.querySelector<HTMLInputElement>('#save-input-value')!;
    expect(checkbox().checked).toBe(true);
    checkbox().checked = false; checkbox().dispatchEvent(new Event('change'));
    fixture.detectChanges(); await fixture.whenStable();
    expect(app.cells().find(cell => cell.id === 'A1')?.saveValue).toBe(false);
    app.editorSource = '[]'; app.applyCell();
    fixture.detectChanges(); await fixture.whenStable();
    app.selectCell('A2'); fixture.detectChanges(); await fixture.whenStable();
    app.selectCell('A1'); fixture.detectChanges(); await fixture.whenStable();
    expect(checkbox().checked).toBe(false);
    expect(app.currentDraftDocument().cells.find(cell => cell.id === 'A1')?.saveValue).toBe(false);
    checkbox().checked = true; checkbox().dispatchEvent(new Event('change'));
    fixture.detectChanges(); await fixture.whenStable();
    expect(app.currentDraftDocument().cells.find(cell => cell.id === 'A1')?.saveValue).toBeUndefined();
    fixture.destroy();
  });

  it('restores the configured button action after applying and reselecting its cell', async () => {
    const fixture = createWithFinancialModel(); fixture.detectChanges(); await fixture.whenStable();
    const app = fixture.componentInstance as unknown as {
      cells: ReturnType<typeof signal<CellDefinition[]>>;
      actionDefinitions: ReturnType<typeof signal<import('./sheet.types').ActionDefinition[]>>;
      viewMode: ReturnType<typeof signal<string>>;
      selectCell(id: string): void; setInspectorVisible(visible: boolean): void; applyCell(): void;
    };
    const runtime = TestBed.inject(RuntimeService) as unknown as RuntimeServiceStub;
    const run = vi.fn(); Object.assign(runtime, {runAction: run});
    app.actionDefinitions.set(['first', 'second'].map(name => ({
      name, label: name, source: `def ${name}(self):\n    pass`, references: {}, bindings: {}, exposed: true,
    })));
    app.cells.update(cells => cells.map(cell => cell.id === 'A1' ? {
      ...cell, view: {widget: {type: 'button', buttonMode: 'action', action: 'first'}},
    } : cell));
    app.viewMode.set('sheet'); app.setInspectorVisible(true); app.selectCell('A1');
    fixture.detectChanges(); await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const actionSelect = () => [...root.querySelectorAll<HTMLLabelElement>('#cell-inspector .tile-widget-setting')]
      .find(label => label.firstChild?.textContent?.trim() === 'Action')!.querySelector('select')!;
    actionSelect().value = 'second'; actionSelect().dispatchEvent(new Event('change'));
    fixture.detectChanges(); await fixture.whenStable();
    app.applyCell(); fixture.detectChanges(); await fixture.whenStable();
    expect(app.cells().find(cell => cell.id === 'A1')?.view?.widget?.action).toBe('second');
    app.selectCell('A2'); fixture.detectChanges(); await fixture.whenStable();
    app.selectCell('A1'); fixture.detectChanges(); await fixture.whenStable();
    expect(app.cells().find(cell => cell.id === 'A1')?.view?.widget?.action).toBe('second');
    expect(actionSelect().value).toBe('second');
    app.actionDefinitions.update(actions => [...actions, {
      ...actions[0], name: 'third', label: 'Third', source: 'def third(self):\n    pass',
    }]);
    fixture.detectChanges(); await fixture.whenStable();
    expect(actionSelect().value).toBe('second');
    expect(run).not.toHaveBeenCalled();
    fixture.destroy();
  });

  async function actionSaveSetup() {
    const fixture = TestBed.createComponent(App); fixture.detectChanges(); await fixture.whenStable();
    const app = fixture.componentInstance as unknown as {
      actionDefinitions: ReturnType<typeof signal<import('./sheet.types').ActionDefinition[]>>;
      actionWorkspacePanel: ActionPanelComponent;
      saveSheet(): Promise<void>; saveAction(definition: import('./sheet.types').ActionDefinition): Promise<void>;
      invokeAction(event: {name: string; arguments: {}}): Promise<void>;
      actionError(): string; actionApplied(): import('./sheet.types').ActionDefinition | null;
      actionRunnerOpen(): boolean;
      actionsOpen: ReturnType<typeof signal<boolean>>;
      saving(): boolean; saveFailure(): {details: string[]; actions?: string[]} | null;
    };
    const original = {name: 'one', source: 'def one(self):\n    return 1', label: 'One', references: {}, bindings: {}, exposed: true};
    const second = {...original, name: 'two', source: 'def two(self):\n    return 2'};
    app.actionDefinitions.set([original, second]);
    const panel = new ActionPanelComponent();
    panel.enabled = true; panel.definitions = [original, second]; panel.selected = 'one'; panel.edit();
    app.actionWorkspacePanel = panel;
    const runtime = TestBed.inject(RuntimeService) as unknown as RuntimeServiceStub;
    const download = vi.spyOn(TestBed.inject(WorkbookFileService), 'downloadBrowser').mockImplementation(() => undefined);
    return {fixture, app, panel, runtime, download, original};
  }

  it('applies visible, stashed and new actions before saving without running them or rebuilding inputs', async () => {
    const {fixture, app, panel, runtime, download} = await actionSaveSetup();
    const update = vi.spyOn(runtime, 'updateAction');
    const run = vi.fn(); Object.assign(runtime, {runAction: run});
    const evaluations = runtime.applyCalls.length;
    panel.draftSource = 'def one(self):\n    return 41';
    panel.choose('two'); panel.edit(); panel.draftSource = 'def two(self):\n    return 42';
    panel.create(); panel.draftSource = 'async def three(self):\n    return 43';
    await app.saveSheet();
    expect(update).toHaveBeenCalledTimes(3);
    expect(run).not.toHaveBeenCalled();
    expect(runtime.applyCalls.length).toBe(evaluations);
    const source = String(download.mock.calls[0][0]);
    expect(source).toContain('return 41'); expect(source).toContain('return 42'); expect(source).toContain('return 43');
    expect(app.actionDefinitions().find(item => item.name === 'one')?.source).toContain('return 41');
    expect(app.saveFailure()).toBeNull();
    fixture.destroy();
  });

  it('waits for an already submitted action Apply before saving its confirmed definition', async () => {
    const {fixture, app, panel, runtime, download, original} = await actionSaveSetup();
    panel.draftSource = 'def one(self):\n    return 42';
    const edited = {...original, source: panel.draftSource};
    let finish!: () => void;
    const held = new Promise<void>(resolve => {finish = resolve;});
    const update = vi.spyOn(runtime, 'updateAction').mockImplementation(async definition => {
      await held; return {...graph, appliedAction: definition};
    });
    const applying = app.saveAction(edited);
    await vi.waitFor(() => expect(update).toHaveBeenCalledOnce());
    const saving = app.saveSheet();
    await Promise.resolve();
    expect(download).not.toHaveBeenCalled(); expect(app.saving()).toBe(true);
    finish(); await applying; await saving;
    expect(update).toHaveBeenCalledOnce();
    expect(String(download.mock.calls[0][0])).toContain('return 42');
    fixture.destroy();
  });

  it('preserves a failed action draft, identifies the method, and retries Save without restarting', async () => {
    const {fixture, app, panel, runtime, download} = await actionSaveSetup();
    panel.draftSource = 'def one(self):\n    return 42';
    const update = vi.spyOn(runtime, 'updateAction').mockRejectedValueOnce(new Error('Action one, line 2: syntax problem\n> 2: return 42'));
    await app.saveSheet();
    expect(download).not.toHaveBeenCalled(); expect(app.saving()).toBe(false);
    expect(app.saveFailure()?.details.join(' ')).toContain('Action one, line 2');
    expect(app.saveFailure()?.actions).toEqual(['one']);
    expect(app.actionDefinitions()[0].source).toContain('return 1');
    expect(panel.draftSource).toContain('return 42');
    update.mockImplementation(async definition => ({...graph, appliedAction: definition}));
    await app.saveSheet();
    expect(download).toHaveBeenCalled(); expect(app.saveFailure()).toBeNull();
    expect(runtime.restartCalls).toHaveLength(0);
    fixture.destroy();
  });

  it('saves action drafts through static validation while the execution kernel is disconnected', async () => {
    const {fixture, app, panel, runtime, download} = await actionSaveSetup();
    runtime.status.set('error'); runtime.error.set('Device kernel disconnected');
    panel.draftSource = 'async def one(self):\n    return 42';
    const update = vi.spyOn(runtime, 'updateAction');
    await app.saveSheet();
    expect(update).not.toHaveBeenCalled();
    expect(String(download.mock.calls[0][0])).toContain('async def one(self):');
    expect(app.actionDefinitions()[1].source).toContain('return 42');
    expect(runtime.status()).toBe('error');
    fixture.destroy();
  });

  it('refuses to save invalid offline action code and points back to its action editor', async () => {
    const {fixture, app, panel, runtime, download} = await actionSaveSetup();
    runtime.status.set('error'); panel.draftSource = 'def one(self):\n    if True';
    await app.saveSheet();
    expect(download).not.toHaveBeenCalled();
    expect(app.saveFailure()?.details.join(' ')).toContain('Action one, line 2');
    expect(app.saveFailure()?.actions).toEqual(['one']);
    expect(panel.hasUnappliedDrafts).toBe(true); expect(app.saving()).toBe(false);
    fixture.destroy();
  });

  it('keeps stale-action feedback in the Actions workspace instead of opening the runner', async () => {
    const {fixture, app, panel, runtime} = await actionSaveSetup();
    app.actionsOpen.set(true);
    panel.draftSource = 'def one(self):\n    return 42';
    const run = vi.fn(); Object.assign(runtime, {runAction: run});
    await app.invokeAction({name: 'one', arguments: {}});
    expect(run).not.toHaveBeenCalled();
    expect(app.actionError()).toContain('Apply the edits or save the workbook first');
    expect(app.actionsOpen()).toBe(true);
    expect(app.actionRunnerOpen()).toBe(false);
    fixture.destroy();
  });

  it('refuses to run the installed action while newer action drafts are open', async () => {
    const {fixture, app, panel, runtime} = await actionSaveSetup();
    panel.draftSource = 'def one(self):\n    return 42';
    const run = vi.fn(); Object.assign(runtime, {runAction: run});
    await app.invokeAction({name: 'one', arguments: {}});
    expect(run).not.toHaveBeenCalled();
    expect(app.actionError()).toContain('Apply the edits or save the workbook first');
    expect(app.actionRunnerOpen()).toBe(true);
    fixture.destroy();
  });

});

describe('linked note images', () => {
  const results = new Map<string, CellResult>([
    [
      'C1',
      {
        id: 'C1',
        display: 'Plot',
        value: null,
        valueType: 'rich-output',
        error: null,
        richOutput: { mimeType: 'image/png', dataBase64: 'cG5n' },
      },
    ],
  ]);

  it('embeds referenced plots into Markdown for copying', () => {
    expect(embedCellImages('# A\n\n![Plot](#cell-C1) ![Plot](#cell-Z9)', results)).toBe(
      '# A\n\n![Plot](data:image/png;base64,cG5n) ![Plot](#cell-Z9)',
    );
  });

  it('embeds HTML output as sanitised HTML', () => {
    const html = new Map(results);
    html.set('D1', {
      id: 'D1', display: 'HTML', value: null, valueType: 'rich-output', error: null,
      richOutput: { mimeType: 'text/html', dataBase64: btoa('<b onclick="x()">Board</b>') },
    });
    expect(embedCellImages('Before ![HTML](#cell-D1) after', html)).toBe(
      'Before \n\n<div class="html-output"><b>Board</b></div>\n\n after',
    );
  });

  it('embeds referenced plots into rendered HTML', () => {
    expect(embedCellImageSources('<p><img src="#cell-C1" alt="Plot"></p>', results)).toBe(
      '<p><img src="data:image/png;base64,cG5n" alt="Plot"></p>',
    );
  });
});

describe('literal input values without running Python', () => {
  it('reads numbers, booleans, None, and quoted strings from input sources', () => {
    const read = (source: string) => literalInputResult({ id: 'A1', source });
    expect(read('548_000')).toMatchObject({ value: 548000, display: '548000', valueType: 'int' });
    expect(read('0.25')).toMatchObject({ value: 0.25, valueType: 'float' });
    expect(read('True')).toMatchObject({ value: true, display: 'True', valueType: 'bool' });
    expect(read('None')).toMatchObject({ value: null, display: '' });
    expect(read('"Sep"')).toMatchObject({ value: 'Sep', display: 'Sep', error: null });
    expect(read('[1, 2]')).toMatchObject({ value: null, valueType: 'unknown' });
    expect(read('make_state()')).toMatchObject({ value: null, valueType: 'unknown' });
  });
});

describe('python error messages', () => {
  it('shows the reason, not the traceback', () => {
    const traceback = new Error(
      'Traceback (most recent call last):\n  File "model.py", line 314\nValueError: The selection would overwrite cells: A3\n',
    );
    expect(pythonErrorMessage(traceback)).toBe('The selection would overwrite cells: A3');
    expect(pythonErrorMessage('plain message')).toBe('plain message');
  });
});

describe('App start', () => {
  it.each([true, false])('offers the guide for a new CLI workbook only (new=%s) and shows it as saved', async isNew => {
    localStorage.clear();
    history.replaceState(null, '', `/?session=${encodeURIComponent('http://127.0.0.1:8765')}${isNew ? '&new=1' : ''}#token=t`);
    const runtime = new RuntimeServiceStub() as RuntimeServiceStub & {
      attachSession(): Promise<unknown>; monitorSession(): () => void;
    };
    const document = createSheetDocument('untitled', 2, 2, [
      {id: 'A1', kind: 'markdown', source: '# New workbook', enabled: true, trigger: 'auto'},
    ]);
    runtime.attachSession = async () => ({revision: 1, mode: 'edit', document, graph});
    runtime.monitorSession = () => () => {};
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [{ provide: RuntimeService, useValue: runtime }],
    }).compileComponents();
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('app-getting-started') !== null).toBe(isNew);
    if (isNew) {
      // Examples open in a new tab there; the hint shows how to copy one next to the file.
      expect(compiled.querySelector('app-getting-started .example-hint')?.textContent).toContain('reaktiv-workbook new --from');
    }
    // The file is on disk already: the CLI wrote it before the editor opened.
    expect(compiled.querySelector('.document-save-state')?.textContent?.trim()).toBe('Saved');
    fixture.destroy(); history.replaceState(null, '', '/');
  });

  it('starts with a blank project and offers the examples in the first-run guide', async () => {
    localStorage.clear();
    const runtime = new RuntimeServiceStub();
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [{ provide: RuntimeService, useValue: runtime }],
    }).compileComponents();
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('.document-name')?.textContent).toContain('Untitled workbook');
    expect(runtime.applyCalls.at(-1)?.cells.map((cell) => cell.kind)).toEqual(['markdown']);
    const examples = [...compiled.querySelectorAll('app-getting-started .example strong')].map(
      (title) => title.textContent,
    );
    // Grouped from a first look to complete apps, starting with the welcome workbook.
    expect(examples[0]).toBe('Welcome to Reaktiv Workbook');
    expect([...compiled.querySelectorAll('app-getting-started .example-level')].map(level => level.textContent))
      .toEqual(['Start here', 'Simple', 'Useful', 'Impressive']);
    expect(compiled.querySelector('app-getting-started footer')?.textContent).toContain(
      'Explore on my own',
    );

    // The notes list folds away to a narrow rail and comes back.
    (compiled.querySelector('app-getting-started footer button:first-child') as HTMLButtonElement).click();
    fixture.detectChanges();
    (compiled.querySelector('.collapse-notes-button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(compiled.querySelector('.notes-sidebar.collapsed')).not.toBeNull();
    expect(compiled.querySelector('.note-list')).toBeNull();
    expect(localStorage.getItem('reaktiv-workbook:notes-sidebar-collapsed:v1')).toBe('true');
    (compiled.querySelector('.notes-sidebar.collapsed button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(compiled.querySelector('.note-list')).not.toBeNull();
  });
});

describe('Notes reading mode', () => {
  it('opens workbooks for reading and switches the whole worksheet to editing', async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [{ provide: RuntimeService, useValue: new RuntimeServiceStub() }],
    }).compileComponents();
    const fixture = createWithFinancialModel();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const app = fixture.componentInstance as unknown as { notesEditing: () => boolean; workbookEditing: () => boolean; viewMode: ReturnType<typeof signal<string>> };
    const editor = () =>
      fixture.debugElement.query(By.directive(MarkdownCellEditorComponent)).componentInstance as MarkdownCellEditorComponent;
    const button = () => compiled.querySelector('.notes-mode-button') as HTMLButtonElement;

    // A restored draft without a mode keeps editing (older drafts); an opened file reads.
    expect(app.notesEditing()).toBe(false);
    button().click();
    fixture.detectChanges();
    expect(app.notesEditing()).toBe(true);
    button().click();
    fixture.detectChanges();
    expect(app.notesEditing()).toBe(false);
    expect(button().textContent).toContain('View');
    expect(editor().readOnly).toBe(true);
    expect(editor().interactive).toBe(true); // widgets keep working while reading
    expect(compiled.querySelector('.note-sidebar-actions')).toBeNull();

    // Ctrl/Cmd+Shift+E switches back.
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'E', metaKey: true, shiftKey: true, bubbles: true }));
    fixture.detectChanges();
    expect(app.notesEditing()).toBe(true);
    expect(editor().readOnly).toBe(false);
    app.viewMode.set('split');fixture.detectChanges();
    expect(compiled.querySelectorAll('[aria-label="Workbook edit mode"]')).toHaveLength(1);
    button().click();fixture.detectChanges();
    expect(app.workbookEditing()).toBe(false);expect(editor().readOnly).toBe(true);
    // View mode shows no formula bar: editing tools appear only in edit mode.
    expect(compiled.querySelector('[aria-label="Apply cell"]')).toBeNull();
  });
});

describe('isExampleFile', () => {
  it('treats files in an examples folder (and its course folders) as templates', () => {
    expect(isExampleFile('/repo/examples/project-planner.workbook.py')).toBe(true);
    expect(isExampleFile('/repo/examples/education/motion.workbook.py')).toBe(true);
    expect(isExampleFile('C:\\work\\examples\\docs\\guide.workbook.py')).toBe(true);
    expect(isExampleFile('/Users/me/Documents/budget.sheet.py')).toBe(false);
    expect(isExampleFile('/Users/me/examples-of-mine/budget.sheet.py')).toBe(false);
    expect(isExampleFile(null)).toBe(false);
  });


});

