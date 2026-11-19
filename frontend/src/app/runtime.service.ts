import { updateTracingEnabled } from './feature-flags';
import { WorkerRequestChannel, type WorkerPayload } from './runtime/worker-request-channel';
import { HttpKernelTransport, RequestTooLargeError, KernelRequestError } from './runtime/http-kernel-transport';
import type { ActionBinding } from './sheet.types';
import type { EmbeddedSessionState } from './embedded-session';
import type { EditorQuery, EditorReply } from './editor-intelligence';
import { PerformanceDiagnostics } from './performance-diagnostics';
import { setPathPicker } from './widget-host';
import type { FolderListing } from './path-browser';
import { Injectable, signal } from '@angular/core';
import type {
  MoveCommandReply,
  ActionDefinition,
  CellDefinition,
  CellProgress,
  LogEntry,
  GraphResult,
  KernelKind,
  RuntimeRequest,
  RuntimeResponse,
  RuntimeStatus,
  ResourceUsage,
  ConsoleResult,
  CellMemoryReport,
  SheetDocument,
} from './sheet.types';

@Injectable({ providedIn: 'root' })
export class RuntimeService {
  readonly status = signal<RuntimeStatus>('idle');
  readonly statusMessage = signal('Runtime not started');
  readonly error = signal<string | null>(null);
  readonly kernel = signal<KernelKind>('pyodide');
  readonly attachedSession = signal(false);
  private readonly http: HttpKernelTransport;
  private sessionRevision = 0;
  private workbookRevision: string | null = null;
  private receiptEpoch = "";
  private receiptSequence = 0;
  private readonly cellReceiptSequences = new Map<string, number>();
  private readonly actionRuns = new Set<string>();
  private actionInputTail: Promise<unknown> = Promise.resolve();
  private moveNeedsReview=false;
  private synchronizedCells: CellDefinition[] | null = null;
  private synchronizedMetadata = '';

  readonly usage = signal<ResourceUsage | null>(null);
  readonly consoleSession = signal(0);
  private usageGeneration = 0;

  private readonly channel: WorkerRequestChannel;
  private readonly enableUpdateTracing = updateTracingEnabled();
  private initialization: Promise<void> | null = null;
  private packages: string[] = [];
  get configuredPackages(): readonly string[] { return this.packages; }
  private variables: Record<string, string> = {};
  private remoteUrl = 'http://127.0.0.1:8765';
  /** Bearer token of the CLI session (or a remote kernel that requires one). */
  private kernelToken: string | null = null;
  /**
   * Cells stopped for running too long. Sent with every update so they do not run
   * (and hang) again; Python reports the ones it interrupted. Released when the cell changes
   * or is run again.
   */
  readonly stoppedCells = signal<ReadonlySet<string>>(new Set());
  private readonly logListeners = new Set<(entry: LogEntry) => void>();
  private readonly progressListeners = new Set<(progress: CellProgress) => void>();
  private readonly snapshotListeners = new Set<(graph: GraphResult) => void>();

  constructor(private readonly diagnostics: PerformanceDiagnostics = new PerformanceDiagnostics()) {
    this.channel = new WorkerRequestChannel(this.diagnostics, {
      event: response => this.handleEvent(response),
      result: response => this.handleResult(response),
      refused: (type, error) => {
        if (!['move-cells', 'move-workbook', 'console', 'cell-memory', 'update-action', 'action-inputs', 'set-inputs', 'run-action'].includes(type)) {
          this.status.set('error'); this.error.set(error.message);
        }
      },
      failed: error => { this.status.set('error'); this.error.set(error.message); },
    });
    this.http = new HttpKernelTransport(
      () => ({url: this.remoteUrl, token: this.kernelToken,
        ...(this.attachedSession() ? {sessionRevision: this.sessionRevision} : {})}),
      this.diagnostics, event => this.emitProgress(event), entry => this.emitLog(entry),
      graph => this.emitSnapshot(graph),
    );
    if (typeof Worker === 'undefined') {
      this.status.set('error');
      this.error.set('Web Workers are not available in this browser.');
      return;
    }

    this.channel.start();
  }

  async runConsole(source: string, sheet: string): Promise<ConsoleResult> {
    const generation = this.usageGeneration;
    this.status.set('running');
    this.statusMessage.set('Running Python console');
    try {
      return (this.usesHttpKernel()
        ? await this.sideRequest('/v1/console', {source, sheet})
        : await this.request('console', undefined, {source, sheet})) as ConsoleResult;
    } finally {
      if (generation === this.usageGeneration && this.status() === 'running') {
        this.status.set('ready');
        this.statusMessage.set('Python console finished');
      }
    }
  }

  async interruptConsole(): Promise<void> {
    if (this.usesHttpKernel()) await this.sideRequest('/v1/interrupt', {});
  }

  async cellMemory(): Promise<CellMemoryReport> {
    return (this.usesHttpKernel()
      ? await this.sideRequest('/v1/cell-memory', {}, AbortSignal.timeout(5000))
      : await this.request('cell-memory')) as CellMemoryReport;
  }

  /** Passive language-server request; never starts or marks the kernel as running. */
  async editor(document: SheetDocument, sheet: string, query: EditorQuery): Promise<EditorReply | null> {
    if (!this.usesHttpKernel() || !['ready', 'running'].includes(this.status())) return null;
    try {
      return await this.sideRequest('/v1/editor', {document, sheet, ...query}, AbortSignal.timeout(55000)) as EditorReply;
    } catch { return null; }
  }

  memoryDiagnostics():object {
    return {kind:this.kernel(),status:this.status(),usage:this.usage(),
      executionWorkerActive:this.channel.active,pendingRequests:this.channel.pendingCount,
      synchronizedSourceChars:this.synchronizedCells?.reduce((n,c)=>n+c.source.length,0) ?? 0,
      scope:this.kernel()==='remote' ? 'Python kernel process, not this page' : 'Kernel only, excludes UI and child processes',
      usageFreshness:'Last successful status-bar sample; may be absent or stale when hidden'};
  }

  /** Observe only a running workbook; never start Python just to measure it. */
  monitorUsage(isRunning: () => boolean): () => void {
    let active = true;
    let busy = false;
    const poll = async () => {
      if (!active || busy) return;
      if (!isRunning()) { this.usage.set(null); return; }
      if (document.visibilityState !== 'visible' || !this.usesHttpKernel()) return;
      busy = true;
      try { await this.refreshUsage(() => active && isRunning()); }
      finally { busy = false; }
    };
    const timer = window.setInterval(() => void poll(), 2000);
    return () => { active = false; window.clearInterval(timer); this.resetUsage(); };
  }

  /** A separate request keeps measurements responsive during cell execution. */
  async refreshUsage(isCurrent: () => boolean = () => true): Promise<void> {
    if (!this.usesHttpKernel() || !['ready', 'running'].includes(this.status())) return;
    const generation = this.usageGeneration;
    try {
      const value = await this.sideRequest('/v1/usage', {}, AbortSignal.timeout(1800));
      if (generation === this.usageGeneration && isCurrent()) {
        this.usage.set(isResourceUsage(value) ? value : null);
      }
    } catch {
      if (generation === this.usageGeneration && isCurrent()) this.usage.set(null);
    }
  }

  private resetUsage(): void {
    this.http.invalidate();
    this.workbookRevision = null;
    this.receiptEpoch = "";
    this.receiptSequence = 0;
    this.cellReceiptSequences.clear();
    this.actionRuns.clear();
    this.actionInputTail = Promise.resolve();
    this.moveNeedsReview=false;
    this.synchronizedCells = null;
    this.synchronizedMetadata = "";
    this.consoleSession.update(value => value + 1);
    this.usageGeneration++;
    this.usage.set(null);
  }

  private httpKernelLabel(): string {
    return this.attachedSession() ? 'Python session' : 'Remote Python';
  }

  /** CLI sessions and remote kernels speak the same HTTP API. */
  private usesHttpKernel(): boolean {
    return this.kernel() === 'remote';
  }

  initialize(): Promise<void> {
    if (this.initialization !== null) {
      return this.initialization;
    }

    this.status.set('loading');
    this.statusMessage.set('Loading Python runtime');
    this.initialization = this.request('initialize', undefined, {
      packages: this.packages,
    }).then(() => undefined);
    return this.initialization;
  }

  /**
   * Problems that would make `source` (a file about to be saved) differ from `document`
   * when Python loads it; empty when it loads back the same (model.verify_written_document).
   */
  async verifyDocument(source: string, document: SheetDocument): Promise<string[]> {
    const result: unknown = this.usesHttpKernel()
      ? await this.remoteRequest<unknown>('/v1/verify-document', { source, document })
      : await this.request('verify-document', undefined, { source, document });
    if (!Array.isArray(result) || !result.every((problem) => typeof problem === 'string')) {
      throw new Error('The Python runtime returned no check result.');
    }
    return result;
  }

  async inspectDocument(source: string): Promise<SheetDocument> {
    if (this.usesHttpKernel()) {
      return this.remoteRequest<SheetDocument>('/v1/inspect-document', { source });
    }
    await this.initialize();
    this.statusMessage.set('Inspecting Python workbook');
    const result = await this.request('inspect-document', undefined, { source });
    if (!isSheetDocument(result)) {
      throw new Error('The Python runtime returned no workbook document.');
    }
    this.status.set('ready');
    this.statusMessage.set('Python workbook inspected');
    return result;
  }

  async apply(
    cells: CellDefinition[],
    imports: string[] = [],
    sheets?: string[],
    code = '',
    allowCellWrites = true,
    document?: SheetDocument,
  ): Promise<GraphResult> {
    const remembered = cells.map(cell => ({...cell, view:cell.view ? structuredClone(cell.view) : undefined}));
    const metadata = this.moveMetadata(imports,sheets,code,document);
    const syncGeneration = this.usageGeneration;
    const remember = (result:GraphResult) => {
      if (syncGeneration !== this.usageGeneration) return;
      this.moveNeedsReview=false;
      this.synchronizedCells = mergeDefinitions(remembered,result.cellChanges);
      this.synchronizedMetadata = metadata;
    };
    if (this.usesHttpKernel()) {
      this.status.set('running');
      this.statusMessage.set('Evaluating on remote Python');
      const result = await this.remoteRequest<GraphResult>('/v1/apply', {
        enableUpdateTracing: this.enableUpdateTracing,
        cells,
        actions: document?.actions ?? [],
        ...(this.attachedSession() && document ? { document } : {}),
        sheets,
        ...(!allowCellWrites ? {allowCellWrites: false} : {}),
        variables: this.variables,
        imports,
        ...(code ? { code } : {}),
        stopped: [...this.stoppedCells()],
      });
      this.status.set(this.actionRuns.size ? 'running' : 'ready');
      this.statusMessage.set(this.actionRuns.size ? 'Actions running' : `${this.httpKernelLabel()} ready`);
      remember(result);
      return result;
    }
    await this.initialize();
    this.status.set('running');
    this.statusMessage.set('Evaluating reactive graph');
    const result = await this.request('apply', cells, {
      enableUpdateTracing: this.enableUpdateTracing,
      actions: document?.actions ?? [],
      variables: this.variables,
      imports,
      sheets,
      code,
      ...(!allowCellWrites ? {allowCellWrites: false} : {}),
      stopped: [...this.stoppedCells()],
    });
    if (!isGraphResult(result)) {
      throw new Error('The Python runtime returned no graph result.');
    }
    this.status.set('ready');
    this.statusMessage.set(
      result.rebuilt
        ? 'Graph initialized'
        : result.changed.length > 0
          ? `Updated ${result.changed.join(', ')} in place`
          : 'Graph is up to date',
    );
    remember(result);
    return result;
  }

  /**
   * The points of a resampled chart in its visible axis ranges (resample.py). Runs no
   * cells and leaves the status alone: it is asked on every zoom and pan.
   */
  async resample(token: string, ranges: Record<string, [unknown, unknown] | null>): Promise<ResampleView> {
    if (this.usesHttpKernel()) {
      const response = await fetch(`${this.remoteUrl}/v1/resample`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.kernelToken ? { Authorization: `Bearer ${this.kernelToken}` } : {}),
        },
        body: JSON.stringify({ token, ranges }),
      });
      const value = (await response.json()) as ResampleView & { error?: string };
      if (!response.ok) throw new Error(value.error ?? `Resampling failed (${response.status})`);
      return value;
    }
    return (await this.request('resample', undefined, { token, ranges })) as unknown as ResampleView;
  }

  async updateAction(definition: ActionDefinition): Promise<GraphResult> {
    if (!this.workbookRevision) throw new Error('Start and synchronize the workbook before applying action edits.');
    const generation = this.usageGeneration;
    const payload = {definition, expectedRevision: this.workbookRevision};
    this.status.set('running'); this.statusMessage.set('Applying action edits');
    try {
      const result = this.usesHttpKernel()
        ? await this.remoteRequest<GraphResult>('/v1/update-action', payload)
        : await this.request('update-action', undefined, payload);
      if (generation !== this.usageGeneration) throw new Error('Python kernel changed during action apply.');
      if (!isGraphResult(result) || result.appliedAction?.name !== definition.name)
        throw new Error('The kernel did not confirm the action definition.');
      return result;
    } finally {
      if (generation === this.usageGeneration && this.status() !== 'error') {
        this.status.set('ready'); this.statusMessage.set('Python ready');
      }
    }
  }

  async runAction(name: string, arguments_: Record<string,ActionBinding>, runId: string = crypto.randomUUID()): Promise<GraphResult> {
    const generation = this.usageGeneration;
    this.actionRuns.add(runId);
    this.status.set('running'); this.statusMessage.set('Running action');
    try {
      const result = this.usesHttpKernel()
        ? await this.remoteRequest<GraphResult>('/v1/run-action', {name, arguments:arguments_, runId})
        : await this.request('run-action', undefined, {actionName:name, arguments:arguments_, runId}) as GraphResult;
      if (!isGraphResult(result)) throw new Error('The action returned no workbook snapshot');
      return result;
    } finally {
      if (generation === this.usageGeneration) {
        this.actionRuns.delete(runId);
        this.status.set(this.actionRuns.size ? 'running' : 'ready');
        this.statusMessage.set(this.actionRuns.size ? 'Actions running' : 'Action finished');
      }
    }
  }

  /** Admission only; the action owner applies these literals at a safe yield. */
  async queueActionInputs(sources: Record<string, string>): Promise<boolean> {
    const runId = this.actionRuns.values().next().value;
    if (!runId) return false;
    // Preserve this window's input order even if separate HTTP connections would
    // deliver rapid checkbox/slider requests out of order. Only admission waits.
    const pending = this.actionInputTail.then(async () => {
      if (!this.actionRuns.has(runId)) return false;
      const result = this.usesHttpKernel()
        ? await this.sideRequest('/v1/action-inputs', {runId, sources})
        : await this.request('action-inputs', undefined, {runId, sources});
      return !!result && typeof result === 'object' && 'accepted' in result && result.accepted === true;
    });
    this.actionInputTail = pending.catch(() => undefined);
    return pending;
  }

  /** Ordered value writes; independent of action lifetime and source compilation. */
  setInputs(sources: Record<string, string>): Promise<GraphResult> {
    const generation = this.usageGeneration;
    const pending = this.actionInputTail.then(async () => {
      if (generation !== this.usageGeneration) throw new Error('Python kernel changed before the input update.');
      const result = this.usesHttpKernel()
        ? await this.remoteRequest<GraphResult>('/v1/set-inputs', {sources})
        : await this.request('set-inputs', undefined, {sources});
      if (!isGraphResult(result)) throw new Error('Input update returned no workbook snapshot');
      return result;
    });
    this.actionInputTail = pending.catch(() => undefined);
    return pending;
  }

  async cancelAction(name: string, runId?: string): Promise<void> {
    if (this.usesHttpKernel()) await this.sideRequest('/v1/cancel-action', {name, runId});
    else await this.request('cancel-action', undefined, {actionName:name, runId});
  }

  async cancelResource(cellId: string): Promise<boolean> {
    const result = this.usesHttpKernel()
      ? await this.sideRequest('/v1/cancel-resource', {cellId}) as {cancelled: boolean}
      : await this.request('cancel-resource', undefined, {cellId}) as {cancelled: boolean};
    return result.cancelled;
  }

  async runEffect(cellId: string): Promise<GraphResult> {
    if (this.usesHttpKernel()) {
      return this.remoteRequest<GraphResult>('/v1/run-effect', { cellId });
    }
    await this.initialize();
    this.status.set('running');
    this.statusMessage.set(`Running effect ${cellId}`);
    const result = await this.request('run-effect', undefined, { cellId });
    if (!isGraphResult(result)) {
      throw new Error('The Python runtime returned no effect result.');
    }
    this.status.set('ready');
    this.statusMessage.set(`Effect ${cellId} finished`);
    return result;
  }

  /** State changed in an anywidget's view: update the Python widget and its readers. */
  async updateWidget(cellId: string, state: Record<string, unknown>, modelId?: string): Promise<GraphResult> {
    if (this.usesHttpKernel()) {
      return this.remoteRequest<GraphResult>('/v1/widget-update', { cellId, state, ...(modelId ? { modelId } : {}) });
    }
    await this.initialize();
    const result = await this.request('widget-update', undefined, { cellId, state, modelId });
    if (!isGraphResult(result)) {
      throw new Error('The Python runtime returned no widget result.');
    }
    return result;
  }

  /** A view's `model.send()`: the widget's Python message handlers run. */
  async widgetMessage(cellId: string, content: unknown, buffers: unknown[], modelId?: string): Promise<GraphResult> {
    if (this.usesHttpKernel()) {
      return this.remoteRequest<GraphResult>('/v1/widget-message', { cellId, content, buffers, ...(modelId ? { modelId } : {}) });
    }
    await this.initialize();
    const result = await this.request('widget-message', undefined, { cellId, content, buffers, modelId });
    if (!isGraphResult(result)) {
      throw new Error('The Python runtime returned no widget result.');
    }
    return result;
  }

  /** A clock cell (every/at) is due: tick it; everything reading it re-runs. */
  async tickTimer(cellId: string): Promise<GraphResult> {
    if (this.usesHttpKernel()) {
      return this.remoteRequest<GraphResult>('/v1/tick-timer', { cellId });
    }
    await this.initialize();
    const result = await this.request('tick-timer', undefined, { cellId });
    if (!isGraphResult(result)) {
      throw new Error('The Python runtime returned no timer result.');
    }
    return result;
  }

  async moveCells(
    cells: CellDefinition[],
    sourceId: string,
    targetId: string,
    sourceIds?: string[],
    sheets?: string[],
  ): Promise<CellDefinition[]> {
    if (this.usesHttpKernel()) {
      return this.remoteRequest<CellDefinition[]>('/v1/move-cells', {
        cells,
        sourceId,
        targetId,
        sourceIds,
        sheets,
      });
    }
    await this.initialize();
    const result = await this.request('move-cells', cells, { sourceId, targetId, sourceIds, sheets });
    if (!Array.isArray(result)) {
      throw new Error('The Python runtime returned no moved cell definitions.');
    }
    return result;
  }

  /** Move against synchronized kernel state; legacy kernels retain their old path. */
  async moveWorkbookCells(
    cells:CellDefinition[], sourceId:string, targetId:string, sourceIds:string[] | undefined,
    sheets:string[], imports:string[], code:string, document:SheetDocument,
  ):Promise<{cells:CellDefinition[]; graph:GraphResult; actions:ActionDefinition[]}> {
    if (this.moveNeedsReview) throw new Error('The previous move needs review. Refresh or explicitly reapply the workbook before moving cells again.');
    const generation=this.usageGeneration;
    const metadata=this.moveMetadata(imports,sheets,code,document);
    if (!sameDefinitions(cells,this.synchronizedCells) || metadata!==this.synchronizedMetadata) {
      await this.apply(cells,imports,sheets,code,true,document);
    }
    if (generation!==this.usageGeneration) throw new Error("Python kernel changed during move.");
    const base=this.synchronizedCells ?? cells;
    const revision=this.workbookRevision;
    if (!revision) {
      // No capability token: old kernel. Never retry an uncertain new command.
      const moved=await this.moveCells(base,sourceId,targetId,sourceIds,sheets);
      const graph=await this.apply(moved,imports,sheets,code,true,{...document,cells:moved});
      return {cells:mergeDefinitions(moved,graph.cellChanges),graph,actions:document.actions ?? []};
    }
    this.status.set('running');
    this.statusMessage.set('Moving cells');
    const payload={expectedRevision:revision,sourceId,targetId,sourceIds};
    try {
      const reply=(this.usesHttpKernel()
        ? await this.remoteRequest<MoveCommandReply>('/v1/move-workbook',payload)
        : await this.request('move-workbook',undefined,payload)) as MoveCommandReply;
      if (generation!==this.usageGeneration) throw new Error("Python kernel changed during move.");
      const moved=applyDefinitionPatch(base,reply.patches);
      if (reply.timings) {
        this.diagnostics.record('python.move-references',reply.timings.rewriteMs);
        this.diagnostics.record('python.move-apply',reply.timings.applyMs);
        if (reply.timings.queueMs!==undefined) this.diagnostics.record('python.move-queue',reply.timings.queueMs);
      }
      this.noteStopped(reply.graph);
      this.synchronizedCells=mergeDefinitions(moved,reply.graph.cellChanges);
      this.status.set('ready');
      this.statusMessage.set('Cells moved');
      return {cells:this.synchronizedCells,graph:reply.graph,actions:reply.actions};
    } catch(error) {
      if (generation!==this.usageGeneration) throw error;
      if (/\bMoveRejected:/.test(String(error))) {
        // Python rejected pure move planning before touching live state. Keep
        // the revision and definitions so the user can choose another location.
        this.status.set(this.actionRuns.size ? 'running' : 'ready');
        this.statusMessage.set(this.actionRuns.size ? 'Actions running' : 'Move not applied');
        this.error.set(null);
        throw error;
      }
      this.moveNeedsReview=true;
      this.synchronizedCells=null;
      this.workbookRevision=null;
      // A conflict/refused move is not a broken kernel. Surface it without replay.
      if (String(error).includes('Move conflict:')) this.status.set('ready');
      throw error;
    }
  }

  /** UI has applied the same move's note/layout metadata. */
  noteMoveDocument(document:SheetDocument):void {
    this.synchronizedMetadata=this.moveMetadata(document.environment.imports ?? [],
      [document.sheetName ?? 'Sheet1',...(document.sheets ?? []).map(s=>s.name)],
      document.environment.code ?? '',document);
  }

  private moveMetadata(imports:string[],sheets:string[] | undefined,code:string,document?:SheetDocument):string {
    const {cells:_cells,snapshot:_snapshot,...rest}=document ?? {};
    return JSON.stringify({imports,sheets,code,variables:this.variables,document:rest});
  }

  async clearLogs(): Promise<GraphResult> {
    if (this.usesHttpKernel()) {
      return this.remoteRequest<GraphResult>('/v1/clear-logs', {});
    }
    await this.initialize();
    const result = await this.request('clear-logs');
    if (!isGraphResult(result)) {
      throw new Error('The Python runtime returned no log result.');
    }
    return result;
  }

  async configureKernel(
    kind: KernelKind,
    remoteUrl: string,
    packages: string[],
    variables: Record<string, string> = {},
    remoteToken: string | null = null,
  ): Promise<void> {
    setPathPicker(undefined);
    this.attachedSession.set(false);
    const normalizedUrl = remoteUrl.trim().replace(/\/$/, '');
    const onlyVariablesChanged =
      kind === this.kernel() &&
      normalizedUrl === this.remoteUrl &&
      sameStrings(packages, this.packages) &&
      (kind !== 'remote' || remoteToken === this.kernelToken);
    this.variables = { ...variables };
    if (onlyVariablesChanged && this.status() === 'ready') {
      this.error.set(null);
      return;
    }

    this.resetUsage();
    this.rejectPending(new Error('Python kernel changed.'));
    this.channel.terminate();
    this.initialization = null;
    this.kernel.set(kind);
    this.packages = [...packages];
    this.remoteUrl = normalizedUrl;
    if (kind === 'remote') this.kernelToken = remoteToken;
    this.error.set(null);

    if (kind === 'remote') {
      this.status.set('loading');
      this.statusMessage.set('Connecting to remote Python');
      try {
        const response = await fetch(`${this.remoteUrl}/health`, { headers: this.kernelToken ? { Authorization: `Bearer ${this.kernelToken}` } : {} });
        if (!response.ok) {
          throw new Error(`Remote Python health check failed (${response.status}).`);
        }
        this.status.set('ready');
        this.statusMessage.set('Remote Python ready');
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.status.set('error');
        this.statusMessage.set('Remote Python unavailable');
        this.error.set(message);
        throw error;
      }
    }

    this.channel.start();
    await this.initialize();
  }

  async attachSession(endpoint: string, token: string): Promise<EmbeddedSessionState> {
    await this.configureKernel('remote', endpoint, [], {}, token);
    this.attachedSession.set(true);
    // The CLI runs Python on this machine: path widgets can browse its folders.
    setPathPicker(async request => (await import('./path-browser')).browsePath(request, payload => this.listFolder(payload)));
    this.sessionRevision = 0;
    const state = await this.readSession();
    if (!state) throw new Error('The Python host returned no embedded workbook.');
    this.variables = { ...state.document.environment.variables };
    this.packages = [...state.document.environment.packages];
    this.statusMessage.set('Attached to Python script');
    return state;
  }

  async readSession(after?: number, signal?: AbortSignal): Promise<EmbeddedSessionState | null> {
    const generation = this.usageGeneration;
    const state = await this.sideRequest('/v1/session', after === undefined ? {} : { after }, signal) as EmbeddedSessionState | null;
    if (generation !== this.usageGeneration) throw new Error('Python session changed before the snapshot arrived.');
    if (state && state.revision < this.sessionRevision) return null;
    if (state) {
      this.sessionRevision = state.revision;
      this.noteStopped(state.graph);
      if (this.status() === 'error') {
        this.status.set('ready');
        this.statusMessage.set('Attached to Python script');
        this.error.set(null);
      }
    }
    return state;
  }

  monitorSession(receive: (state: EmbeddedSessionState) => void, fail: (error: unknown) => void, canRead: () => boolean = () => true): () => void {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const poll = async () => {
      try {
        if (this.attachedSession() && this.status() !== 'running' && this.status() !== 'loading' && canRead()) {
          const state = await this.readSession(this.sessionRevision, controller.signal);
          if (active && state) receive(state);
        }
      } catch (error) { if (active) fail(error); }
      finally { if (active) timer = setTimeout(() => void poll(), 500); }
    };
    timer = setTimeout(() => void poll(), 500);
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }

  async saveSession(document: SheetDocument, saveOutputs = true, assets?: Record<string, string>): Promise<EmbeddedSessionState> {
    const state = await this.remoteCall<EmbeddedSessionState>('/v1/session-save', {
      document, ...(!saveOutputs ? {saveOutputs:false} : {}), ...(assets ? {assets} : {}),
    });
    this.sessionRevision = state.revision;
    this.noteStopped(state.graph);
    return state;
  }

  /** A CLI session restarts its Python (in a sandbox) with the workbook's packages; resolves
   * with the new session, which keeps the address and token. uv may download packages first. */
  async restartSession(document: SheetDocument): Promise<EmbeddedSessionState> {
    const pid = async (): Promise<number | null> => {
      try {
        const response = await fetch(`${this.remoteUrl}/health`, { headers: this.kernelToken ? { Authorization: `Bearer ${this.kernelToken}` } : {} });
        return response.ok ? ((await response.json()) as { pid?: number }).pid ?? null : null;
      } catch { return null; }
    };
    const before = await pid();
    // While loading, the session monitor pauses: the old process going away is expected.
    this.status.set('loading');
    this.statusMessage.set("Restarting Python with the workbook's packages…");
    this.error.set(null);
    try {
      await this.http.request('/v1/session-restart', { document }, false);
      for (const deadline = Date.now() + 10 * 60_000; Date.now() < deadline;) {
        await new Promise(resolve => setTimeout(resolve, 600));
        const current = await pid();
        if (current === null || current === before) continue;
        this.sessionRevision = 0;
        const state = await this.readSession();
        if (!state) throw new Error('The restarted Python returned no workbook.');
        this.packages = [...state.document.environment.packages];
        this.variables = { ...state.document.environment.variables };
        this.status.set('ready');
        this.statusMessage.set('Attached to Python script');
        return state;
      }
      throw new Error('Python did not come back within 10 minutes. See the terminal running reaktiv-workbook.');
    } catch (error) {
      this.status.set('error');
      this.statusMessage.set('Python restart failed');
      this.error.set(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  async resetSessionInput(cellId: string): Promise<GraphResult> {
    return this.remoteCall<GraphResult>('/v1/session-reset-input', {cellId});
  }

  /** An allowed git command, run by the CLI session in the workbook's folder. */
  runGit(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
    return this.remoteRequest('/v1/git', { args });
  }

  /** One folder of the machine running the CLI session, for the file/folder picker. */
  listFolder(payload: { path?: string; hidden?: boolean }): Promise<FolderListing> {
    return this.remoteRequest<FolderListing>('/v1/files', payload);
  }

  detachSession(): void {
    setPathPicker(undefined);
    this.attachedSession.set(false);
    this.kernelToken = null;
    this.suspend();
  }

  async restart(packages: string[]): Promise<void> {
    this.resetUsage();
    if (this.usesHttpKernel()) {
      this.packages = [...packages];
      await this.remoteRequest('/v1/restart', {});
      this.statusMessage.set('Remote Python restarted');
      return;
    }
    this.rejectPending(new Error('Python runtime restarted.'));
    this.channel.start();
    this.packages = [...packages];
    this.initialization = null;
    this.error.set(null);
    await this.initialize();
  }

  suspend(): void {
    this.resetUsage();
    this.rejectPending(new Error('Python runtime suspended.'));
    this.channel.terminate();
    if (this.kernel() === 'pyodide') this.channel.start();
    this.packages = [];
    this.variables = {};
    this.initialization = null;
    this.status.set('idle');
    this.statusMessage.set('Workbook loaded · runtime paused');
    this.error.set(null);
  }

  /** Let stopped cells run again (the user changed them or runs them again). */
  releaseCells(cellIds: Iterable<string>): void {
    const next = new Set(this.stoppedCells());
    for (const id of cellIds) next.delete(id);
    if (next.size !== this.stoppedCells().size) this.stoppedCells.set(next);
  }

  /** Keep cells stopped (a cell that hung, before the kernel restarts). */
  holdCells(cellIds: Iterable<string>): void {
    this.stoppedCells.set(new Set([...this.stoppedCells(), ...cellIds]));
  }

  private noteStopped(result: unknown): void {
    if (!isGraphResult(result)) return;
    if (result.snapshotEpoch && result.snapshotEpoch !== this.receiptEpoch) {
      this.receiptEpoch = result.snapshotEpoch;
      this.receiptSequence = 0;
      this.cellReceiptSequences.clear();
    }
    const sequence = result.snapshotSequence;
    const stale = sequence !== undefined && sequence < this.receiptSequence;
    if (!stale) {
      this.workbookRevision=result.workbookRevision ?? null;
      if (sequence !== undefined) this.receiptSequence = sequence;
    }
    if (result.timings) {
      this.diagnostics.record('python.apply-definitions',result.timings.definitionsMs);
      this.diagnostics.record('python.apply-resources',result.timings.resourcesMs);
      this.diagnostics.record('python.apply-snapshot',result.timings.snapshotMs);
      if (result.timings.queueMs!==undefined) this.diagnostics.record('python.apply-queue',result.timings.queueMs);
    }
    if (this.synchronizedCells && result.cellChanges) {
      const changes = result.cellChanges.filter(cell => {
        if (sequence === undefined) return true;
        if (sequence < (this.cellReceiptSequences.get(cell.id) ?? 0)) return false;
        this.cellReceiptSequences.set(cell.id, sequence);
        return true;
      });
      this.synchronizedCells=mergeDefinitions(this.synchronizedCells, changes);
    }
    if (stale) return;
    const stopped = result.stopped ?? [];
    const current = this.stoppedCells();
    if (stopped.length !== current.size || stopped.some((id) => !current.has(id))) {
      this.stoppedCells.set(new Set(stopped));
    }
  }

  /**
   * Stop the cell that runs too long. HTTP kernels interrupt it: Python keeps its
   * state and the cell fails with "Stopped" ('interrupted'; nothing was running: 'idle').
   * Pyodide cannot be interrupted: it is restarted, and the cell is held so the update that
   * follows does not run it again ('restarted'). An HTTP kernel can only be interrupted
   * ('unavailable' when forced).
   */
  async stopRun(cellId: string | null, force = false): Promise<'interrupted' | 'idle' | 'restarted' | 'unavailable'> {
    if (this.usesHttpKernel() && !force) {
      const value = (await this.sideRequest('/v1/interrupt', {})) as { interrupted?: unknown };
      return value.interrupted === true ? 'interrupted' : 'idle';
    }
    if (this.kernel() === 'remote') return 'unavailable';
    if (cellId !== null) this.holdCells([cellId]);
    this.resetUsage();
    this.rejectPending(new KernelStoppedError());
    this.channel.start();
    this.initialization = null;
    this.error.set(null);
    await this.initialize();
    return 'restarted';
  }

  /** Type checking can run where Python has its packages: CLI sessions and remote kernels. */
  canCheckTypes(): boolean {
    return this.usesHttpKernel() && this.status() !== 'idle' && this.status() !== 'error';
  }

  /**
   * Type-check the workbook with pyright in the kernel's environment (`/v1/check`). Answered
   * while cells run and never changes the kernel status; null where it is not available.
   */
  async checkTypes(document: SheetDocument, mode: TypeCheckMode): Promise<TypeCheckResult | null> {
    if (!this.canCheckTypes()) return null;
    return (await this.sideRequest('/v1/check', { document, mode })) as TypeCheckResult;
  }

  /** A kernel request beside the running update: no status, progress, or error changes. */
  private async sideRequest(path: string, payload: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    return this.http.sideRequest(path, payload, signal);
  }

  dismissError(): void {
    this.error.set(null);
    if (this.status() === 'error') {
      this.status.set('idle');
      this.statusMessage.set('Runtime error dismissed');
    }
  }

  private request(
    type: RuntimeRequest['type'], cells?: CellDefinition[], payload: WorkerPayload = {},
  ): Promise<RuntimeResponse['result']> {
    if (!this.channel.active) return Promise.reject(new Error(this.error() ?? 'Python worker unavailable.'));
    return this.channel.request(type, cells, payload);
  }

  /** Cells starting and finishing while Python runs; returns a function that unsubscribes. */
  onProgress(listener: (progress: CellProgress) => void): () => void {
    this.progressListeners.add(listener);
    return () => this.progressListeners.delete(listener);
  }

  onLog(listener: (entry: LogEntry) => void): () => void {
    this.logListeners.add(listener);
    return () => this.logListeners.delete(listener);
  }

  onSnapshot(listener: (graph: GraphResult) => void): () => void {
    this.snapshotListeners.add(listener);
    return () => this.snapshotListeners.delete(listener);
  }

  private emitSnapshot(graph: GraphResult): void {
    if (this.status() !== 'running' || !isGraphResult(graph)) return;
    for (const listener of this.snapshotListeners) listener(graph);
  }

  private emitLog(entry: LogEntry): void {
    for (const listener of this.logListeners) listener(entry);
  }

  private emitProgress(progress: CellProgress): void {
    for (const listener of this.progressListeners) listener(progress);
  }

  private handleEvent(response: RuntimeResponse): void {
    if (response.type === 'snapshot') {
      if (response.snapshot) this.emitSnapshot(response.snapshot);
      return;
    }
    if (response.type === 'log') {
      if (response.log) this.emitLog(response.log);
      return;
    }
    if (response.type === 'usage') {
      if (['ready', 'running'].includes(this.status()) && isResourceUsage(response.usage)) this.usage.set(response.usage);
      return;
    }
    if (response.type === 'progress') {
      if (response.cellId && (response.event === 'start' || response.event === 'end')) {
        this.emitProgress({ event: response.event, cellId: response.cellId });
      }
      return;
    }
    if (response.type === 'status') {
      this.statusMessage.set(response.message ?? 'Loading Python runtime');
      return;
    }

  }

  private handleResult(response: RuntimeResponse): void {
    this.error.set(null);
    if (this.status() === 'loading') {
      this.status.set('ready');
      this.statusMessage.set('Python and reaktiv ready');
    }
    this.noteStopped(response.result);
  }

  private rejectPending(error: Error): void { this.channel.rejectPending(error); }

  /**
   * HTTP kernels answer `/v1/progress` while another request runs: requests that run cells
   * poll it, so the app hears about cells as they start and finish. A kernel
   * without the endpoint (an older remote backend) simply reports nothing.
   */
  private async remoteRequest<T>(path: string, payload: Record<string, unknown>): Promise<T> {
    return this.remoteCall<T>(path, payload, true);
  }

  private async remoteCall<T>(path: string, payload: Record<string, unknown>, pollProgress = false): Promise<T> {
    const generation = this.usageGeneration;
    this.status.set('running');
    try {
      const result = await this.http.request<T>(path, payload, pollProgress);
      if (generation !== this.usageGeneration) throw new Error('Python kernel changed before the request completed.');
      this.status.set(this.actionRuns.size ? 'running' : 'ready');
      this.statusMessage.set(this.actionRuns.size ? 'Actions running' : `${this.httpKernelLabel()} ready`);
      this.error.set(null);
      this.noteStopped(result);
      const revision = (result as { sessionRevision?: number }).sessionRevision;
      if (this.attachedSession() && revision !== undefined) this.sessionRevision = Math.max(this.sessionRevision, revision);
      return result;
    } catch (error) {
      if (generation !== this.usageGeneration) throw error;
      if (error instanceof RequestTooLargeError || (error instanceof KernelRequestError && error.status >= 400 && error.status < 500)) {
        this.status.set(this.actionRuns.size ? 'running' : 'ready');
        this.statusMessage.set(this.actionRuns.size ? 'Actions running' : `${this.httpKernelLabel()} ready`);
        this.error.set(null);
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.status.set('error');
      this.statusMessage.set(`${this.httpKernelLabel()} unavailable`);
      this.error.set(message);
      throw error;
    }
  }
}

/** Restyle data per resampled trace (resample.py `view`). */
export interface ResampleView {
  traces: Array<{ index: number; shown: number; inRange: number; total: number; data: Record<string, unknown[]> }>;
}


function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export type TypeCheckMode = 'standard' | 'strict';

/** A finding of the type checker, on a cell (or the shared code when `cellId` is null). */
export interface TypeFinding {
  section?: 'source' | 'parameters' | 'computation';
  cellId: string | null;
  /** Line within the cell's source (1-based). */
  line: number | null;
  severity: 'error' | 'warning';
  rule: string;
  message: string;
  detail: string;
}

export interface TypeCheckResult {
  available: boolean;
  reason?: string;
  diagnostics: TypeFinding[];
}

/** The update was cut short because the user stopped a cell (not a Python failure). */
export class KernelStoppedError extends Error {
  constructor() {
    super('Python was restarted to stop a cell that ran too long.');
  }
}

function isGraphResult(value: unknown): value is GraphResult {
  return typeof value === 'object' && value !== null && 'dependencies' in value;
}

function isSheetDocument(value: unknown): value is SheetDocument {
  return (
    typeof value === 'object' &&
    value !== null &&
    'format' in value &&
    value.format === 'reaktiv-workbook' &&
    'cells' in value &&
    Array.isArray(value.cells)
  );
}

function isResourceUsage(value: unknown): value is ResourceUsage {
  if (value === null || typeof value !== 'object') return false;
  const usage = value as Partial<ResourceUsage>;
  const metric = (number: unknown) => number === null || (typeof number === 'number' && Number.isFinite(number) && number >= 0);
  return (usage.memoryKind === 'resident' || usage.memoryKind === 'wasm') && metric(usage.cpuPercent) && metric(usage.memoryBytes);
}


function mergeDefinitions(cells:CellDefinition[],changes?:CellDefinition[]):CellDefinition[] {
  const updates=new Map(changes?.map(cell=>[cell.id,cell]));
  return cells.map(cell=>updates.get(cell.id) ?? cell);
}

function sameDefinitions(cells:CellDefinition[],other:CellDefinition[] | null):boolean {
  if (!other || cells.length!==other.length) return false;
  const byId=new Map(other.map(cell=>[cell.id,cell]));
  return cells.every(cell=>{
    const previous=byId.get(cell.id);
    if (!previous) return false;
    return Object.keys({...previous,...cell}).every(key=>{
      const a=(cell as unknown as Record<string,unknown>)[key];
      const b=(previous as unknown as Record<string,unknown>)[key];
      return a===b || (typeof a==='object' && typeof b==='object' && JSON.stringify(a)===JSON.stringify(b));
    });
  });
}

export function applyDefinitionPatch(cells:CellDefinition[],patches:MoveCommandReply['patches']):CellDefinition[] {
  const updates=new Map(patches.map(p=>[p.previousId,p.changes]));
  return cells.map(cell=>{
    const change=updates.get(cell.id);
    if (!change) return cell;
    const next:Record<string,unknown>={...cell};
    for (const [key,value] of Object.entries(change)) {
      if (value===null) delete next[key]; else next[key]=value;
    }
    return next as unknown as CellDefinition;
  });
}
