import type { WidgetType } from './input-widgets';

export type CellKind = 'input' | 'linked' | 'formula' | 'resource' | 'markdown' | 'effect';

export interface CellDefinition {
  id: string;
  name?: string;
  kind: CellKind;
  source: string;
  /** False keeps initialization code instead of persisting action/effect-written data. */
  saveValue?: boolean;
  override?: string;
  /** Optional synchronous resource parameter code; absent selects simple mode. */
  params?: string;
  /** Optional linked computation; receives source and previous state. */
  computation?: string;
  enabled: boolean;
  color?: string;
  /** Dashboard presentation in the grid; absent for a plain value cell. */
  view?: CellView;
  /** Type hint of a formula's value (`float`, `pd.DataFrame`): the method's return annotation
   * in the file, used by type checking. */
  annotation?: string;
  /** Python comparator expression; absent uses the workbook default. */
  equal?: string;
}

export interface CellView {
  /** Reactive highlight expression, evaluated by Python independently of the cell value. */
  color?: WidgetExpression;
  /** 'rendered' shows the plot / table / note / widget itself instead of a value preview. */
  display?: 'value' | 'rendered';
  /** [columns, rows] this cell covers, anchored at its own coordinate. */
  span?: [number, number];
  /** Markdown cells: false = a cell note (not listed in Notes); unset = a note page. */
  page?: boolean;
  /** Render a text result as Markdown; unset follows the workbook setting. */
  markdown?: boolean;
  /** How a rendered input cell is edited in the grid. */
  widget?: CellWidget;
}

export interface WidgetExpression { expr: string; }

export interface CellWidget {
  /** See input-widgets.ts. */
  type: WidgetType;
  min?: number | string;
  max?: number | string;
  step?: number | string;
  options?: string[] | string;
  label?: string | WidgetExpression;
  placeholder?: string | WidgetExpression;
  disabled?: boolean | WidgetExpression;
  visible?: boolean | WidgetExpression;
  loading?: boolean | WidgetExpression;
  pressed?: boolean | WidgetExpression;
  buttonMode?: 'count' | 'toggle' | 'action';
  action?: string;
  cancelWhileRunning?: boolean;
  actionArguments?: Record<string, ActionBinding>;
  /** Sliders, text and number fields: ms after the last change before the cell updates while
   * editing (0: every change). Unset: sliders 150 ms, text and number on Enter / leaving. */
  debounce?: number;
}

export interface ResolvedCellWidget {
  /** UI feedback, never persisted as widget configuration. */
  actionError?: string;
  type: CellWidget['type'];
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  visible?: boolean;
  loading?: boolean;
  pressed?: boolean;
  buttonMode?: 'count' | 'toggle' | 'action';
  action?: string;
  cancelWhileRunning?: boolean;
  actionState?: 'running' | 'cancelling';
  actionArguments?: Record<string, ActionBinding>;
  debounce?: number;
}

/** Last evaluated outputs, stored with the document to read notes without running. */
export interface SheetSnapshot {
  savedAt: string;
  cells: CellResult[];
  dependencies: Record<string, string[]>;
  sourceDependencies?: Record<string, string[]>;
  dependencyStates?: Record<string, 'unobserved' | 'observed' | 'partial'>;
  widgetDependencies?: Record<string, string[]>;
}

export interface CellResult {
  color?: string;
  colorError?: string;
  colorDependencies?: string[];
  callable?: {signature:string; names:string[]; async?:boolean};
  linkedOverride?: string | null;
  /** Python object written at runtime; saves retain the initialization source. */
  runtimeOnlyInput?: boolean;
  widget?: ResolvedCellWidget;
  widgetError?: string;
  id: string;
  display: string;
  value: unknown;
  valueType: string;
  error: string | null;
  /** Where the error happened, or which cell caused it (live results only). */
  errorDetail?: ErrorDetail;
  durationMs?: number | null;
  /** Latest snapshot preparation, excluding cell evaluation and transport. */
  outputPreparationMs?: number;
  artifact?: ArtifactResult;
  richOutput?: RichOutputResult;
  table?: TableResult;
  resourceStatus?: 'idle' | 'loading' | 'reloading' | 'resolved' | 'local' | 'error' | 'cancelled';
}

/** A tabular value (DataFrame, Series, list of records/rows); see python/reaktiv_workbook/tables.py. */
export interface TableResult {
  kind: 'DataFrame' | 'Series' | 'records' | 'rows';
  columns: string[];
  index: TableCell[] | null;
  indexName: string | null;
  rows: TableCell[][];
  rowCount: number;
  columnCount: number;
  truncated: boolean;
}

export type TableCell = string | number | boolean | null;

export interface RichOutputResult {
  mimeType: string;
  dataBase64: string;
}

export interface ArtifactResult {
  filename: string;
  mimeType: string;
  size: number;
  sha256: string;
  dataBase64: string;
}

export interface EffectResult {
  id: string;
  enabled: boolean;
  triggerCount: number;
  lastTriggered: string | null;
  output: string;
  error: string | null;
  status: 'idle' | 'running' | 'succeeded' | 'failed';
  durationMs: number | null;
}

export interface LogEntry {
  /** Stable identity shared by live events and final snapshots. */
  id?: string;
  timestamp: string;
  /** The cell that wrote the entry; '' for app and kernel events. */
  cellId: string;
  /** info: print() output and events · warning: stderr, warnings · error: exceptions. */
  level: 'info' | 'warning' | 'error';
  message: string;
  /** Errors: cell code, shared code, and the innermost library frames. */
  traceback?: string;
  /** Errors: the failing line of the cell. */
  line?: number;
}

export interface ErrorDetail {
  /** The cell whose error this cell ran into; absent when the cell failed by itself. */
  origin?: string;
  traceback?: string;
  line?: number;
  /** The failing line of the cell's code. */
  source?: string;
  sheet?: string;
}

export type CellUpdateStatus = 'changed' | 'equal' | 'cached' | 'failed' | 'unaffected' | 'ran' | 'waiting' | 'not-run';
export interface CellUpdateObservation {
  status: CellUpdateStatus;
  executions: number;
  publishedChanged: boolean;
  dependencies: string[];
  changedDependencies: string[];
  equal?: boolean;
  equality?: 'custom' | 'default';
  output?: 'prepared' | 'reused';
}
export interface WorkbookUpdateTrace {
  sequence: number;
  roots: string[];
  cells: Record<string, CellUpdateObservation>;
}

export interface GraphResult {
  snapshotEpoch?: string;
  snapshotSequence?: number;
  /** Canonical definition acknowledged by the direct action-update command. */
  appliedAction?: ActionDefinition;
  /** Live, metadata-only observations of the latest settled update. */
  updateTrace?: WorkbookUpdateTrace;
  timings?: {definitionsMs:number;resourcesMs:number;snapshotMs:number;queueMs?:number};
  workbookRevision?: string;
  actions?: ActionResult[];
  /** Successful effect writes, already applied in the kernel. */
  cellChanges?: CellDefinition[];
  cells: CellResult[];
  dependencies: Record<string, string[]>;
  sourceDependencies?: Record<string, string[]>;
  dependencyStates?: Record<string, 'unobserved' | 'observed' | 'partial'>;
  widgetDependencies?: Record<string, string[]>;
  effects: EffectResult[];
  logs: LogEntry[];
  changed: string[];
  /** Clock cells (every/at) and when each ticks next; absent for stored snapshots. */
  timers?: TimerInfo[];
  /** Custom messages from Python widgets (`widget.send`) for their views. */
  widgetMessages?: Array<{ cellId: string; modelId?: string; content: unknown; buffers: unknown[] }>;
  /** Cells stopped for running too long; they stay stopped until released. */
  stopped?: string[];
  rebuilt: boolean;
  updateMode: 'initialized' | 'incremental';
}

/** A clock cell: `every(...)` / `at(...)`, */
export interface TimerInfo {
  cellId: string;
  /** "every 5 min", "at 08:00 on mon, tue". */
  label: string;
  /** Local time of the kernel, ISO without zone. */
  lastAt: string;
  nextAt: string;
  /** Seconds from the evaluation until the next tick. */
  nextInSeconds: number;
}

export interface SheetDocument {
  /** Persist evaluated outputs beside this workbook; omitted means enabled. */
  saveOutputs?: boolean;
  actions?: ActionDefinition[];
  format: 'reaktiv-workbook';
  version: 4;
  /** Opening provenance, not the JSON schema version or persisted Python metadata. */
  sourceFormatVersion?: 1 | 2;
  sourceFileName?: string;
  name: string;
  grid: {
    columns: number;
    rows: number;
  };
  environment: {
    packages: string[];
    imports?: string[];
    variables: Record<string, string>;
    /** Shared code (functions, classes, constants) for every cell; */
    code?: string;
    /** Omitted for the default in-app kernel. */
    kernel?: DocumentKernel;
    /** Python version for local kernels, e.g. "3.12"; omitted for the app default. */
    python?: string;
  };
  layout: {
    columnWidths: Record<string, number>;
    rowHeights: Record<string, number>;
    zoom: number;
    noteZoom?: number;
    /** Manual order of the notes list (cell ids); unlisted notes follow in sheet order. */
    noteOrder?: string[];
    /** Child note id → parent note id. Omitted notes are at the top level. */
    noteParents?: Record<string, string>;
  };
  cells: CellDefinition[];
  snapshot?: SheetSnapshot;
  /** Name of the first sheet (its cells have plain ids like "A1"); default "Sheet1". */
  sheetName?: string;
  /** Additional sheets; their cells have qualified ids like "Budget!A1". */
  sheets?: SheetTabLayout[];
}

/** An additional sheet (tab) and its grid layout. */
export interface SheetTabLayout {
  name: string;
  grid: { columns: number; rows: number };
  layout: { columnWidths: Record<string, number>; rowHeights: Record<string, number> };
}

export interface RuntimeRequest {
  knownOutputs?: string[];
  definition?: ActionDefinition;
  enableUpdateTracing?: boolean;
  diagnostics?: boolean;
  expectedRevision?: string;
  actions?: ActionDefinition[];
  actionName?: string;
  runId?: string;
  sources?: Record<string, string>;
  arguments?: Record<string,ActionBinding>;
  /** Restore history without repeating effect-generated writes. */
  allowCellWrites?: boolean;
  id: number;
  type:
    | 'initialize'
    | 'inspect-document'
    | 'verify-document'
    | 'apply'
    | 'run-effect'
    | 'run-action'
    | 'update-action'
    | 'action-inputs' | 'set-inputs'
    | 'cancel-action'
    | 'cancel-resource'
    | 'widget-update'
    | 'widget-message'
    | 'tick-timer'
    | 'move-workbook'
    | 'move-cells'
    | 'clear-logs'
    | 'resample'
    | 'console'
    | 'cell-memory';
  /** A resampled chart and its visible axis ranges (resample). */
  token?: string;
  ranges?: Record<string, [unknown, unknown] | null>;
  /** New widget state (widget-update). */
  state?: Record<string, unknown>;
  /** Nested widget model (widget-update, widget-message). */
  modelId?: string;
  /** Custom message content and binary buffers (widget-message). */
  content?: unknown;
  buffers?: unknown[];
  cells?: CellDefinition[];
  packages?: string[];
  imports?: string[];
  code?: string;
  variables?: Record<string, string>;
  source?: string;
  sheet?: string;
  /** The workbook a file to save must load back as (verify-document). */
  document?: SheetDocument;
  cellId?: string;
  sourceId?: string;
  sourceIds?: string[];
  targetId?: string;
  /** Sheet names, first = the sheet with plain cell ids. */
  sheets?: string[];
  /** Cells kept stopped (apply). */
  stopped?: string[];
}

export interface MoveCommandReply {
  timings?: {rewriteMs:number; applyMs:number; queueMs?:number};
  patches: Array<{previousId: string; changes: Record<string, unknown>}>;
  graph: GraphResult;
  actions: ActionDefinition[];
}

export interface CancellationResult { cancelled: boolean; }

export interface RuntimeResponse {
  timings?: Record<string,number>;
  id?: number;
  type: 'result' | 'error' | 'status' | 'progress' | 'usage' | 'log' | 'snapshot';
  snapshot?: GraphResult;
  log?: LogEntry;
  usage?: ResourceUsage;
  result?: MoveCommandReply | GraphResult | CellDefinition[] | SheetDocument | ConsoleResult | CellMemoryReport | CancellationResult;
  message?: string;
  /** `progress`: a cell started or finished running. */
  event?: 'start' | 'end';
  cellId?: string;
}

/** A cell started or finished running, reported while Python is still busy. */
export interface CellProgress {
  event: 'start' | 'end';
  cellId: string;
}

export type RuntimeStatus = 'idle' | 'loading' | 'ready' | 'running' | 'error';
/**
 * pyodide: in-app, sandboxed (default). remote: an HTTP backend (a CLI session or a
 * user-run server).
 */
export type KernelKind = 'pyodide' | 'remote';

/** Kernel choice stored in the worksheet (remote is a per-session setting). */
export type DocumentKernel = 'pyodide' | 'local';


/** CPU uses one core as 100%; browser memory is allocated Wasm heap, not resident RAM. */
export interface ResourceUsage {
  cpuPercent: number | null;
  memoryBytes: number | null;
  memoryKind: 'resident' | 'wasm';
}

export interface ConsoleResult { output: string; stderr: string; display: string; error: string | null; }
export interface CellMemory { bytes: number; limited: boolean; }
export type CellMemoryReport = Record<string, CellMemory>;


export interface ActionBinding { cell?: string; value?: unknown; default?: true }
export interface ActionDefinition { name: string; source: string; label: string; references: Record<string,string>; bindings: Record<string,ActionBinding>; exposed: boolean }
export interface ActionParameter { name: string; annotation: string; required: boolean; default?: unknown }
export interface ActionInvocation { id: string; name: string; status: 'running'|'succeeded'|'failed'|'cancelled'; error: string | null; output?: CellResult }

export interface ActionResult {
  runs?: ActionInvocation[];
  compileError?: string | null; status?: 'idle'|'running'|'succeeded'|'failed'|'cancelled'; name: string; label: string; description: string; parameters: ActionParameter[]; bindings: Record<string,ActionBinding>; running: boolean; error: string | null; cancelled?: boolean; output: CellResult }
