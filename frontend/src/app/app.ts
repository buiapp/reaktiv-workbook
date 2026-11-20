import { randomId } from './random-id';
import { WorkbookMigrationNoticeComponent } from './workbook-migration-notice.component';
import { migratedFilename, migrationDownloadName, type WorkbookMigration } from './files/workbook-migration';
import { GraphLevelsComponent } from './graph/graph-levels.component';
import { ViewOptionsComponent } from './view-options.component';
import { CommandPaletteComponent, type PaletteCommand } from './command-palette.component';
import { ZoomControlComponent } from './zoom-control.component';
import { CellColorExpressionComponent } from './cell-color-expression.component';
import { patchTrackLayout, type AgentTrackChange } from './agents/agent-track-layout';
import { ToolbarPopupDirective } from './toolbar-popup.directive';
import { assertCellPlacements, planCellMove, previewCellMove, translateCellId } from './cell-placement';
import { CellDropPreviewComponent } from './cell-drop-preview.component';
import { AgentActivity } from './agents/agent-activity';
import { agentCellLayoutKey, inspectCellLayouts } from './agents/agent-layout';
import { AgentActivityComponent } from './agents/agent-activity.component';
import { AgentCellFeedbackComponent } from './agents/agent-cell-feedback.component';
import { GraphNodeResizeDirective } from './graph/graph-node-resize.directive';
import { hasGraphOutput } from './graph/graph-outputs';
import type { GraphNodeSize } from './graph-layout';
import type { GraphLayout } from './graph-layout';
import { DocumentChanges, legacyCheckpoint, type DocumentCheckpoint } from './workbook/document-changes';
import { readRecoveryDraft, writeRecoveryOutputs, removeRecoveryDraft } from './recovery-outputs';
import { updateTracingEnabled } from './feature-flags';
import { GraphWorkspace } from './graph/graph-workspace';
import { ActionWorkspace } from './actions/action-workspace';
import { pythonErrorMessage } from './runtime/error-message';
import { KernelRequestError } from './runtime/http-kernel-transport';
import { setPathsInWorkbookFolder } from './widget-host';
import { WorkbookState } from './workbook/workbook-state';
import { shareCellResults } from './workbook/result-sharing';
import { affectedCellIds, cloneCells, isNotePage, sameCell, sameComputation, sortCells } from './workbook/cell-model';
import { newProjectCells, type NewProjectTemplate } from './workbook/project-templates';
import { WORKBOOK_SUFFIX, exampleAssetUrl, fileNameFromPath, fileStem } from './files/workbook-paths';
import { isNoteSort, markdownTitle, sortNotes, type NoteSort } from './notes/note-model';
import { embedCellImages, embedCellImageSources, NoteRenderer, renderMarkdownForExport } from './notes/note-rendering';
import { PYTHON_LABEL, PYTHON_KEYWORDS, PYTHON_COMPLETIONS, globalImportCompletions, sharedCodeNames, parseRequirements, parseGlobalImports, parseEnvironmentVariables } from './editor/python-authoring';
import { WorkbookCommandQueue } from './workbook-command-queue';
import { AgentAccessComponent } from './agents/agent-access.component';
import { AgentConnection, storedAgentPairing } from './agents/agent-connection';
import type { AgentWorksheetChange, AgentEnvironmentChange, AgentGridLines } from './agents/live-agent-workbook';
import { LiveAgentWorkbook } from './agents/live-agent-workbook';
import type { AgentViewContext, AgentCellContext } from './agents/agent-context';
import { themes, importThemes, type AppTheme } from './themes';
import { PerformanceDiagnostics } from './performance-diagnostics';
import { WorkbookSourceService } from './workbook-source.service';
import { GettingStartedComponent } from './getting-started.component';
import { CellConnectionControlsComponent, CellConnectionsComponent } from './cell-connections.component';
import type { ConnectionSettings } from './cell-connections';
import { ActionArgumentsComponent } from './action-arguments.component';
import { remapWidgetActionBindings, actionWidgetState, refusedInputState, type InputRefusal, type WidgetActionRequest } from './widget-action';
import { PanelResizeDirective } from './panel-resize.directive';
import { SaveFailureComponent, type SaveFailure } from './save-failure.component';
import { ActionPanelComponent } from './action-panel.component';
import { workbookCellMemberNames } from './sheet-file';
import { cellMemberNames, refactorCellLabel, rewriteActionWorksheet, actionReferencesCells } from './sheet-file';
import type { ActionDefinition, ActionBinding } from './sheet.types';
import { PaneActivationDirective } from './pane-activation.directive';
import { DEBOUNCED_WIDGETS, WIDGET_STATES, isWidgetDebounce, liveUpdateTiming, widgetBlocked, widgetSettingText } from './widget-config';
import { linkedAgentBridge, linkedSession, withoutAgentToken, type EmbeddedSessionState, type SessionEnvironment } from './embedded-session';
import { ViewZoomDirective } from './view-zoom.directive';
import type { EditorLanguageService } from './editor-intelligence';
import { CellTypeBadgeComponent, CELL_TYPES, CELL_TYPE_ORDER } from './cell-type-badge.component';
import { SelectionNavigationComponent } from './selection-navigation.component';
import { EMPTY_SELECTION_HISTORY, visitSelection, adjacentSelection, renameSelections, type SelectionHistory, type SelectionLocation } from './selection-history';
import { LinkedInputComponent } from './linked-input.component';
import { NoteTreeComponent } from './note-tree.component';
import { normalizeNoteParents, canNestNote, type NoteParents } from './note-tree';
import { CellSearchComponent } from './cell-search.component';
import { CellFocusComponent } from './cell-focus.component';
import { SheetExtentComponent } from './sheet-extent.component';
import { DebugConsoleComponent } from './debug-console.component';
import { CellMemoryComponent } from './cell-memory.component';
import type { CellMemoryReport } from './sheet.types';
import { ResourceUsageComponent } from './resource-usage.component';
import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  ViewChild,
  Component,
  OnDestroy,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  untracked,
  CUSTOM_ELEMENTS_SCHEMA,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { mathRevision } from './markdown-math';
import { mermaidRevision, prepareMermaid, mermaidMemoryDiagnostics } from './markdown-mermaid';
import { codeRevision, prepareCode, registerMarkdownCode } from './code-highlight';
import DOMPurify from 'dompurify';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import {
  MarkdownCellEditorComponent,
  type MarkdownInterpolationValue,
  type MarkdownWidgetChange,
} from './markdown-cell-editor.component';
import { PythonEditorComponent, type PythonCompletion } from './python-editor.component';
import {
  KernelStoppedError,
  RuntimeService,
  type TypeCheckMode,
  type TypeFinding,
} from './runtime.service';
import type { EditorDiagnostic } from './python-editor.component';
import {
  copiedCellsDocument,
  createSheetDocument,
  DEFAULT_SHEET_NAME,
  isCopiedCells,
  relabelCells,
  uniqueLabels,
  makeSnapshot,
  rewriteWidgetView,
  qualifyCellId,
  relativeReference,
  duplicateSheet as duplicateSheetCells,
  cellReference,
  splitCellId,
} from './sheet-file';
import { UiIconComponent } from './ui-icon.component';
import { KernelNoticeComponent } from './kernel-notice.component';
import { KeepInViewDirective } from './keep-in-view';
import { CellActivityTracker, markActivity } from './cell-activity';
import { AssetStore } from './asset-store';
import { WorkbookFileService } from './workbook-file.service';
import { diffWorkbooks, GitService, HttpGitTransport, type GitStatus, type WorkbookChanges } from './git.service';
import { renderTableHtml, tableSummary } from './data-table';
import { clampSpan, coveredCells, kpiText, spanOf, widgetFor, widgetSource } from './dashboard';
import { normalizeAnnotation, normalizeView } from './sheet-file';
import {
  cellPosition,
  collectableCells,
  collectionSource,
  collectionTarget,
  columnLabel,
  edgeCell,
  filledInColumn,
  filledInRow,
  rectangularSelection,
  stepCell,
  type CollectionMode,
} from './cell-selection';
import {
  currentWindowId,
  draftKeyFor,
  hasWindowOpening,
  openInNewWindow,
  openNewWindow,
  takeWindowOpening,
  type WindowOpening,
  pruneStaleBrowserDrafts,
  startupPlan,
  type DraftSummary,
  linkedExample,
  linkedNote,
} from './window-session';
import { NODE_HEIGHT, NODE_WIDTH } from './graph-layout';
import { GraphDebugComponent } from './graph-debug.component';
import { UpdateTraceComponent } from './update-trace.component';
import { UPDATE_STATES, updateExplanation } from './update-trace';
import { Debouncer } from './debouncer';
import { TimerScheduler, timerSummary } from './timer-scheduler';
import { installExternalLinkHandler } from './external-links';
import {
  HTML_NOTE_LINK_EVENT,
  isHtmlOutput,
  registerHtmlOutput,
} from './html-output';
import { NOTE_LINK_PREFIX, noteLinkHref, resolveNoteLink, type NoteLinkTarget } from './note-links';
import { EXAMPLES, EXAMPLE_LEVELS } from './examples';
import { isRichWidget, pythonLiteral, stepValue, withInputComments, type WidgetValue } from './input-widgets';
import { RichWidgetComponent } from './rich-widget.component';
import {
  LogFilter,
  filterLogs,
  isRoutineStatus,
  logsAsText,
  problemsAsText,
} from './log-view';
import {
  isAnywidgetOutput,
  registerAnywidgetView,
  splitWidgetChange,
  type AnywidgetChange,
  type AnywidgetMessage,
} from './anywidget-view';
import {
  isPlotlyOutput,
  plotlySpecsToPng,
  RESAMPLE_EVENT,
  type ResampleRequest,
  plotlyTitle,
  registerPlotlyFigure,
} from './plotly-figure';
import {
  escapeHtml,
  exportFileName,
  notesToHtml,
  notesToMarkdown,
  withoutAppLinksHtml,
  withoutAppLinksMarkdown,
  type ExportedNote,
  type NoteExportFormat,
} from './note-export';
import type {
  ArtifactResult,
  CellDefinition,
  CellKind,
  CellResult,
  CellView,
  CellWidget,
  ResolvedCellWidget,
  GraphResult,
  KernelKind,
  LogEntry,
  RichOutputResult,
  TableResult,
  SheetDocument,
  SheetSnapshot,
} from './sheet.types';

const HISTORY_LIMIT = 50;
/** DOMPurify's default URL rule, plus the blob: and asset: URLs note images are shown with. */
const SAFE_NOTE_URLS = /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|matrix|blob|asset):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;
const AUTO_DRAFT_ENABLED_KEY = 'reaktiv-workbook:auto-draft-enabled';
const GETTING_STARTED_DISMISSED_KEY = 'reaktiv-workbook:getting-started-dismissed:v1';
const RENDER_STRINGS_AS_MARKDOWN_KEY = 'reaktiv-workbook:render-strings-as-markdown';
const GRAPH_SETTINGS_KEY = 'reaktiv-workbook:graph-settings:v1';
const NOTE_SORT_KEY = 'reaktiv-workbook:note-sort:v1';
const NOTE_HISTORY_GROUP_MS = 750;
const CELL_DRAG_TYPE = 'application/x-reaktiv-workbook-cell';
const SHEET_DRAG_TYPE = 'application/x-reaktiv-workbook-tab';
const CELL_COLORS = ['#f7c6c7', '#f8d49d', '#f3e59a', '#cde7ae', '#b9ddd8', '#c9d2f2', '#d8c9ef'];
const CELL_TYPE_PREFIXES: Readonly<Record<string, CellKind>> = {
  // No '#': it starts a Python comment as often as a Markdown heading.
  '=': 'formula',
  '!': 'effect',
  '~': 'resource',
};

interface HistorySnapshot {
  environment?: SheetDocument['environment'];
  worksheetSize?: string;
  worksheetTracks?: string;
  label?: string;
  actions?: ActionDefinition[];
  splitSheets?: string[];
  splitNotes?: string[];
  cells: CellDefinition[];
  activeNoteId: string;
  noteDraft: string;
  selectedId: string;
  selectedIds: string[];
  noteParents: NoteParents;
  noteOrder: string[];
  /** Sheet structure: cell ids depend on it (renames, reordering). */
  sheets?: { first: string; extra: string[]; layouts: Record<string, SheetLayout> };
}

/** A new window starts with a blank project: one empty note, like New → Blank note. */
const STARTER_NAME = 'Untitled workbook';
const STARTER_CELLS: CellDefinition[] = newProjectCells(STARTER_NAME, 'note');
const STARTER_NOTE = STARTER_CELLS[0];

registerMarkdownCode();

const EDITOR_EXPANDED_KEY = 'reaktiv-workbook:editor-expanded';
const TYPE_CHECKING_KEY = 'reaktiv-workbook:type-checking';

function readTypeChecking(): 'off' | TypeCheckMode {
  try {
    const stored = localStorage.getItem(TYPE_CHECKING_KEY);
    return stored === 'off' || stored === 'strict' ? stored : 'standard';
  } catch {
    return 'standard';
  }
}

const INSPECTOR_COLLAPSED_KEY = 'reaktiv-workbook:inspector-collapsed:v2';

function readEditorExpanded(): boolean {
  try {
    return localStorage.getItem(EDITOR_EXPANDED_KEY) === 'true';
  } catch {
    return false;
  }
}

@Component({
  selector: 'app-root',
  imports: [WorkbookMigrationNoticeComponent, ViewOptionsComponent, ZoomControlComponent, CommandPaletteComponent,
    GraphLevelsComponent,
    CellColorExpressionComponent,
    AgentAccessComponent,
    ActionPanelComponent,
    PanelResizeDirective,
    ToolbarPopupDirective,
    GraphNodeResizeDirective,
    SaveFailureComponent,
    ActionArgumentsComponent,
    PaneActivationDirective,
    ViewZoomDirective,
    CommonModule,
    FormsModule,
    PythonEditorComponent,
    MarkdownCellEditorComponent,
    RichWidgetComponent,
    UiIconComponent,
    KernelNoticeComponent,
    GraphDebugComponent,
    UpdateTraceComponent,
    KeepInViewDirective,
    ResourceUsageComponent,
    SheetExtentComponent,
    DebugConsoleComponent,
    CellSearchComponent,
    CellFocusComponent,
    GettingStartedComponent,
    CellConnectionControlsComponent,
    CellConnectionsComponent,
    CellDropPreviewComponent,
    AgentActivityComponent,
    AgentCellFeedbackComponent,
    NoteTreeComponent,
    LinkedInputComponent,
    CellMemoryComponent,
    CellTypeBadgeComponent,
    SelectionNavigationComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // <reaktiv-plotly> (plotly-figure.ts) draws interactive Plotly charts.
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class App implements OnInit, OnDestroy {
  private readonly workbookState = new WorkbookState(cloneCells(STARTER_CELLS));
  private readonly noteRenderer = new NoteRenderer();
  protected readonly cellTypes = CELL_TYPES;
  protected graphTypeColor(kind: keyof typeof CELL_TYPES): string { return CELL_TYPES[kind].color; }
  protected readonly isPlotlyOutput = isPlotlyOutput;
  protected readonly isAnywidgetOutput = isAnywidgetOutput;
  protected readonly isHtmlOutput = isHtmlOutput;
  protected readonly plotlyTitle = plotlyTitle;
  protected readonly runtime = inject(RuntimeService);
  private readonly workbookSource = inject(WorkbookSourceService);
  /** Images of notes, stored next to the workbook (asset-store.ts). */
  protected readonly assets = inject(AssetStore);
  protected readonly workbookFiles = inject(WorkbookFileService);
  private readonly gitService = inject(GitService);
  protected readonly columns = signal(makeColumns(10));
  protected readonly rows = signal(makeRows(16));
  protected readonly documentName = signal(STARTER_NAME);
  protected readonly workbookNameDraft = signal<string | null>(null);
  protected readonly statusDetailsOpen = signal(false);
  protected readonly kernelDescription = computed(() => this.embeddedSession() ? 'Python script session'
    : this.runtime.kernel() === 'remote' ? 'Remote Python' : 'In-app Python · Pyodide');
  protected readonly documentActivityTooltip = computed(() => [
    this.saving() ? 'Saving…' : this.hasUnsavedChanges() ? 'Unsaved changes' : 'No unsaved changes',
    'Edited: ' + (this.lastEditedAt() ? this.activityTime(this.lastEditedAt()) : 'No edits recorded'),
    'Saved: ' + (this.lastSavedAt() ? this.activityTime(this.lastSavedAt()) : 'Not saved in this session'),
  ].join('\n'));

  protected beginWorkbookRename(): void {
    this.workbookNameDraft.set(this.documentName());
    requestAnimationFrame(() => {
      const input = document.getElementById('workbook-title-input') as HTMLInputElement | null;
      input?.focus(); input?.select();
    });
  }

  protected finishWorkbookRename(restoreFocus = false): void {
    const draft = this.workbookNameDraft();
    if (draft === null) return;
    if (draft.trim()) this.documentName.set(draft.trim());
    this.workbookNameDraft.set(null);
    if (restoreFocus) this.focusWorkbookTitle();
  }

  protected cancelWorkbookRename(): void {
    this.workbookNameDraft.set(null);
    this.focusWorkbookTitle();
  }

  private focusWorkbookTitle(): void {
    requestAnimationFrame(() => document.getElementById('workbook-title-button')?.focus());
  }

  protected statusDetailsToggled(event: Event): void {
    this.statusDetailsOpen.set((event as ToggleEvent).newState === 'open');
  }

  protected readonly packages = this.workbookState.packages;
  protected readonly imports = this.workbookState.imports;
  protected readonly variables = this.workbookState.variables;
  protected readonly columnWidths = signal<Record<string, number>>({});
  protected readonly rowHeights = signal<Record<string, number>>({});
  protected readonly zoom = signal(1);
  protected readonly noteZoom = signal(1);
  protected readonly kernelKind = signal<KernelKind>('pyodide');
  protected readonly logsOpen = signal(false);
  protected readonly bottomDockHeight = signal<number | null>(null);
  protected readonly artifactsOpen = signal(false);
  protected readonly viewMode = signal<'sheet' | 'notes' | 'split' | 'graph'>('notes');
  protected readonly settingsOpen = signal(false);
  protected readonly settingsLevel = signal<'workbook' | 'app'>('workbook');

  protected openSettings(level = this.settingsLevel()): void {
    this.settingsLevel.set(level);
    this.settingsOpen.set(true);
  }

  protected settingsScopeKeydown(event: KeyboardEvent): void {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const level = event.key === 'Home' ? 'workbook' : event.key === 'End' ? 'app'
      : this.settingsLevel() === 'workbook' ? 'app' : 'workbook';
    this.openSettings(level);
    document.getElementById(`settings-${level}-tab`)?.focus();
  }

  protected readonly gettingStartedOpen = signal(false);
  protected readonly newProjectOpen = signal(false);
  protected readonly cells = this.workbookState.cells;
  protected readonly graph = this.workbookState.graph;
  protected readonly selectedId = signal(STARTER_NOTE.id);
  protected readonly selectedIds = signal<ReadonlySet<string>>(new Set([STARTER_NOTE.id]));
  private selectionAnchor = STARTER_NOTE.id;
  protected readonly activeNoteId = signal(STARTER_NOTE.id);
  protected readonly noteDraft = signal(STARTER_NOTE.source);
  protected readonly hasUndo = signal(false);
  protected readonly undoLabel = signal<string | null>(null);
  protected readonly hasRedo = signal(false);
  protected readonly pendingStart = signal(false);
  /**
   * Cells can be edited only while Python runs this workbook: an edit is applied by
   * evaluating it, and a paused workbook (opened, not started) or a failed kernel would
   * leave edits unevaluated. Notes and code stay readable meanwhile.
   */
  protected readonly kernelRunning = computed(
    () =>
      !this.pendingStart() &&
      (this.runtime.status() === 'ready' || this.runtime.status() === 'running'),
  );

  protected readonly kernelNotice = computed(() => {
    const status = this.runtime.status();
    const connecting = this.embeddedSession();
    if (status === 'loading') return {
      title: connecting ? 'Connecting to Python…' : 'Starting Python…',
      detail: 'Editing, input controls and actions will be available when Python is ready.',
      action: connecting ? 'Connecting…' : 'Starting…', busy: true,
    };
    return {
      title: 'Read-only · Python is not running',
      detail: connecting
        ? 'Reconnect to the Python script to edit cells, change inputs and run actions.'
        : 'Start Python to edit cells and notes, change inputs and run actions. Starting runs the workbook’s code.',
      action: connecting ? 'Reconnect to Python' : status === 'error' ? 'Restart Python' : 'Start Python',
      busy: false,
    };
  });

  protected async enableWorkbook(): Promise<void> {
    if (this.kernelNotice().busy || this.kernelRunning()) return;
    if (this.embeddedSession() || this.runtime.status() === 'error') await this.restartKernel();
    else await this.startWorkbook();
  }

  /** False (with a message) when cells cannot be edited now. */
  private requireKernel(): boolean {
    if (this.pendingMove()) {
      this.evaluationError='A cell move is pending. Wait for it to finish before applying another change.';
      return false;
    }
    if (this.kernelRunning()) return true;
    this.evaluationError = this.pendingStart()
      ? 'Start the workbook to edit cells.'
      : this.runtime.status() === 'loading'
        ? 'Python is starting. Edit cells once it is ready.'
        : 'Python is not running. Restart the kernel to edit cells.';
    return false;
  }
  protected readonly workbookMigration = this.workbookState.migration;
  protected readonly migrationFilename = signal('');
  protected readonly workbookEditing = this.workbookState.workbookEditing;
  /** A filled cell without a label is named after its position in the file. */
  protected readonly labelHint = computed(() => {
    const cell = this.definitionAt(this.selectedId());
    if (cell === undefined || cell.kind === 'markdown' || cell.name || cell.source.trim() === '') return null;
    return `Name this cell. Without a label it is called ${splitCellId(cell.id)[1].toLowerCase()} in the Python file, and moving it renames it.`;
  });
  protected setWorkbookEditing(editing: boolean): void {
    if (this.appRun() && editing) return;
    if (!editing) this.commitNoteDraftIfNeeded();
    if (!editing && this.editorCellId) this.stashEditorDraft(this.editorCellId);
    this.workbookEditing.set(editing);
    this.endCellDrag();
    this.closeCellContextMenu();
    this.stopPickingReferences();
  }
  protected cellDoubleClick(event: MouseEvent, id: string): void {
    if ((event.target as HTMLElement).closest('input,button,select,textarea,[contenteditable],reaktiv-plotly,reaktiv-anywidget,reaktiv-html')) return;
    if (this.workbookEditing()) this.editCell(id);
    else this.showInspector(); // view mode: read the cell in the panel
  }
  protected readonly sidebarWidth = signal<number | null>(null);
  /** A wide inspector with a tall code editor (remembered per browser). */
  protected readonly editorExpanded = signal(readEditorExpanded());
  protected readonly splitPosition = signal(50);
  protected readonly splitViews = signal<readonly ('notes' | 'sheet' | 'graph')[]>(['notes', 'sheet']);
  protected readonly splitInspectorOpen = signal(false);
  /** The cell panel opens on demand (I, double-click, Inspect); v2: closed by default. */
  protected readonly inspectorCollapsed = signal(storedFlag(INSPECTOR_COLLAPSED_KEY, true));
  protected readonly inspectorVisible = computed(() => !this.appRun() && this.viewMode() !== 'notes' && !this.inspectorCollapsed()
    && (this.viewMode() !== 'split' || this.splitInspectorOpen()));
  protected toggleInspector(): void { this.setInspectorVisible(!this.inspectorVisible()); }
  private setInspectorVisible(visible: boolean): void {
    if (this.appRun() && visible) return;
    this.inspectorCollapsed.set(!visible);
    this.splitInspectorOpen.set(visible);
    try { localStorage.setItem(INSPECTOR_COLLAPSED_KEY, String(!visible)); } catch { /* Window preference still works. */ }
    if (!visible) requestAnimationFrame(() => document.getElementById('inspector-toggle')?.focus());
  }
  private showInspector(): void { this.setInspectorVisible(true); }
  protected readonly splitSheets = signal<readonly string[]>(['', '']);
  protected readonly splitNotes = signal<readonly string[]>(['', '']);
  protected readonly splitZooms = signal<readonly number[]>([1, 1]);
  private readonly activeSplitPane = signal(0);
  protected readonly splitNoteZooms = signal<readonly number[]>([1, 1]);
  protected readonly splitGraphZooms = signal<readonly number[]>([1, 1]);
  private readonly splitPaneContent = computed(() => this.splitSheets().map((sheet, index) => this.paneContent(sheet, index)));
  private readonly singlePaneContent = computed(() => this.paneContent(this.activeSheet(), -1));
  protected readonly workspacePanes = computed(() => this.splitPaneContent().map(pane => this.withPaneZoom(pane)));
  protected readonly singlePane = computed(() => this.withPaneZoom(this.singlePaneContent()));

  // Keep the matching pane's embedded view alive across single/split transitions.
  protected readonly visiblePanes = computed(() => {
    const mode = this.viewMode();
    if (mode === 'split') {
      return this.splitViews().map((kind, slot) => ({ kind, slot, pane: this.workspacePanes()[slot] }));
    }
    const slot = Math.max(0, this.splitViews().indexOf(mode));
    return [{ kind: mode, slot, pane: this.singlePane() }];
  });

  private withPaneZoom<T extends {index: number}>(pane: T) {
    const index = pane.index;
    return {...pane,
      zoom: index < 0 ? this.zoom() : this.splitZooms()[index],
      noteZoom: index < 0 ? this.noteZoom() : this.splitNoteZooms()[index],
      graphZoom: index < 0 ? this.graphZoom() : this.splitGraphZooms()[index],
    };
  }

  private paneContent(sheet: string, index: number) {
    const layout = this.layoutOf(sheet);
    const columns = makeColumns(layout.columns), rows = makeRows(layout.rows);
    const notes = this.notePages().filter(note => splitCellId(note.id)[0] === sheet);
    const requested = index < 0 ? this.activeNoteId() : this.splitNotes()[index];
    const note = notes.find(note => note.id === requested) ?? notes[0];
    const source = note?.id === this.activeNoteId() ? this.noteDraft() : note?.source ?? '';
    return {
      columnWidths: layout.columnWidths, rowHeights: layout.rowHeights,
      index, sheet, columns, rows, notes, noteId: note?.id ?? '', source,
      title: markdownTitle(source, note?.name ?? note?.id ?? ''),
      values: this.valuesForNote(note?.id ?? qualifyCellId(sheet, 'A1')),
      noteLinks: this.linksForNote(note?.id ?? qualifyCellId(sheet, 'A1')),
      gridColumns: `38px ${columns.map(column => `${layout.columnWidths[column] ?? 112}px`).join(' ')}`,
      gridRows: `32px ${rows.map(row => `${layout.rowHeights[String(row)] ?? 45}px`).join(' ')}`,
      gridWidth: 39 + columns.reduce((total, column) => total + (layout.columnWidths[column] ?? 112), 0),
      gridHeight: 33 + rows.reduce((total, row) => total + (layout.rowHeights[String(row)] ?? 45), 0),
      covered: coveredCells(this.cells().filter(cell => splitCellId(cell.id)[0] === sheet), columns.length, rows.length),
      extent: this.extentForSheet(sheet),
      graph: this.graphWorkspace.paneLayout(sheet, this.graphPinIndex(index)),
    };
  }

  protected activateSplitPane(index: number): void {
    if (this.viewMode() !== 'split' || index < 0) return;
    const pane = this.workspacePanes()[index];
    this.activeSplitPane.set(index);
    if (this.activeSheet() !== pane.sheet) this.switchSheet(pane.sheet);
    if (pane.noteId && this.activeNoteId() !== pane.noteId) {
      this.commitNoteDraftIfNeeded();
      this.activeNoteId.set(pane.noteId);
      this.noteDraft.set(this.definitionAt(pane.noteId)?.source ?? '');
    }
  }

  protected setSplitSheet(index: number, sheet: string): void {
    if (this.splitSheets()[index] !== sheet) this.graphWorkspace.unpin(this.graphPinIndex(index));
    if (!this.sheetTabs().some(tab => tab.prefix === sheet)) return;
    this.commitNoteDraftIfNeeded();
    this.splitSheets.update(sheets => sheets.map((current, position) => position === index ? sheet : current));
    this.splitNotes.update(notes => notes.map((current, position) => position === index ? '' : current));
    this.activateSplitPane(index);
  }

  protected setPaneZoom(index: number, value: number): void {
    const zoom = Math.min(2, Math.max(0.1, value));
    if (index < 0) this.zoom.set(zoom);
    else this.splitZooms.update(zooms => zooms.map((current, position) => position === index ? zoom : current));
  }

  /** The colour popover opens below its button (native popovers otherwise centre). */
  protected placeColorMenu(event: Event): void {
    const menu = event.target as HTMLElement;
    if ((event as ToggleEvent).newState !== 'open') return;
    const trigger = menu.ownerDocument.querySelector<HTMLElement>(`[popovertarget="${menu.id}"]`);
    const box = trigger?.getBoundingClientRect();
    if (!box) return;
    menu.style.top = `${Math.round(box.bottom + 6)}px`;
    menu.style.left = `${Math.round(Math.max(8, Math.min(box.left, window.innerWidth - menu.offsetWidth - 8)))}px`;
  }

  /** Picking a colour closes the menu. */
  protected closeColorMenu(event: Event): void {
    const menu = event.currentTarget as HTMLElement & { hidePopover?: () => void };
    if ((event.target as HTMLElement).closest('button')) menu.hidePopover?.();
  }

  protected fitSheetFromToolbar(event: Event, sheet: string, index: number): void {
    const viewport = (event.currentTarget as HTMLElement | null)?.closest('.sheet-area')?.querySelector<HTMLElement>('.sheet-scroll');
    if (!viewport || viewport.clientWidth <= 0 || viewport.clientHeight <= 0) return;
    const layout = this.layoutOf(sheet), extent = this.extentForSheet(sheet);
    const width = 39 + makeColumns(extent.columns).reduce((total, column) => total + (layout.columnWidths[column] ?? 112), 0);
    const height = 33 + makeRows(extent.rows).reduce((total, row) => total + (layout.rowHeights[String(row)] ?? 45), 0);
    this.setPaneZoom(index, Math.min(1, (viewport.clientWidth - 16) / width, (viewport.clientHeight - 16) / height));
    viewport.scrollTo({left: 0, top: 0, behavior: 'instant'});
  }

  protected setPaneNoteZoom(index: number, value: number): void {
    if (index < 0) this.setNoteZoom(value);
    else this.splitNoteZooms.update(zooms => zooms.map((current, position) => position === index ? Math.min(1.6, Math.max(0.7, value)) : current));
  }

  protected setPaneGraphZoom(index: number, value: number): void {
    if (index < 0) this.graphZoom.set(clampGraphZoom(value));
    else this.splitGraphZooms.update(zooms => zooms.map((current, position) => position === index ? clampGraphZoom(value) : current));
  }

  private readonly splitNoteWatcher = effect(() => {
    if (this.viewMode() !== 'split') return;
    const index = this.activeSplitPane();
    const noteId = this.activeNoteId();
    if (this.definitionAt(noteId)?.kind === 'markdown' && splitCellId(noteId)[0] === this.splitSheets()[index] && this.splitNotes()[index] !== noteId) {
      this.splitNotes.update(notes => notes.map((current, position) => position === index ? noteId : current));
    }
  });

  protected updatePaneNote(index: number, source: string): void {
    this.activateSplitPane(index);
    this.updateNoteDraft(source);
  }

  protected readonly markdownCopied = signal(false);
  protected readonly autoDraftEnabled = signal(true);
  protected readonly renderStringsAsMarkdown = signal(true);
  protected readonly lastDraftSaved = signal<string | null>(null);
  protected readonly saveFeedback = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly saveFailure = signal<SaveFailure | null>(null);
  protected lastSaveOptions: { saveAs?: boolean } = {};
  private reportSaveFailure(summary: string, details: string[], title = 'Workbook not saved'): void {
    const ids = new Set(details.flatMap(detail => [...detail.matchAll(/\bCell ((?:[A-Za-z_]\w*!)?[A-Z]+[1-9]\d*)\b/g)].map(match => match[1])));
    const cells = [...ids].flatMap(id => {
      const cell = this.definitionAt(id);
      return cell ? [{id, label: cell.name ? `${id} · ${cell.name}` : id}] : [];
    });
    const actions = [...new Set(details.flatMap(detail => [...detail.matchAll(/\bAction ([A-Za-z_]\w*)\b/g)].map(match => match[1])))];
    this.saveFailure.set({ title, summary, details, cells, actions });
    this.logSystem('error', `${summary} ${details.join('\n')}`);
  }
  protected openSaveFailureCell(cellId: string): void {
    if (!this.definitionAt(cellId)) return;
    this.saveFailure.set(null);
    this.actionsOpen.set(false);
    this.cellTypeFocus.set('');
    this.openLogCell(cellId);
    this.splitInspectorOpen.set(true);
  }
  protected openSaveFailureAction(name: string): void {
    this.saveFailure.set(null);
    this.openActions(name);
  }
  protected readonly lastEditedAt = signal<string | null>(null);
  protected readonly lastSavedAt = signal<string | null>(null);
  protected readonly hasUnsavedChanges = signal(false);
  protected readonly cellContextMenu = signal<{ x: number; y: number; cellId: string } | null>(
    null,
  );
  protected readonly updatedCellIds = signal<ReadonlySet<string>>(new Set());
  protected readonly cellColors = CELL_COLORS;
  protected readonly variableCount = computed(() => Object.keys(this.variables()).length);
  protected readonly importCount = computed(() => this.imports().length);
  protected readonly pythonCompletions = computed<readonly PythonCompletion[]>(() => {
    const references: PythonCompletion[] = [{label: 'cells', type: 'namespace', detail: 'cell handles', info: 'cells.name.set(value), .update(fn), .reset(), .get()'}];
    const seen = new Set<string>();
    for (const sheet of [this.sheetName(), ...this.extraSheets()]) {
      references.push({ label: sheet, type: 'namespace', detail: 'sheet', info: `Cells: ${sheet}.A1` });
      references.push({label: `cells.${sheet}`, type: 'namespace', detail: 'cell handles'});
    }
    for (const cell of this.cells()) {
      const coordinate = relativeReference(this.activeSheet(), cell.id, this.sheetName());
      const label = cell.name ? cellReference(this.activeSheet(), cell, this.sheetName()) : undefined;
      const sheet = cell.id.includes('!') ? cell.id.split('!')[0] : this.sheetName();
      const localCoordinate = cell.id.split('!').at(-1)!;
      for (const reference of [label, coordinate, `${sheet}.${localCoordinate}`, ...(cell.name ? [`${sheet}.${cell.name}`] : [])]) {
        if (!reference || seen.has(reference)) continue;
        seen.add(reference);
        references.push({
          label: reference,
          cellId: cell.id,
          valueType: cell.annotation || this.resultMap().get(cell.id)?.valueType,
          type: this.resultMap().get(cell.id)?.valueType === 'function' ? 'function' : this.resultMap().get(cell.id)?.valueType === 'type' ? 'class' : 'variable',
          detail: `${cell.id} · ${cell.annotation || this.resultMap().get(cell.id)?.valueType || cell.kind}`,
          info: cell.name === reference ? `Reactive cell ${cell.id}` : cell.name,
          boost: cell.name === reference ? 10 : 5,
        });
        references.push({label: `cells.${reference}`, cellId: cell.id, valueType: cell.annotation || this.resultMap().get(cell.id)?.valueType,
          type: 'variable', detail: `${cell.id} · cell handle`, info: ['input','linked'].includes(cell.kind) ? 'set(value), update(fn), get()' + (cell.kind === 'linked' ? ', reset()' : '') : 'get() · read-only'});
        for (const method of [...(cell.kind !== 'effect' ? ['get'] : []), ...(['input','linked'].includes(cell.kind) ? ['set','update'] : []), ...(cell.kind === 'linked' ? ['reset'] : []), ...(cell.kind === 'resource' ? ['value', 'status', 'is_loading', 'error', 'reload'] : [])]) {
          references.push({label: `cells.${reference}.${method}`, type: 'function', detail: `${cell.id} · ${method === 'get' ? 'read' : 'effect write'}`});
        }
      }
    }
    return [
      ...references,
      ...this.sharedCodeCompletions(),
      ...globalImportCompletions(this.imports()),
      ...PYTHON_COMPLETIONS,
    ];
  });

  protected readonly editorLanguageService: EditorLanguageService = query =>
    this.runtime.editor?.(this.currentDraftDocument(), this.activeSheet(), query) ?? Promise.resolve(null);

  protected readonly cellTypeOptions = CELL_TYPE_ORDER.map(kind => ({
    kind,
    label: kind === 'input' ? 'Input signal' : kind === 'formula' ? 'Computed formula' : CELL_TYPES[kind].label,
  }));
  protected editorKind: CellKind = 'markdown';
  protected editorName = '';
  /** Type hint of the formula being edited (`float`, `pd.DataFrame`). */
  protected editorAnnotation = '';
  protected editorEqual = '';
  protected equalityMode(): string {
    return this.editorEqual === '' ? 'default' : this.editorEqual === 'lambda previous, current: previous is current' ? 'identity' : this.editorEqual === 'values_equal' ? 'value' : this.editorEqual === 'lambda previous, current: False' ? 'always' : 'custom';
  }
  protected setEqualityMode(mode: string): void {
    if (!this.requireKernel()) return;
    this.editorEqual = mode === 'default' ? '' : mode === 'identity' ? 'lambda previous, current: previous is current' : mode === 'value' ? 'values_equal' : mode === 'always' ? 'lambda previous, current: False' : 'lambda previous, current: previous == current';
  }
  protected editorParams = '';
  protected editorComputation = '';
  protected editorResourceExplicit = false;
  protected readonly formulaExpanded = signal(false);
  protected toggleFormulaExpanded(): void { this.formulaExpanded.update(value => !value); }

  protected openFormulaEditor(editor: PythonEditorComponent): void {
    this.formulaExpanded.set(true);
    this.codeEditorFocused(editor);
  }

  protected collapseFormulaEditor(event?: Event): void {
    if (event?.defaultPrevented) return; // Completion gets the first Escape.
    event?.preventDefault();
    event?.stopPropagation();
    this.formulaExpanded.set(false);
    this.stopPickingReferences();
  }

  protected dismissFormulaEditor(event: PointerEvent): void {
    if (!this.formulaExpanded() || !(event.target instanceof Element)) return;
    if (event.target.closest('.formula-editor-field, .formula-expand, .cm-tooltip, .pick-cells-button')) return;
    // Picking a reference keeps the same editor and cell selected.
    if (this.referenceEditor() && event.target.closest('.sheet-cell, .graph-node')) return;
    this.formulaExpanded.set(false);
  }

  protected editorSource = STARTER_NOTE.source;
  protected editorColor = '';
  protected packageSource = '';
  protected importSource = '';
  protected variableSource = '';
  protected remoteUrl = 'http://127.0.0.1:8765';
  /**
   * Message for the error toast. Backed by a signal: the app is zoneless/OnPush, so a
   * plain field would not re-render when set from async code (e.g. a refused move).
   */
  private readonly evaluationErrorMessage = signal<string | null>(null);
  protected get evaluationError(): string | null {
    return this.evaluationErrorMessage();
  }
  protected set evaluationError(message: string | null) {
    this.evaluationErrorMessage.set(message);
    // Toasts disappear; the Logs panel keeps what went wrong.
    if (message) this.logSystem('error', message);
  }
  protected newProjectName = 'Untitled workbook';
  protected newProjectTemplate: NewProjectTemplate = 'note';
  protected newProjectColumns = 10;
  protected newProjectRows = 16;
  protected newProjectError: string | null = null;

  private readonly undoStack: HistorySnapshot[] = [];
  private readonly redoStack: HistorySnapshot[] = [];
  private evaluationGeneration = 0;
  private readonly workbookCommands=new WorkbookCommandQueue();
  protected readonly agentAccessOpen = signal(false);
  protected readonly agentCellLayoutKey = agentCellLayoutKey;
  protected readonly agentActivity = new AgentActivity(() => this.cells());
  protected readonly agentActivityCellIds = computed(() => new Set(this.cells().map(cell => cell.id)));
  private agentActionActive = 0;
  private readonly agentWorkbook = new LiveAgentWorkbook({
    observe: (command, execute) => this.agentActivity.observe(command, execute),
    document: () => ({ ...this.currentDraftDocument(), cells: this.cells() }),
    graph: () => this.graph(),
    drafts: () => this.agentDraftIds(),
    kernelRunning: () => this.kernelRunning(),
    context: () => this.agentViewContext(),
    cellLayouts: ids => inspectCellLayouts(this.cells(), this.graph().cells, ids,
      sheet => ({...this.layoutOf(sheet), name: this.sheetTabs().find(tab => tab.prefix === sheet)?.name ?? sheet}), this.graph().workbookRevision),
    logs: () => this.allLogs(),
    diagnostics: () => ({ typeFindings: this.typeFindings(), evaluationError: this.evaluationError,
      performance: this.diagnostics.snapshot() }),
    kernelStatus: () => this.agentKernelStatus(),
    controlKernel: (action, force, check) => this.controlAgentKernel(action, force, check),
    actionStatus: () => ({ invocations: this.actionWorkspace.invocations(), running: this.runningAction(), applying: this.actionApplying(), error: this.actionError() }),
    actionDrafts: () => this.actionWorkspacePanel?.hasUnappliedDrafts ?? false,
    editAction: (definition, check) => this.editAgentAction(definition, check),
    runAction: (name, args, check) => this.runAgentAction(name, args, check),
    cancelAction: async (name, runId) => {
      this.actionError.set('');
      await this.actionWorkspace.cancel(name, runId);
      if (this.actionError()) throw new Error(this.actionError());
    },
    colorCells: async (ids, color, expression) => {
      const reactive = expression !== undefined || this.cells().some(cell => ids.includes(cell.id) && cell.view?.color);
      if (expression !== undefined && !this.requireKernel()) throw new Error('Start the kernel before setting reactive colors.');
      if (reactive && this.kernelRunning() && this.agentDraftIds().length) throw new Error('Apply or discard user drafts before changing reactive colors.');
      const before = this.cells();
      this.applyCellColors(new Set(ids), color, 'Agent cell colors', expression);
      if (reactive && this.kernelRunning()) await this.evaluateGraphNow(false, true);
      this.agentActivity.recordChanges(before, this.cells());
    },
    resizeWorksheet: async (sheet, columns, rows) => this.resizeAgentWorksheet(sheet, columns, rows),
    setTracks: async change => this.setAgentTracks(change),
    gridLines: (change, check) => this.agentGridLines(change, check),
    moveCells: async (source, target, ids) => {
      if (!this.requireKernel()) throw new Error('Start the workbook kernel first.');
      const before = this.cells();
      await this.dropCellNow(source, target, ids ?? [source], true);
      this.agentActivity.recordChanges(before, this.cells());
    },
    labelCell: (id, label, check) => this.labelAgentCell(id, label, check),
    manageWorksheet: (change, check) => this.manageAgentWorksheet(change, check),
    updateEnvironment: (change, check) => this.updateAgentEnvironment(change, check),
    environmentStatus: () => ({packagesActive: this.documentChanges.same(this.packages(), this.runtime.configuredPackages),
      packageActivation: 'Packages are activated by an explicit kernel start/restart. Remote/embedded dependencies are installed by their host.'}),
    addImage: async (mime, data, check) => {
      check();
      if (this.embeddedSession()) throw new Error('Embedded sessions do not synchronize image assets yet. Use a computed image/SVG output, or open the workbook normally to add durable assets.');
      const {dataUrlToBlob} = await import('./image-assets');
      const blob = dataUrlToBlob(`data:${mime};base64,${data}`);
      if (!blob || blob.size > 5 * 1024 * 1024) throw new Error('Image is invalid or exceeds 5 MB.');
      return this.assets.add(blob, check);
    },
    inspectVisual: async (id, pane) => {
      const {inspectVisualCell} = await import('./agents/agent-visual');
      return inspectVisualCell(id, pane, this.resultAt(id));
    },
    validate: async document => {
      const result = await this.workbookSource.serialize(document);
      if (result.problems.length) throw new Error(result.problems.join('\n'));
    },
    commit: cells => this.commitAgentCells(cells),
    save: async () => {
      if (!this.embeddedSession())
        throw new Error('Save this workbook from the app. Agents can save workbooks opened with reaktiv-workbook edit.');
      if (this.saving()) throw new Error('A save is already in progress.');
      await this.saveSheet();
      if (this.saveFailure() || this.hasUnsavedChanges()) throw new Error('Save did not complete. Review the save feedback in the app.');
    },
  });
  protected readonly agentAccess = new AgentConnection(
    () => ({ name: this.documentName(), kernelRunning: this.kernelRunning(), context: this.agentViewContext() }),
    async (command, assertShared) => {
      try {
        const execute = () => this.agentWorkbook.execute(command, assertShared);
        // Status/logs/interrupt must answer while an apply is holding the command queue.
        const result = ['read', 'edit', 'save', 'colors', 'resize', 'tracks', 'move', 'label'].includes(command.operation)
          ? await this.workbookCommands.run(execute) : await execute();
        if (!result) throw new Error('The workbook was replaced before the agent command ran.');
        return result;
      } catch (error) {
        this.logSystem('warning', `Agent request did not complete: ${pythonErrorMessage(error)}`);
        throw error;
      }
    },
  );

  private agentKernelControlBusy = false;
  private agentKernelStatus(): Record<string, unknown> {
    return { kind: this.runtime.kernel(), status: this.runtime.status(), message: this.runtime.statusMessage(),
      error: this.runtime.error(), evaluationError: this.evaluationError, pendingStart: this.pendingStart(), embedded: this.embeddedSession(),
      currentCell: this.activity.current()?.id ?? null, activity: [...this.activity.states()].map(([id, state]) => ({ id, state })),
      stoppedCells: [...this.runtime.stoppedCells()], usage: this.runtime.usage(),
      capabilities: { start: !this.embeddedSession(), restart: !this.embeddedSession(), interrupt: true,
        forceInterrupt: this.runtime.kernel() !== 'remote' && !this.embeddedSession() } };
  }

  private async controlAgentKernel(action: 'start' | 'restart' | 'interrupt', force: boolean, check: () => void): Promise<void> {
    check();
    if (action === 'interrupt') {
      if (force && (this.runtime.kernel() === 'remote' || this.embeddedSession()))
        throw new Error('Force restart is unavailable for remote or embedded kernels.');
      const previousError = this.evaluationError;
      await this.stopRunningCell(force, check);
      if (this.evaluationError && this.evaluationError !== previousError) throw new Error(this.evaluationError);
      return;
    }
    if (this.embeddedSession()) throw new Error('The embedding script owns this kernel. Start/restart it there.');
    if (this.agentKernelControlBusy || this.runtime.status() === 'running' || this.runtime.status() === 'loading')
      throw new Error('The kernel is busy. Use interrupt before requesting a start/restart.');
    this.agentKernelControlBusy = true;
    try {
      await this.workbookCommands.run(async () => undefined);
      check();
      if (this.runtime.status() === 'running' || this.runtime.status() === 'loading') throw new Error('The kernel became busy.');
      if (action === 'start' && this.kernelRunning()) return;
      if (!this.documentChanges.same(parseRequirements(this.packageSource), this.packages()) ||
          !this.documentChanges.same(parseGlobalImports(this.importSource), this.imports()) ||
          !this.documentChanges.same(parseEnvironmentVariables(this.variableSource), this.variables()))
        throw new Error('Environment drafts are open. Apply or discard them in the app first.');
      this.logSystem('info', `Agent requested kernel ${action}`);
      if (action === 'start') await this.startWorkbook(check);
      else await this.restartKernel(check);
      if (this.runtime.status() === 'error' || !this.kernelRunning())
        throw new Error(this.runtime.error() ?? this.evaluationError ?? 'Kernel did not start.');
    } finally { this.agentKernelControlBusy = false; }
  }

  @ViewChild('actionWorkspacePanel') private actionWorkspacePanel?: ActionPanelComponent;

  private checkAgentAction(invoking = false): void {
    if (!this.requireKernel()) throw new Error('Start the workbook kernel before changing/running actions.');
    if (this.actionApplying() || (!invoking && this.runningAction()) || (this.runtime.status() === 'running' && !this.runningAction()))
      throw new Error('Wait for the current action/update to finish.');
    if (this.actionWorkspacePanel?.hasUnappliedDrafts) throw new Error('User action drafts are open. Apply or discard them first.');
  }

  private async editAgentAction(definition: ActionDefinition, check: () => void): Promise<void> {
    this.checkAgentAction();
    await this.actionWorkspace.apply(definition, { check, historyLabel: 'Agent action edits' });
    if (this.actionError()) throw new Error(this.actionError());
    if (this.actionApplied()?.name !== definition.name) throw new Error('Action edit was not confirmed.');
    this.logSystem('info', `Agent edited action ${definition.name} · Undo available`);
  }

  private async runAgentAction(name: string, args: Record<string, ActionBinding>, check: () => void): Promise<void> {
    this.checkAgentAction(true);
    const generation = this.workbookCommands.generation;
    this.agentActionActive++;
    let result: Awaited<ReturnType<ActionWorkspace["invoke"]>>;
    try {
      result = await this.actionWorkspace.invoke({ name, arguments: args }, check);
    } finally {
      if (generation === this.workbookCommands.generation) this.agentActionActive--;
    }
    if (!result) throw new Error(this.actionError() || 'Action execution was not confirmed. Inspect status/logs before retrying.');
    if (result.error) throw new Error(result.error);
    this.logSystem('info', `Agent ran action ${name}`);
  }

  private resizeAgentWorksheet(sheet: string, columns: number, rows: number, record = true): { columns: number; rows: number } {
    const minimum = this.extentForSheet(sheet);
    // The current editor can contain a draft not yet stashed in cellDrafts.
    for (const id of this.agentDraftIds()) {
      if (splitCellId(id)[0] !== sheet) continue;
      const [column, row] = cellPosition(id);
      minimum.columns = Math.max(minimum.columns, column); minimum.rows = Math.max(minimum.rows, row);
    }
    const next = { columns: Math.max(columns, minimum.columns), rows: Math.max(rows, minimum.rows) };
    const layout = this.layoutOf(sheet);
    if (layout.columns === next.columns && layout.rows === next.rows) return next;
    if (record) this.recordHistory(true, 'Agent worksheet size', sheet);
    if (sheet === this.activeSheet()) {
      this.columns.set(makeColumns(next.columns)); this.rows.set(makeRows(next.rows));
    } else this.storedLayouts.update(layouts => ({ ...layouts, [sheet]: { ...layout, ...next } }));
    return next;
  }

  private async labelAgentCell(id: string, label: string, check: () => void): Promise<void> {
    const before = this.currentDraftDocument(), next = refactorCellLabel(before, id, label);
    if (next === before) return;
    const result = await this.workbookSource.serialize(next);
    if (result.problems.length) throw new Error(result.problems.join('\n'));
    check();
    if (!this.requireKernel()) throw new Error('The workbook kernel stopped before label refactoring.');
    if (!this.documentChanges.same(before, this.currentDraftDocument()) || this.agentDraftIds().length || this.actionWorkspacePanel?.hasUnappliedDrafts)
      throw new Error('Workbook changed while preparing label refactoring. Read and reconcile.');
    this.recordHistory(true, 'Agent cell label');
    this.actionDefinitions.set(next.actions ?? []);
    this.cells.set(sortCells(next.cells));
    this.agentActivity.recordChanges(before.cells, next.cells);
    const note = this.definitionAt(this.activeNoteId());
    if (note?.kind === 'markdown') this.noteDraft.set(note.source);
    this.syncEditor();
    await this.evaluateGraphNow(false, true);
  }

  private setAgentTracks(change: AgentTrackChange): void {
    const prefix = change.worksheet === this.sheetName() ? '' : change.worksheet;
    const layout = this.layoutOf(prefix), next = patchTrackLayout(layout, change);
    if (this.documentChanges.same(layout, next)) return;
    this.recordHistory(true, 'Agent row/column sizing');
    this.undoStack[this.undoStack.length - 1].worksheetTracks = prefix;
    if (prefix === this.activeSheet()) this.applyLayout(next);
    else this.storedLayouts.update(layouts => ({...layouts, [prefix]: next}));
  }

  private assertAgentSettings(check: () => void): void {
    check();
    if (this.runtime.status() === 'running' || this.runtime.status() === 'loading') throw new Error('The kernel is busy. Wait for the current operation.');
    if (this.settingsOpen() || (this.sharedCodeOpen() && this.sharedCodeDraft !== this.sharedCode()))
      throw new Error('Workbook settings/shared-code editor is open. Finish the user edits first.');
  }

  private async manageAgentWorksheet(change: AgentWorksheetChange, check: () => void): Promise<void> {
    await this.workbookCommands.run(async () => {
      this.assertAgentSettings(check);
      if (!this.requireKernel()) throw new Error('Start the workbook kernel first.');
      if (change.name !== change.name.trim() || (change.newName && change.newName !== change.newName.trim())) throw new Error('Worksheet names cannot have surrounding spaces.');
      const tab = this.sheetTabs().find(tab => tab.name === change.name);
      const existingLayout = tab ? this.layoutOf(tab.prefix) : DEFAULT_SHEET_LAYOUT;
      if ((change.columns ?? existingLayout.columns) * (change.rows ?? existingLayout.rows) > 100000) throw new Error('Worksheet grid is limited to 100000 visible slots.');
      if (change.action === 'create') {
        const problem = this.duplicateNameProblem(change.name);
        if (problem) throw new Error(problem);
      } else if (!tab) throw new Error('Unknown worksheet. Inspect the overview first.');
      if (change.action === 'update' && change.newName && change.newName !== change.name) {
        const problem = this.duplicateNameProblem(change.newName);
        if (problem) throw new Error(problem);
      }
      if (change.action === 'delete') {
        if (tab!.prefix === '') throw new Error('The first worksheet cannot be deleted. Reorder sheets in the app first.');
        const removed = new Set(this.cells().filter(cell => splitCellId(cell.id)[0] === tab!.prefix).map(cell => cell.id));
        const dependents = Object.entries(this.graph().sourceDependencies ?? this.graph().dependencies)
          .filter(([id, dependencies]) => !removed.has(id) && dependencies.some(id => removed.has(id))).map(([id]) => id);
        const noteLinks = this.cells().filter(cell => !removed.has(cell.id) && (cell.source.includes('#note-' + change.name + '!') || cell.source.includes('#cell-' + change.name + '!') || cell.source.includes('#sheet-input:' + change.name + '!') || Object.values(cell.view?.widget?.actionArguments ?? {}).some(binding => binding.cell && removed.has(binding.cell))));
        dependents.push(...noteLinks.map(cell => cell.id));
        const actions = this.actionDefinitions().filter(action => rewriteActionWorksheet(action.source, change.name, '__deleted_worksheet__') !== action.source || actionReferencesCells(action.source, action.references, removed) ||
          Object.values(action.bindings).some(binding => binding.cell && removed.has(binding.cell)));
        if (!change.allowBrokenReferences && (dependents.length || actions.length))
          throw new Error(`Worksheet is referenced by cells ${dependents.join(', ')} and actions ${actions.map(action => action.name).join(', ')}. Update references first or explicitly allowBrokenReferences.`);
      }
      const before = this.cells();
      this.recordHistory(true, 'Agent worksheet ' + change.action);
      if (change.action === 'create') {
        this.extraSheets.update(names => [...names, change.name]);
        this.storedLayouts.update(layouts => ({...layouts, [change.name]: {...DEFAULT_SHEET_LAYOUT,
          columns: change.columns ?? 10, rows: change.rows ?? 16}}));
      } else if (change.action === 'delete') {
        this.deleteSheet(tab!.prefix, false, false);
        const ids = new Set(this.cells().map(cell => cell.id));
        this.noteOrder.update(order => order.filter(id => ids.has(id)));
        this.noteParents.update(parents => Object.fromEntries(Object.entries(parents).filter(([id, parent]) => ids.has(id) && ids.has(parent))));
      } else {
        if (change.newName && change.newName !== change.name) this.renameSheet(tab!.prefix, change.newName, false, false);
        const prefix = tab!.prefix === '' ? '' : change.newName ?? change.name;
        const layout = this.layoutOf(prefix);
        if (change.columns !== undefined || change.rows !== undefined)
          this.resizeAgentWorksheet(prefix, change.columns ?? layout.columns, change.rows ?? layout.rows, false);
      }
      this.graphWorkspace.resetViews();
      this.agentActivity.recordChanges(before, this.cells());
      await this.evaluateGraphNow(false, true);
      this.logSystem('info', `Agent ${change.action} worksheet ${change.name} · Undo available`);
    });
  }

  private async updateAgentEnvironment(change: AgentEnvironmentChange, check: () => void): Promise<void> {
    await this.workbookCommands.run(async () => {
      this.assertAgentSettings(check);
      if ((change.code !== undefined || change.imports !== undefined) && !this.requireKernel()) throw new Error('Start Python before applying shared code/imports.');
      const previous = this.currentDraftDocument().environment;
      this.recordHistory(true, 'Agent shared code/packages', undefined, true);
      this.setAgentEnvironment({...previous, ...change});
      try {
        if (change.code !== undefined || change.imports !== undefined) await this.evaluateGraphNow(false, true);
      } catch (error) {
        this.setAgentEnvironment(previous);
        throw new Error(`Shared code/imports were not applied; previous settings restored. ${pythonErrorMessage(error)}`);
      }
      this.logSystem('info', change.packages ? 'Agent updated package requirements; explicit kernel start/restart required · Undo available' : 'Agent updated shared code/imports · Undo available');
    });
  }

  private setAgentEnvironment(environment: SheetDocument['environment']): void {
    this.packages.set([...environment.packages]); this.packageSource = environment.packages.join('\n');
    this.imports.set([...(environment.imports ?? [])]); this.importSource = (environment.imports ?? []).join('\n');
    this.sharedCode.set(environment.code ?? '');
  }

  private agentLastFocusedAt = new Date().toISOString();
  private readonly handleAgentWindowFocus = () => { this.agentLastFocusedAt = new Date().toISOString(); };

  private agentViewContext(): AgentViewContext {
    const cell = (id: string): AgentCellContext | null => {
      if (!id) return null;
      const definition = this.definitionAt(id);
      return { id, name: definition?.name ?? '', kind: definition?.kind ?? 'empty',
        ...(definition?.kind === 'markdown' ? { title: markdownTitle(definition.source, definition.name ?? id) } : {}) };
    };
    const mode = this.viewMode();
    const views = mode === 'split' ? this.splitViews() : [mode];
    const panes = views.map((view, index) => {
      const sheet = mode === 'split' ? this.splitSheets()[index] : this.activeSheet();
      const requested = mode === 'split' ? this.splitNotes()[index] : this.activeNoteId();
      const notes = view === 'notes' ? this.notePages().filter(note => splitCellId(note.id)[0] === sheet) : [];
      const note = notes.find(note => note.id === requested) ?? notes[0];
      return { index, view, worksheet: sheet || this.sheetName(), note: note ? cell(note.id) : null };
    });
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusedTile = focused?.closest<HTMLElement>('[data-cell-id]')?.dataset['cellId'];
    const focusedEditor = focused?.closest('#cell-inspector app-python-editor');
    return { windowFocused: document.hasFocus(), lastFocusedAt: this.agentLastFocusedAt,
      view: mode, activePane: mode === 'split' ? this.activeSplitPane() : 0, panes,
      selectedCell: cell(this.selectedId()), selectedCellIds: [...this.selectedIds()],
      inspectedCell: this.inspectorVisible() ? cell(this.selectedId()) : null,
      focusedCellId: focusedTile ?? (focusedEditor && this.inspectorVisible() ? this.editorCellId : null),
      editorCellId: this.inspectorVisible() ? this.editorCellId : null,
      notesEditing: this.notesEditing(), actionsOpen: this.actionsOpen(), consoleOpen: this.consoleOpen() };
  }

  private agentDraftIds(): string[] {
    const ids = new Set(this.cellDrafts().keys());
    if (this.editorCellId && this.hasCellDraft(this.editorCellId)) ids.add(this.editorCellId);
    const note = this.definitionAt(this.activeNoteId());
    if (note?.kind === 'markdown' && note.source !== this.noteDraft()) ids.add(note.id);
    return [...ids];
  }

  private async commitAgentCells(cells: CellDefinition[]): Promise<void> {
    if (!this.requireKernel()) throw new Error('The workbook kernel is not running.');
    const previous = this.definitionMap();
    const changed = new Set(cells.filter(cell => !this.documentChanges.same(previous.get(cell.id), cell)).map(cell => cell.id));
    const nextIds = new Set(cells.map(cell => cell.id));
    for (const id of previous.keys()) if (!nextIds.has(id)) changed.add(id);
    this.recordHistory(true, 'Agent cell edits');
    this.cells.set(sortCells(cells));
    this.agentActivity.recordChanges([...previous.values()], this.cells());
    for (const id of changed) if (this.definitionAt(id)) this.growSheetToFit(splitCellId(id)[0], [id]);
    if (changed.has(this.activeNoteId())) {
      const note = this.resolveActiveNote();
      this.activeNoteId.set(note?.id ?? '');
      this.noteDraft.set(note?.source ?? '');
    }
    if (changed.has(this.selectedId())) this.syncEditor();
    this.logSystem('info', `Agent edited ${changed.size} cell${changed.size === 1 ? '' : 's'} · Undo available`);
    await this.evaluateGraphNow(false, true);
  }
  protected readonly pendingMove=signal(false);
  private readonly moveStatus=signal<string | null>(null);

  /** Set while the last file is reopened at startup. */
  protected readonly openingFile = signal<string | null>(null);

  // ── Kernel choice (stored in the worksheet) ─────────────────────────────
  /** Python version for local kernels ("" = app default). */
  protected readonly pythonVersion = signal('');
  /** The workbook's saved kernel setting, kept as is (`local` files keep `local`). */
  private documentKernel: 'pyodide' | 'local' = 'pyodide';

  // ── Shared code ───────────────────
  // Functions, classes, and constants every cell can use; saved as plain module-level
  // Python in the workbook file. Changing it recomputes the whole workbook.
  protected readonly sharedCode = this.workbookState.code;
  protected readonly sharedCodeOpen = signal(false);
  protected sharedCodeDraft = '';
  protected readonly sharedCodeError = signal<string | null>(null);
  /** Names defined in shared code, offered while typing formulas. */
  private readonly sharedCodeCompletions = computed(() => sharedCodeNames(this.sharedCode()));

  protected openSharedCode(): void {
    this.sharedCodeDraft = this.sharedCode();
    this.sharedCodeError.set(null);
    this.sharedCodeOpen.set(true);
  }

  protected async applySharedCode(): Promise<void> {
    if (!this.requireKernel()) return;
    const previous = this.sharedCode();
    this.sharedCode.set(this.sharedCodeDraft.trimEnd());
    await this.evaluateGraph();
    const error = this.evaluationError;
    if (error !== null && /Shared code/.test(error)) {
      // Keep the dialog open with the message; the previous code stays in effect.
      this.sharedCodeError.set(pythonErrorMessage(error));
      this.evaluationError = null;
      this.sharedCode.set(previous);
      await this.evaluateGraph();
      return;
    }
    this.sharedCodeOpen.set(false);
  }

  private kernelSettings(): { kernel: 'pyodide' | 'local'; python: string } {
    if (this.embeddedSession() && this.attachedKernelSettings) return this.attachedKernelSettings;
    return { kernel: this.documentKernel, python: this.pythonVersion() };
  }

  private autoDraftReady = false;
  private draftTimer: number | null = null;
  private updateFlashTimer: number | null = null;
  private updateFlashFrame: number | null = null;
  private saveFeedbackTimer: number | null = null;
  private lastNoteHistoryAt = 0;
  private lastNoteHistoryId = '';
  private activityTrackingReady = false;
  private readonly documentChanges = new DocumentChanges();
  private currentDocumentCheckpoint: DocumentCheckpoint = null;
  private savedDocumentCheckpoint: DocumentCheckpoint = null;

  protected readonly definitionMap = this.workbookState.definitionMap;
  protected readonly markdownCells = this.workbookState.markdownCells;
  protected readonly notePages = this.workbookState.notePages;
  protected readonly isNotePage = isNotePage;
  protected readonly selectedMarkdownIsPage = computed(() => {
    const cell = this.definitionAt(this.selectedId());
    return cell !== undefined && isNotePage(cell);
  });

  /** Open a Markdown cell in the Notes view; a cell note becomes a note page first. */
  protected openInNotes(cellId: string): void {
    const definition = this.definitionAt(cellId);
    if (definition?.kind !== 'markdown') return;
    if (!isNotePage(definition)) {
      if (!this.requireKernel()) return;
      this.updateCellView(cellId, (view) => ({ ...view, page: true }));
    }
    this.selectNote(cellId);
  }

  // ── Links between notes (note-links.ts) ──
  /** Notes the active note can link to (the link dialog's note list). */
  protected readonly noteLinkTargets = computed<NoteLinkTarget[]>(() => this.linksForNote(this.activeNoteId()));

  private linksForNote(noteId: string): NoteLinkTarget[] {
    const [sheet] = splitCellId(noteId);
    return this.orderedNotes()
      .filter(note => note.id !== noteId)
      .map(note => ({ href: noteLinkHref(note, sheet, this.sheetName()), title: this.noteTitle(note) }));
  }

  /**
   * A click on a `#note-…` link opens that note (staying in Note + cells when open). While
   * the note is being edited, a click places the cursor and Cmd/Ctrl+click follows it.
   */
  private readonly handleNoteLinkClick = (event: MouseEvent): void => {
    if (event.defaultPrevented || event.button !== 0) return;
    const target = event.target instanceof Element ? event.target : null;
    const link = target?.closest<HTMLAnchorElement>(`a[href^="${NOTE_LINK_PREFIX}"]`) ?? null;
    if (link === null) return;
    event.preventDefault();
    if (link.closest('[contenteditable="true"]') !== null && !event.metaKey && !event.ctrlKey) return;
    // A link in a grid cell is relative to that cell's sheet, otherwise to the open note's.
    const cell = link.closest<HTMLElement>('[data-cell-id], [id^="cell-"]');
    const [sheet] = splitCellId(cell !== null ? (cell.dataset['cellId'] ?? cell.id.slice('cell-'.length)) : this.activeNoteId());
    this.followNoteLink(link.getAttribute('href') ?? '', sheet);
  };

  /** A `#note-…` link inside HTML output (html-output.ts); relative to the open note's sheet. */
  private readonly handleHtmlNoteLink = (event: Event): void => {
    const href = (event as CustomEvent<string>).detail;
    if (typeof href === 'string') this.followNoteLink(href, splitCellId(this.activeNoteId())[0]);
  };

  protected followNoteLink(href: string, fromSheet: string): void {
    const note = resolveNoteLink(href, this.cells(), fromSheet, this.sheetName());
    if (note === undefined) {
      this.evaluationError = `There is no note "${href.slice(NOTE_LINK_PREFIX.length)}" in this workbook.`;
      return;
    }
    if (!isNotePage(note)) {
      this.selectCell(note.id);
      return;
    }
    const view = this.viewMode();
    this.selectNote(note.id);
    if (view === 'split') this.viewMode.set('split');
  }

  private readonly actionWorkspace = new ActionWorkspace({
    state: this.workbookState, commands: this.workbookCommands,
    runtime: this.runtime,
    document: () => this.currentDraftDocument(), requireKernel: () => this.requireKernel(),
    recordHistory: label => this.recordHistory(true, label),
    evaluate: propagate => propagate ? this.evaluateGraphNow(false, true) : this.evaluateGraph(),
    acceptGraph: graph => this.acceptGraph(graph), flash: ids => this.flashUpdatedCells(ids),
    acceptLiveGraph: graph => this.acceptGraph({...graph, cellChanges: [], updateTrace: this.graph().updateTrace}, false, true),
    settle: () => this.activity.settle(),
  });
  protected readonly actionDefinitions = this.workbookState.actions;
  protected readonly actionsOpen = signal(false);
  protected readonly actionInitialArguments = signal<Record<
    string,
    ActionBinding
  > | null>(null);
  protected readonly widgetActionFeedback = this.actionWorkspace.widgetActionFeedback;
  protected readonly availableActions = this.workbookState.availableActions;
  protected readonly selectedAction = this.actionWorkspace.selectedAction;
  protected readonly actionInitialSource = this.actionWorkspace.actionInitialSource;
  protected readonly actionError = this.actionWorkspace.actionError;
  protected readonly actionApplying = this.actionWorkspace.actionApplying;
  protected readonly actionApplied = this.actionWorkspace.actionApplied;
  protected readonly runningAction = this.actionWorkspace.runningAction;
  protected readonly cancellingActionNames = computed(() => this.actionWorkspace.invocations().filter(run => this.actionWorkspace.cancellingIds().has(run.id)).map(run => run.name));
  protected readonly runningActionNames = computed(() => this.actionWorkspace.invocations().map(run => run.name));

  protected readonly actionRunnerOpen = this.actionWorkspace.actionRunnerOpen;
  protected readonly runnerSelectedAction = signal('');
  protected readonly lastInvokedAction = this.actionWorkspace.lastInvokedAction;
  protected readonly pinnedActionNames = signal<string[]>([]);
  private readonly restoreActionPins = effect(() => {
    const key = `reaktiv-workbook:action-pins:${this.documentName()}`;
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
      this.pinnedActionNames.set(Array.isArray(stored) ? stored.filter((item): item is string => typeof item === 'string') : []);
    } catch { this.pinnedActionNames.set([]); }
  });
  protected toggleActionPin(name: string): void {
    this.pinnedActionNames.update(items => items.includes(name) ? items.filter(item => item !== name) : [...items, name]);
    try { localStorage.setItem(`reaktiv-workbook:action-pins:${this.documentName()}`, JSON.stringify(this.pinnedActionNames())); } catch { /* Optional device preference. */ }
  }
  /** Actions offered as buttons; run mode shows the action launcher only when there are some. */
  protected readonly hasExposedActions = computed(() => this.actionDefinitions().some(action => action.exposed));

  protected openActionRunner(name = ''): void {
    this.actionsOpen.set(false);
    this.actionInitialSource.set('');
    this.actionInitialArguments.set(null);
    this.runnerSelectedAction.set(name || this.runningAction() || this.lastInvokedAction() || '');
    this.actionRunnerOpen.set(true);
  }
  protected readonly actionCompletions = computed<readonly PythonCompletion[]>(() => {
    const items: PythonCompletion[] = [{label: 'self', type: 'variable', detail: 'This workbook · actions are workbook-owned'}];
    for (const sheet of this.sheetTabs()) items.push({label: `self.${sheet.name}`, type: 'variable', detail: 'Worksheet'});
    for (const [id, member] of workbookCellMemberNames(this.cells(), this.sheetName())) {
      const cell = this.definitionAt(id)!;
      const type = cell.annotation || this.resultMap().get(id)?.valueType || cell.kind;
      items.push({label: `self.${member}`, type: 'variable', cellId: id, detail: `${id} · ${type} · reactive handle`, info: cell.kind === 'resource' ? 'Read .value(); inspect .status(), .is_loading() and .error().' : 'Call to read; writable inputs support .set(value) and .update(fn).'});
      for (const method of [...(['input', 'linked'].includes(cell.kind) ? ['set', 'update'] : []), ...(cell.kind === 'linked' ? ['reset'] : []), ...(cell.kind === 'resource' ? ['value', 'status', 'is_loading', 'error', 'reload'] : [])])
        items.push({label: `self.${member}.${method}`, type: 'function', detail: `${id} · ${method === 'set' ? '(value)' : method === 'update' ? '(fn)' : '()'}`});
    }
    for (const method of this.actionDefinitions()) {
      const signature = method.source.split('\n')[0];
      items.push({label: `self.${method.name}`, type: 'function', detail: signature, info: method.label});
      for (const state of ['running', 'result', 'error']) items.push({label: `self.${method.name}.${state}`, type: 'function', detail: 'Read-only action state'});
    }
    return items;
  });
  protected openActions(
    name = '',
    initialArguments: Record<string, ActionBinding> | null = null,
  ): void {
    if (this.appRun()) return;
    this.actionRunnerOpen.set(false);
    this.actionInitialArguments.set(initialArguments);
    if (!name && this.runningAction()) name = this.runningAction()!;
    this.moreOpen.set(false);
    this.actionError.set('');
    this.actionInitialSource.set('');
    if (name) this.selectedAction.set(name);
    this.actionsOpen.set(true);
  }
  protected exposeSelectedFunction(): void {
    const cell = this.definitionAt(this.selectedId());
    const callable = this.resultAt(this.selectedId())?.callable;
    if (!cell || !callable) return;
    const members = workbookCellMemberNames(this.cells(), this.sheetName());
    let name = `run_${members.get(cell.id)?.replaceAll('.', '_')}`;
    let index = 2;
    while (
      this.actionDefinitions().some((item) => item.name === name) ||
      [...members.values()].includes(name)
    )
      name = `run_${members.get(cell.id)?.replaceAll('.', '_')}_${index++}`;
    const signature = callable.signature.replace('(', '(self, ');
    const arguments_ = callable.names
      .map((name) => `${name}=${name}`)
      .join(', ');
    this.openActions();
    this.actionInitialSource.set(
      `${callable.async ? 'async ' : ''}def ${name}${signature}:\n    return ${callable.async ? 'await ' : ''}self.${members.get(cell.id)}()(${arguments_})`,
    );
  }
  protected saveAction(definition: ActionDefinition): Promise<void> { return this.saving() ? Promise.resolve() : this.actionWorkspace.apply(definition); }
  protected removeAction(name: string): Promise<void> { return this.actionWorkspace.remove(name); }
  protected saveActionBindings(event: {name: string; bindings: Record<string, ActionBinding>}): Promise<void> {
    return this.actionWorkspace.saveBindings(event);
  }
  protected invokeAction(event: {name: string; arguments: Record<string, ActionBinding>}): Promise<void> {
    if (this.saving() || this.actionWorkspacePanel?.hasUnappliedDrafts) {
      const message = this.saving() ? 'Wait for the workbook save to finish before running an action.'
        : `Action ${event.name} was not run: there are unapplied action edits. Apply the edits or save the workbook first.`;
      this.actionError.set(message);
      if (!this.actionsOpen()) this.openActionRunner(event.name);
      const feedback = this.widgetActionFeedback();
      if (feedback?.name === event.name) this.widgetActionFeedback.set({ ...feedback, error: message });
      return Promise.resolve();
    }
    return this.actionWorkspace.invoke(event).then(() => undefined);
  }
  protected cancelAction(name: string, runId?: string): Promise<void> { return this.actionWorkspace.cancel(name, runId); }

  protected triggerWidgetAction(event: WidgetActionRequest): void {
    if (
      !this.requireKernel() ||
      (this.runtime.status() === 'running' && !this.runningAction())
    )
      return;
    const widget = this.tileWidget(event.cellId);
    if (this.resultAt(event.cellId)?.widgetError || widgetBlocked(widget))
      return;
    const run = this.actionWorkspace.invocations().find(item => item.name === event.name);
    if (widget.cancelWhileRunning && run) {
      void this.cancelAction(run.name, run.id);
      return;
    }
    const action = this.graph().actions?.find(
      (item) => item.name === event.name,
    );
    this.widgetActionFeedback.set({
      cellId: event.cellId,
      name: event.name,
      error: '',
    });
    if (!action) {
      this.widgetActionFeedback.set({
        cellId: event.cellId,
        name: event.name,
        error: `Unknown action: ${event.name}`,
      });
      return;
    }
    const bindings = { ...action.bindings, ...event.arguments };
    if (
      action.parameters.some(
        (parameter) =>
          parameter.required &&
          (!bindings[parameter.name] || bindings[parameter.name].default),
      )
    ) {
      this.openActionRunner(event.name);
      this.actionInitialArguments.set(event.arguments);
      return;
    }
    void this.invokeAction(event);
  }

  protected actionResult(name: string | undefined) {
    return this.graph().actions?.find((item) => item.name === name);
  }

  private readonly handleActionClick = (event: MouseEvent): void => {
    const target =
      event.target instanceof Element
        ? event.target.closest<HTMLAnchorElement>('a[href^="#sheet-action:"]')
        : null;
    if (!target) return;
    if (
      target.closest('[contenteditable="true"]') &&
      !event.ctrlKey &&
      !event.metaKey
    )
      return;
    event.preventDefault();
    const name = decodeURIComponent(
      (target.getAttribute('href') ?? '').slice('#sheet-action:'.length),
    );
    const action = this.graph().actions?.find((item) => item.name === name);
    if (!action) {
      this.evaluationError = `Unknown action: ${name}`;
      return;
    }
    if (
      action?.parameters.some(
        (parameter) => parameter.required && !action.bindings[parameter.name],
      )
    )
      this.openActionRunner(name);
    else void this.invokeAction({ name, arguments: {} });
  };

  // ── Print / export notes ──────────────────────────────────────────────
  // A snapshot of what the notes show: current values, tables, and plots (see
  // note-export.ts). Printing renders the chosen notes into .print-root (styles.scss).
  protected readonly exportDialog = signal<{ ids: ReadonlySet<string>; format: NoteExportFormat } | null>(
    null,
  );
  protected readonly printHtml = signal<string | null>(null);

  protected openExportDialog(): void {
    this.commitNoteDraftIfNeeded(false);
    const active = this.activeNoteId();
    const ids = this.notePages().some((note) => note.id === active)
      ? new Set([active])
      : new Set(this.notePages().slice(0, 1).map((note) => note.id));
    this.exportDialog.set({ ids, format: this.exportDialog()?.format ?? 'markdown' });
  }

  protected toggleExportNote(id: string, checked: boolean): void {
    this.exportDialog.update((dialog) => {
      if (dialog === null) return dialog;
      const ids = new Set(dialog.ids);
      if (checked) ids.add(id);
      else ids.delete(id);
      return { ...dialog, ids };
    });
  }

  protected selectAllExportNotes(all: boolean): void {
    this.exportDialog.update((dialog) =>
      dialog === null
        ? dialog
        : { ...dialog, ids: new Set(all ? this.orderedNotes().map((note) => note.id) : []) },
    );
  }

  protected setExportFormat(format: NoteExportFormat): void {
    this.exportDialog.update((dialog) => (dialog === null ? dialog : { ...dialog, format }));
  }

  /**
   * The chosen notes in list order, rendered from the current results. Interactive
   * charts become PNG images (drawn by plotly.js) so the output is self-contained.
   */
  private async exportedNotes(ids: ReadonlySet<string>): Promise<ExportedNote[]> {
    const results = this.resultMap();
    const notes = this.orderedNotes().filter((note) => ids.has(note.id));
    const cells = this.cells();
    // Links to exported notes jump to their section in HTML; other note links become text.
    const noteAnchors = (html: string, from: string): string =>
      html.replace(/href="(#note-[^"]+)"/g, (match, href: string) => {
        const target = resolveNoteLink(href, cells, splitCellId(from)[0], this.sheetName());
        return target !== undefined && ids.has(target.id) ? `href="#${escapeHtml(target.id)}"` : match;
      });
    return Promise.all(
      notes.map(async (note) => {
        // Embed plots first (charts arrive as Plotly specs), then draw charts as PNG.
        // Exported and printed notes are self-contained: images from assets/ go inline.
        const markdown = await plotlySpecsToPng(
          embedCellImages(await this.assets.inline(results.get(note.id)?.display || note.source), results),
        );
        await prepareMermaid(markdown); // diagrams are rendered asynchronously
        await prepareCode(markdown); // so is code highlighting
        return {
          id: note.id,
          title: this.noteTitle(note),
          markdown: withoutAppLinksMarkdown(markdown),
          html: withoutAppLinksHtml(noteAnchors(renderMarkdownForExport(markdown), note.id)),
        };
      }),
    );
  }

  protected async exportNotes(): Promise<void> {
    const dialog = this.exportDialog();
    if (dialog === null || dialog.ids.size === 0) return;
    const notes = await this.exportedNotes(dialog.ids);
    const stem = notes.length === 1 ? notes[0].title : this.documentName();
    const filename = exportFileName(stem, dialog.format);
    const content =
      dialog.format === 'markdown' ? notesToMarkdown(notes) : notesToHtml(stem, notes);
    try {
      const saved = await this.workbookFiles.exportText(
        content,
        filename,
        dialog.format === 'markdown'
          ? { name: 'Markdown', extensions: ['md'], mimeType: 'text/markdown' }
          : { name: 'HTML', extensions: ['html'], mimeType: 'text/html' },
      );
      if (saved === null) return;
      this.exportDialog.set(null);
      this.showSaveFeedback(
        `Exported ${notes.length === 1 ? '1 note' : `${notes.length} notes`} to ${fileNameFromPath(saved)}`,
      );
    } catch (error) {
      this.evaluationError = `Could not export: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  protected async printNotes(): Promise<void> {
    const dialog = this.exportDialog();
    if (dialog === null || dialog.ids.size === 0) return;
    const notes = await this.exportedNotes(dialog.ids);
    this.printHtml.set(
      notes.map((note) => `<section class="print-note markdown-content">${note.html}</section>`).join(''),
    );
    this.exportDialog.set(null);
    const done = () => {
      this.printHtml.set(null);
      window.removeEventListener('afterprint', done);
    };
    window.addEventListener('afterprint', done);
    // Let the print view render (and images decode) before the print dialog opens.
    requestAnimationFrame(() =>
      setTimeout(async () => {
        try {
          await (window.print() as unknown as Promise<void> | undefined);
        } catch (error) {
          this.evaluationError = `Could not print: ${error instanceof Error ? error.message : String(error)}`;
        }
      }, 50),
    );
  }

  protected setSaveInputValue(cellId: string, saveValue: boolean): void {
    if (!this.requireKernel() || this.runtime.status() === 'running') return;
    const current = this.definitionAt(cellId);
    if (current?.kind !== 'input' || (current.saveValue !== false) === saveValue) return;
    this.recordHistory();
    this.cells.update(cells => cells.map(cell => cell.id === cellId
      ? { ...cell, saveValue: saveValue ? undefined : false } : cell));
    void this.evaluateGraph();
  }

  protected setNotePage(cellId: string, page: boolean): void {
    if (this.definitionAt(cellId)?.kind !== 'markdown') return;
    this.updateCellView(cellId, (view) => ({ ...view, page }));
  }
  /**
   * Results by cell. Input cells missing from the graph (not run yet, or added after the
   * saved outputs were taken) get their value from their literal source, so notes and
   * widgets work without executing anything.
   */
  protected readonly resultMap = this.workbookState.resultMap;
  protected readonly artifactCells = this.workbookState.artifactCells;
  protected readonly noteValues = computed<MarkdownInterpolationValue[]>(() => this.valuesForNote(this.activeNoteId()));

  private valuesForNote(selected: string): MarkdownInterpolationValue[] {
    const results = this.resultMap();
    return this.cells()
      .filter((cell) => cell.id !== selected)
      .flatMap((cell) => {
        const result = results.get(cell.id);
        const value = {
          cellId: cell.id,
          display: result?.display ?? '',
          // Not computed yet (never run, or added after the saved outputs): a quiet
          // placeholder, not an error.
          pending: result === undefined,
          error: result?.error ?? null,
          value: result?.value,
          editable: cell.kind === 'input' || cell.kind === 'linked',
          artifact: result?.artifact,
          richOutput: result?.richOutput,
          table: result?.table,
          kind: cell.kind,
          linkedOverride: result?.linkedOverride,
          widget: result?.widget ?? (cell.view?.widget ? widgetFor(result?.value,cell.view.widget) : undefined),
          widgetError: result?.widgetError,
        };
        // References as the note's source writes them: the label, a coordinate relative
        // to the note's sheet (A1 on the same sheet, Budget.A1 elsewhere), and the id.
        const relative = relativeReference(splitCellId(selected)[0], cell.id, this.sheetName());
        return [...new Set([cell.name ? cellReference(splitCellId(selected)[0], cell, this.sheetName()) : undefined, relative, cell.id.includes('!') || splitCellId(cell.id)[0] === splitCellId(selected)[0] ? cell.id : undefined].filter(Boolean))].map((reference) => ({
          ...value,
          reference: reference!,
        }));
      });
  }
  protected readonly markdownHtmlMap = computed(() => {
    // Formulas and diagrams render once KaTeX / Mermaid have loaded (lazily): re-render then.
    const revision = `${mathRevision()}:${mermaidRevision()}:${codeRevision()}`;
    this.noteRenderer.invalidate(revision);
    const results = this.resultMap();
    const cells = this.cells();
    this.noteRenderer.retainCells(cells.filter(cell => cell.kind === 'markdown'
      || (results.get(cell.id)?.valueType === 'str' && !results.get(cell.id)?.error && this.rendersMarkdown(cell.id)))
      .map(cell => cell.id));
    this.assets.revision(); // re-render when an image becomes showable
    return new Map(
      cells
        .filter((cell) => cell.kind === 'markdown')
        .map((cell) => [
          cell.id,
          embedCellImageSources(this.noteRenderer.renderCell(cell.id, this.assets.toDisplay(results.get(cell.id)?.display ?? '')), results),
        ]),
    );
  });
  /** Short worksheet labels use the same rendered Markdown cache as the grid. */
  protected readonly worksheetLabelIds = computed(() => {
    const results = this.resultMap();
    const html = this.markdownHtmlMap();
    return new Set(this.cells().filter(cell => {
      if (cell.kind !== 'markdown') return false;
      const result = results.get(cell.id);
      const text = result?.display.trim() ?? '';
      if (!text || result?.error || result?.richOutput || result?.table || result?.artifact
        || /[\r\n]|<\/?[a-z][^>]*>|!\[/i.test(text)) return false;
      const rendered = html.get(cell.id) ?? '';
      return /^<(?:p|h[1-6])(?:>|\s)/.test(rendered)
        && !/<(?:img|svg|video|audio|iframe|canvas|table|pre|ul|ol|blockquote|div|br|hr|reaktiv-)\b/i.test(rendered);
    }).map(cell => cell.id));
  });

  protected readonly selectedDependencies = computed(
    () => new Set(this.graph().dependencies[this.selectedId()] ?? []),
  );
  protected readonly selectedDependents = computed(
    () => new Set(this.workbookState.dependents().get(this.selectedId()) ?? []),
  );
  protected readonly selectedResult = computed(() => this.resultMap().get(this.selectedId()));
  // ── Logs panel (log-view.ts) ──────────────────────────────────────────
  /** Failed cells as root causes, with the cells failing because of them. */
  protected readonly problems = this.workbookState.problems;
  protected readonly logFilter = signal<LogFilter>('all');
  protected readonly logSearch = signal('');
  protected readonly logsCopied = signal(false);
  /** App and kernel events (starting Python, installing packages, failed actions). */
  private readonly systemLogs = signal<LogEntry[]>([]);
  private readonly liveLogs = signal<LogEntry[]>([]);
  private readonly logSubscription = this.runtime.onLog(entry => {
    this.liveLogs.update(entries => [...entries.slice(-499), entry]);
  });
  private readonly allLogs = computed(() => [...this.graph().logs, ...this.liveLogs(), ...this.systemLogs()]);
  protected readonly visibleLogs = computed(() =>
    filterLogs(this.allLogs(), this.logFilter(), this.logSearch(), this.cellLabel),
  );
  protected readonly logCounts = computed(() => {
    const logs = this.allLogs();
    const cellLogs = logs.filter((entry) => entry.cellId !== '');
    return {
      problems: this.problems().length,
      all: logs.length,
      error: cellLogs.filter((entry) => entry.level === 'error').length,
      warning: cellLogs.filter((entry) => entry.level === 'warning').length,
      info: cellLogs.filter((entry) => entry.level === 'info').length,
      system: logs.length - cellLogs.length,
    };
  });
  protected readonly logFilters: ReadonlyArray<{ id: LogFilter; label: string }> = [
    { id: 'problems', label: 'Problems' },
    { id: 'all', label: 'All' },
    { id: 'error', label: 'Errors' },
    { id: 'warning', label: 'Warnings' },
    { id: 'info', label: 'Output' },
    { id: 'system', label: 'App' },
  ];
  protected readonly cellLabel = (cellId: string): string => this.definitionAt(cellId)?.name ?? '';
  private readonly statusLogger = effect(() => {
    const message = this.runtime.statusMessage();
    if (message && !isRoutineStatus(message)) untracked(() => this.logSystem('info', message));
  });
  private readonly runtimeErrorLogger = effect(() => {
    const message = this.runtime.error();
    if (message) untracked(() => this.logSystem('error', message));
  });

  // ── Cell activity ──────────────
  // Cells that depend on an edit are pending until their new value arrives; the cell Python
  // is computing right now is running. Grid cells read it through cellClasses, note values
  // through `data-cells` (markActivity), the status bar through activityMessage.
  protected readonly activity = new CellActivityTracker();
  private readonly progressSubscription = this.runtime.onProgress((progress) => {
    this.activity.progress(progress);
    if (progress.event === 'start' && this.resourceCancelMessage()?.id === progress.cellId) this.resourceCancelMessage.set(null);
  });
  protected readonly cancellingResources = signal<ReadonlySet<string>>(new Set());
  protected readonly resourceCancelMessage = signal<{id: string; text: string} | null>(null);
  protected canCancelResource(cellId: string): boolean {
    return this.definitionAt(cellId)?.kind === 'resource' && this.activity.isRunning(cellId);
  }
  protected async cancelResource(cellId: string): Promise<void> {
    if (!this.canCancelResource(cellId) || this.cancellingResources().has(cellId)) return;
    const generation = this.workbookCommands.generation;
    if (this.activity.current()?.id === cellId) this.stopRequest.set({cellId, at: performance.now()});
    this.cancellingResources.update(ids => new Set(ids).add(cellId));
    try {
      const accepted = await this.runtime.cancelResource(cellId);
      if (generation !== this.workbookCommands.generation) return;
      const text = accepted ? `Cancelled ${this.cellTitle(cellId)}. Its previous value is kept; a parameter or code change starts a new load.` : `${this.cellTitle(cellId)} already finished loading.`;
      this.resourceCancelMessage.set({id: cellId, text});
      this.logSystem('info', text);
    } catch (error) {
      if (generation !== this.workbookCommands.generation) return;
      const text = `Could not cancel ${this.cellTitle(cellId)}: ${error instanceof Error ? error.message : String(error)}`;
      this.resourceCancelMessage.set({id: cellId, text});
      this.logSystem('error', text);
    } finally {
      if (generation === this.workbookCommands.generation) this.cancellingResources.update(ids => new Set([...ids].filter(id => id !== cellId)));
    }
  }
  /** What the last update sent to Python, to tell which cells an edit changes. */
  private appliedCells = new Map<string, CellDefinition>();
  private readonly noteActivity = effect(() => markActivity(document, this.activity.states()));
  private readonly activityClock = signal(0);
  private activityTimer: number | null = null;
  private readonly activityClockRunner = effect(() => {
    const running = this.activity.current() !== null || this.runtime.status() === 'running';
    if (running && this.activityTimer === null) {
      this.activityTimer = window.setInterval(() => this.activityClock.set(performance.now()), 250);
    } else if (!running && this.activityTimer !== null) {
      window.clearInterval(this.activityTimer);
      this.activityTimer = null;
    }
    if (!running) untracked(() => this.stopRequest.set(null));
  });
  /** "Running load_data (B3) · 2.4 s" once a cell has run for a moment (fast ones never show). */
  protected readonly activityMessage = computed(() => {
    if (this.moveStatus()) return this.moveStatus();
    const current = this.activity.current();
    if (current === null) return null;
    const seconds = (this.activityClock() - current.since) / 1000;
    if (seconds < 0.3) return null;
    const label = this.cells().find((cell) => cell.id === current.id)?.name;
    return `Running ${label ? `${label} (${current.id})` : current.id} · ${seconds.toFixed(1)} s`;
  });

  /** After Stop, a cell still running this long later can be force-stopped (kernel restart). */
  private static readonly FORCE_STOP_MS = 2500;
  private readonly stopRequest = signal<{ cellId: string | null; at: number } | null>(null);

  /** Interrupt is available immediately, including actions and console commands. */
  protected readonly stopAction = computed<'stop' | 'stopping' | 'force' | null>(() => {
    const current = this.activity.current();
    if (current === null && this.runtime.status() !== 'running') return null;
    const now = this.activityClock();
    const request = this.stopRequest();
    if (request && request.cellId === (current?.id ?? null)) {
      return now - request.at > App.FORCE_STOP_MS ? 'force' : 'stopping';
    }
    return 'stop';
  });

  protected readonly stopLabel = computed(() => this.stopAction() === 'force' ? 'Force stop kernel'
    : this.canCancelResource(this.activity.current()?.id ?? '') ? 'Cancel resource load' : 'Interrupt kernel');

  /**
   * Stop the cell that runs too long: interrupt it where the kernel can (local
   * and remote Python keep their state); restart Pyodide, or a local kernel that does not
   * react. The cell stays stopped until it is changed or run again.
   */
  protected async stopRunningCell(forceOverride?: boolean, assertCurrent?: () => void): Promise<void> {
    const current = this.activity.current();
    if (current === null && this.runtime.status() !== 'running') return;
    if (current !== null && this.canCancelResource(current.id) && !(forceOverride ?? this.stopAction() === 'force')) {
      await this.cancelResource(current.id);
      return;
    }
    const action = this.stopAction();
    const force = forceOverride ?? action === 'force';
    if (action === 'stopping' && !force) return;
    const label = current ? this.cellTitle(current.id) : 'Python execution';
    const resume = current ? ' Change the cell or apply it to run it again.' : '';
    const restarts = force || this.runtime.kernel() === 'pyodide';
    this.stopRequest.set({ cellId: current?.id ?? null, at: performance.now() });
    if (restarts && current !== null) {
      this.evaluationGeneration++; // the update in flight ends with the kernel
      this.activity.settle();
    }
    try {
      const outcome = await this.runtime.stopRun(current?.id ?? null, force);
      assertCurrent?.();
      if (outcome === 'restarted') {
        this.logSystem('warning', `Stopped ${label}: Python was restarted.${resume}`);
        this.stopRequest.set(null);
        await this.evaluateGraph();
      } else if (outcome === 'interrupted') {
        this.logSystem('warning', `Stopped ${label}.${resume}`);
      } else if (outcome === 'unavailable') {
        this.evaluationError = `${label} does not stop, and a remote kernel cannot be restarted from here. Restart it where it runs.`;
      }
    } catch (error) {
      if (assertCurrent) throw error;
      this.evaluationError = `Could not stop ${label}: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private cellTitle(cellId: string): string {
    const name = this.definitionAt(cellId)?.name;
    return name ? `${name} (${cellId})` : cellId;
  }

  /** What the last finished update ran, to show an edited input before Python has it. */
  private readonly completedCells = signal<ReadonlyMap<string, CellDefinition>>(new Map());

  /** An input edited while an update runs shows what was typed, not the old value. */
  protected typedInputAt(cellId: string): string | null {
    const definition = this.definitionAt(cellId);
    if (definition?.kind !== 'input' || this.activity.states().size === 0) return null;
    const completed = this.completedCells().get(cellId);
    if (completed !== undefined && completed.source === definition.source) return null;
    return definition.source.replace(/^(?:\s*#.*\n)+/, '').trim();
  }

  /** Cells whose value an update of `cells` will change: the edited cells and everything
   * that reads them (inputs are not waited for: they hold what was typed). */
  private pendingAfter(cells: readonly CellDefinition[]): string[] {
    const changed: string[] = [];
    const next = new Map(cells.map((cell) => [cell.id, cell]));
    for (const cell of cells) {
      const before = this.appliedCells.get(cell.id);
      if (before === undefined || !sameComputation(before, cell)) changed.push(cell.id);
    }
    for (const id of this.appliedCells.keys()) if (!next.has(id)) changed.push(id);
    return [...affectedCellIds(changed, this.graph().dependencies)].filter((id) => {
      const kind = next.get(id)?.kind;
      return kind !== undefined && kind !== 'input';
    });
  }

  private logSystem(level: LogEntry['level'], message: string): void {
    const last = this.systemLogs().at(-1);
    if (last?.message === message && last.level === level) return;
    this.systemLogs.update((logs) => [
      ...logs.slice(-199),
      { timestamp: new Date().toISOString(), cellId: '', level, message },
    ]);
  }
  protected readonly gridTemplateColumns = computed(
    () =>
      `38px ${this.columns()
        .map((column) => `${this.columnWidths()[column] ?? 112}px`)
        .join(' ')}`,
  );
  protected readonly gridTemplateRows = computed(
    () =>
      `32px ${this.rows()
        .map((row) => `${this.rowHeights()[String(row)] ?? 45}px`)
        .join(' ')}`,
  );
  // ── Graph view ───────────────────────────────────────────────────────
  // Focus, depth, and filters keep large graphs readable (see graph-layout.ts).
  protected readonly activeSheet = signal('');
  private readonly graphWorkspace = new GraphWorkspace(this.workbookState, this.selectedId, this.activeSheet);
  protected readonly updateTracingAvailable = updateTracingEnabled();
  protected readonly traceUpdates = this.graphWorkspace.traceUpdates;
  protected readonly updateTracePath = this.graphWorkspace.updateTracePath;
  protected readonly updateStates = UPDATE_STATES;
  protected readonly updateExplanation = updateExplanation;
  protected readonly updateTraceIds = this.graphWorkspace.updateTraceIds;
  protected setTraceUpdates(enabled:boolean):void {
    this.traceUpdates.set(this.updateTracingAvailable && enabled);
    if (!enabled) this.updateTracePath.set(null);
  }
  protected inspectTraceCell(id:string):void {
    if (!this.definitionAt(id)) return;
    this.showInspector();
    const [sheet]=splitCellId(id);
    if (sheet!==this.activeSheet()) this.switchSheet(sheet);
    this.selectCell(id);
  }
  protected showUpdateTrace(path:{id:string;direction:'upstream'|'downstream'}):void {
    if (!this.updateTracingAvailable || !this.graph().updateTrace?.cells[path.id]) return;
    this.commitNoteDraftIfNeeded();
    this.unpinGraph(-1);
    this.traceUpdates.set(true);
    this.updateTracePath.set(path);
    this.inspectTraceCell(path.id);
    this.viewMode.set('graph');
  }
  protected readonly graphConnections = this.graphWorkspace.connections;
  protected setGraphConnections(value: string): void {
    if (value !== 'selected' && value !== 'all') return;
    this.graphConnections.set(value);
    this.storeGraphSettings();
  }
  protected setGraphInputsFirst(index: number, enabled: boolean): void {
    this.unpinGraph(index);
    this.graphWorkspace.inputsFirst.set(enabled);
    this.storeGraphSettings();
  }
  protected readonly graphScrollableLevels = this.graphWorkspace.scrollableLevels;
  protected graphLevelState(index: number) { return this.graphWorkspace.levelState(this.graphPinIndex(index)); }
  protected setGraphScrollableLevels(enabled: boolean): void {
    this.graphWorkspace.scrollableLevels.set(enabled);
    this.storeGraphSettings();
  }
  protected readonly graphFocus = this.graphWorkspace.graphFocus;
  protected readonly graphDepth = this.graphWorkspace.graphDepth;
  protected readonly graphHideNotes = this.graphWorkspace.graphHideNotes;
  protected readonly graphHideText = this.graphWorkspace.graphHideText;
  protected readonly graphHideIsolated = this.graphWorkspace.graphHideIsolated;
  protected readonly graphErrorsOnly = this.graphWorkspace.graphErrorsOnly;
  protected readonly graphErrors = this.workbookState.errors;
  protected readonly graphThisSheet = this.graphWorkspace.graphThisSheet;
  protected readonly graphZoom = signal(1);
  protected readonly graphNodeWidth = NODE_WIDTH;
  protected readonly graphNodeHeight = NODE_HEIGHT;
  protected readonly graphDependencies = this.workbookState.graphDependencies;
  protected readonly graphLayout = computed(() => this.singlePane().graph());
  protected readonly splitGridTemplate = computed(
    () =>
      `minmax(0, ${this.splitPosition()}fr) 8px minmax(0, ${100 - this.splitPosition()}fr)`,
  );
  /** Clock cells (every/at) by cell id. */
  protected readonly timerMap = this.workbookState.timerMap;
  private readonly timerScheduler = new TimerScheduler((cellId) => this.tickTimer(cellId));
  /** Clocks tick only while Python runs the workbook. */
  private readonly timerWatcher = effect(() => {
    const timers = this.graph().timers ?? [];
    this.timerScheduler.schedule(this.kernelRunning() && !this.embeddedSession() && !this.pendingMove() ? timers : []);
  });
  private readonly draftWatcher = effect(() => {
    this.cellDrafts(); // cell drafts are part of the window's unsaved work
    const enabled = this.autoDraftEnabled();
    const document = this.currentDraftDocument();
    const requireExplicitStart = this.pendingStart();
    const checkpoint = document;
    if (this.activityTrackingReady && !this.documentChanges.same(checkpoint, this.currentDocumentCheckpoint)) {
      this.currentDocumentCheckpoint = checkpoint;
      this.lastEditedAt.set(new Date().toISOString());
      this.hasUnsavedChanges.set(!this.documentChanges.same(checkpoint, this.savedDocumentCheckpoint));
    }
    if (this.autoDraftReady && enabled) this.scheduleDraftSave(document, requireExplicitStart);
  });

  /**
   * Saved outputs: when a document carries a snapshot, its values are shown right away
   * (notes readable without running the graph) until live results replace them.
   * `snapshotSavedAt` is set while the grid and notes show snapshot values.
   */
  protected readonly snapshotSavedAt = signal<string | null>(null);
  protected readonly cellConnections = signal<ConnectionSettings>({upstream: true, downstream: true, depth: 0});
  protected readonly cellTypeFocus = signal<CellKind | ''>('');
  protected readonly focusedTypeIds = computed(() => new Set(this.cells().filter(cell => !this.cellTypeFocus() || cell.kind === this.cellTypeFocus()).map(cell => cell.id)));
  protected readonly cellSearchOpen = signal(false);
  protected readonly commandPaletteOpen = signal(false);
  protected openCommandPalette(): void {
    this.moreOpen.set(false);
    this.commandPaletteOpen.set(true);
  }

  /**
   * Every command in one searchable list (Ctrl/Cmd+K). Rare commands live here and in the
   * More menu instead of the top bar. Run mode lists what a reader may do: views, actions.
   */
  protected readonly paletteCommands = computed<PaletteCommand[]>(() => {
    const run = this.appRun(), editing = this.workbookEditing(), running = this.kernelRunning();
    const commands: PaletteCommand[] = [
      { id: 'view-notes', group: 'View', label: 'Show notes', run: () => this.showNotes() },
      { id: 'view-cells', group: 'View', label: 'Show cells', run: () => this.switchFromNotes('sheet') },
      { id: 'view-graph', group: 'View', label: 'Show graph', run: () => this.switchFromNotes('graph') },
      { id: 'view-split', group: 'View', label: 'Show side by side (split)', run: () => this.showSplit() },
    ];
    for (const action of this.actionDefinitions().filter(item => item.exposed))
      commands.push({ id: 'action-' + action.name, group: 'Actions', label: 'Run action: ' + (action.label || action.name),
        disabled: !running, run: () => this.openActionRunner(action.name) });
    commands.push({ id: 'cell-search', group: 'Workbook', label: 'Search cells', shortcut: 'Ctrl/Cmd+Shift+F', run: () => this.openCellSearch() });
    if (!run) {
      commands.push(
        { id: 'edit-mode', group: 'Workbook', label: editing ? 'Switch to view mode' : 'Switch to edit mode', shortcut: 'Ctrl/Cmd+Shift+E', run: () => this.toggleNotesEditing() },
        { id: 'actions-editor', group: 'Workbook', label: 'Edit actions', run: () => this.openActions() },
        { id: 'shared-code', group: 'Workbook', label: 'Shared code', run: () => this.openSharedCode() },
        { id: 'inspector', group: 'Workbook', label: this.inspectorVisible() ? 'Hide cell panel' : 'Show cell panel', shortcut: 'I', run: () => this.toggleInspector() },
        { id: 'undo', group: 'Workbook', label: 'Undo', shortcut: 'Ctrl/Cmd+Z', disabled: !this.hasUndo(), run: () => this.undo() },
        { id: 'redo', group: 'Workbook', label: 'Redo', shortcut: 'Ctrl/Cmd+Y', disabled: !this.hasRedo(), run: () => this.redo() },
        { id: 'save', group: 'File', label: 'Save', shortcut: 'Ctrl/Cmd+S', disabled: this.saving(), run: () => void this.saveSheet() },
        { id: 'save-as', group: 'File', label: 'Save as…', disabled: this.saving(), run: () => void this.saveSheet({ saveAs: true }) },
        { id: 'new', group: 'File', label: 'New workbook', shortcut: 'Ctrl/Cmd+Alt+N', run: () => this.openNewProject() },
        { id: 'new-window', group: 'File', label: 'New window', run: () => void this.openNewWindow() },
        { id: 'open', group: 'File', label: 'Open workbook…', shortcut: 'Ctrl/Cmd+O', run: () => {
          const input = document.querySelector<HTMLInputElement>('.topbar .file-input');
          if (input) void this.openSheet(input);
        } },
        ...this.examples.map(example => ({ id: 'example-' + example.file, group: 'Examples', label: 'Open example: ' + example.title,
          run: () => void this.openExample(example.file) })),
        { id: 'kernel-start', group: 'Python', label: 'Start Python', disabled: running || this.runtime.status() === 'loading', run: () => void this.enableWorkbook() },
        { id: 'kernel-stop', group: 'Python', label: this.stopLabel(), shortcut: 'Ctrl/Cmd+.', disabled: !this.stopAction() || this.stopAction() === 'stopping', run: () => void this.stopRunningCell() },
        { id: 'kernel-restart', group: 'Python', label: this.embeddedSession() ? 'Reconnect to Python script' : 'Restart Python', disabled: this.pendingStart() || this.runtime.status() === 'loading', run: () => void this.restartKernel() },
        { id: 'logs', group: 'Tools', label: 'Logs', shortcut: 'Ctrl/Cmd+Shift+L', run: () => this.toggleLogs() },
        { id: 'artifacts', group: 'Tools', label: 'Generated artifacts', run: () => this.toggleArtifacts() },
        { id: 'agent', group: 'Tools', label: 'Agent access (MCP)', run: () => this.agentAccessOpen.set(true) },
        { id: 'settings', group: 'Tools', label: 'Settings', shortcut: 'Ctrl/Cmd+,', run: () => this.openSettings() },
        { id: 'theme', group: 'Tools', label: 'Change theme', run: () => this.cycleTheme() },
        { id: 'getting-started', group: 'Tools', label: 'Getting started', run: () => this.showGettingStarted() },
      );
      if (this.git()) commands.push({ id: 'git', group: 'Tools', label: 'Git', run: () => void this.openGitPanel() });
    }
    return commands;
  });
  protected readonly searchableCells = computed(() => {
    const cells = new Map(this.cells().map(cell => [cell.id, cell]));
    for (const [id, draft] of this.cellDrafts()) cells.set(id, {id, enabled: true, ...cells.get(id), kind: draft.kind, name: draft.name, source: draft.source, params: draft.params, computation: draft.computation, annotation: draft.annotation, equal: draft.equal});
    const note = cells.get(this.activeNoteId());
    if (note?.kind === 'markdown' && !this.cellDrafts().has(note.id) && (this.viewMode() === 'notes' || this.viewMode() === 'split')) cells.set(note.id, {...note, source: this.noteDraft()});
    return [...cells.values()];
  });
  protected openCellSearch(): void { if (this.editorCellId !== null) this.stashEditorDraft(this.editorCellId); this.syncEditor(); this.cellSearchOpen.set(true); }
  protected chooseSearchCell(id: string): void { this.cellSearchOpen.set(false); this.cellTypeFocus.set(''); this.openReferencedCell(id); }
  protected readonly consoleOpen = signal(false);
  protected readonly consoleCreated = signal(false);
  protected toggleConsole(): void {
    if (this.appRun()) return;
    this.consoleCreated.set(true);
    this.consoleOpen.update(value => !value);
    this.logsOpen.set(false);
    this.artifactsOpen.set(false);
  }
  protected readonly showCellMemory = signal(false);
  protected readonly cellMemory = signal<CellMemoryReport>({});
  private memoryGeneration = 0;
  private memoryTimer: ReturnType<typeof setTimeout> | null = null;
  private memoryBusy = false;
  private memoryQueued = false;
  private readonly trackCellMemory = effect(() => {
    this.graph();
    const enabled = this.showCellMemory() && this.kernelRunning();
    this.memoryGeneration++;
    if (this.memoryTimer !== null) clearTimeout(this.memoryTimer);
    if (!enabled) { this.cellMemory.set({}); return; }
    this.memoryTimer = setTimeout(() => void this.refreshCellMemory(), 200);
  });

  protected setShowCellMemory(enabled: boolean): void {
    this.showCellMemory.set(enabled);
    try { localStorage.setItem('reaktiv-workbook:show-cell-memory', String(enabled)); } catch { /* device preference unavailable */ }
  }

  protected async refreshCellMemory(): Promise<void> {
    if (!this.showCellMemory() || !this.kernelRunning()) return;
    if (this.memoryBusy) { this.memoryQueued = true; return; }
    this.memoryBusy = true;
    const generation = this.memoryGeneration;
    try {
      const result = await this.runtime.cellMemory();
      if (generation === this.memoryGeneration && this.showCellMemory()) this.cellMemory.set(result);
    } catch {
      if (generation === this.memoryGeneration) this.cellMemory.set({});
    } finally {
      this.memoryBusy = false;
      if (this.memoryQueued) { this.memoryQueued = false; void this.refreshCellMemory(); }
    }
  }

  protected readonly occupiedExtent = computed(() => this.extentForSheet(this.activeSheet()));

  private extentForSheet(sheet: string): {columns: number; rows: number} {
    let columns = 1, rows = 1;
    for (const cell of this.cells()) {
      if (splitCellId(cell.id)[0] !== sheet) continue;
      const [column, row] = cellPosition(cell.id);
      columns = Math.max(columns, column + (cell.view?.span?.[0] ?? 1) - 1);
      rows = Math.max(rows, row + (cell.view?.span?.[1] ?? 1) - 1);
    }
    for (const id of this.cellDrafts().keys()) {
      if (splitCellId(id)[0] !== sheet) continue;
      const [column, row] = cellPosition(id);
      columns = Math.max(columns, column); rows = Math.max(rows, row);
    }
    return {columns, rows};
  }

  protected beginSheetResize(): void { this.syncEditor(); }

  protected resizeSheetExtent(extent: {columns: number; rows: number}): void {
    const minimum = this.occupiedExtent();
    const columns = Math.max(1, minimum.columns, extent.columns);
    const rows = Math.max(1, minimum.rows, extent.rows);
    this.columns.set(Array.from({length: columns}, (_, index) => columnLabel(index + 1)));
    this.rows.set(Array.from({length: rows}, (_, index) => index + 1));
  }

  protected readonly saveOutputs = signal(true);
  private loadedSnapshot: SheetSnapshot | undefined;

  protected setSaveOutputs(enabled: boolean): void {
    this.saveOutputs.set(enabled);
  }

  /** Outputs to store with the document: live results, or the snapshot still shown. */
  private snapshotForSave(): SheetSnapshot | undefined {
    const graph = this.graph();
    if (this.snapshotSavedAt() !== null || graph.cells.length === 0) return this.loadedSnapshot;
    return makeSnapshot(graph);
  }

  /** The tab title follows the document, marked while edits are unsaved. */
  private readonly syncWindowTitle = effect(() => {
    const title = `${this.documentName()}${this.hasUnsavedChanges() ? ' — Edited' : ''}`;
    document.title = `${title} · Reaktiv Workbook`;
  });

  /** Each window is an independent workbook with its own auto-draft slot. */
  private readonly windowId = currentWindowId();
  private readonly draftKey = draftKeyFor(this.windowId);
  private readonly syncThemeFromOtherWindow = (event: StorageEvent) => {
    if (![themes().key,themes().customKey].includes(event.key ?? '')) return;
    this.themeChoices.set(themes().all());
    this.applyTheme(localStorage.getItem(themes().key) || 'system');
  };

  /**
   * A workbook read from a file. Its saved outputs come from the sidecar file when the
   * workbook is opened.
   */
  private async inspectOpened(opened: { source: string; outputs?: string | null; name?: string }): Promise<SheetDocument> {
    const document = {...await this.runtime.inspectDocument(opened.source), sourceFileName: opened.name};
    if (!opened.outputs) return document;
    try {
      const snapshot = JSON.parse(opened.outputs) as SheetSnapshot;
      return Array.isArray(snapshot?.cells) ? { ...document, snapshot } : document;
    } catch {
      return document; // a broken sidecar is only a cache
    }
  }

  // ── Type checking ─────────────────
  /** Off, or how strictly pyright checks the workbook (remembered per browser). */
  protected readonly typeChecking = signal<'off' | TypeCheckMode>(readTypeChecking());
  protected readonly typeFindings = signal<readonly TypeFinding[]>([]);
  protected readonly typeCheckState = signal<'idle' | 'checking' | 'unavailable'>('idle');
  protected readonly typeCheckReason = signal<string | null>(null);
  private typeCheckTimer: number | null = null;
  private typeCheckGeneration = 0;
  private typeCheckInFlight = false;
  private typeCheckQueued = false;
  private typeFindingCursor = 0;

  protected readonly typeFindingsByCell = computed(() => {
    const byCell = new Map<string, TypeFinding[]>();
    for (const finding of this.typeFindings()) {
      if (finding.cellId === null) continue;
      byCell.set(finding.cellId, [...(byCell.get(finding.cellId) ?? []), finding]);
    }
    return byCell;
  });
  protected readonly selectedTypeFindings = computed(() => this.typeFindingsByCell().get(this.selectedId()) ?? []);
  protected readonly selectedEditorDiagnostics = computed<readonly EditorDiagnostic[]>(() =>
    this.selectedTypeFindings().filter(finding => finding.section !== 'parameters' && finding.section !== 'computation').map((finding) => ({
      line: finding.line ?? 1,
      severity: finding.severity,
      message: finding.detail ? `${finding.message}\n${finding.detail}` : finding.message,
    })),
  );
  protected readonly parameterEditorDiagnostics = computed<readonly EditorDiagnostic[]>(() =>
    this.selectedTypeFindings().filter(finding => finding.section === 'parameters').map(finding => ({
      line: finding.line ?? 1, severity: finding.severity,
      message: finding.detail ? `${finding.message}\n${finding.detail}` : finding.message,
    })),
  );
  protected readonly computationEditorDiagnostics = computed<readonly EditorDiagnostic[]>(() =>
    this.selectedTypeFindings().filter(finding => finding.section === 'computation').map(finding => ({
      line: finding.line ?? 1, severity: finding.severity,
      message: finding.detail ? `${finding.message}\n${finding.detail}` : finding.message,
    })),
  );
  protected readonly sharedCodeTypeFindings = computed(() => this.typeFindings().filter((finding) => finding.cellId === null));

  protected typeStatusTitle(): string {
    if (this.typeCheckState() === 'unavailable') return this.typeCheckReason() ?? 'Type checking is not available';
    const count = this.typeFindings().length;
    return count === 0
      ? `Type checking (${this.typeChecking()}): nothing found`
      : `Type checking (${this.typeChecking()}): ${count} finding(s) — click to go to the next cell`;
  }

  protected setTypeChecking(mode: 'off' | TypeCheckMode): void {
    this.typeChecking.set(mode);
    try {
      localStorage.setItem(TYPE_CHECKING_KEY, mode);
    } catch {
      // Storage unavailable: the choice lasts for this window.
    }
    this.scheduleTypeCheck(0);
  }

  /** Select the next cell with a finding (shared code: the settings, where it is edited). */
  protected showNextTypeFinding(): void {
    const findings = this.typeFindings();
    if (findings.length === 0) return;
    const finding = findings[this.typeFindingCursor++ % findings.length];
    if (finding.cellId === null) this.openSettings('workbook');
    else this.jumpTo(finding.cellId);
  }

  /** Check types a moment after the workbook changed (the check runs beside the kernel's work). */
  private scheduleTypeCheck(delay = 1200): void {
    if (this.typeCheckTimer !== null) window.clearTimeout(this.typeCheckTimer);
    this.typeCheckTimer = null;
    if (this.typeChecking() === 'off' || !this.runtime.canCheckTypes()) {
      this.typeCheckGeneration++;
      this.typeFindings.set([]);
      this.typeCheckState.set('idle');
      return;
    }
    this.typeCheckTimer = window.setTimeout(() => {
      this.typeCheckTimer = null;
      void this.checkTypes();
    }, delay);
  }

  private async checkTypes(): Promise<void> {
    const mode = this.typeChecking();
    if (mode === 'off') return;
    if (this.typeCheckInFlight) { this.typeCheckQueued=true; this.typeCheckGeneration++; return; }
    this.typeCheckInFlight=true;
    const generation = ++this.typeCheckGeneration;
    this.typeCheckState.set('checking');
    try {
      const result = await this.runtime.checkTypes(this.currentDraftDocument(), mode);
      if (generation !== this.typeCheckGeneration) return;
      if (result === null || !result.available) {
        this.typeFindings.set([]);
        this.typeCheckState.set(result === null ? 'idle' : 'unavailable');
        this.typeCheckReason.set(result?.reason ?? null);
        return;
      }
      this.typeFindings.set(result.diagnostics);
      this.typeCheckState.set('idle');
      this.typeCheckReason.set(null);
    } catch (error) {
      if (generation !== this.typeCheckGeneration) return;
      this.typeFindings.set([]);
      this.typeCheckState.set('unavailable');
      this.typeCheckReason.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.typeCheckInFlight=false;
      if (this.typeCheckQueued) {
        this.typeCheckQueued=false;
        if (!this.sessionDestroyed) this.scheduleTypeCheck(0);
      }
    }
  }

  // ── Git ─────────────────────────────────
  /** The repository of the open file: branch, distance to its remote, changed files. */
  protected readonly git = signal<GitStatus | null>(null);
  protected readonly gitPanelOpen = signal(false);
  protected readonly gitChanges = signal<WorkbookChanges | null>(null);
  protected readonly gitTextDiff = signal('');
  /** What git is doing (Committing…, Pushing…), or null. */
  protected readonly gitBusy = signal<string | null>(null);
  protected readonly gitMessage = signal<string | null>(null);
  protected commitMessage = '';

  /** The CLI session's workbook file, for git; null outside an edit session. */
  private sessionWorkbookPath: string | null = null;

  /** The file git works on: the opened file, or the CLI session's workbook. */
  private gitPath(): string | null {
    return this.sessionWorkbookPath;
  }

  protected async refreshGit(): Promise<void> {
    const path = this.gitPath();
    if (path === null || !this.gitService.available) {
      this.git.set(null);
      return;
    }
    try {
      const inRepository = (await this.gitService.repository(path)) !== null;
      const status = inRepository ? await this.gitService.status(path) : null;
      if (path === this.gitPath()) this.git.set(status);
    } catch {
      this.git.set(null);
    }
  }

  protected async openGitPanel(): Promise<void> {
    this.gitPanelOpen.set(true);
    this.gitMessage.set(null);
    await this.loadGitChanges();
  }

  /** What changed since the last commit, cell by cell (the workbook as it is now, unsaved edits included). */
  private async loadGitChanges(): Promise<void> {
    const path = this.gitPath();
    if (path === null) return;
    this.gitChanges.set(null);
    try {
      await this.refreshGit();
      const committed = await this.gitService.committedSource(path);
      const before = committed === null ? null : await this.runtime.inspectDocument(committed);
      this.gitChanges.set(diffWorkbooks(before, this.currentDraftDocument()));
      this.gitTextDiff.set(await this.gitService.textDiff(path));
    } catch (error) {
      this.gitMessage.set(error instanceof Error ? error.message : String(error));
    }
  }

  /** Save if needed, then commit the workbook and its images (nothing else that is staged). */
  protected async commitWorkbook(): Promise<void> {
    const message = this.commitMessage.trim();
    if (message === '') {
      this.gitMessage.set('Write what changed first: the commit message.');
      return;
    }
    await this.runGit('Committing…', async (path) => {
      if (this.hasUnsavedChanges() || this.gitPath() === null) {
        await this.saveSheet();
        if (this.hasUnsavedChanges()) throw new Error('The workbook was not saved, so nothing was committed.');
      }
      const status = await this.gitService.status(path);
      const result = await this.gitService.commit(path, message, status.changes.map((change) => change.path));
      this.commitMessage = '';
      return `Committed: ${result}`;
    });
  }

  protected async pushWorkbook(): Promise<void> {
    await this.runGit('Pushing…', async (path) => `Pushed. ${await this.gitService.push(path)}`);
  }

  /** Fast-forward to the remote's version and open it (refused with unsaved edits). */
  protected async pullWorkbook(): Promise<void> {
    if (this.hasUnsavedChanges()) {
      this.gitMessage.set('Save (or commit) your changes before pulling.');
      return;
    }
    await this.runGit('Pulling…', async (path) => {
      const result = await this.gitService.pull(path);
      // The CLI session reloaded the pulled file; show its new revision.
      const state = await this.runtime.readSession();
      if (state) this.acceptSessionState(state, false);
      return `Pulled. ${result}`;
    });
  }

  private async runGit(busy: string, action: (path: string) => Promise<string>): Promise<void> {
    const path = this.gitPath();
    if (path === null || this.gitBusy() !== null) return;
    this.gitBusy.set(busy);
    this.gitMessage.set(null);
    try {
      const result = await action(path);
      this.logSystem('info', `git: ${result}`);
      await this.loadGitChanges();
      this.gitMessage.set(result);
    } catch (error) {
      this.gitMessage.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.gitBusy.set(null);
    }
  }

  private readonly refreshGitOnFocus = () => void this.refreshGit();

  /** Set while this window holds the new workbook it started with, untouched. */
  private untouchedCheckpoint: DocumentCheckpoint = null;

  private isUntouched(): boolean {
    return (
      this.untouchedCheckpoint !== null &&
      this.documentChanges.same(this.currentDraftDocument(), this.untouchedCheckpoint)
    );
  }

  /**
   * Workbooks open in their own window; a window that still holds its untouched new
   * workbook opens it itself. `here` opens it in this window: the fallback when no window
   * could be opened (blocked popup, or a browser file too large to hand over).
   */
  private async openWorkbook(
    opening: WindowOpening | Promise<WindowOpening>,
    here: () => Promise<void>,
  ): Promise<void> {
    if (!this.isUntouched()) {
      try {
        if (await openInNewWindow(opening)) return;
      } catch (error) {
        this.evaluationError = `Could not open a new window: ${error instanceof Error ? error.message : String(error)}`;
        return;
      }
    }
    await here();
  }

  /** What the window that opened this one asked it to open. */
  private async openHandedOver(): Promise<void> {
    this.openingFile.set('workbook');
    let opening: WindowOpening | null = null;
    try {
      opening = await takeWindowOpening(this.windowId);
      if (opening === null) throw new Error('nothing was handed over');
      if (opening.kind === 'source') {
        this.openDocument(await this.inspectOpened({ source: opening.source, outputs: opening.outputs, name: opening.name }), true, opening.modifiedAt);
      } else if (opening.kind === 'example') {
        await this.openExampleHere(opening.name);
      } else {
        this.startNewProject(opening.name, opening.columns, opening.rows, opening.template);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.evaluationError = `Could not open the workbook in this window (${reason}).`;
      void this.evaluateGraph();
    } finally {
      this.openingFile.set(null);
    }
  }

  protected async openNewWindow(): Promise<void> {
    try {
      await openNewWindow();
    } catch (error) {
      this.evaluationError = `Could not open a new window: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  protected readonly diagnostics=inject(PerformanceDiagnostics);
  protected readonly theme = signal('system');
  protected readonly themeChoices=signal<AppTheme[]>(themes().all());
  protected readonly themeMessage=signal('');
  protected readonly themeBusy=signal(false);
  protected readonly diagnosticsMessage=signal('');
  protected readonly themeLabel = computed(() => 'Theme: ' + (this.themeChoices().find(t=>t.id===this.theme())?.name ?? 'Follow system'));

  protected cycleTheme(): void {
    const choices=this.themeChoices();
    this.setTheme(choices[(choices.findIndex(t=>t.id===this.theme())+1)%choices.length].id);
  }

  protected setTheme(next: string): void {
    this.applyTheme(next);
    try { localStorage.setItem(themes().key,this.theme()); } catch { /* Applies for this session. */ }
  }

  private applyTheme(theme: string): void { this.theme.set(themes().apply(theme)); }

  protected async importThemeFiles(event: Event): Promise<void> {
    const input=event.target as HTMLInputElement;
    const folder=input.hasAttribute('webkitdirectory');
    const files=[...(input.files ?? [])].filter(f=>f.name.toLowerCase().endsWith('.json') && (!folder || f.webkitRelativePath.split('/').length<=2)).sort((a,b)=>a.name.localeCompare(b.name));
    this.themeBusy.set(true); this.themeMessage.set('');
    try {
      if (files.length>100 || files.some(f=>f.size>65536)) throw new Error('Select at most 100 JSON files, at most 64 KiB each.');
      const batch=[];
      for (const file of files) batch.push({name:file.name,text:await file.text()});
      this.acceptThemes(batch);
    } catch(error) { this.themeMessage.set(String(error)); }
    finally { input.value=''; this.themeBusy.set(false); }
  }

  private acceptThemes(files: {name:string; text:string}[]): void {
    const imported=importThemes(files);
    this.themeChoices.set(themes().all());
    this.setTheme(imported[0].id);
    this.themeMessage.set(`Loaded ${imported.length} theme(s). Load the folder again after editing its JSON files.`);
  }

  protected removeCustomTheme(): void {
    try {
      localStorage.setItem(themes().customKey,JSON.stringify(this.themeChoices().filter(t=>t.id.startsWith('custom:') && t.id!==this.theme())));
      this.themeChoices.set(themes().all()); this.setTheme('system');
    } catch(error) { this.themeMessage.set(String(error)); }
  }

  protected async exportTheme(): Promise<void> {
    const current=this.themeChoices().find(t=>t.id===this.theme());
    try {
      const type=current?.type ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      const defaults=type==='light'
        ? {'editor.background':'#fdfdfb','editor.foreground':'#1d1d1b','textLink.foreground':'#7157d9','focusBorder':'#7157d9'}
        : {'editor.background':'#161614','editor.foreground':'#e7e7e2','textLink.foreground':'#8975f2','focusBorder':'#8975f2'};
      await this.workbookFiles.exportText(JSON.stringify({name:'My theme',type,colors:current?.colors ?? defaults},null,2),'my-theme.json',{name:'Theme JSON',extensions:['json'],mimeType:'application/json'});
    } catch(error) { this.themeMessage.set(String(error)); }
  }

  private async memoryDiagnostics():Promise<object> {
    // Length/count observations only. Never serialize source, values or asset names.
    const graph=this.graph();
    const heap=(performance as Performance & {memory?:{usedJSHeapSize:number;totalJSHeapSize:number;jsHeapSizeLimit:number}}).memory;
    const cacheStats=(cache:Map<string,unknown>)=>({entries:cache.size,keyChars:[...cache.keys()].reduce((n,s)=>n+s.length,0)});
    const frontend={
      jsHeap:heap ? {usedBytes:heap.usedJSHeapSize,totalBytes:heap.totalJSHeapSize,limitBytes:heap.jsHeapSizeLimit,
        scope:'Nonstandard browser JS heap reading; excludes native, graphics and Wasm memory'} : null,
      domElements:document.getElementsByTagName('*').length,iframes:document.getElementsByTagName('iframe').length,
      cells:this.cells().length,cellSourceChars:this.cells().reduce((n,c)=>n+c.source.length,0),
      richOutputChars:graph.cells.reduce((n,c)=>n+(c.richOutput?.dataBase64.length ?? 0),0),
      artifactBytes:graph.cells.reduce((n,c)=>n+(c.artifact?.size ?? 0),0),
      undoEntries:this.undoStack.length,redoEntries:this.redoStack.length,
      historySourceChars:[...this.undoStack,...this.redoStack].reduce((n,h)=>n+h.cells.reduce((sum,c)=>sum+c.source.length,0),0),
      trustedHtml:cacheStats(this.trustedCache),
      markdown:this.noteRenderer.diagnostics(),
      mermaid:mermaidMemoryDiagnostics(),assets:this.assets.memoryDiagnostics(),
      serializer:this.workbookSource.memoryDiagnostics(),kernel:this.runtime.memoryDiagnostics(),
      notes:'Frontend counts cover this window only. Character counts are logical retained content, not allocated bytes; strings and buffers can be shared.',
    };
    return {frontend};
  }

  protected async exportPerformanceDiagnostics(): Promise<void> {
    try {
      const graph=this.graph();
      const report=await this.diagnostics.report({kernel:this.runtime.kernel(),status:this.runtime.status(),view:this.viewMode(),
        cells:this.cells().length,results:graph?.cells.length ?? 0,
        richOutputs:graph?.cells.filter(c=>c.richOutput).length ?? 0,
        richOutputChars:graph?.cells.reduce((sum,c)=>sum+(c.richOutput?.dataBase64.length ?? 0),0) ?? 0,
        // Cached evaluation durations are context, not an additive breakdown of request time.
        cachedCellDurations:graph?.cells.filter(c=>c.durationMs!=null).map(c=>({id:c.id,durationMs:c.durationMs!})).sort((a,b)=>b.durationMs-a.durationMs).slice(0,20),
        cellOutputPreparation:graph.cells.filter(c=>c.outputPreparationMs!=null)
          .map(c=>({id:c.id,outputPreparationMs:c.outputPreparationMs!}))
          .sort((a,b)=>b.outputPreparationMs-a.outputPreparationMs).slice(0,20),
        largestRichOutputs:graph.cells.filter(c=>c.richOutput)
          .map(c=>({id:c.id,base64Chars:c.richOutput!.dataBase64.length}))
          .sort((a,b)=>b.base64Chars-a.base64Chars).slice(0,20),
        updateTrace:graph.updateTrace ?? null,
        theme:this.theme()});
      const path=await this.workbookFiles.exportText(report,'reaktiv-diagnostics.json',{name:'Diagnostics JSON',extensions:['json'],mimeType:'application/json'});
      if (path) this.diagnosticsMessage.set('Diagnostics saved. Review the report before sharing it.');
    } catch(error) { this.diagnosticsMessage.set(String(error)); }
  }

  private stopUsageMonitor?: () => void;

  protected readonly embeddedSession = signal(false);
  protected readonly appRun = signal(false);
  private sessionLink: ReturnType<typeof linkedSession> = null;
  private attachedKernelSettings: { kernel: 'pyodide' | 'local'; python: string } | null = null;
  private stopSessionMonitor?: () => void;
  private sessionDestroyed = false;

  ngOnInit(): void {
    window.addEventListener('focus', this.handleAgentWindowFocus);
    this.diagnostics.setMemoryProbe(()=>this.memoryDiagnostics());
    try { this.sessionLink = linkedSession(location.search, location.hash); }
    catch (error) { this.evaluationError = String(error); this.pendingStart.set(true); return; }
    this.initializeSession();
  }

  private initializeSession(): void {
    this.stopUsageMonitor = this.runtime.monitorUsage(() => this.kernelRunning());
    registerPlotlyFigure();
    registerHtmlOutput();
    registerAnywidgetView();
    document.addEventListener('anywidget-change', this.handleWidgetChange);
    document.addEventListener('anywidget-message', this.handleWidgetMessage);
    document.addEventListener('click', this.handleNoteLinkClick, true);
    document.addEventListener('click', this.handleActionClick, true);
    document.addEventListener(HTML_NOTE_LINK_EVENT, this.handleHtmlNoteLink);
    this.removeExternalLinkHandler = installExternalLinkHandler(
      (message) => (this.evaluationError = message),
    );
    let gettingStartedDismissed = false;
    try {
      this.applyTheme(localStorage.getItem(themes().key) || 'system');
      this.autoDraftEnabled.set(localStorage.getItem(AUTO_DRAFT_ENABLED_KEY) !== 'false');
      this.showCellMemory.set(localStorage.getItem('reaktiv-workbook:show-cell-memory') === 'true');
      this.renderStringsAsMarkdown.set(
        localStorage.getItem(RENDER_STRINGS_AS_MARKDOWN_KEY) !== 'false',
      );
      this.restoreGraphSettings(localStorage.getItem(GRAPH_SETTINGS_KEY));
      const noteSort = localStorage.getItem(NOTE_SORT_KEY);
      if (isNoteSort(noteSort)) this.noteSort.set(noteSort);
      gettingStartedDismissed = localStorage.getItem(GETTING_STARTED_DISMISSED_KEY) === 'true';
    } catch {
      this.autoDraftEnabled.set(true);
    }
    // A window opened to open a workbook starts with that workbook, not a draft.
    let handedOver = false;
    try {
      handedOver = hasWindowOpening(this.windowId);
    } catch {
      // Storage unavailable: nothing was handed over.
    }
    const draft = this.autoDraftEnabled() && !handedOver && !this.sessionLink ? this.readStoredDraft() : null;
    const plan = startupPlan(draft);
    const restored = plan.kind === 'draft' && draft !== null && this.restoreDraft(draft);
    if (!restored) {
      this.syncEditor();
      this.markNewDocumentEdited();
    }
    this.activityTrackingReady = true;
    // A link to a bundled example (from the website) opens it in this window, unless the
    // window already holds the learner's earlier work on it (restored above).
    const example = restored ? null : linkedExample(location.search);
    // From the command line, only a blank new workbook offers the guide (`new=1` in its link).
    const newSessionWorkbook = this.sessionLink !== null && new URLSearchParams(location.search).get('new') === '1';
    this.gettingStartedOpen.set(
      !restored && !gettingStartedDismissed && example === null && !handedOver
        && (!this.sessionLink || newSessionWorkbook),
    );
    // A new, untouched workbook: opening another one replaces it instead of adding a window.
    if (!restored && example === null && !handedOver) {
      this.untouchedCheckpoint = this.currentDraftDocument();
    }
    this.autoDraftReady = !this.sessionLink;
    if (this.autoDraftReady && this.autoDraftEnabled()) {
      this.scheduleDraftSave(this.currentDraftDocument(), this.pendingStart());
    }
    if (this.sessionLink) { this.pendingStart.set(true); void this.openEmbeddedSession(); }
    else if (handedOver) void this.openHandedOver();
    else if (restored && !this.pendingStart()) {
      // Returning to a course through a chapter link: resume on that chapter.
      this.showLinkedNote();
      void this.startWorkbook();
    } else if (example !== null) void this.openLinkedExample(example);
    else void this.evaluateGraph();

    window.addEventListener('storage', this.syncThemeFromOtherWindow);
    // Commits and pulls made in a terminal show up when the window is used again.
    window.addEventListener('focus', this.refreshGitOnFocus);
    // Copy and paste cells, also between windows (the system clipboard).
    document.body.append(this.clipboardBridge);
    // Resampled charts ask for the points of the range the user zoomed to.
    document.addEventListener(RESAMPLE_EVENT, this.handleResample);
    this.clipboardBridge.addEventListener('paste', this.handlePasteCells);
    try {
      pruneStaleBrowserDrafts(localStorage);
    } catch {
      // Storage unavailable: nothing to prune.
    }
  }

  private removeExternalLinkHandler?: () => void;

  ngOnDestroy(): void {
    this.agentActivity.reset();
    this.endCellDrag();
    window.removeEventListener('focus', this.handleAgentWindowFocus);
    this.agentAccess.stop();
    this.cancelRecoveryOutputs();
    this.noteRenderer.clear();
    this.trustedCache.clear();
    this.sessionDestroyed = true;
    this.logSubscription();
    this.progressSubscription();
    this.workbookCommands.reset();
    this.resourceCancelMessage.set(null);
    this.cancellingResources.set(new Set());
    this.diagnostics.stop();
    this.diagnostics.setMemoryProbe(null);
    this.stopUsageMonitor?.();
    this.stopSessionMonitor?.();
    this.memoryGeneration++;
    this.showCellMemory.set(false);
    if (this.memoryTimer !== null) clearTimeout(this.memoryTimer);
    this.timerScheduler.cancel();
    document.removeEventListener('anywidget-change', this.handleWidgetChange);
    document.removeEventListener('anywidget-message', this.handleWidgetMessage);
    document.removeEventListener('click', this.handleNoteLinkClick, true);
    document.removeEventListener('click', this.handleActionClick, true);
    document.removeEventListener(HTML_NOTE_LINK_EVENT, this.handleHtmlNoteLink);
    this.removeExternalLinkHandler?.();
    window.removeEventListener('storage', this.syncThemeFromOtherWindow);
    window.removeEventListener('focus', this.refreshGitOnFocus);
    this.clipboardBridge.removeEventListener('paste', this.handlePasteCells);
    document.removeEventListener(RESAMPLE_EVENT, this.handleResample);
    this.clipboardBridge.remove();
    if (this.noteCommitTimer !== null) clearTimeout(this.noteCommitTimer);
    if (this.draftTimer !== null) window.clearTimeout(this.draftTimer);
    if (this.updateFlashTimer !== null) window.clearTimeout(this.updateFlashTimer);
    if (this.updateFlashFrame !== null) cancelAnimationFrame(this.updateFlashFrame);
    if (this.saveFeedbackTimer !== null) window.clearTimeout(this.saveFeedbackTimer);
  }

  protected qualifiedPaneCell(sheet: string, column: string, row: number): string {
    return qualifyCellId(sheet, `${column}${row}`);
  }

  protected cellId(column: string, row: number): string {
    return qualifyCellId(this.activeSheet(), `${column}${row}`);
  }

  // ── Sheets (tabs) ─────────────────────────────────────────────────────
  // The grid signals (columns, rows,
  // sizes) always describe the active sheet; other sheets' layouts wait in
  // `storedLayouts`. All sheets share one reactive graph.
  protected readonly sheetName = this.workbookState.sheetName;
  protected readonly extraSheets = this.workbookState.extraSheets;
  /** '' is the first sheet (plain ids); other sheets are their name ("Budget!A1"). */
  private readonly storedLayouts = signal<Record<string, SheetLayout>>({});
  protected readonly renamingSheet = signal<string | null>(null);
  protected readonly sheetTabs = computed(() => [
    { prefix: '', name: this.sheetName() },
    ...this.extraSheets().map((name) => ({ prefix: name, name })),
  ]);

  protected switchSheet(prefix: string): void {
    if (prefix === this.activeSheet()) return;
    const current = this.activeSheet();
    this.storedLayouts.update((layouts) => ({ ...layouts, [current]: this.activeLayout() }));
    this.applyLayout(this.storedLayouts()[prefix] ?? DEFAULT_SHEET_LAYOUT);
    this.activeSheet.set(prefix);
    if (this.viewMode() === 'split') {
      this.splitSheets.update(sheets => sheets.map((sheet, index) => index === this.activeSplitPane() ? prefix : sheet));
    }
    // Picking references from another sheet: keep editing the same cell.
    if (this.referenceEditor() !== null) return;
    const first = this.cells().find((cell) => splitCellId(cell.id)[0] === prefix);
    this.selectCell(first?.id ?? qualifyCellId(prefix, 'A1'));
  }

  protected addSheet(): void {
    const taken = new Set([...this.sheetNames(), ...this.cells().map((cell) => cell.name)]);
    let index = this.extraSheets().length + 2;
    while (taken.has(`Sheet${index}`)) index++;
    const name = `Sheet${index}`;
    this.extraSheets.update((sheets) => [...sheets, name]);
    this.storedLayouts.update((layouts) => ({ ...layouts, [name]: DEFAULT_SHEET_LAYOUT }));
    this.switchSheet(name);
    this.startRenameSheet(name);
  }

  protected startRenameSheet(prefix: string): void {
    this.renamingSheet.set(prefix);
    requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>('.sheet-tab-rename');
      input?.focus();
      input?.select();
    });
  }

  /**
   * Rename a sheet: its cells' ids and every `Old.A1` reference in all sheets follow.
   * Names are Python identifiers (they appear in formulas) and must not clash with
   * other sheets or cell labels.
   */
  protected renameSheet(prefix: string, rawName: string, evaluate = true, record = true): void {
    this.graphWorkspace.resetViews();
    if (!this.requireKernel()) return;
    this.renamingSheet.set(null);
    const name = rawName.trim();
    const oldName = prefix === '' ? this.sheetName() : prefix;
    if (name === '' || name === oldName) return;
    if (name === 'cells') { this.evaluationError = 'The sheet name cells is reserved for cell references.'; return; }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || PYTHON_KEYWORDS.has(name)) {
      this.evaluationError = `"${name}" is not a valid sheet name; use letters, digits, and _.`;
      return;
    }
    if (this.sheetNames().includes(name) || this.cells().some((cell) => cell.name === name)) {
      this.evaluationError = `A sheet or cell is already called "${name}".`;
      return;
    }
    if (record) this.recordHistory();
    const references = new RegExp(`(?<![\\w.])${oldName}\\.(?=[A-Za-z_][A-Za-z0-9_]*\\b)`, 'g');
    const links = new RegExp(`#(sheet-input:|cell-|note-)${oldName}!`, 'g');
    const renameId = (id: string) =>
      prefix !== '' && splitCellId(id)[0] === prefix ? qualifyCellId(name, splitCellId(id)[1]) : id;
    this.cells.update((cells) =>
      sortCells(
        cells.map((cell) => ({
          ...cell,
          id: renameId(cell.id),
          view: rewriteWidgetView(cell.view, expression => expression.replace(references, `${name}.`),renameId),
          source:
            cell.kind === 'input'
              ? cell.source
              : cell.source.replace(references, `${name}.`).replace(links, `#$1${name}!`),
            params: cell.params?.replace(references, `${name}.`),
            computation: ['source', 'previous'].includes(oldName) ? cell.computation : cell.computation?.replace(references, `${name}.`),
        })),
      ),
    );
    this.renameInNoteOrder(renameId);
    this.actionDefinitions.update(actions => actions.map(action => ({...action, source: rewriteActionWorksheet(action.source, oldName, name)})));
    if (prefix === '') {
      this.sheetName.set(name);
    } else {
      this.extraSheets.update((sheets) => sheets.map((sheet) => (sheet === prefix ? name : sheet)));
      this.storedLayouts.update(({ [prefix]: layout, ...rest }) =>
        layout === undefined ? rest : { ...rest, [name]: layout },
      );
      if (this.activeSheet() === prefix) this.activeSheet.set(name);
      this.splitSheets.update(sheets => sheets.map(sheet => sheet === prefix ? name : sheet));
      this.selectedId.set(renameId(this.selectedId()));
      this.selectedIds.set(new Set([...this.selectedIds()].map(renameId)));
      this.activeNoteId.set(renameId(this.activeNoteId()));
    }
    if (evaluate) void this.evaluateGraph();
  }

  // Deleting is deliberate: right-click a tab → Delete sheet… → confirm (no × on tabs).
  protected readonly sheetMenu = signal<{ x: number; y: number; prefix: string } | null>(null);
  protected readonly sheetToDelete = signal<string | null>(null);

  protected openSheetMenu(event: MouseEvent, prefix: string): void {
    event.preventDefault();
    event.stopPropagation();
    this.sheetMenu.set({ x: event.clientX, y: event.clientY, prefix });
  }

  protected sheetDisplayName(prefix: string): string {
    return prefix === '' ? this.sheetName() : prefix;
  }

  protected sheetIndex(prefix: string): number {
    return this.sheetTabs().findIndex((tab) => tab.prefix === prefix);
  }

  protected moveSheet(prefix: string, offset: -1 | 1): void {
    this.sheetMenu.set(null);
    const order = this.sheetNames();
    const index = this.sheetIndex(prefix);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    this.reorderSheets(order);
  }

  protected askDeleteSheet(prefix: string): void {
    this.sheetMenu.set(null);
    if (!this.requireKernel() || this.sheetTabs().length < 2) return;
    this.sheetToDelete.set(prefix);
    setTimeout(() => document.querySelector<HTMLElement>('.close-prompt .danger-button')?.focus());
  }

  protected confirmDeleteSheet(): void {
    const prefix = this.sheetToDelete();
    this.sheetToDelete.set(null);
    if (prefix !== null) this.deleteSheet(prefix);
  }

  protected deleteSheet(prefix: string, evaluate = true, record = true): void {
    if (!this.requireKernel()) return;
    if (prefix === '') {
      // The first sheet has the plain cell ids (A1): the next sheet takes its place first, then
      // the old first sheet (now qualified, Old!A1) is deleted like any other. One undo step.
      const [first, next, ...rest] = this.sheetNames();
      if (next === undefined) return; // a workbook keeps at least one sheet
      this.reorderSheets([next, first, ...rest], false, record);
      prefix = first;
      record = false;
    }
    if (record) this.recordHistory();
    if (this.activeSheet() === prefix) this.switchSheet('');
    this.splitSheets.update(sheets => sheets.map(sheet => sheet === prefix ? '' : sheet));
    this.splitNotes.update(notes => notes.map(id => splitCellId(id)[0] === prefix ? '' : id));
    this.cells.update((all) => all.filter((cell) => splitCellId(cell.id)[0] !== prefix));
    this.extraSheets.update((sheets) => sheets.filter((sheet) => sheet !== prefix));
    this.storedLayouts.update(({ [prefix]: _removed, ...rest }) => rest);
    if (evaluate) void this.evaluateGraph();
  }

  // ── Duplicating a sheet ───────────────────────────────────────────────
  // Duplicate sheets keep their labels in the new sheet.
  protected readonly sheetToDuplicate = signal<{ prefix: string; name: string } | null>(null);

  protected askDuplicateSheet(prefix: string): void {
    this.sheetMenu.set(null);
    if (!this.requireKernel()) return;
    const taken = new Set([...this.sheetNames(), ...this.cells().map((cell) => cell.name)]);
    const base = `${this.sheetDisplayName(prefix)}_copy`;
    let name = base;
    for (let index = 2; taken.has(name); index++) name = `${base}${index}`;
    this.sheetToDuplicate.set({ prefix, name });
    setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>('.duplicate-sheet-name');
      input?.focus();
      input?.select();
    });
  }

  /** Why the name in the Duplicate dialog cannot be used, or null. */
  protected duplicateNameProblem(name: string): string | null {
    const trimmed = name.trim();
    if (trimmed === '') return 'Enter a name.';
    if (trimmed === 'cells') return 'The name cells is reserved for cell references.';
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed) || PYTHON_KEYWORDS.has(trimmed)) {
      return 'Use letters, digits, and _ (the name appears in formulas, like Budget.A1).';
    }
    if (this.sheetNames().includes(trimmed) || this.cells().some((cell) => cell.name === trimmed)) {
      return `A sheet or cell is already called "${trimmed}".`;
    }
    return null;
  }

  protected confirmDuplicateSheet(rawName: string): void {
    const request = this.sheetToDuplicate();
    if (request === null || this.duplicateNameProblem(rawName) !== null) return;
    this.sheetToDuplicate.set(null);
    this.duplicateSheet(request.prefix, rawName.trim());
  }

  /** Copy a sheet's cells and layout to a new sheet right after it, and open it. */
  protected duplicateSheet(prefix: string, name: string): void {
    if (!this.requireKernel() || this.duplicateNameProblem(name) !== null) return;
    this.commitNoteDraftIfNeeded(false);
    this.recordHistory();
    const { copies } = duplicateSheetCells(
      this.cells(),
      { prefix, name: this.sheetDisplayName(prefix) },
      { prefix: name, name },
      this.sheetNames(),
    );
    const layout = this.layoutOf(prefix);
    this.cells.update((cells) => sortCells([...cells, ...copies]));
    // The new tab goes right after the original (the first sheet's copy becomes the second tab).
    this.extraSheets.update((sheets) => {
      const at = prefix === '' ? 0 : sheets.indexOf(prefix) + 1;
      return [...sheets.slice(0, at), name, ...sheets.slice(at)];
    });
    this.storedLayouts.update((layouts) => ({ ...layouts, [name]: structuredClone(layout) }));
    // In a manual note order, each copied note follows its original.
    if (this.noteOrder().length > 0) {
      const copied = new Set(copies.map((cell) => cell.id));
      const copyOf = (id: string) => qualifyCellId(name, splitCellId(id)[1]);
      this.noteOrder.update((order) =>
        order.flatMap((id) =>
          splitCellId(id)[0] === prefix && copied.has(copyOf(id)) ? [id, copyOf(id)] : [id],
        ),
      );
    }
    this.noteParents.update(parents => {
      const copied = {...parents};
      for (const [child, parent] of Object.entries(parents)) if (splitCellId(child)[0] === prefix) copied[qualifyCellId(name, splitCellId(child)[1])] = splitCellId(parent)[0] === prefix ? qualifyCellId(name, splitCellId(parent)[1]) : parent;
      return copied;
    });
    this.switchSheet(name);
    void this.evaluateGraph();
  }

  // ── Reordering sheets (drag a tab) ─────────────────────────────────────
  // The first sheet's cells have plain ids (A1), the others are qualified (Budget!A1).
  // Moving a different sheet to the front therefore relabels ids of both sheets; formula
  // references are relative (A1) or by sheet name (Budget.A1) and do not change.
  private draggedSheet: string | null = null;
  protected readonly sheetDropTarget = signal<string | null>(null);

  protected startSheetDrag(event: DragEvent, name: string): void {
    this.draggedSheet = name;
    event.dataTransfer?.setData(SHEET_DRAG_TYPE, name);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  protected endSheetDrag(): void {
    this.draggedSheet = null;
    this.sheetDropTarget.set(null);
  }

  protected sheetDragOver(event: DragEvent, prefix: string): void {
    if (event.dataTransfer?.types.includes(SHEET_DRAG_TYPE)) {
      event.preventDefault();
      this.sheetDropTarget.set(prefix);
      return;
    }
    this.allowDrop(event);
  }

  /** A tab dropped on a tab takes its place (moving right: after it, left: before it). */
  protected dropSheetTab(event: DragEvent, targetPrefix: string): boolean {
    const dragged = event.dataTransfer?.getData(SHEET_DRAG_TYPE) || this.draggedSheet;
    this.endSheetDrag();
    if (!dragged) return false;
    event.preventDefault();
    const names = this.sheetNames();
    const target = targetPrefix === '' ? this.sheetName() : targetPrefix;
    const from = names.indexOf(dragged);
    const to = names.indexOf(target);
    if (from < 0 || to < 0 || from === to) return true;
    const order = names.filter((name) => name !== dragged);
    order.splice(to, 0, dragged);
    this.reorderSheets(order);
    return true;
  }

  /** Put the sheets in `order` (all sheet names). */
  protected reorderSheets(order: string[], evaluate = true, record = true): void {
    if (!this.requireKernel()) return;
    const oldFirst = this.sheetName();
    const newFirst = order[0];
    if (order.join('\n') === this.sheetNames().join('\n')) return;
    this.commitNoteDraftIfNeeded(false);
    if (record) this.recordHistory();
    const layouts = Object.fromEntries(
      this.sheetTabs().map((tab) => [tab.name, this.layoutOf(tab.prefix)]),
    );
    const activeName = this.activeSheet() === '' ? oldFirst : this.activeSheet();
    if (newFirst !== oldFirst) {
      // Relabel: old first sheet's A1 → Old!A1, new first sheet's New!A1 → A1.
      const relabel = (id: string): string => {
        const [sheet, coordinate] = splitCellId(id);
        if (sheet === '') return qualifyCellId(oldFirst, coordinate);
        if (sheet === newFirst) return coordinate;
        return id;
      };
      const links = (source: string) =>
        source.replace(
          /#(cell-|sheet-input:|note-)((?:[A-Za-z_][A-Za-z0-9_]*!)?[A-Z]+[1-9][0-9]*)\b/g,
          (_match, kind: string, id: string) => `#${kind}${relabel(id)}`,
        );
      this.cells.update((cells) =>
        sortCells(
          cells.map((cell) => ({
            ...cell,
            id: relabel(cell.id),
            view:remapWidgetActionBindings(cell.view,relabel),
            source: cell.kind === 'markdown' ? links(cell.source) : cell.source,
          })),
        ),
      );
      this.selectedId.set(relabel(this.selectedId()));
      this.selectedIds.set(new Set([...this.selectedIds()].map(relabel)));
      this.selectionAnchor = relabel(this.selectionAnchor);
      this.activeNoteId.set(relabel(this.activeNoteId()));
      this.renameInNoteOrder(relabel);
      this.cutCells.set(null);
    }
    this.sheetName.set(newFirst);
    this.extraSheets.set(order.slice(1));
    // Every sheet keeps its own layout; the first one is stored under its plain prefix ''.
    this.storedLayouts.set(Object.fromEntries(order.map((name, index) => [index === 0 ? '' : name, layouts[name]])));
    const activePrefix = activeName === newFirst ? '' : activeName;
    this.applyLayout(layouts[activeName] ?? DEFAULT_SHEET_LAYOUT);
    this.activeSheet.set(activePrefix);
    this.splitSheets.update(sheets => sheets.map(sheet => {
      const name = sheet === '' ? oldFirst : sheet;
      return name === newFirst ? '' : name;
    }));
    if (evaluate) void this.evaluateGraph();
  }

  protected sheetCellCount(prefix: string): number {
    return this.cells().filter((cell) => splitCellId(cell.id)[0] === prefix).length;
  }

  private sheetNames(): string[] {
    return [this.sheetName(), ...this.extraSheets()];
  }

  private activeLayout(): SheetLayout {
    return {
      columns: this.columns().length,
      rows: this.rows().length,
      columnWidths: this.columnWidths(),
      rowHeights: this.rowHeights(),
    };
  }

  private applyLayout(layout: SheetLayout): void {
    this.columns.set(makeColumns(layout.columns));
    this.rows.set(makeRows(layout.rows));
    this.columnWidths.set(layout.columnWidths);
    this.rowHeights.set(layout.rowHeights);
  }

  /** A sheet's immutable layout; shared by source checkpoints. */
  private layoutOf(prefix: string): SheetLayout {
    return prefix === this.activeSheet()
      ? this.activeLayout()
      : (this.storedLayouts()[prefix] ?? DEFAULT_SHEET_LAYOUT);
  }

  /** First-sheet grid plus the document's sheet settings, for saving. */
  private documentLayout(): {
    first: SheetLayout;
    sheets: { sheetName: string; sheets: SheetDocument['sheets'] };
  } {
    return {
      first: this.layoutOf(''),
      sheets: {
        sheetName: this.sheetName(),
        sheets: this.extraSheets().map((name) => {
          const layout = this.layoutOf(name);
          return {
            name,
            grid: { columns: layout.columns, rows: layout.rows },
            layout: { columnWidths: layout.columnWidths, rowHeights: layout.rowHeights },
          };
        }),
      },
    };
  }

  protected definitionAt(cellId: string): CellDefinition | undefined {
    return this.definitionMap().get(cellId);
  }

  protected resultAt(cellId: string): CellResult | undefined {
    return this.resultMap().get(cellId);
  }

  protected markdownAt(cellId: string): SafeHtml {
    return this.trustedHtml(this.markdownHtmlMap().get(cellId) ?? '');
  }

  /**
   * Rendered notes keep their SVG (diagrams) and inline styles (formulas): DOMPurify
   * removes anything executable, then Angular is told the result is safe (its own
   * sanitizer would strip SVG and styles). Cached by HTML.
   */
  private readonly sanitizer = inject(DomSanitizer);
  private readonly trustedCache = new Map<string, SafeHtml>();

  protected trustedHtml(html: string): SafeHtml {
    let trusted = this.trustedCache.get(html);
    if (trusted === undefined) {
      const clean = DOMPurify.sanitize(html, {
        USE_PROFILES: { html: true, svg: true, svgFilters: true, mathMl: true },
        ADD_TAGS: ['foreignObject'],
        // DOMPurify's default plus the URLs note images are shown with (asset-store.ts).
        ALLOWED_URI_REGEXP: SAFE_NOTE_URLS,
      });
      trusted = this.sanitizer.bypassSecurityTrustHtml(clean);
      this.trustedCache.set(html, trusted);
      if (this.trustedCache.size > 300) this.trustedCache.delete(this.trustedCache.keys().next().value!);
    }
    return trusted;
  }

  /** Whether a text result renders as Markdown: the cell's own choice, else the default. */
  protected rendersMarkdown(cellId: string): boolean {
    return this.definitionAt(cellId)?.view?.markdown ?? this.renderStringsAsMarkdown();
  }

  protected setCellMarkdown(cellId: string, markdown: boolean): void {
    this.updateCellView(cellId, (view) => ({ ...view, markdown }));
  }

  protected stringMarkdownAt(cellId: string): SafeHtml {
    const result = this.resultAt(cellId);
    return this.trustedHtml(
      result?.valueType === 'str' && result.error === null ? this.noteRenderer.renderCell(cellId, this.assets.toDisplay(result.display)) : '',
    );
  }

  protected readonly tableSummary = tableSummary;

  /** Worksheet table HTML, cached per table object (rendered from a template binding). */
  protected tableHtml(table: TableResult): string {
    let html = this.tableHtmlCache.get(table);
    if (html === undefined) {
      html = renderTableHtml(table);
      this.tableHtmlCache.set(table, html);
    }
    return html;
  }
  private readonly tableHtmlCache = new WeakMap<TableResult, string>();

  protected formatDuration(durationMs: number | null | undefined): string {
    if (durationMs === null || durationMs === undefined) return 'Not executed';
    if (durationMs < 0.01) return '<0.01 ms';
    if (durationMs < 1000) return `${durationMs.toFixed(durationMs < 10 ? 2 : 1)} ms`;
    return `${(durationMs / 1000).toFixed(2)} s`;
  }

  private readonly graphNavigationActive = computed(() => this.viewMode() === 'graph' || (this.viewMode() === 'split' && this.splitViews().includes('graph')));
  private readonly selectionHistory = signal<SelectionHistory>(EMPTY_SELECTION_HISTORY);
  private selectionLocation(): SelectionLocation {
    return { cellId: this.selectedId() };
  }
  private readonly selectionNavigationWatcher = effect(() => {
    if (!this.graphNavigationActive()) return;
    const location = this.selectionLocation();
    untracked(() => this.selectionHistory.update(history => visitSelection(history, location)));
  });
  private validSelection(location: SelectionLocation): boolean {
    const [sheet] = splitCellId(location.cellId);
    if (!this.sheetTabs().some(tab => tab.prefix === sheet)) return false;
    const [column, row] = cellPosition(location.cellId), layout = this.layoutOf(sheet);
    return column <= layout.columns && row <= layout.rows;
  }
  protected readonly canNavigateBack = computed(() => adjacentSelection(this.selectionHistory(), -1, location => this.validSelection(location)) !== null);
  protected readonly canNavigateForward = computed(() => adjacentSelection(this.selectionHistory(), 1, location => this.validSelection(location)) !== null);

  protected navigateSelection(direction: -1 | 1): void {
    if (!this.graphNavigationActive()) return;
    this.selectionHistory.update(history => visitSelection(history, this.selectionLocation()));
    const history = this.selectionHistory();
    const index = adjacentSelection(history, direction, location => this.validSelection(location));
    if (index === null) return;
    this.commitNoteDraftIfNeeded(false);
    this.stopPickingReferences();
    const location = history.entries[index];
    this.selectionHistory.set({ ...history, index });
    const [sheet] = splitCellId(location.cellId);
    if (sheet !== this.activeSheet()) this.switchSheet(sheet);
    this.selectCell(location.cellId);
    requestAnimationFrame(() => {
      if (this.sessionDestroyed || !this.graphNavigationActive() || this.selectedId() !== location.cellId) return;
      const target = document.getElementById(this.viewMode() === 'split' ? `pane-${this.activeSplitPane()}-graph-cell-${location.cellId}` : `graph-cell-${location.cellId}`);
      target?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    });
  }

  protected selectCell(cellId: string): void {
    if (cellId !== this.selectedId()) this.stopPickingReferences();
    this.selectedId.set(cellId);
    this.selectedIds.set(new Set([cellId]));
    this.selectionAnchor = cellId;
    this.markdownCopied.set(false);
    this.syncEditor();
  }

  protected selectGridCell(cellId: string, event?: MouseEvent): void {
    if (this.suppressNextCellClick) {
      this.suppressNextCellClick = false;
      return;
    }
    if (event?.ctrlKey || event?.metaKey) {
      const selected = new Set(this.selectedIds());
      if (selected.has(cellId) && selected.size > 1) selected.delete(cellId);
      else selected.add(cellId);
      this.selectedIds.set(selected);
      this.selectedId.set(cellId);
      this.selectionAnchor = cellId;
      this.syncEditor();
      return;
    }
    if (event?.shiftKey) {
      const selected = rectangularSelection(this.selectionAnchor, cellId);
      this.selectedIds.set(selected);
      this.selectedId.set(cellId);
      this.syncEditor();
      return;
    }
    // Markdown cells are selected like any cell; "Open in Notes" goes to the note view.
    this.selectCell(cellId);
    if (this.viewMode() === 'split' && !this.inspectorCollapsed()) this.splitInspectorOpen.set(true);
  }

  // ── Dashboard tiles ────────────────────────────────────────────────────
  /** Cells hidden under a spanning tile, mapped to that tile. */
  protected readonly coveredCells = computed(() =>
    coveredCells(this.cells(), this.columns().length, this.rows().length),
  );

  protected isRendered(definition: CellDefinition | undefined): boolean {
    return definition?.view?.display === 'rendered';
  }

  protected cellGridRow(cellId: string): string {
    const definition = this.definitionAt(cellId);
    const layout = this.layoutOf(splitCellId(cellId)[0]);
    const rows = definition ? spanOf(definition, layout.columns, layout.rows)[1] : 1;
    return `${cellPosition(cellId)[1] + 1} / span ${rows}`;
  }

  protected cellGridColumn(cellId: string): string {
    const definition = this.definitionAt(cellId);
    const layout = this.layoutOf(splitCellId(cellId)[0]);
    const columns = definition ? spanOf(definition, layout.columns, layout.rows)[0] : 1;
    return `${cellPosition(cellId)[0] + 1} / span ${columns}`;
  }

  protected spanLabel(definition: CellDefinition): string {
    const [columns, rows] = spanOf(definition, this.columns().length, this.rows().length);
    return `${columns} × ${rows}`;
  }

  protected tileWidget(cellId: string): ResolvedCellWidget & { rejected?: { value: string; message: string } } {
    const widget =
      this.resultAt(cellId)?.widget ??
      widgetFor(
        this.resultAt(cellId)?.value,
        this.definitionAt(cellId)?.view?.widget,
      );
    return refusedInputState(actionWidgetState(
      widget,
      cellId,
      this.runningActionNames(),
      this.runtime.status() === 'running' && !this.runningAction(),
      this.widgetActionFeedback(),
      this.cancellingActionNames(),
    ), cellId, this.inputRefusal());
  }

  protected widgetLabel(cellId: string, widget: ResolvedCellWidget): string {
    return (
      widget.label ??
      this.actionResult(widget.action)?.label ??
      (this.definitionAt(cellId)?.name
        ? this.labelText(this.definitionAt(cellId)!.name!)
        : cellId)
    );
  }
  protected readonly widgetStateFields = WIDGET_STATES;
  protected readonly widgetSettingText = widgetSettingText;

  protected setWidgetPresentation(
    cellId: string,
    key:
      'label' | 'placeholder' | 'disabled' | 'visible' | 'loading' | 'pressed',
    raw: string,
  ): void {
    if (!this.requireKernel()) return;
    this.updateCellView(cellId, (view) => {
      if (!view.widget) return view;
      const widget = { ...view.widget };
      const text = raw.trim();
      if (!text) delete widget[key];
      else if (text === '=') delete widget[key];
      else if (text.startsWith('='))
        Object.assign(widget, { [key]: { expr: text.slice(1).trim() } });
      else if (key === 'label' || key === 'placeholder') widget[key] = raw;
      else if (/^(true|false)$/i.test(text))
        widget[key] = text.toLowerCase() === 'true';
      else Object.assign(widget, { [key]: { expr: text } });
      return { ...view, widget };
    });
    void this.evaluateGraph();
  }

  protected setButtonMode(
    cellId: string,
    mode: 'count' | 'toggle' | 'action',
  ): void {
    if (!this.requireKernel()) return;
    const target = this.availableActions()[0]?.name;
    if (mode === 'action' && !target) return;
    this.updateCellView(cellId, (view) => {
      if (!view.widget) return view;
      const widget = { ...view.widget, buttonMode: mode };
      if (mode === 'action') widget.action = target;
      else {
        delete widget.action;
        delete widget.actionArguments;
        delete widget.cancelWhileRunning;
      }
      return { ...view, widget };
    });
    void this.evaluateGraph();
  }

  protected setButtonAction(cellId: string, name: string): void {
    if (!this.requireKernel()) return;
    this.updateCellView(cellId, (view) => ({
      ...view,
      widget: view.widget
        ? {
            ...view.widget,
            action: name,
            buttonMode: 'action',
            actionArguments: {},
          }
        : undefined,
    }));
    void this.evaluateGraph();
  }
  protected isDebouncedWidget(type: string | undefined): boolean {
    return DEBOUNCED_WIDGETS.some(widget => widget === type);
  }

  /** The widget's `debounce`: empty restores the default, 0 updates on every change. */
  protected setWidgetDebounce(cellId: string, text: string): void {
    if (!this.requireKernel()) return;
    const delay = text.trim() === '' ? undefined : Number(text);
    if (delay !== undefined && !isWidgetDebounce(delay)) {
      this.evaluationError = 'Update delay must be whole milliseconds from 0 to 10000.';
      return;
    }
    this.widgetDebouncers.get(cellId)?.cancel();
    this.updateCellView(cellId, view => {
      if (!view.widget) return view;
      const widget = { ...view.widget };
      if (delay === undefined) delete widget.debounce;
      else widget.debounce = delay;
      return { ...view, widget };
    });
    void this.evaluateGraph();
  }

  protected setButtonCancellation(cellId: string, enabled: boolean): void {
    if (!this.requireKernel()) return;
    this.updateCellView(cellId, view => ({...view, widget: view.widget ? {...view.widget, cancelWhileRunning: enabled} : undefined}));
    void this.evaluateGraph();
  }

  protected setButtonArguments(
    cellId: string,
    bindings: Record<string, ActionBinding>,
  ): void {
    if (!this.requireKernel()) return;
    this.updateCellView(cellId, (view) => ({
      ...view,
      widget: view.widget
        ? { ...view.widget, actionArguments: bindings }
        : undefined,
    }));
    void this.evaluateGraph();
  }

  protected tileKpi(cellId: string): string | null {
    const result = this.resultAt(cellId);
    return result === undefined || result.error ? null : kpiText(result.value, result.display);
  }

  /**
   * Dragging a slider or typing in a live text/number field: the control and its readout
   * follow instantly (a draft value that results arriving meanwhile cannot override); the
   * input cell updates with the widget's timing (`liveUpdateTiming`), and once more when
   * the edit is committed (release, Enter, or leaving the field).
   */
  /** The formula bar: cell views while editing. The shell's rows follow it (without-formula-bar). */
  protected readonly formulaBarShown = computed(() => this.viewMode() !== 'notes' && !this.appRun() && this.workbookEditing());

  protected readonly widgetDraft = signal<{ cellId: string; value: string } | null>(null);
  private readonly widgetDebouncers = new Map<string, Debouncer<string>>();

  /** While a tile's control is held, its cell is not draggable (the slider gets the drag). */
  protected readonly widgetPointerCell = signal<string | null>(null);

  protected holdWidget(cellId: string, event?: Event): void {
    // Native drag eligibility is decided before Angular's next render.
    const tile = (event?.currentTarget as HTMLElement | null)?.closest<HTMLElement>('.sheet-cell') ?? this.gridElement(cellId);
    const draggable = tile?.draggable ?? false;
    if (tile) tile.draggable = false;
    this.widgetPointerCell.set(cellId);
    const release = () => {
      if (tile?.isConnected) tile.draggable = this.workbookEditing() && draggable;
      this.widgetPointerCell.set(null);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
  }

  protected widgetDraftFor(cellId: string): string | null {
    const draft = this.widgetDraft();
    return draft !== null && draft.cellId === cellId ? draft.value : null;
  }

  protected inputTileWidget(event: Event, cellId: string, widget: ResolvedCellWidget): void {
    const timing = liveUpdateTiming(widget.type, widget.debounce);
    if (timing === null) return;
    const value = (event.target as HTMLInputElement).value;
    this.widgetDraft.set({ cellId, value });
    // An emptied number field is not a value yet (Number('') would be 0).
    const source = widget.type === 'number' && value.trim() === '' ? null : widgetSource(value, widget.type);
    if (source !== null) this.widgetDebouncer(cellId).call(source, timing);
  }

  private widgetDebouncer(cellId: string): Debouncer<string> {
    let debouncer = this.widgetDebouncers.get(cellId);
    if (debouncer === undefined) {
      debouncer = new Debouncer((source) => this.updateInputFromWidget({ cellId, source }));
      this.widgetDebouncers.set(cellId, debouncer);
    }
    return debouncer;
  }

  protected changeTileWidget(event: Event, cellId: string, widget: ResolvedCellWidget): void {
    const control = event.target as HTMLInputElement | HTMLSelectElement;
    const value =
      control instanceof HTMLInputElement && control.type === 'checkbox' ? control.checked : control.value;
    this.widgetDebouncers.get(cellId)?.cancel();
    if (this.widgetDraft()?.cellId === cellId) this.widgetDraft.set(null);
    const source = widgetSource(value, widget.type);
    if (source !== null) this.updateInputFromWidget({ cellId, source });
  }

  protected readonly isRichWidget = isRichWidget;

  /** ‹ / › next to a tile's slider: one step down or up. */
  protected stepTileWidget(cellId: string, widget: ResolvedCellWidget, direction: -1 | 1): void {
    if (!this.requireKernel()) return;
    const current = Number(this.widgetDraftFor(cellId) ?? this.resultAt(cellId)?.value);
    const next = stepValue(current, direction, widget);
    if (next === current) return;
    this.widgetDebouncers.get(cellId)?.cancel();
    this.widgetDraft.set(null);
    const source = widgetSource(next, widget.type);
    if (source !== null) this.updateInputFromWidget({ cellId, source });
  }

  /** A list, multiple choice, long text, or button tile changed its input cell. */
  protected changeRichWidget(cellId: string, widget: ResolvedCellWidget, value: WidgetValue): void {
    if(widget.type==='button' && (widget.action || widget.buttonMode==='action'))return;
    const source = widgetSource(value, widget.type, widget.buttonMode);
    if (source !== null) this.updateInputFromWidget({ cellId, source });
  }

  /** "shopping_list" → "Shopping list". */
  protected labelText(name: string): string {
    return name.replaceAll('_', ' ').replace(/^./, (character) => character.toUpperCase());
  }

  /**
   * Legacy Notes alias of the single workbook-wide editing mode.
   * In reading mode values, charts, and widgets work, but nothing turns back into its
   * source on a double-click and the text cannot change. New projects start in editing
   * mode; opened files, examples, and courses in reading mode.
   */
  protected readonly notesEditing = this.workbookEditing;

  protected toggleNotesEditing(): void {
    this.setWorkbookEditing(!this.workbookEditing());
    if (this.autoDraftReady && this.autoDraftEnabled()) {
      this.scheduleDraftSave(this.currentDraftDocument(), this.pendingStart());
    }
  }

  /** The notes list can be folded away to give the page the full width. */
  // In a narrow window the list starts folded, unless the reader chose otherwise.
  protected readonly notesSidebarCollapsed = signal(
    storedFlag(NOTES_SIDEBAR_COLLAPSED_KEY, typeof window !== 'undefined' && window.innerWidth < NARROW_WINDOW),
  );

  protected toggleNotesSidebar(): void {
    this.notesSidebarCollapsed.update((collapsed) => !collapsed);
    try {
      localStorage.setItem(NOTES_SIDEBAR_COLLAPSED_KEY, String(this.notesSidebarCollapsed()));
    } catch {
      // The choice still applies for this session.
    }
  }

  private graphPinIndex(index: number): number { return index < 0 ? Math.max(0, this.splitViews().indexOf('graph')) : index; }
  protected graphIsPinned(index: number): boolean { return this.graphWorkspace.isPinned(this.graphPinIndex(index)); }
  protected graphOutputsShown(index: number): boolean { return this.graphWorkspace.outputsShown(this.graphPinIndex(index)); }
  protected graphFocused(index: number): boolean { return this.graphWorkspace.focused(this.graphPinIndex(index)); }
  protected toggleGraphPin(index: number, layout: GraphLayout, sheet = this.activeSheet()): void {
    if (this.graphIsPinned(index)) this.graphWorkspace.unpin(this.graphPinIndex(index));
    else this.graphWorkspace.pin(this.graphPinIndex(index), layout, sheet);
  }
  protected unpinGraph(index: number): void { this.graphWorkspace.unpin(this.graphPinIndex(index)); }
  protected graphHasOutput(id: string): boolean { return hasGraphOutput(this.definitionAt(id), this.resultAt(id)); }
  protected resizeGraphNode(index: number, id: string, size: GraphNodeSize | null): void {
    this.graphWorkspace.resizeNode(this.graphPinIndex(index), id, size);
  }
  protected graphSheetValue(index: number, sheet: string): string {
    return this.graphWorkspace.scope(this.graphPinIndex(index), sheet) ?? '*';
  }
  protected setGraphSheet(index: number, sheet: string): void {
    if (sheet !== '*' && !this.sheetTabs().some(tab => tab.prefix === sheet)) return;
    this.commitNoteDraftIfNeeded();
    this.unpinGraph(index);
    if (sheet !== '*') {
      if (index < 0) this.switchSheet(sheet); else this.setSplitSheet(index, sheet);
      if (this.referenceEditor() === null && splitCellId(this.selectedId())[0] !== sheet) {
        this.selectCell(this.cells().find(cell => splitCellId(cell.id)[0] === sheet)?.id ?? qualifyCellId(sheet, 'A1'));
      }
    }
    this.setGraphThisSheet(sheet !== '*');
  }

  protected setGraphDirection(index: number, direction: string): void {
    if (direction !== 'horizontal' && direction !== 'vertical') return;
    this.unpinGraph(index);
    this.graphWorkspace.direction.set(direction);
    this.storeGraphSettings();
  }

  protected setGraphOutputs(enabled: boolean): void {
    this.graphWorkspace.showOutputs.set(enabled);
    this.storeGraphSettings();
  }

  protected setGraphFocus(enabled: boolean): void {
    this.graphFocus.set(enabled);
    this.storeGraphSettings();
  }

  protected readonly graphDepthOption = computed(() =>
    Number.isFinite(this.graphDepth()) ? String(this.graphDepth()) : 'all',
  );

  protected setGraphDepth(value: string): void {
    this.graphDepth.set(value === 'all' ? Infinity : Number(value));
    this.storeGraphSettings();
  }

  protected setGraphHideNotes(hidden: boolean): void {
    this.graphHideNotes.set(hidden);
    this.storeGraphSettings();
  }

  protected setGraphFilter(kind: 'text' | 'isolated' | 'errors', enabled: boolean): void {
    ({text: this.graphHideText, isolated: this.graphHideIsolated, errors: this.graphErrorsOnly})[kind].set(enabled);
    this.storeGraphSettings();
  }

  protected traceGraphOrigin(cellId: string, index = -1): void {
    this.graphWorkspace.unpin(this.graphPinIndex(index));
    const [sheet] = splitCellId(cellId);
    if (sheet !== this.activeSheet()) this.switchSheet(sheet);
    this.selectCell(cellId);
    this.graphFocus.set(true);
    this.graphDepth.set(Infinity);
    this.storeGraphSettings();
    requestAnimationFrame(() => {
      const id = this.viewMode() === 'split' ? `pane-${this.activeSplitPane()}-graph-cell-${cellId}` : `graph-cell-${cellId}`;
      document.getElementById(id)?.scrollIntoView?.({block: 'nearest', inline: 'nearest'});
    });
  }

  protected setGraphThisSheet(enabled: boolean): void {
    this.graphThisSheet.set(enabled);
    this.storeGraphSettings();
  }

  private storeGraphSettings(): void {
    try { localStorage.setItem(GRAPH_SETTINGS_KEY, this.graphWorkspace.settings()); }
    catch { /* The settings still apply for this window. */ }
  }

  private restoreGraphSettings(serialized: string | null): void { this.graphWorkspace.restore(serialized); }

  protected zoomGraph(factor: number): void {
    this.graphZoom.update((zoom) => clampGraphZoom(zoom * factor));
  }

  /** Scale the graph so it fits the visible area (never above 100%). */
  protected fitGraphFromToolbar(event: Event, layout: GraphLayout, index: number): void {
    const viewport = (event.currentTarget as HTMLElement).closest('.graph-view')?.querySelector<HTMLElement>('.graph-scroll');
    if (!viewport) return;
    const width = Number(viewport.dataset['fitWidth']), height = Number(viewport.dataset['fitHeight']);
    if (width > 0 && height > 0) {
      this.setPaneGraphZoom(index, Math.min(1, layout.direction === 'vertical' ? (viewport.clientHeight - 16) / height : (viewport.clientWidth - 16) / width));
      viewport.scrollTo({left:0, top:0});
    } else this.fitGraph(viewport, layout, index);
  }

  protected fitGraph(viewport: HTMLElement, layout = this.graphLayout(), index = -1): void {
    if (layout.width === 0 || layout.height === 0) return;
    const scale = Math.min(
      (viewport.clientWidth - 16) / layout.width,
      (viewport.clientHeight - 16) / layout.height,
      1,
    );
    this.setPaneGraphZoom(index, scale);
    viewport.scrollTo({ left: 0, top: 0 });
  }

  /** Drag the empty background to pan. */
  protected startGraphPan(event: PointerEvent, viewport: HTMLElement): void {
    if (event.pointerType === 'touch' || event.button !== 0 || (event.target as HTMLElement).closest('.graph-node')) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const left = viewport.scrollLeft;
    const top = viewport.scrollTop;
    viewport.classList.add('panning');
    const move = (moveEvent: PointerEvent) => {
      viewport.scrollLeft = left - (moveEvent.clientX - startX);
      viewport.scrollTop = top - (moveEvent.clientY - startY);
    };
    const stop = () => {
      viewport.classList.remove('panning');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  }

  protected setRendered(cellId: string, rendered: boolean): void {
    this.updateCellView(cellId, (view) => ({ ...view, display: rendered ? 'rendered' : 'value' }));
  }

  protected resetSpan(cellId: string): void {
    this.updateCellView(cellId, (view) => ({ ...view, span: [1, 1] }));
  }

  protected setTileWidget(cellId: string, type: string): void {
    if (!this.requireKernel()) return;
    this.updateCellView(cellId, (view) => {
      if(type==='auto')return {...view,widget:undefined};
      const widget={...view.widget,type:type as CellWidget['type']};
      if(type!=='button'){delete widget.action;delete widget.actionArguments;delete widget.buttonMode;}
      return {...view,widget};
    });
    void this.evaluateGraph();
  }

  protected widgetOptionsText(widget: CellWidget | undefined): string {
    return typeof widget?.options === 'string' ? '=' + widget.options : (widget?.options ?? []).join(', ');
  }

  protected setTileWidgetOption(cellId: string, key: 'min' | 'max' | 'step' | 'options', raw: string): void {
    if (!this.requireKernel()) return;
    this.updateCellView(cellId, (view) => {
      if (view.widget === undefined) return view;
      const widget: CellWidget = { ...view.widget };
      if (key === 'options') {
        widget.options = raw.trim().startsWith('=') ? raw.trim().slice(1) : raw.split(',').map((option) => option.trim()).filter(Boolean);
      } else {
        const parsed = Number(raw);
        if (raw.trim() === '') delete widget[key];
        else widget[key] = Number.isFinite(parsed) ? parsed : raw.trim().replace(/^=/, '');
      }
      return { ...view, widget };
    });
    void this.evaluateGraph();
  }

  /**
   * Drag a tile's corner to span more cells. The span stops before any filled cell or
   * other tile, so nothing gets hidden. Presentation only: nothing is recomputed.
   */
  protected startSpanResize(event: PointerEvent, cellId: string): void {
    event.preventDefault();
    event.stopPropagation();
    if (this.definitionAt(cellId) === undefined) return;
    this.recordHistory();
    const [anchorColumn, anchorRow] = cellPosition(cellId);
    const move = (moveEvent: PointerEvent) => {
      const target = this.gridPositionAt(moveEvent.clientX, moveEvent.clientY);
      if (target === null) return;
      const covered = this.coveredCells();
      const span = clampSpan(
        cellId,
        [Math.max(1, target[0] - anchorColumn + 1), Math.max(1, target[1] - anchorRow + 1)],
        (id) => this.isFilled(id) || (covered.has(id) && covered.get(id) !== cellId),
        this.columns().length,
        this.rows().length,
      );
      this.updateCellView(cellId, (view) => ({ ...view, span }), false);
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  }

  /** Grid [column, row] under a screen point, found from the header cells. */
  private gridPositionAt(x: number, y: number): [number, number] | null {
    const index = (selector: string, inside: (rect: DOMRect) => boolean) => {
      const headers = [...document.querySelectorAll<HTMLElement>(selector)];
      const hit = headers.findIndex((header) => inside(header.getBoundingClientRect()));
      if (hit >= 0) return hit + 1;
      const last = headers.at(-1)?.getBoundingClientRect();
      return last !== undefined && inside(new DOMRect(last.x, last.y, Infinity, Infinity)) ? headers.length : null;
    };
    const column = index('.column-header', (rect) => x >= rect.left && x < rect.right);
    const row = index('.row-header', (rect) => y >= rect.top && y < rect.bottom);
    return column === null || row === null ? null : [column, row];
  }

  private updateCellView(cellId: string, update: (view: CellView) => CellView, record = true): void {
    const current = this.definitionAt(cellId);
    if (current === undefined) return;
    const view = normalizeView(update(current.view ?? {}));
    if (JSON.stringify(view) === JSON.stringify(current.view)) return;
    if (record) this.recordHistory();
    this.cells.update((cells) =>
      cells.map((cell) => {
        if (cell.id !== cellId) return cell;
        const { view: _previous, ...rest } = cell;
        return view === undefined ? rest : { ...rest, view };
      }),
    );
  }

  /** Selected cells that have a value to collect (notes and effects are skipped). */
  protected readonly collectableSelection = computed(() =>
    collectableCells(this.selectedIds(), (id) => this.definitionMap().get(id)),
  );

  /** Header click selects the filled cells of a column; Ctrl/Cmd+click adds them. */
  protected selectColumn(column: string, event: MouseEvent): void {
    if ((event.target as HTMLElement | null)?.closest('.resize-handle')) return;
    this.selectMany(
      filledInColumn(column, this.rows(), (id) => this.isFilled(id), this.activeSheet()),
      event,
    );
  }

  protected selectRow(row: number, event: MouseEvent): void {
    if ((event.target as HTMLElement | null)?.closest('.resize-handle')) return;
    this.selectMany(
      filledInRow(row, this.columns(), (id) => this.isFilled(id), this.activeSheet()),
      event,
    );
  }

  /**
   * Grid keyboard: arrows move, Shift+arrows extend the selection, Ctrl/Cmd+Shift+arrows
   * extend to the end of the filled block, Ctrl/Cmd+A selects every filled cell, and
   * Alt+L / Alt+D collect the selection into a list / dict cell.
   */
  protected handleGridKey(event: KeyboardEvent, cellId: string): void {
    // Keys typed into a tile's widget (slider arrows, text) belong to the widget.
    if ((event.target as HTMLElement).closest('input, button, select, textarea, [contenteditable], reaktiv-plotly, reaktiv-anywidget, reaktiv-html')) return;
    if (event.key === 'Enter' || event.key === 'F2') {
      if (this.workbookEditing()) { this.editCell(cellId); event.preventDefault(); }
      return;
    }
    if (event.key === ' ') { this.selectCell(cellId); event.preventDefault(); return; }
    const modifier = event.ctrlKey || event.metaKey;
    const directions: Record<string, [number, number]> = {
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
    };
    const direction = directions[event.key];
    if (direction !== undefined) {
      event.preventDefault();
      const [columnDelta, rowDelta] = direction;
      const columnCount = this.columns().length;
      const rowCount = this.rows().length;
      const from = event.shiftKey ? this.selectedId() : cellId;
      const target = modifier
        ? edgeCell(from, columnDelta, rowDelta, (id) => this.isFilled(id), columnCount, rowCount)
        : stepCell(from, columnDelta, rowDelta, columnCount, rowCount);
      if (event.shiftKey) {
        this.selectedIds.set(rectangularSelection(this.selectionAnchor, target));
        this.selectedId.set(target);
        this.syncEditor();
      } else {
        this.selectCell(target);
      }
      this.focusGridCell(target);
      return;
    }
    if (modifier && !event.shiftKey && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      this.selectMany(this.cells().map((cell) => cell.id));
      return;
    }
    if (this.workbookEditing() && event.altKey && !modifier && (event.code === 'KeyL' || event.code === 'KeyD')) {
      event.preventDefault();
      this.collectSelection(event.code === 'KeyL' ? 'list' : 'dict');
    }
  }

  /**
   * Create a computed cell whose value is a list (or dict) of the selected cells'
   * values, placed after the selection. References use cell names, so it keeps
   * working when cells move.
   */
  protected collectSelection(mode: CollectionMode): void {
    if (!this.requireKernel()) return;
    const selected = this.collectableSelection();
    if (selected.length === 0) return;
    const target = collectionTarget(
      selected.map((cell) => cell.id),
      (id) => this.isFilled(id),
      this.columns().length,
      this.rows().length,
    );
    this.recordHistory();
    for (let index = 0; index < target.addColumns; index++) this.addColumn();
    for (let index = 0; index < target.addRows; index++) this.addRow();
    this.cells.update((cells) =>
      sortCells([
        ...cells,
        {
          id: target.id,
          kind: 'formula',
          source: collectionSource(selected, mode, splitCellId(target.id)[0], this.sheetName()),
          enabled: true,
        },
      ]),
    );
    this.closeCellContextMenu();
    this.selectCell(target.id);
    this.focusGridCell(target.id);
    void this.evaluateGraph();
  }

  private gridElement(cellId: string): HTMLElement | null {
    return document.getElementById(this.viewMode() === 'split' ? `pane-${this.activeSplitPane()}-cell-${cellId}` : `cell-${cellId}`);
  }

  private selectMany(ids: readonly string[], event?: MouseEvent): void {
    if (ids.length === 0) return;
    const additive = event?.ctrlKey || event?.metaKey;
    const selected = new Set(additive ? this.selectedIds() : []);
    for (const id of ids) selected.add(id);
    this.selectedIds.set(selected);
    this.selectedId.set(ids[0]);
    this.selectionAnchor = ids[0];
    this.syncEditor();
  }

  private isFilled(cellId: string): boolean {
    return this.definitionMap().has(cellId);
  }

  private focusGridCell(cellId: string): void {
    requestAnimationFrame(() => {
      const element = this.gridElement(cellId);
      element?.focus();
      element?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  }

  // ── Picking references by clicking the sheet ──────────────────────────
  // Opt-in: only after the user turns on "Pick cells" does clicking a cell insert a
  // reference to it (its label, else A1 / Budget.A1 relative to the edited cell) into
  // the editor. Otherwise a click selects the cell, which leaves the edit, as expected.
  // The mode ends on Escape, on applying, on toggling it off, or when the selection changes.
  /** The editor that receives picked references; null when not picking. */
  protected readonly referenceEditor = signal<PythonEditorComponent | null>(null);
  private suppressNextCellClick = false;

  protected togglePickReferences(editor: PythonEditorComponent): void {
    if (this.referenceEditor() !== null) {
      this.stopPickingReferences();
      return;
    }
    if (!this.requireKernel()) return;
    this.referenceEditor.set(editor);
    editor.focus();
  }

  protected stopPickingReferences(): void {
    this.referenceEditor.set(null);
  }

  /** While picking, references go to the code editor that was focused last. */
  protected codeEditorFocused(editor: PythonEditorComponent): void {
    if (this.referenceEditor() !== null) this.referenceEditor.set(editor);
  }

  protected pickReference(event: MouseEvent, cellId: string): void {
    const editor = this.referenceEditor();
    if (editor === null || event.button !== 0) return;
    if (!this.kernelRunning()) {
      this.stopPickingReferences();
      return;
    }
    const editing = this.selectedId();
    if (cellId === editing) return;
    // Keep the editor focused and the edited cell selected.
    event.preventDefault();
    this.suppressNextCellClick = true;
    const reference = cellReference(splitCellId(editing)[0], { id: cellId, name: this.definitionAt(cellId)?.name }, this.sheetName());
    editor.insertAtCursor(this.editorKind === 'markdown' ? `{{ ${reference} }}` : reference);
    this.flashUpdatedCells(new Set([cellId]));
  }

  protected editCell(cellId: string): void {
    this.showInspector();
    this.selectCell(cellId);
    requestAnimationFrame(() => {
      const editor = document.querySelector<HTMLElement>('.inspector .cm-content');
      (editor ?? document.getElementById('inspector-source'))?.focus();
    });
  }

  protected showNotes(): void {
    this.actionsOpen.set(false);
    this.commitNoteDraftIfNeeded();
    const note = this.resolveActiveNote();
    if (note !== undefined) {
      this.activeNoteId.set(note.id);
      this.noteDraft.set(note.source);
      this.selectCell(note.id);
    }
    this.viewMode.set('notes');
    if (note && splitCellId(note.id)[0] !== this.activeSheet()) {
      this.switchSheet(splitCellId(note.id)[0]);
      this.selectCell(note.id);
    }
  }

  protected showSplit(): void {
    this.actionsOpen.set(false);
    this.commitNoteDraftIfNeeded();
    const note = this.resolveActiveNote();
    if (note !== undefined) {
      this.activeNoteId.set(note.id);
      this.noteDraft.set(note.source);
    }
    if (this.definitionAt(this.selectedId())?.kind === 'markdown') {
      const calculation = this.cells().find((cell) => cell.kind !== 'markdown' && splitCellId(cell.id)[0] === this.activeSheet());
      if (calculation !== undefined) this.selectCell(calculation.id);
    }
    if (this.viewMode() !== 'split') {
      this.splitSheets.set([this.activeSheet(), this.activeSheet()]);
      this.splitNotes.set([this.activeNoteId(), this.activeNoteId()]);
      this.splitZooms.set([this.zoom(), this.zoom()]);
      this.splitNoteZooms.set([this.noteZoom(), this.noteZoom()]);
      this.splitGraphZooms.set([this.graphZoom(), this.graphZoom()]);
      this.activeSplitPane.set(0);
    }
    this.splitInspectorOpen.set(false);
    this.viewMode.set('split');
  }

  protected toggleSplitSides(): void {
    this.graphWorkspace.swapPins();
    this.commitNoteDraftIfNeeded();
    this.splitViews.update(views => [...views].reverse());
    this.splitSheets.update(sheets => [...sheets].reverse());
    this.splitNotes.update(notes => [...notes].reverse());
    this.splitZooms.update(zooms => [...zooms].reverse());
    this.splitNoteZooms.update(zooms => [...zooms].reverse());
    this.splitGraphZooms.update(zooms => [...zooms].reverse());
    this.activeSplitPane.set(1 - this.activeSplitPane());
  }

  protected setSplitView(index: number, view: 'notes' | 'sheet' | 'graph'): void {
    if (this.splitViews()[index] !== view) this.graphWorkspace.unpin(this.graphPinIndex(index));
    if (!['notes', 'sheet', 'graph'].includes(view)) return;
    this.commitNoteDraftIfNeeded();
    this.splitViews.update(previous => {
      const next = [...previous];
      next[index] = view;
      return next;
    });
    this.splitInspectorOpen.set(false);
  }

  protected selectSplitNote(id: string, index = this.activeSplitPane()): void {
    this.commitNoteDraftIfNeeded();
    const note = this.notePages().find(note => note.id === id);
    if (!note) return;
    this.setSplitSheet(index, splitCellId(id)[0]);
    this.splitNotes.update(notes => notes.map((current, position) => position === index ? id : current));
    this.activeNoteId.set(id);
    this.noteDraft.set(note.source);
  }

  protected selectNote(cellId: string): void {
    this.commitNoteDraftIfNeeded();
    // Notes live on sheets; keep the grid on the note's sheet for Note + cells.
    const [noteSheet] = splitCellId(cellId);
    if (noteSheet !== this.activeSheet() && this.definitionAt(cellId) !== undefined) {
      this.switchSheet(noteSheet);
    }
    this.activeNoteId.set(cellId);
    this.noteDraft.set(this.definitionAt(cellId)?.source ?? '');
    this.selectCell(cellId);
    this.viewMode.set('notes');
    // On a small screen the list is a drawer over the page: close it once a note is chosen.
    if (window.innerWidth <= 700) this.notesSidebarCollapsed.set(true);
  }

  protected switchFromNotes(view: 'sheet' | 'split' | 'graph'): void {
    this.actionsOpen.set(false);
    this.commitNoteDraftIfNeeded();
    this.viewMode.set(view);
  }

  protected noteTitle(cell: CellDefinition): string {
    return markdownTitle(cell.source, cell.name ?? cell.id);
  }

  protected draftNoteTitle(): string {
    return markdownTitle(this.noteDraft(), this.activeNoteId());
  }

  protected createWorksheetText(cellId: string): void {
    if (!this.requireKernel() || this.definitionAt(cellId) || this.hasCellDraft(cellId)) return;
    this.closeCellContextMenu();
    this.selectCell(cellId);
    this.editorKind = 'markdown';
    this.updateEditorSource('# Heading');
    this.applyCell();
    if (this.viewMode() === 'split' && !this.inspectorCollapsed()) this.splitInspectorOpen.set(true);
  }

  protected createNote(parent?: string): void {
    if (!this.requireKernel()) return;
    this.notesEditing.set(true);
    this.commitNoteDraftIfNeeded();
    let target = this.firstEmptyCellId();
    if (target === null) {
      const row = Math.max(this.rows().length, this.occupiedExtent().rows) + 1;
      target = qualifyCellId(this.activeSheet(), `A${row}`);
      this.growSheetToFit(this.activeSheet(), [target]);
    }
    this.recordHistory();
    this.cells.update((cells) =>
      sortCells([
        ...cells,
        {
          id: target,
          kind: 'markdown',
          source: '# Untitled note\n\nStart writing…',
          enabled: true,
        },
      ]),
    );
    if (parent) this.noteParents.update(parents => ({...parents, [target]: parent}));
    this.activeNoteId.set(target);
    this.noteDraft.set('# Untitled note\n\nStart writing…');
    this.selectCell(target);
    this.viewMode.set('notes');
    void this.evaluateGraph();
  }

  protected applyNote(): void {
    this.commitNoteDraftIfNeeded();
  }

  /** Notes apply to their cell shortly after typing stops; no separate "update" step. */
  private noteCommitTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly moreOpen = signal(false);

  /** Close the More menu after choosing one of its actions. */
  protected closeMoreIfAction(event: Event): void {
    if ((event.target as HTMLElement).closest('button')) this.moreOpen.set(false);
  }

  // ── Notes list order ──────────────────────────────────────────────────
  // Manual order is part of the workbook (layout.noteOrder in the file); the chosen
  // sort is a per-viewer preference. Dragging a note (or Alt+Arrow) switches to manual,
  // starting from the order currently shown.
  protected readonly noteOrder = signal<string[]>([]);
  protected readonly noteParents = signal<NoteParents>({});
  protected readonly noteContextMenu = signal<{id: string; x: number; y: number} | null>(null);
  protected openNoteContextMenu(menu: {id: string; x: number; y: number}): void {
    this.closeTransientMenus(); this.noteContextMenu.set(menu);
    requestAnimationFrame(() => (document.querySelector<HTMLElement>('.note-context-menu [role="menuitem"]:not(:disabled)') ?? document.querySelector<HTMLElement>('.note-context-menu'))?.focus());
  }
  protected readonly validNoteParents = computed(() => normalizeNoteParents(this.notePages(), this.noteParents()));
  protected readonly treeNotes = computed(() => this.orderedNotes().map(note => ({id: note.id, title: this.noteTitle(note), excerpt: this.noteExcerpt(note), source: note.source})));
  protected organizeNote(id: string, parent: string, before?: string | null): void {
    if (!this.notePages().some(note => note.id === id) || parent && !this.notePages().some(note => note.id === parent) || !canNestNote(id, parent, this.validNoteParents())) return;
    if (before === undefined && (this.validNoteParents()[id] ?? '') === parent) return;
    this.recordHistory();
    const parents = {...this.validNoteParents()};
    if (parent) parents[id] = parent; else delete parents[id];
    this.noteParents.set(parents);
    if (before !== undefined) this.moveNote(id, before);
  }
  protected createSubnote(parent: string): void {
    if (!this.requireKernel()) return;
    const [sheet] = splitCellId(parent);
    if (sheet !== this.activeSheet()) this.switchSheet(sheet);
    this.createNote(parent);
  }
  protected readonly noteSort = signal<NoteSort>('manual');
  protected readonly orderedNotes = computed(() =>
    sortNotes(this.notePages(), this.noteSort(), this.noteOrder(), (note) => this.noteTitle(note)),
  );

  protected setNoteSort(sort: string): void {
    if (!isNoteSort(sort)) return;
    this.noteSort.set(sort);
    try {
      localStorage.setItem(NOTE_SORT_KEY, sort);
    } catch {
      // The sort still applies for this session.
    }
  }

  /** Move a note before `beforeId` (null = to the end) in the manual order. */
  protected moveNote(noteId: string, beforeId: string | null): void {
    const order = this.orderedNotes()
      .map((note) => note.id)
      .filter((id) => id !== noteId);
    const index = beforeId === null ? order.length : order.indexOf(beforeId);
    order.splice(index < 0 ? order.length : index, 0, noteId);
    this.noteOrder.set(order);
    this.setNoteSort('manual');
  }

  /** Keep the manual order when note ids change (moves, sheet renames). */
  private renameInNoteOrder(rename: (id: string) => string): void {
    this.actionDefinitions.update(methods=>methods.map(method=>({...method,
      references:Object.fromEntries(Object.entries(method.references).map(([member,id])=>[member,rename(id)])),
      bindings:Object.fromEntries(Object.entries(method.bindings).map(([name,binding])=>[name,binding.cell ? {cell:rename(binding.cell)} : binding])),
    })));

    this.splitNotes.update(notes => notes.map(id => id ? rename(id) : id));
    this.selectionHistory.update(history => renameSelections(history, rename));
    this.renameInCellDrafts(rename); // moves, sheet renames and reorders relabel cells
    this.noteParents.update(parents => Object.fromEntries(Object.entries(parents).map(([child, parent]) => [rename(child), rename(parent)])));
    this.noteOrder.update((order) => order.map(rename));
  }

  protected readonly noteQuery = signal('');
  protected readonly filteredNotes = computed(() => {
    const query = this.noteQuery().trim().toLowerCase();
    const notes = this.orderedNotes();
    if (query === '') return notes;
    // Title matches first, then notes that only mention the query in their text.
    const inTitle = notes.filter((note) => this.noteTitle(note).toLowerCase().includes(query));
    const inText = notes.filter(
      (note) => !inTitle.includes(note) && note.source.toLowerCase().includes(query),
    );
    return [...inTitle, ...inText];
  });

  /** First line of prose after the title, for the notes list. */
  protected noteExcerpt(note: CellDefinition): string {
    const lines = note.source
      .split('\n')
      .map((line) =>
        line
          .replace(/\{\{[\s\S]*?\}\}/g, '…')
          .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
          .replace(/[#>*_`|]/g, '')
          .trim(),
      )
      .filter((line) => line !== '' && !/^[-:\s]+$/.test(line));
    const prose = note.source
      .split('\n')
      .slice(1)
      .filter((line) => !/#sheet-input:|^\s*[|>#!]|^\s*\{\{[^}]*\}\}\s*$/.test(line));
    const first = prose
      .map((line) => line.replace(/\{\{[\s\S]*?\}\}/g, '…').replace(/[*_`]/g, '').trim())
      .find((line) => line.length > 2);
    return (first ?? lines.slice(1).find((line) => line.length > 2) ?? '').slice(0, 90);
  }

  protected updateNoteDraft(source: string): void {
    if (source === this.noteDraft()) return;
    if (this.noteCommitTimer !== null) clearTimeout(this.noteCommitTimer);
    this.noteCommitTimer = setTimeout(() => {
      this.noteCommitTimer = null;
      this.commitNoteDraftIfNeeded();
    }, 700);
    const now = Date.now();
    const noteId = this.activeNoteId();
    if (noteId !== this.lastNoteHistoryId || now - this.lastNoteHistoryAt > NOTE_HISTORY_GROUP_MS) {
      this.recordHistory(false);
    }
    this.lastNoteHistoryAt = now;
    this.lastNoteHistoryId = noteId;
    this.noteDraft.set(source);
  }

  protected showGettingStarted(): void {
    this.gettingStartedOpen.set(true);
  }

  protected closeGettingStarted(): void {
    this.gettingStartedOpen.set(false);
    try {
      localStorage.setItem(GETTING_STARTED_DISMISSED_KEY, 'true');
    } catch {
      // The dialog still closes when storage is unavailable.
    }
  }

  protected openNewProject(): void {
    this.newProjectName = 'Untitled workbook';
    this.newProjectTemplate = 'note';
    this.newProjectColumns = 10;
    this.newProjectRows = 16;
    this.newProjectError = null;
    this.newProjectOpen.set(true);
  }

  protected createNewProject(): void {
    const name = this.newProjectName.trim();
    const columns = Math.round(Number(this.newProjectColumns));
    const rows = Math.round(Number(this.newProjectRows));
    if (name === '') {
      this.newProjectError = 'Enter a project name.';
      return;
    }
    if (!Number.isFinite(columns) || columns < 1 || columns > 100) {
      this.newProjectError = 'Columns must be between 1 and 100.';
      return;
    }
    if (!Number.isFinite(rows) || rows < 1 || rows > 1000) {
      this.newProjectError = 'Rows must be between 1 and 1,000.';
      return;
    }
    if (this.newProjectTemplate === 'model' && (columns < 2 || rows < 2)) {
      this.newProjectError = 'The starter model needs at least 2 columns and 2 rows.';
      return;
    }

    const template = this.newProjectTemplate;
    this.newProjectOpen.set(false);
    this.closeGettingStarted();
    void this.openWorkbook({ kind: 'new', name, columns, rows, template }, async () =>
      this.startNewProject(name, columns, rows, template),
    );
  }

  private startNewProject(name: string, columns: number, rows: number, template: NewProjectTemplate): void {
    this.kernelKind.set('pyodide');
    this.pythonVersion.set('');
    this.packageSource = '';
    this.importSource = '';
    this.variableSource = '';
    const cells = newProjectCells(name, template);
    const document = createSheetDocument(name, columns, rows, cells, [], {
      columnWidths: {},
      rowHeights: {},
      zoom: 1,
      noteZoom: 1,
    });
    this.openDocument(document, false);
    this.workbookEditing.set(true);
    this.markNewDocumentEdited();
    this.viewMode.set(cells.some((cell) => cell.kind === 'markdown') ? 'notes' : 'sheet');
    void this.startWorkbook();
  }

  protected updateInputFromWidget(change: MarkdownWidgetChange): void {
    const result = this.resultAt(change.cellId);
    if (result?.widgetError || widgetBlocked(result?.widget ?? {})) return;
    this.updateInputsFromWidget([change]);
  }

  private readonly widgetWriteVersions = new Map<string, number>();
  /** The input value Python last refused, shown in that input's control until corrected. */
  protected readonly inputRefusal = signal<InputRefusal | null>(null);
  private widgetApplyBarrier = 0;

  private async writeWidgetDuringAction(sources: Map<string, string>, previous: Map<string, string | undefined>,
                                        typed: Map<string, string>): Promise<void> {
    const generation = this.workbookCommands.generation, evaluation = this.widgetApplyBarrier;
    const versions = new Map([...sources.keys()].map(id => [id, this.widgetWriteVersions.get(id)]));
    let accepted = false;
    try {
      const graph = await this.runtime.setInputs(Object.fromEntries(sources));
      if (generation === this.workbookCommands.generation) this.acceptGraph(graph);
      accepted = true;
    }
    catch (error) {
      if (generation !== this.workbookCommands.generation) return;
      if (error instanceof KernelRequestError && error.status === 403) {
        // Refused by policy (a shared session's path limits): restore the value, never retry.
        this.cells.update(cells => cells.map(cell => {
          if (!previous.has(cell.id) || versions.get(cell.id) !== this.widgetWriteVersions.get(cell.id)) return cell;
          const value = previous.get(cell.id);
          return cell.kind === 'linked' ? {...cell, override: value} : {...cell, source: value ?? cell.source};
        }));
        if (previous.has(this.selectedId())) this.syncEditor();
        // Shown at the input itself, with the refused text kept for correction.
        const [cellId, source] = [...typed][0] ?? [];
        let value: unknown = null;
        try { value = source === undefined ? null : JSON.parse(source); } catch { /* not a string literal */ }
        if (cellId !== undefined && typeof value === 'string') this.inputRefusal.set({ cellId, value, message: pythonErrorMessage(error) });
        else this.evaluationError = pythonErrorMessage(error);
        return;
      }
      this.logSystem('warning', `Live widget update could not be queued; applying after the action. ${pythonErrorMessage(error)}`);
    }
    if (accepted || generation !== this.workbookCommands.generation) return;
    // The action may have finished just before admission. Restore the captured
    // intent after its final snapshot so kernel writes cannot erase the click.
    await this.workbookCommands.run(async () => {
      if (generation !== this.workbookCommands.generation || evaluation !== this.widgetApplyBarrier || !this.requireKernel()) return;
      const latest = new Map([...sources].filter(([id]) => versions.get(id) === this.widgetWriteVersions.get(id)));
      if (!latest.size) return;
      this.cells.update(cells => cells.map(cell => {
        const source = latest.get(cell.id);
        return source === undefined || !['input', 'linked'].includes(cell.kind) ? cell :
          cell.kind === 'linked' ? {...cell, override: source} : {...cell, source};
      }));
      if (latest.has(this.selectedId())) this.syncEditor();
      await this.evaluateGraphNow(false, false, true);
    });
  }

  /** Widgets write input cells: several at once (a bound widget's x and y) are one step. */
  private updateInputsFromWidget(changes: readonly MarkdownWidgetChange[]): void {
    if (!this.requireKernel()) return;
    const sources = new Map<string, string>();
    const previous = new Map<string, string | undefined>();
    const typed = new Map<string, string>();
    // Any new value for a refused input (or Escape, which sends the current one) replaces the refusal.
    if (changes.some(change => change.cellId === this.inputRefusal()?.cellId)) this.inputRefusal.set(null);
    for (const change of changes) {
      const definition = this.definitionAt(change.cellId);
      if (!definition || !['input', 'linked'].includes(definition.kind) || change.source === '') continue;
      // The comment above the value ("# rent per month") stays with the cell.
      const source = definition.kind === 'linked' ? change.source : withInputComments(definition.source, change.source);
      const current = definition.kind === 'linked' ? definition.override : definition.source;
      if (current !== source) { sources.set(change.cellId, source); previous.set(change.cellId, current); typed.set(change.cellId, change.source); }
    }
    if (sources.size === 0) return;
    // One undo step per drag, not one per intermediate value.
    const key = [...sources.keys()].sort().join(',');
    const now = Date.now();
    if (this.lastWidgetEdit?.cellId !== key || now - this.lastWidgetEdit.at > 1000) {
      this.recordHistory();
    }
    this.lastWidgetEdit = { cellId: key, at: now };
    this.cells.update((cells) =>
      cells.map((cell) => {
        const source = sources.get(cell.id);
        return source === undefined ? cell : cell.kind === 'linked' ? { ...cell, override: source } : { ...cell, source };
      }),
    );
    for (const id of sources.keys()) this.widgetWriteVersions.set(id, (this.widgetWriteVersions.get(id) ?? 0) + 1);
    if (sources.has(this.selectedId())) this.syncEditor();
    void this.writeWidgetDuringAction(sources, previous, typed);
  }

  protected overrideLinkedInput(id: string, source: string): void {
    this.updateInputsFromWidget([{ cellId: id, source }]);
  }

  protected resetLinkedInput(id: string): void {
    if (!this.requireKernel()) return;
    const definition = this.definitionAt(id);
    if (definition?.kind !== 'linked' || definition.override === undefined) return;
    if (this.embeddedSession()) {
      void this.runtime.resetSessionInput(id).then(graph => this.acceptGraph(graph))
        .catch(error => { this.evaluationError = pythonErrorMessage(error); });
      return;
    }
    this.recordHistory();
    this.cells.update(cells => cells.map(cell => cell.id === id ? { ...cell, override: undefined } : cell));
    void this.evaluateGraph();
  }

  private readonly linkedStateWatcher = effect(() => {
    const states = new Map(this.graph().cells.filter(result => result.linkedOverride !== undefined).map(result => [result.id, result.linkedOverride ?? undefined]));
    untracked(() => this.cells.update(cells => {
      if (!cells.some(cell => cell.kind === 'linked' && states.has(cell.id) && cell.override !== states.get(cell.id))) return cells;
      return cells.map(cell => cell.kind === 'linked' && states.has(cell.id) ? { ...cell, override: states.get(cell.id) } : cell);
    }));
  });

  private lastWidgetEdit: { cellId: string; at: number } | null = null;

  protected setAutoDraftEnabled(enabled: boolean): void {
    this.autoDraftEnabled.set(enabled);
    try {
      localStorage.setItem(AUTO_DRAFT_ENABLED_KEY, String(enabled));
    } catch {
      // The toggle still applies for this session when storage is unavailable.
    }
    if (enabled) this.scheduleDraftSave(this.currentDraftDocument(), this.pendingStart());
  }

  protected setRenderStringsAsMarkdown(enabled: boolean): void {
    this.renderStringsAsMarkdown.set(enabled);
    try {
      localStorage.setItem(RENDER_STRINGS_AS_MARKDOWN_KEY, String(enabled));
    } catch {
      // The preference still applies for this session when storage is unavailable.
    }
  }

  protected updateEditorSource(value: string): void {
    const startsNewCell =
      this.definitionAt(this.selectedId()) === undefined && this.editorSource === '';
    this.editorSource = value;
    if (!startsNewCell || value.length !== 1) return;
    const kind = CELL_TYPE_PREFIXES[value];
    if (kind !== undefined) this.editorKind = kind;
  }

  protected openCellContextMenu(event: MouseEvent, cellId: string): void {
    event.preventDefault();
    event.stopPropagation();
    // Keep a multi-cell selection so its actions (e.g. collect) apply to all of it.
    if (!(this.selectedIds().size > 1 && this.selectedIds().has(cellId))) this.selectCell(cellId);
    this.cellContextMenu.set({ x: event.clientX, y: event.clientY, cellId });
  }

  protected closeCellContextMenu(): void {
    this.cellContextMenu.set(null);
  }

  protected closeTransientMenus(): void {
    this.noteContextMenu.set(null);
    this.closeCellContextMenu();
    this.sheetMenu.set(null);
    this.headerMenu.set(null);
    this.moreOpen.set(false);
  }

  protected inspectContextCell(cellId: string): void {
    this.showInspector();
    this.selectGridCell(cellId);
    if (this.viewMode() === 'split' && !this.inspectorCollapsed()) this.splitInspectorOpen.set(true);
    this.closeCellContextMenu();
  }

  protected async copyContextCellReference(cellId: string): Promise<void> {
    const reference = cellReference(this.activeSheet(), { id: cellId, name: this.definitionAt(cellId)?.name }, this.sheetName());
    try {
      await navigator.clipboard.writeText(reference);
    } catch (error) {
      this.evaluationError = `Could not copy cell reference: ${error instanceof Error ? error.message : String(error)}`;
    }
    this.closeCellContextMenu();
  }

  protected clearContextCell(cellId: string): void {
    this.selectCell(cellId);
    this.deleteSelected();
    this.closeCellContextMenu();
  }

  protected toggleContextEffect(cellId: string): void {
    if (!this.requireKernel()) return;
    const current = this.definitionAt(cellId);
    if (current?.kind !== 'effect') return;
    this.recordHistory();
    this.cells.update((cells) =>
      cells.map((cell) => (cell.id === cellId ? { ...cell, enabled: !cell.enabled } : cell)),
    );
    this.closeCellContextMenu();
    void this.evaluateGraph();
  }

  protected deleteSelectedNote(): void { this.deleteNote(this.activeNoteId()); }

  protected deleteNote(id: string): void {
    if (!this.requireKernel() || !this.notePages().some(note => note.id === id)) return;
    this.commitNoteDraftIfNeeded(false);
    const active = this.activeNoteId(), previousSelection = this.selectedId();
    this.selectCell(id); this.deleteSelected();
    if (id !== active) { this.selectCell(previousSelection); return; }
    const next = this.notePages()[0];
    if (next) {
      this.activeNoteId.set(next.id); this.noteDraft.set(next.source);
      const [sheet] = splitCellId(next.id);
      if (sheet !== this.activeSheet()) this.switchSheet(sheet);
      this.selectCell(next.id);
    } else this.noteDraft.set('');
  }

  protected openReferencedCell(cellId: string): void {
    this.showInspector();
    this.commitNoteDraftIfNeeded();
    // The cell may live on another sheet than the one shown in the grid.
    const [sheet] = splitCellId(cellId);
    if (sheet !== this.activeSheet()) this.switchSheet(sheet);
    this.selectCell(cellId);
    if (this.viewMode() === 'split') {
      this.splitInspectorOpen.set(true);
      requestAnimationFrame(() => this.gridElement(cellId)?.focus());
      return;
    }
    this.viewMode.set('sheet');
    requestAnimationFrame(() => this.gridElement(cellId)?.focus());
  }

  protected inspectActiveNote(): void {
    this.showInspector();
    const noteId = this.activeNoteId();
    this.selectCell(noteId);
    this.splitInspectorOpen.set(true);
  }

  protected closeSplitInspector(): void {
    this.setInspectorVisible(false);
  }

  protected applyCell(): void {
    if (!this.requireKernel()) return;
    this.stopPickingReferences();
    const cellId = this.selectedId();
    if (!this.definitionAt(cellId) && this.editorSource.trim()) {
      try { assertCellPlacements([...this.cells(), { id: cellId }], new Set([cellId])); }
      catch (error) { this.evaluationError = pythonErrorMessage(error); return; }
    }
    this.dropCellDrafts([cellId]); // applied (or the editor still holds it, if refused)
    const wasStopped = this.runtime.stoppedCells().has(cellId);
    this.runtime.releaseCells([cellId]); // a stopped cell runs again
    const source = this.editorSource.trim();
    const normalizedSource = normalizePrefixedCellSource(this.editorKind, source);
    const existing = this.definitionAt(cellId);

    const name = this.editorName.trim();
    if (name === 'cells') {
      this.evaluationError = 'The label cells is reserved for cell references.';
      return;
    }
    if (name !== '' && (!PYTHON_LABEL.test(name) || PYTHON_KEYWORDS.has(name))) {
      this.evaluationError = 'Cell labels must be valid, non-keyword Python identifiers.';
      return;
    }
    if (name && this.sheetNames().includes(name)) {
      this.evaluationError = `The label ${name} conflicts with a sheet name.`;
      return;
    }
    const duplicate =
      name === ''
        ? undefined
        : this.cells().find((cell) => cell.id !== cellId && splitCellId(cell.id)[0] === splitCellId(cellId)[0] && cell.name === name);
    if (duplicate !== undefined) {
      this.evaluationError = `The label ${name} is already used by ${duplicate.id}.`;
      return;
    }
    // The typed kind prefix ('=', '!', '~') only chose the kind: the editor shows the applied
    // source, or it would differ from the cell and leave a draft behind.
    if (normalizedSource !== source) this.editorSource = normalizedSource;

    if (normalizedSource === '') {
      if (existing !== undefined) {
        this.recordHistory();
        this.cells.update((cells) => cells.filter((cell) => cell.id !== cellId));
        void this.evaluateGraph();
      }
      return;
    }

    const next: CellDefinition = {
      id: cellId,
      name: name || undefined,
      kind: this.editorKind,
      source: normalizedSource,
      saveValue: this.editorKind === 'input' && existing?.saveValue === false ? false : undefined,
      override: this.editorKind === 'linked' && existing?.kind === 'linked' && existing.source === normalizedSource && existing.computation === (this.editorComputation.trim() || undefined) ? existing.override : undefined,
      enabled: existing?.kind === 'effect' ? existing.enabled : true,
      color: this.editorColor || undefined,
      equal: this.editorKind !== 'effect' ? this.editorEqual.trim() || undefined : undefined,
      params: this.editorKind === 'resource' && this.editorResourceExplicit ? this.editorParams.trim() || 'None' : undefined,
      computation: this.editorKind === 'linked' ? this.editorComputation.trim() || undefined : undefined,
      annotation: (this.editorKind === 'formula' || this.editorKind === 'linked') ? normalizeAnnotation(this.editorAnnotation) || undefined : undefined,
      // Grid Markdown starts as worksheet text; the Notes sidebar creates pages.
      view:
        existing?.kind !== 'markdown' && this.editorKind === 'markdown' && this.viewMode() !== 'notes'
          ? { ...existing?.view, page: false, display: 'rendered' }
          : existing?.view,
    };
    if (existing !== undefined && sameCell(existing, next)) {
      if (wasStopped) void this.evaluateGraph();
      return;
    }

    let cells = this.cells().map(cell => cell.id === cellId ? {...next, name: existing?.name} :
      cell.id === this.activeNoteId() && cell.kind === 'markdown' ? {...cell, source: this.noteDraft()} : cell);
    let actions = this.actionDefinitions();
    if (!existing) cells.push(next);
    if (existing !== undefined && (existing.name ?? '') !== name) {
      if (this.actionWorkspacePanel?.hasUnappliedDrafts || this.agentDraftIds().some(id => id !== cellId)) {
        this.evaluationError = 'Apply or discard other cell/action drafts before refactoring a label.';
        return;
      }
      try {
        const renamed = refactorCellLabel({...this.currentDraftDocument(), cells}, cellId, name);
        cells = renamed.cells; actions = renamed.actions ?? [];
      } catch (error) { this.evaluationError = error instanceof Error ? error.message : String(error); return; }
    }
    this.recordHistory();
    this.actionDefinitions.set(actions);
    const updated = sortCells(cells);
    this.cells.set(updated);
    const activeNote = updated.find(
      (cell) => cell.id === this.activeNoteId() && cell.kind === 'markdown',
    );
    if (activeNote !== undefined) this.noteDraft.set(activeNote.source);
    void this.evaluateGraph();
  }

  protected setCellColor(cellId: string, color: string): void {
    const targetIds = this.selectedIds().has(cellId) ? this.selectedIds() : new Set([cellId]);
    const reactive = this.cells().some(cell => targetIds.has(cell.id) && cell.view?.color);
    this.applyCellColors(targetIds, color);
    if (reactive && this.kernelRunning()) void this.evaluateGraph();
    this.closeCellContextMenu();
  }

  private applyCellColors(targetIds: ReadonlySet<string>, color: string, label?: string, expression?: string): void {
    const changed = this.cells().some(
      (cell) => targetIds.has(cell.id) && ((cell.color ?? '') !== color || (cell.view?.color?.expr ?? '') !== (expression ?? '')),
    );
    if (!changed) return;
    this.recordHistory(true, label);
    this.cells.update((cells) =>
      cells.map(cell => targetIds.has(cell.id) ? { ...cell, color: color || undefined,
        view: normalizeView({...cell.view, color: expression ? {expr: expression} : undefined}) } : cell),
    );
    if (targetIds.has(this.selectedId())) this.editorColor = color;
  }

  protected cellHighlight(cellId: string): string | null {
    const definition = this.definitionAt(cellId), result = this.resultAt(cellId);
    return (definition?.view?.color && !result?.colorError ? result?.color ?? definition.color : definition?.color) || null;
  }

  protected async setCellColorExpression(cellId: string, expression: string, fallback: string): Promise<void> {
    if (!this.requireKernel()) return;
    try {
      await this.workbookCommands.run(async () => {
        if (this.agentDraftIds().length) throw new Error('Apply or discard cell drafts before changing reactive colors.');
        this.applyCellColors(new Set([cellId]), fallback, 'Reactive cell color', expression);
        await this.evaluateGraphNow(false, true);
      });
    } catch (error) { this.evaluationError = pythonErrorMessage(error); }
  }

  protected deleteSelected(): void {
    const targetIds = this.selectedIds();
    const hasAppliedCells = this.cells().some((cell) => targetIds.has(cell.id));
    if (hasAppliedCells && !this.requireKernel()) return;
    if (hasAppliedCells) {
      this.recordHistory();
      this.cells.update((cells) => cells.filter((cell) => !targetIds.has(cell.id)));
    }
    this.dropCellDrafts(targetIds);
    if (this.editorCellId !== null && targetIds.has(this.editorCellId)) this.editorCellId = null;
    this.syncEditor();
    if (hasAppliedCells) void this.evaluateGraph();
  }

  protected toggleEffect(cellId: string, event: Event): void {
    if (!this.requireKernel()) {
      event.preventDefault();
      return;
    }
    const enabled = (event.target as HTMLInputElement).checked;
    const current = this.definitionAt(cellId);
    if (current === undefined || current.kind !== 'effect' || current.enabled === enabled) {
      return;
    }
    this.recordHistory();
    this.cells.update((cells) =>
      cells.map((cell) => (cell.id === cellId ? { ...cell, enabled } : cell)),
    );
    void this.evaluateGraph();
  }

  private async applyActionDraftsForSave(): Promise<boolean> {
    await this.actionWorkspace.waitForApply();
    const panel = this.actionWorkspacePanel;
    const pending = panel?.pendingDefinitions() ?? [];
    const drafts = pending.filter(draft => !this.actionDefinitions().some(item =>
      item.name === draft.name && item.source === draft.source && item.label === draft.label));
    panel?.acknowledgeSaved(pending.filter(draft => !drafts.includes(draft)));
    if (!drafts.length) return true;
    if (this.runningAction() || this.runtime.status() === 'running')
      throw new Error('Wait for the running workbook operation to finish, or stop it, before saving unapplied action edits. No action was run by Save.');
    const generation = this.workbookCommands.generation;
    if (!this.kernelRunning()) {
      // Saving remains available without an execution kernel. Validate source only;
      // starting/reconnecting the workbook installs these definitions normally.
      const next = [...this.actionDefinitions().filter(item => !drafts.some(draft => draft.name === item.name)), ...drafts];
      if (await this.checkedWorkbookSource({ ...this.currentDraftDocument(), actions: next }) === null) return false;
      if (generation !== this.workbookCommands.generation) throw new Error('Workbook changed while checking action edits. Save the current workbook again.');
      this.recordHistory();
      this.actionDefinitions.set(next);
      panel?.acknowledgeSaved(drafts);
      return true;
    }
    for (const draft of drafts) {
      await this.actionWorkspace.apply(draft);
      if (generation !== this.workbookCommands.generation) throw new Error('Workbook changed while applying action edits. Save the current workbook again.');
      if (this.actionError() || this.actionApplied()?.source !== draft.source || this.actionApplied()?.name !== draft.name)
        throw new Error(this.actionError() || `Action ${draft.name} was not confirmed. The file was not saved; your draft is kept. Apply the edit again.`);
      panel?.acknowledgeSaved([draft]);
    }
    return true;
  }

  /**
   * Save the workbook. `saveAs` (Save As…, Ctrl/Cmd+Shift+S) always asks where; so does
   * saving a bundled or repository example (an `examples` folder), so an example is never
   * overwritten by accident — picking the same file in the dialog still replaces it.
   */
  protected async saveSheet(options: { saveAs?: boolean } = {}): Promise<void> {
    if (this.appRun()) return;
    if (this.saving()) return;
    this.lastSaveOptions = { ...options };
    this.saving.set(true);
    this.saveFeedback.set(null);
    this.saveFailure.set(null);
    const migration = this.workbookMigration();
    let stage = 'prepare the workbook';
    let sourceWritten = false;
    try {
      this.commitNoteDraftIfNeeded();
      stage = 'apply action edits before saving';
      if (!await this.applyActionDraftsForSave()) return;
      if (this.embeddedSession() && !options.saveAs) {
        // Like marimo, the CLI upgrades an older-format file in place.
        stage = 'save the Python session workbook';
        this.takeEnvironmentFields();
        const document = this.currentDraftDocument();
        const files = await this.assets.filesForDownload(document.cells);
        const {blobToDataUrl} = await import('./image-assets');
        const assets: Record<string, string> = {};
        for (const [name, blob] of files) assets[name] = (await blobToDataUrl(blob)).split(',')[1];
        const state = await this.runtime.saveSession(document,this.saveOutputs(),assets);
        this.acceptSessionState(state);
        if (migration && this.workbookMigration() === migration) this.workbookMigration.set(null);
        this.markDocumentSaved();
        this.saveFeedback.set(migration ? 'Saved and upgraded to workbook format 2' : 'Saved to the Python session workbook');
        void this.refreshGit();
        return;
      }
      const { packages, imports, variables } = this.takeEnvironmentFields();
      // Generation and file writes may await while the user keeps editing.
      let savedCheckpoint = this.currentDraftDocument();
      const layout = this.documentLayout();
      const build = (cells: CellDefinition[], snapshot: SheetSnapshot | undefined) =>
        createSheetDocument(
          this.documentName(),
          layout.first.columns,
          layout.first.rows,
          cells,
          packages,
          {
            columnWidths: layout.first.columnWidths,
            rowHeights: layout.first.rowHeights,
            zoom: this.zoom(),
            noteZoom: this.noteZoom(),
            noteOrder: this.noteOrder(),
            noteParents: this.validNoteParents(),
          },
          variables,
          imports,
          snapshot,
          { ...this.kernelSettings(), ...layout.sheets, code: this.sharedCode(), actions: this.actionDefinitions(), saveOutputs:this.saveOutputs() },
        );
      const snapshot = this.saveOutputs() ? this.snapshotForSave() : undefined;
      const filename = migration ? migrationDownloadName(this.migrationFilename(), migration.sourceName) : `${fileStem(this.documentName())}${WORKBOOK_SUFFIX}`;
      stage = 'prepare images for download';
      const cells = await this.assets.extractEmbedded(this.cells());
      const assetFiles = await this.assets.filesForDownload(cells);
      const outputs = mapSnapshotNotes(snapshot, text => this.assets.replaceEmbedded(text));
      const document = build(cells, undefined);
      stage = 'generate and check the workbook';
      const source = await this.checkedWorkbookSource(document);
      if (source === null) return;
      stage = 'download the workbook';
      if (assetFiles.size > 0) {
        const { createWorkbookArchive } = await import('./workbook-archive');
        const archive = await createWorkbookArchive(filename, source, outputs === undefined ? undefined : JSON.stringify(outputs), assetFiles);
        this.workbookFiles.downloadBrowser(archive, `${filename}.zip`);
        sourceWritten = true;
      } else {
        this.workbookFiles.downloadBrowser(source, filename);
        sourceWritten = true;
        stage = 'download the snapshot';
        if (outputs !== undefined) this.workbookFiles.downloadBrowser(JSON.stringify(outputs), `${filename}.snapshot.json`, 'application/json');
      }
      if (
        this.documentChanges.same(this.currentDraftDocument(), savedCheckpoint) &&
        cells.some((cell, index) => cell !== this.cells()[index])
      ) {
        this.adoptMovedImages(cells);
        savedCheckpoint = this.currentDraftDocument();
      }
      if (migration && this.workbookMigration() === migration) this.workbookMigration.set(null);
      this.markDocumentSaved(savedCheckpoint);
      this.showSaveFeedback(assetFiles.size > 0
        ? `Downloaded ${filename}.zip with images`
        : `Downloaded ${filename}${snapshot === undefined ? "" : " and snapshot"}`);
    } catch (error) {
      this.reportSaveFailure(`Could not ${stage}.`, [
        error instanceof Error ? error.message : String(error),
        ...(sourceWritten ? ['The workbook source was saved, but the save did not finish. Retry to complete the remaining steps.'] : []),
      ], sourceWritten ? 'Save incomplete' : 'Workbook not saved');
    } finally {
      this.saving.set(false);
    }
  }

  /** Images that were embedded in notes are files now: the notes link them (one step back in
   * undo restores the embedded version, which the next save moves out again). */
  private adoptMovedImages(cells: CellDefinition[]): void {
    this.recordHistory();
    this.cells.set(cells);
    const active = cells.find((cell) => cell.id === this.activeNoteId());
    if (active?.kind === 'markdown') this.noteDraft.set(active.source);
    void this.evaluateGraph();
  }

  /** Static generation/validation works independently of the execution kernel. */
  private async checkedWorkbookSource(document: SheetDocument): Promise<string | null> {
    const generated = await this.workbookSource.serialize(document);
    if (generated.problems.length === 0) return generated.source;
    this.reportSaveFailure('Not saved: the file would not load back as this workbook.', [
      ...generated.problems,
      'The workbook file was not overwritten. Your changes remain open. Use Open cell or Open action below to inspect the reported code, then save again after correcting any reported code issue.',
    ]);
    return null;
  }

  protected async openSheet(input: HTMLInputElement): Promise<void> {
    input.click();
  }

  protected async loadSheet(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    const file = files.find((item) => item.name.endsWith('.py') || item.name.endsWith('.zip'));
    if (file === undefined) {
      if (files.length) this.evaluationError = 'Select a workbook .py file with its optional snapshot, or a workbook .zip including images.';
      return;
    }
    const modifiedAt = new Date(file.lastModified).toISOString();
    const companion = files.find((item) => item.name === `${file.name}.snapshot.json`);
    const opening = file.name.endsWith('.zip') ? (async (): Promise<WindowOpening> => {
      const { readWorkbookArchive } = await import('./workbook-archive');
      const archive = await readWorkbookArchive(file);
      await this.assets.importFiles(archive.assets);
      return { kind: 'source', source: archive.source, outputs: archive.outputs, modifiedAt, name: file.name.replace(/\.zip$/i, '') };
    })() : Promise.all([file.text(), companion?.text() ?? Promise.resolve(null)]).then(
      ([source, outputs]): WindowOpening => ({ kind: 'source', source, outputs, modifiedAt, name: file.name }),
    );
    try {
      await this.openWorkbook(opening, async () => {
        const value = await opening;
        if (value.kind === 'source') this.openDocument(
          await this.inspectOpened({ source: value.source, outputs: value.outputs, name: value.name }),
          true, modifiedAt,
        );
      });
    } catch (error) {
      this.evaluationError = error instanceof Error ? error.message : String(error);
    }
  }

  /**
   * Open and run a bundled example named in the link. Bundled examples ship with the app,
   * so they start at once (files opened from elsewhere wait for "Start workbook").
   */
  private async openLinkedExample(name: string): Promise<void> {
    try {
      const response = await fetch(exampleAssetUrl(name, document.baseURI));
      if (!response.ok) throw new Error(`Could not load ${name} (${response.status}).`);
      const document_ = await this.runtime.inspectDocument(await response.text());
      this.openDocument(document_, false);
      this.markNewDocumentEdited();
      this.viewMode.set(document_.cells.some((cell) => cell.kind === 'markdown') ? 'notes' : 'sheet');
      this.showLinkedNote();
      await this.startWorkbook();
    } catch (error) {
      this.evaluationError = error instanceof Error ? error.message : String(error);
      void this.evaluateGraph();
    }
  }

  /** `&note=<label>` in the link: open that page of the workbook (a chapter of a course). */
  private showLinkedNote(): void {
    const label = linkedNote(location.search);
    const note = label === null ? undefined : this.notePages().find((cell) => cell.name === label);
    if (note !== undefined) this.selectNote(note.id);
  }

  protected readonly examples = EXAMPLES;
  protected readonly exampleLevels = EXAMPLE_LEVELS;

  protected loadExample(event: Event): Promise<void> {
    const select = event.target as HTMLSelectElement;
    const name = select.value;
    select.value = '';
    return name === '' ? Promise.resolve() : this.openExample(name);
  }

  /** Open a bundled example (Examples menu, Getting started). It waits for "Start workbook". */
  protected async openExample(name: string): Promise<void> {
    await this.openWorkbook({ kind: 'example', name }, () => this.openExampleHere(name));
  }

  private async openExampleHere(name: string): Promise<void> {
    try {
      const response = await fetch(exampleAssetUrl(name, document.baseURI));
      if (!response.ok) {
        throw new Error(`Could not load example workbook (${response.status}).`);
      }
      this.openDocument(await this.runtime.inspectDocument(await response.text()));
    } catch (error) {
      this.evaluationError = error instanceof Error ? error.message : String(error);
    }
  }

  /** The Workbook settings fields (packages, imports, environment variables) become the
   * workbook's: what Apply runs with and Save writes. */
  private takeEnvironmentFields(): { packages: string[]; imports: string[]; variables: Record<string, string> } {
    const packages = parseRequirements(this.packageSource);
    const imports = parseGlobalImports(this.importSource);
    const variables = parseEnvironmentVariables(this.variableSource);
    this.packages.set(packages);
    this.imports.set(imports);
    this.variables.set(variables);
    return { packages, imports, variables };
  }

  protected async applyPackages(): Promise<void> {
    if (this.embeddedSession()) {
      // The script's Python owns what is installed; the lists still belong to the workbook.
      try { this.takeEnvironmentFields(); await this.evaluateGraph(); this.settingsOpen.set(false); }
      catch (error) { this.evaluationError = String(error); }
      return;
    }
    try {
      const { packages, variables } = this.takeEnvironmentFields();
      await this.runtime.configureKernel(
        this.kernelKind(),
        this.remoteUrl,
        packages,
        variables,
      );
      this.settingsOpen.set(false);
      this.pendingStart.set(false);
      await this.evaluateGraph();
    } catch (error) {
      this.evaluationError = error instanceof Error ? error.message : String(error);
    }
  }

  protected async restartKernel(assertCurrent?: () => void): Promise<void> {
    if (this.embeddedSession()) {
      try {
        await this.recoverSessionConflict();
        this.evaluationError = 'Reconnected to the Python script. Review any preserved drafts before applying.';
      } catch (error) { this.evaluationError = String(error); }
      return;
    }
    this.stopRequest.set(null);
    // Restarting because a cell hangs: keep it stopped, or the restart would run it again.
    const running = this.activity.current();
    if (running !== null) {
      this.runtime.holdCells([running.id]);
      this.evaluationGeneration++;
      this.activity.settle();
    }
    try {
      const packages = parseRequirements(this.packageSource);
      const imports = parseGlobalImports(this.importSource);
      const variables = parseEnvironmentVariables(this.variableSource);
      this.packages.set(packages);
      this.imports.set(imports);
      this.variables.set(variables);
      await this.runtime.configureKernel(
        this.kernelKind(),
        this.remoteUrl,
        packages,
        variables,
      );
      assertCurrent?.();
      await this.runtime.restart(packages);
      assertCurrent?.();
      this.pendingStart.set(false);
      await this.evaluateGraph();
      this.settingsOpen.set(false);
    } catch (error) {
      if (assertCurrent) throw error;
      this.evaluationError = error instanceof Error ? error.message : String(error);
    }
  }

  protected async startWorkbook(assertCurrent?: () => void): Promise<void> {
    try {
      const packages = parseRequirements(this.packageSource);
      const imports = parseGlobalImports(this.importSource);
      const variables = parseEnvironmentVariables(this.variableSource);
      this.packages.set(packages);
      this.imports.set(imports);
      this.variables.set(variables);
      await this.runtime.configureKernel(
        this.kernelKind(),
        this.remoteUrl,
        packages,
        variables,
      );
      assertCurrent?.();
      this.pendingStart.set(false);
      await this.evaluateGraph();
    } catch (error) {
      if (assertCurrent) throw error;
      this.evaluationError = error instanceof Error ? error.message : String(error);
    }
  }

  /** An anywidget saved new state (model.save_changes()): Python updates its readers. */
  private readonly handleWidgetChange = (event: Event): void => {
    const { cellId, state, modelId, bindings } = (event as CustomEvent<AnywidgetChange>).detail;
    if (!cellId || !this.requireKernel()) return;
    // Bound traits are data: they go to their input cells. The rest is the
    // widget's own state.
    const { inputs, own, errors } = splitWidgetChange(state, bindings, pythonLiteral);
    if (errors.length > 0) this.evaluationError = errors.join(' ');
    if (inputs.length > 0) this.updateInputsFromWidget(inputs);
    if (Object.keys(own).length === 0) return;
    const generation = ++this.evaluationGeneration;
    void this.workbookCommands.run(async () => {
        const graph = await this.runtime.updateWidget(cellId, own, modelId);
        if (generation !== this.evaluationGeneration) return;
        this.acceptGraph(graph);
        this.flashUpdatedCells(affectedCellIds(graph.changed, graph.dependencies));
      })
      .catch((error: unknown) => {
        this.evaluationError = pythonErrorMessage(error);
      });
  };

  /** A clock cell is due: Python ticks it and re-runs everything that reads it. */
  private tickTimer(cellId: string): void {
    if (!this.kernelRunning() || this.pendingMove()) {
      this.timerScheduler.settled(cellId);
      return;
    }
    // Queue ticks already in flight before a move; new ticks pause during the move.
    const generation = this.evaluationGeneration;
    this.activity.expect(
      [...affectedCellIds([cellId], this.graph().dependencies)].filter((id) => this.definitionAt(id)?.kind !== 'input'),
    );
    void this.workbookCommands.run(async () => {
      const graph = await this.runtime.tickTimer(cellId);
      this.timerScheduler.settled(cellId);
      this.activity.settle();
      if (generation !== this.evaluationGeneration) {
        this.timerScheduler.schedule(this.kernelRunning() && !this.pendingMove() ? (this.graph().timers ?? []) : []);
        return;
      }
      this.acceptGraph(graph);
      this.flashUpdatedCells(affectedCellIds(graph.changed, graph.dependencies));
    }).catch((error: unknown) => {
      this.evaluationError = pythonErrorMessage(error);
    }).finally(() => {
      this.timerScheduler.settled(cellId);
      this.activity.settle();
    });
  }

  protected timerTitle(cellId: string): string | null {
    const timer = this.timerMap().get(cellId);
    return timer === undefined ? null : timerSummary(timer);
  }

  /** A widget's `model.send()`: Python handles it; replies come back with the result. */
  private readonly handleWidgetMessage = (event: Event): void => {
    const { cellId, modelId, content, buffers } = (event as CustomEvent<AnywidgetMessage>).detail;
    if (!cellId || !this.kernelRunning() || this.pendingMove()) return;
    void this.workbookCommands.run(async () => {
      this.acceptGraph(await this.runtime.widgetMessage(cellId, content, buffers, modelId));
    })
      .catch((error: unknown) => {
        this.evaluationError = pythonErrorMessage(error);
      });
  };

  /** `widget.send()` from Python: hand each message to the views of its widget. */
  private readonly widgetMessageDelivery = effect(() => {
    const messages = this.graph().widgetMessages ?? [];
    if (messages.length === 0) return;
    queueMicrotask(() => {
      for (const message of messages) {
        for (const element of document.querySelectorAll<HTMLElement & { deliver?: (m: unknown) => void }>(
          `reaktiv-anywidget[data-cell="${CSS.escape(message.cellId)}"]`,
        )) {
          element.deliver?.({ modelId: message.modelId, content: message.content, buffers: message.buffers });
        }
      }
    });
  });

  protected async runEffect(cellId: string): Promise<void> {
    if (!this.requireKernel()) return;
    this.evaluationError = null;
    this.runtime.releaseCells([cellId]);
    try {
      await this.workbookCommands.run(async () => {
        this.acceptGraph(await this.runtime.runEffect(cellId));
      });
    } catch (error) {
      this.evaluationError = error instanceof Error ? error.message : String(error);
    }
  }

  protected async clearLogs(): Promise<void> {
    this.systemLogs.set([]);
    try {
      await this.workbookCommands.run(async () => {
        this.acceptGraph(await this.runtime.clearLogs());
      });
    } catch (error) {
      this.evaluationError = error instanceof Error ? error.message : String(error);
    }
  }

  protected toggleArtifacts(): void {
    const open = !this.artifactsOpen();
    this.artifactsOpen.set(open);
    if (open) { this.logsOpen.set(false); this.consoleOpen.set(false); }
  }

  protected toggleLogs(): void {
    const open = !this.logsOpen();
    this.logsOpen.set(open);
    if (!open) return;
    this.artifactsOpen.set(false);
    this.consoleOpen.set(false);
    this.logFilter.set('all');
  }

  /** Status bar: open the Logs panel on the failing cells (or the log when there are none). */
  protected openProblems(): void {
    this.logsOpen.set(true);
    this.artifactsOpen.set(false);
    this.consoleOpen.set(false);
    this.logFilter.set(this.problems().length > 0 ? 'problems' : 'all');
  }

  /** Show a cell from the Logs panel: its sheet, in a view where the grid is visible. */
  protected openLogCell(cellId: string): void {
    if (cellId === '') return;
    this.showInspector();
    const [sheet] = splitCellId(cellId);
    if (sheet !== this.activeSheet()) this.switchSheet(sheet);
    if (this.viewMode() === 'notes' || this.viewMode() === 'graph') this.viewMode.set('sheet');
    this.jumpTo(cellId);
    requestAnimationFrame(() =>
      this.gridElement(cellId)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }),
    );
  }

  protected async copyLogs(): Promise<void> {
    const text =
      this.logFilter() === 'problems'
        ? problemsAsText(this.problems(), this.cellLabel)
        : logsAsText(this.visibleLogs(), this.cellLabel);
    try {
      await navigator.clipboard.writeText(text);
      this.logsCopied.set(true);
      setTimeout(() => this.logsCopied.set(false), 1500);
    } catch (error) {
      this.evaluationError = `Could not copy logs: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  protected artifactDataUrl(artifact: ArtifactResult): string {
    return `data:${artifact.mimeType};base64,${artifact.dataBase64}`;
  }

  protected richOutputDataUrl(output: RichOutputResult): string {
    return `data:${output.mimeType};base64,${output.dataBase64}`;
  }

  protected isPreviewableArtifact(artifact: ArtifactResult): boolean {
    return ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(artifact.mimeType);
  }

  protected artifactSize(size: number): string {
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KiB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MiB`;
  }

  protected downloadArtifact(artifact: ArtifactResult): void {
    const binary = window.atob(artifact.dataBase64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    const url = URL.createObjectURL(new Blob([bytes], { type: artifact.mimeType }));
    const anchor = window.document.createElement('a');
    anchor.href = url;
    anchor.download = artifact.filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  protected addColumn(): void {
    this.columns.update((columns) => [...columns, columnLabel(columns.length + 1)]);
  }

  protected addRow(): void {
    this.rows.update((rows) => [...rows, rows.length + 1]);
  }

  protected zoomBy(delta: number): void {
    this.zoom.update((value) => Math.min(2, Math.max(0.1, Math.round((value + delta) * 10) / 10)));
  }

  protected setNoteZoom(value: number): void {
    this.noteZoom.set(Math.min(1.6, Math.max(0.7, value)));
  }

  protected resetZoom(): void {
    this.zoom.set(1);
  }

  protected startColumnResize(event: PointerEvent, column: string): void {
    this.startResize(
      event,
      this.columnWidths()[column] ?? 112,
      64,
      480,
      (size) => this.columnWidths.update((widths) => ({ ...widths, [column]: size })),
      'x',
    );
  }

  protected startRowResize(event: PointerEvent, row: number): void {
    this.startResize(
      event,
      this.rowHeights()[String(row)] ?? 45,
      28,
      240,
      (size) => this.rowHeights.update((heights) => ({ ...heights, [row]: size })),
      'y',
    );
  }

  protected toggleEditorExpanded(): void {
    const expanded = !this.editorExpanded();
    this.editorExpanded.set(expanded);
    try {
      localStorage.setItem(EDITOR_EXPANDED_KEY, String(expanded));
    } catch {
      // Storage unavailable: the choice lasts for this window.
    }
  }

  protected startSidebarResize(event: PointerEvent): void {
    event.preventDefault();
    const move = (pointer: PointerEvent) => {
      const maximum = Math.min(800, window.innerWidth * 0.65);
      this.sidebarWidth.set(Math.min(maximum, Math.max(280, window.innerWidth - pointer.clientX)));
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop, { once: true });
  }

  protected startSplitResize(event: PointerEvent): void {
    event.preventDefault();
    const container = (event.currentTarget as HTMLElement).parentElement;
    if (container === null) return;
    const move = (pointer: PointerEvent) => {
      const bounds = container.getBoundingClientRect();
      const available = Math.max(1, bounds.width - 8);
      const position = ((pointer.clientX - bounds.left) / available) * 100;
      const minimum = Math.min(42, (280 / available) * 100);
      this.splitPosition.set(Math.min(100 - minimum, Math.max(minimum, position)));
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop, { once: true });
  }

  protected resizeSplitWithKeyboard(event: KeyboardEvent): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const direction = event.key === 'ArrowLeft' ? -1 : 1;
    this.splitPosition.update((position) =>
      Math.min(75, Math.max(25, position + direction * (event.shiftKey ? 10 : 2))),
    );
  }

  protected async copyMarkdownOutput(): Promise<void> {
    const display = this.selectedResult()?.display;
    if (display === undefined) {
      return;
    }
    const markdown = embedCellImages(display, this.resultMap());
    try {
      await navigator.clipboard.writeText(markdown);
      this.markdownCopied.set(true);
      window.setTimeout(() => this.markdownCopied.set(false), 1500);
    } catch (error) {
      this.evaluationError = `Could not copy Markdown: ${
        error instanceof Error ? error.message : String(error)
      }`;
    }
  }

  protected undo(): void {
    if (this.undoStack.at(-1)?.worksheetTracks === undefined && !this.requireKernel()) return;
    const previous = this.undoStack.pop();
    if (previous === undefined) {
      return;
    }
    this.redoStack.push({ ...this.captureHistory(previous.environment !== undefined), label: previous.label, worksheetSize: previous.worksheetSize, worksheetTracks: previous.worksheetTracks });
    this.restoreHistory(previous);
    this.updateHistoryState();
    this.syncEditor();
    if (previous.worksheetTracks === undefined) void this.evaluateGraph(true);
  }

  protected redo(): void {
    if (this.redoStack.at(-1)?.worksheetTracks === undefined && !this.requireKernel()) return;
    const next = this.redoStack.pop();
    if (next === undefined) {
      return;
    }
    this.undoStack.push({ ...this.captureHistory(next.environment !== undefined), label: next.label, worksheetSize: next.worksheetSize, worksheetTracks: next.worksheetTracks });
    this.restoreHistory(next);
    this.updateHistoryState();
    this.syncEditor();
    if (next.worksheetTracks === undefined) void this.evaluateGraph(true);
  }

  protected handleGlobalShortcut(event: KeyboardEvent, sheetFile: HTMLInputElement): void {
    if (event.defaultPrevented) return;
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      this.commandPaletteOpen.update(open => !open);
      return;
    }
    if (this.appRun()) return;
    // Let the browser dismiss the top-layer details before handling workspace Escape.
    if (event.key === 'Escape' && this.statusDetailsOpen()) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    const modifier = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (modifier && event.shiftKey && key === 'f') { event.preventDefault(); this.openCellSearch(); return; }
    if (event.key === 'Escape' && this.actionsOpen()) { event.preventDefault(); this.actionsOpen.set(false); return; }
    if (event.key === 'Escape' && this.cellSearchOpen()) { event.preventDefault(); this.cellSearchOpen.set(false); return; }
    if (event.key === 'Escape') {
      if (this.noteContextMenu()) {
        event.preventDefault(); const id = this.noteContextMenu()!.id; this.noteContextMenu.set(null);
        requestAnimationFrame(() => document.querySelector<HTMLElement>(`app-note-tree [data-note="${CSS.escape(id)}"]`)?.focus()); return;
      }
      if (this.referenceEditor() !== null) {
        event.preventDefault();
        this.stopPickingReferences();
        return;
      }
      if (this.cutCells() !== null) {
        event.preventDefault();
        this.cutCells.set(null);
        return;
      }
      if (this.gettingStartedOpen() || this.newProjectOpen()) {
        event.preventDefault();
        this.gettingStartedOpen.set(false);
        this.newProjectOpen.set(false);
      } else if (this.settingsOpen() || this.logsOpen() || this.artifactsOpen()) {
        event.preventDefault();
        this.settingsOpen.set(false);
        this.logsOpen.set(false);
        this.artifactsOpen.set(false);
      } else if (this.viewMode() === 'split' && this.splitInspectorOpen()) {
        event.preventDefault();
        this.closeSplitInspector();
      }
      return;
    }
    const editingTarget =
      target?.closest('input, textarea, .cm-editor, .cm-tooltip, [contenteditable="true"]') !== null &&
      target !== null;
    if (key === 'i' && !modifier && !event.altKey && !event.shiftKey && !editingTarget && this.viewMode() !== 'notes' && !this.actionsOpen()) {
      event.preventDefault();
      this.toggleInspector();
      return;
    }
    if (this.graphNavigationActive() && event.altKey && !modifier && !event.shiftKey && !editingTarget && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault();
      this.navigateSelection(event.key === 'ArrowLeft' ? -1 : 1);
      return;
    }
    if (!this.workbookEditing() && (this.viewMode() === 'sheet' || (this.viewMode() === 'split' && this.splitViews().includes('sheet'))) && !editingTarget && (key === 'delete' || key === 'backspace' || (modifier && (key === 'x' || key === 'v')))) {event.preventDefault(); return;}
    if (!modifier) {
      const cellTarget = target?.closest('.sheet-cell, .graph-node');
      if (
        (key === 'delete' || key === 'backspace') &&
        !editingTarget &&
        cellTarget !== null &&
        cellTarget !== undefined
      ) {
        event.preventDefault();
        this.deleteSelected();
      }
      return;
    }
    // Cut / copy / paste cells (within or between sheets and windows); editors keep their
    // own clipboard. Copy and paste go through the system clipboard.
    if (!editingTarget && !event.shiftKey && (key === 'x' || key === 'c' || key === 'v')) {
      const onGrid = this.viewMode() === 'sheet' || this.viewMode() === 'split';
      if (key === 'x' && this.cutSelection()) event.preventDefault();
      // The browser copies the bridge's selection itself.
      if (key === 'c' && onGrid) this.copyCellsToClipboard();
      if (key === 'v' && this.cutCells() !== null) {
        event.preventDefault();
        void this.pasteCutCells(this.selectedId());
      } else if (key === 'v' && onGrid) {
        this.pasteCellsFromClipboard();
      }
      return;
    }
    // Ctrl/Cmd+Shift+E (Ctrl/Cmd+E is inline code in the note editor).
    if (modifier && event.shiftKey && key === 'e') {
      event.preventDefault();
      this.toggleNotesEditing();
      return;
    }
    if (modifier && key === 's') {
      event.preventDefault();
      void this.saveSheet({ saveAs: event.shiftKey });
      return;
    }
    // Ctrl/Cmd+. stops the cell that is running.
    if (event.key === '.' && this.activity.current() !== null) {
      event.preventDefault();
      void this.stopRunningCell();
      return;
    }
    if (key === 'o') {
      event.preventDefault();
      void this.openSheet(sheetFile);
      return;
    }
    // Ctrl/Cmd+Alt+N: a new workbook (Ctrl/Cmd+N is a new note; browsers keep Shift+N).
    // `code`, since Option+N types a dead key on macOS.
    if (event.altKey && event.code === 'KeyN') {
      event.preventDefault();
      this.openNewProject();
      return;
    }
    if (key === 'n') {
      event.preventDefault();
      this.createNote();
      return;
    }
    if (key === 'enter') {
      event.preventDefault();
      if (this.viewMode() === 'notes' || this.viewMode() === 'split') this.applyNote();
      else this.applyCell();
      return;
    }
    if (key === ',') {
      event.preventDefault();
      this.openSettings('app');
      return;
    }
    if (event.shiftKey && key === 'l') {
      event.preventDefault();
      this.toggleLogs();
      return;
    }
    if (!event.shiftKey && ['1', '2', '3', '4'].includes(key)) {
      event.preventDefault();
      if (key === '1') this.showNotes();
      else if (key === '2') this.showSplit();
      else if (key === '3') this.switchFromNotes('sheet');
      else this.switchFromNotes('graph');
      return;
    }
    if (editingTarget) return;
    if (key === 'z' && !event.shiftKey) {
      event.preventDefault();
      this.undo();
    } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
      event.preventDefault();
      this.redo();
    }
  }

  protected startDrag(event: DragEvent, cellId: string): void {
    if (this.definitionAt(cellId) === undefined || event.dataTransfer === null) {
      event.preventDefault();
      return;
    }
    if (!this.selectedIds().has(cellId)) this.selectCell(cellId);
    this.cellDrag.set({sourceId: cellId, selection: [...this.selectedIds()]});
    this.cellDropTarget.set(null);
    event.dataTransfer.effectAllowed = 'copyMove';
    event.dataTransfer.setData(CELL_DRAG_TYPE, cellId);
    event.dataTransfer.setData('text/plain', cellId);
  }

  protected allowDrop(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer !== null) {
      event.dataTransfer.dropEffect = 'move';
    }
  }

  private readonly cellDrag = signal<{sourceId: string; selection: string[]} | null>(null);
  private readonly cellDropTarget = signal<{id: string; pane: number} | null>(null);
  protected readonly cellDropPreview = computed(() => {
    const drag = this.cellDrag(), target = this.cellDropTarget();
    if (!drag || !target) return null;
    return {...previewCellMove(this.cells(), drag.sourceId, target.id, drag.selection), pane: target.pane};
  });

  protected previewCellDrop(event: DragEvent, id: string, pane: number): void {
    this.allowDrop(event);
    if (!this.cellDrag()) return;
    const previous = this.cellDropTarget();
    if (previous?.id !== id || previous.pane !== pane) this.cellDropTarget.set({id, pane});
    if (event.dataTransfer) event.dataTransfer.dropEffect = this.cellDropPreview()?.invalid ? 'none' : 'move';
  }

  protected leaveCellDrop(event: DragEvent): void {
    if (event.relatedTarget instanceof Node && (event.currentTarget as Element).contains(event.relatedTarget)) return;
    this.cellDropTarget.set(null);
  }

  protected endCellDrag(): void {
    this.cellDrag.set(null);
    this.cellDropTarget.set(null);
  }

  protected async dropCell(event: DragEvent, targetId: string): Promise<void> {
    const drag = this.cellDrag();
    this.endCellDrag();
    if (!this.requireKernel()) return;
    event.preventDefault();
    const sourceId = event.dataTransfer?.getData('text/plain');
    if (sourceId === undefined || sourceId === '' || sourceId === targetId) {
      return;
    }
    const selection=(drag?.sourceId === sourceId ? drag.selection : [...this.selectedIds()]).filter(id=>this.definitionAt(id)!==undefined);
    await this.queueCellMove(()=>this.dropCellNow(sourceId,targetId,selection));
  }

  private async dropCellNow(sourceId:string,targetId:string,selection:string[], propagateError = false):Promise<void> {
    const generation=this.workbookCommands.generation;
    const sourceCell = this.definitionAt(sourceId);
    if (sourceCell === undefined) {
      return;
    }
    const targetWasOccupied = this.definitionAt(targetId) !== undefined;
    const activeNoteBeforeMove = this.activeNoteId();

    const finish=this.diagnostics.begin('ui.drop-cell',{cells:this.cells().length});
    try {
      const {movingIds, positions} = planCellMove(this.cells(), sourceId, targetId, selection);
      assertCellPlacements(this.cells().map(cell => positions.has(cell.id)
        ? { ...cell, id: positions.get(cell.id)! } : cell), new Set(positions.values()));
      this.commitNoteDraftIfNeeded(false);
      const command = await this.runtime.moveWorkbookCells(
        cloneCells(this.cells()),
        sourceId,
        targetId,
        movingIds,
        this.sheetNames(), this.imports(), this.sharedCode(), this.currentDraftDocument(),
      );
      if (generation!==this.workbookCommands.generation) return;
      const moved=command.cells;
      this.recordHistory(true, propagateError ? 'Agent cell move' : undefined);
      const movedIds = new Set(movingIds ?? [sourceId]);
      const destinations = [...movedIds].map((id) => translateCellId(id, sourceId, targetId));
      this.growSheetToFit(splitCellId(targetId)[0], destinations, moved);
      if (this.editorCellId !== null) this.stashEditorDraft(this.editorCellId);
      // A single-cell drop swaps occupied cells; a group drop only uses empty destinations.
      if (movingIds !== undefined || !targetWasOccupied) {
        this.dropCellDrafts(destinations.filter((id) => !movedIds.has(id)));
        if (this.editorCellId !== null && destinations.includes(this.editorCellId) && !movedIds.has(this.editorCellId)) {
          this.editorCellId = null;
        }
      }
      this.renameInNoteOrder((id) => movedIds.has(id)
        ? translateCellId(id, sourceId, targetId)
        : movingIds === undefined && targetWasOccupied && id === targetId ? sourceId : id);
      this.cells.set(sortCells(moved));
      const nextSelection = movingIds
        ? new Set(movingIds.map((id) => translateCellId(id, sourceId, targetId)))
        : new Set([targetId]);
      let activeNoteAfterMove = activeNoteBeforeMove;
      if (movingIds?.includes(activeNoteBeforeMove)) {
        activeNoteAfterMove = translateCellId(activeNoteBeforeMove, sourceId, targetId);
      } else if (movingIds === undefined && activeNoteBeforeMove === sourceId) {
        activeNoteAfterMove = targetId;
      } else if (
        movingIds === undefined &&
        targetWasOccupied &&
        activeNoteBeforeMove === targetId
      ) {
        activeNoteAfterMove = sourceId;
      }
      this.activeNoteId.set(activeNoteAfterMove);
      const activeNote = moved.find(
        (cell) => cell.id === activeNoteAfterMove && cell.kind === 'markdown',
      );
      if (activeNote !== undefined) this.noteDraft.set(activeNote.source);
      this.selectedIds.set(nextSelection);
      this.selectedId.set(targetId);
      this.selectionAnchor = targetId;
      this.syncEditor();
      this.completeCellMove(command.graph,command.actions);
    } catch (error) {
      if (generation===this.workbookCommands.generation) this.evaluationError = error instanceof Error ? error.message : String(error);
      if (propagateError) throw error;
    } finally { finish(); this.diagnostics.nextFrame('ui.drop-to-next-frame'); }
  }

  // ── Copy / paste cells ───────────────────
  // ⌘/Ctrl+C puts the selected cells on the system clipboard as a small workbook file (the file
  // writer); ⌘/Ctrl+V in any window reads it back (the file reader), places it at the selected
  // cell (the group move), and renames labels that are taken there. Editors and text
  // selections keep the normal clipboard.

  /**
   * The system clipboard without permission prompts: WebKit (Safari) only
   * copies a selection and only pastes into something editable, and a selected grid cell is
   * neither. So ⌘C selects the cells' text in this hidden field and lets the system copy it,
   * and ⌘V lets the system paste into it — the way browser spreadsheets do it.
   */
  private readonly clipboardBridge = createClipboardBridge();
  private bridgeReturnFocus: HTMLElement | null = null;

  /** ⌘/Ctrl+C on selected cells (not while editing, nor with text selected). */
  private copyCellsToClipboard(): boolean {
    const selection = window.getSelection();
    if (selection !== null && !selection.isCollapsed) return false;
    const cells = [...this.selectedIds()]
      .map((id) => this.definitionAt(id))
      .filter((cell): cell is CellDefinition => cell !== undefined);
    if (cells.length === 0) return false;
    const source = this.workbookSource.serialize(copiedCellsDocument(cloneCells(cells))).then(generated => {
      if (generated.problems.length) throw new Error(generated.problems.join('\n\n'));
      return generated.source;
    });
    const message = `Copied ${cells.length === 1 ? '1 cell' : `${cells.length} cells`}`;
    this.cutCells.set(null);
    const copy = async () => {
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        // Start the write within the user's gesture; WebKit accepts a promised Blob.
        await navigator.clipboard.write([new ClipboardItem({
          'text/plain': source.then(text => new Blob([text], {type: 'text/plain'})),
        })]);
      } else {
        this.useClipboardBridge(await source, 'copy');
      }
      this.showSaveFeedback(message);
    };
    void copy().catch((error: unknown) => (this.evaluationError = `Could not copy the cells: ${pythonErrorMessage(error)}`));
    return true;
  }

  /** ⌘/Ctrl+V on the grid: the browser pastes into the bridge (`handlePasteCells` reads it). */
  private pasteCellsFromClipboard(): void {
    this.useClipboardBridge('', 'paste');
  }

  private pasteClipboardText(text: string | null | undefined, target: string): void {
    if (isCopiedCells(text)) void this.pasteCopiedCells(text!, target);
    else if (text?.trim()) this.showSaveFeedback('The clipboard holds text, not cells: copy cells with ⌘/Ctrl+C first');
  }

  private useClipboardBridge(text: string, kind: 'copy' | 'paste'): void {
    this.bridgeReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.clipboardBridge.value = text;
    this.clipboardBridge.focus();
    this.clipboardBridge.select();
    // Give the focus back once the system has copied or pasted. Not on a timer: a menu's
    // Copy/Paste can reach the page later than a zero-delay timer, and the focus would be
    // back on the grid by then.
    const bridge = this.clipboardBridge;
    let timeout = 0;
    const restore = () => {
      window.clearTimeout(timeout);
      bridge.removeEventListener(kind, done);
      bridge.value = '';
      if (document.activeElement === bridge) this.bridgeReturnFocus?.focus();
    };
    const done = () => window.setTimeout(restore);
    bridge.addEventListener(kind, done);
    timeout = window.setTimeout(restore, 2000); // nothing to copy or paste: no event comes
  }

  private readonly handlePasteCells = (event: ClipboardEvent): void => {
    event.preventDefault();
    if (!this.workbookEditing()) return;
    this.pasteClipboardText(event.clipboardData?.getData('text/plain'), this.selectedId());
  };

  /** A resampled chart was zoomed or panned: Python sends the real points of that range. */
  private readonly handleResample = (event: Event): void => {
    const request = (event as CustomEvent<ResampleRequest>).detail;
    if (!this.kernelRunning()) return; // saved outputs only: the overview stays
    this.runtime
      .resample(request.token, request.ranges)
      .then((view) => request.apply(view))
      .catch(() => undefined); // the chart changed (its cell re-ran): its new version follows
  };

  /** Place copied cells with the top-left of their area at `targetId`. */
  protected async pasteCopiedCells(text: string, targetId: string): Promise<void> {
    if (!this.requireKernel()) return;
    try {
      const copiedDocument = await this.runtime.inspectDocument(text);
      const copied = copiedDocument.cells.filter((cell) => splitCellId(cell.id)[0] === '');
      if (copied.length === 0) return;
      const [targetSheet, targetCoordinate] = splitCellId(targetId);
      // The group move keeps references between the copied cells right; it needs a copied
      // cell as its anchor, so aim that cell where the area's top-left offset puts it.
      const ids = copied.map((cell) => cell.id);
      const anchor = topLeft(ids);
      const [anchorColumn, anchorRow] = cellPosition(anchor);
      const areaColumn = Math.min(...ids.map((id) => cellPosition(id)[0]));
      const areaRow = Math.min(...ids.map((id) => cellPosition(id)[1]));
      const [targetColumn, targetRow] = cellPosition(targetCoordinate);
      const anchorTarget = `${columnLabel(targetColumn + anchorColumn - areaColumn)}${targetRow + anchorRow - areaRow}`;
      const placed =
        anchorTarget === anchor ? copied : await this.runtime.moveCells(copied, anchor, anchorTarget, ids, [copiedDocument.sheetName ?? DEFAULT_SHEET_NAME]);
      const destinations = new Set(placed.map((cell) => qualifyCellId(targetSheet, splitCellId(cell.id)[1])));
      const occupied = [...destinations].filter((id) => this.definitionAt(id) !== undefined);
      if (occupied.length > 0) {
        this.evaluationError = `Paste would overwrite ${occupied.slice(0, 3).join(', ')}${occupied.length > 3 ? ', …' : ''}: select an empty area.`;
        return;
      }
      // Labels are local to the destination sheet: copies whose label is taken here get `_2`, `_3`, …
      const taken = new Set<string>([...this.sheetNames(), ...this.cells().flatMap((cell) => (cell.name && splitCellId(cell.id)[0] === targetSheet ? [cell.name] : []))]);
      const clashing = placed.flatMap((cell) => (cell.name && taken.has(cell.name) ? [cell.name] : []));
      const labels = uniqueLabels(clashing, taken, (name, attempt) => `${name}_${attempt + 1}`);
      const pasted = relabelCells(placed, labels).map((cell) => ({ ...cell, id: qualifyCellId(targetSheet, splitCellId(cell.id)[1]),view:remapWidgetActionBindings(cell.view,id=>placed.some(original=>original.id===id) ? qualifyCellId(targetSheet,splitCellId(id)[1]) : id) }));
      assertCellPlacements([...this.cells(), ...pasted], destinations);
      this.commitNoteDraftIfNeeded(false);
      this.recordHistory();
      this.growSheetToFit(targetSheet, [...destinations]);
      if (this.editorCellId !== null) this.stashEditorDraft(this.editorCellId);
      this.dropCellDrafts(destinations);
      if (this.editorCellId !== null && destinations.has(this.editorCellId)) this.editorCellId = null;
      this.cells.update((cells) => sortCells([...cells, ...pasted]));
      if (targetSheet === this.activeSheet()) {
        this.selectedIds.set(destinations);
        this.selectedId.set(targetId);
        this.selectionAnchor = targetId;
        this.syncEditor();
      }
      const renamed = [...labels].map(([from, to]) => `${from} → ${to}`).join(', ');
      this.showSaveFeedback(
        `Pasted ${pasted.length === 1 ? '1 cell' : `${pasted.length} cells`}${renamed ? ` (labels taken here: ${renamed})` : ''}`,
      );
      await this.evaluateGraph();
    } catch (error) {
      this.evaluationError = `Could not paste the cells: ${pythonErrorMessage(error)}`;
    }
  }

  // ── Cut / paste and moving cells between sheets ──────────────────────────
  /** Cells marked by Cut (⌘/Ctrl+X); Paste (⌘/Ctrl+V) moves them to the selected cell. */
  protected readonly cutCells = signal<{ ids: string[]; anchor: string } | null>(null);

  /** Mark the selected filled cells for moving; returns false when nothing to cut. */
  protected cutSelection(): boolean {
    if (!this.requireKernel()) return false;
    const ids = [...this.selectedIds()].filter((id) => this.definitionAt(id) !== undefined);
    if (ids.length === 0) return false;
    const anchor = ids.includes(this.selectedId()) ? this.selectedId() : topLeft(ids);
    this.cutCells.set({ ids, anchor });
    this.closeCellContextMenu();
    return true;
  }

  protected async pasteCutCells(targetId: string): Promise<void> {
    const cut = this.cutCells();
    if (cut === null) return;
    this.closeCellContextMenu();
    if (await this.moveCellGroup(cut.ids, cut.anchor, targetId)) this.cutCells.set(null);
  }

  /** Dropping cells on a sheet tab moves them to that sheet at the same coordinates. */
  protected async dropOnSheet(event: DragEvent, sheet: string): Promise<void> {
    if (this.dropSheetTab(event, sheet)) return;
    event.preventDefault();
    const sourceId = event.dataTransfer?.getData('text/plain');
    if (!sourceId || this.definitionAt(sourceId) === undefined) return;
    const [sourceSheet, coordinate] = splitCellId(sourceId);
    if (sourceSheet === sheet) return;
    const selected = [...this.selectedIds()].filter(
      (id) => this.definitionAt(id) !== undefined && splitCellId(id)[0] === sourceSheet,
    );
    const ids = selected.includes(sourceId) ? selected : [sourceId];
    if (await this.moveCellGroup(ids, sourceId, qualifyCellId(sheet, coordinate))) {
      this.switchSheet(sheet);
      this.selectedIds.set(new Set(ids.map((id) => translateCellId(id, sourceId, qualifyCellId(sheet, coordinate)))));
    }
  }

  /**
   * Move cells by the offset anchor → target, possibly onto another sheet; the engine
   * rewrites references everywhere. The target
   * sheet's grid grows to fit; occupied destinations are refused.
   */
  private async moveCellGroup(ids: string[], anchorId: string, targetId: string): Promise<boolean> {
    if (!this.requireKernel()) return false;
    return (await this.queueCellMove(()=>this.moveCellGroupNow(ids,anchorId,targetId))) ?? false;
  }

  private async moveCellGroupNow(ids:string[],anchorId:string,targetId:string):Promise<boolean> {
    const generation=this.workbookCommands.generation;
    if (ids.length === 0 || anchorId === targetId) return false;
    const destinations = ids.map((id) => translateCellId(id, anchorId, targetId));
    const [targetSheet] = splitCellId(targetId);
    try {
      const selected = new Set(ids);
      assertCellPlacements(this.cells().map(cell => selected.has(cell.id)
        ? { ...cell, id: translateCellId(cell.id, anchorId, targetId) } : cell), new Set(destinations));
      this.commitNoteDraftIfNeeded(false);
      const command = await this.runtime.moveWorkbookCells(
        cloneCells(this.cells()),
        anchorId,
        targetId,
        ids,
        this.sheetNames(), this.imports(), this.sharedCode(), this.currentDraftDocument(),
      );
      if (generation!==this.workbookCommands.generation) return false;
      const moved=command.cells;
      this.recordHistory();
      this.growSheetToFit(targetSheet, destinations, moved);
      const movedIds = new Set(ids);
      if (this.editorCellId !== null) this.stashEditorDraft(this.editorCellId);
      this.dropCellDrafts(destinations.filter((id) => !movedIds.has(id)));
      if (this.editorCellId !== null && destinations.includes(this.editorCellId) && !movedIds.has(this.editorCellId)) {
        this.editorCellId = null;
      }
      this.renameInNoteOrder((id) => (movedIds.has(id) ? translateCellId(id, anchorId, targetId) : id));
      this.cells.set(sortCells(moved));
      const activeNote = this.activeNoteId();
      if (ids.includes(activeNote)) {
        const next = translateCellId(activeNote, anchorId, targetId);
        this.activeNoteId.set(next);
        const note = moved.find((cell) => cell.id === next && cell.kind === 'markdown');
        if (note !== undefined) this.noteDraft.set(note.source);
      }
      if (targetSheet === this.activeSheet()) {
        this.selectedIds.set(new Set(destinations));
        this.selectedId.set(targetId);
        this.selectionAnchor = targetId;
        this.syncEditor();
      }
      this.completeCellMove(command.graph,command.actions);
      return true;
    } catch (error) {
      if (generation===this.workbookCommands.generation) this.evaluationError = pythonErrorMessage(error);
      return false;
    }
  }

  // ── Inserting and deleting rows and columns ─────────────────────────────
  // Like a spreadsheet: the cells after the change move as a group (the cell move: references
  // follow, inputs keep their values), tiles across it grow or shrink, custom row heights or
  // column widths move along, and the grid grows or shrinks by as much. One undo step.
  protected readonly cellPosition = cellPosition;
  protected readonly columnLabel = columnLabel;
  protected readonly headerMenu = signal<{ x: number; y: number; axis: 'row' | 'column'; index: number } | null>(null);
  /** A deletion waiting for confirmation: its cells, and the cells/actions that read them. */
  protected readonly gridDeletion = signal<{ axis: 'row' | 'column'; index: number; count: number; cells: number; users: string[] } | null>(null);

  protected openHeaderMenu(event: MouseEvent, axis: 'row' | 'column', index: number): void {
    if (!this.workbookEditing()) return;
    event.preventDefault();
    event.stopPropagation();
    this.closeCellContextMenu();
    this.headerMenu.set({ x: event.clientX, y: event.clientY, axis, index });
  }

  protected columnNumber(label: string): number {
    return cellPosition(`${label}1`)[0];
  }

  /** Insert an empty row before row `row` (1-based) of the active sheet. */
  protected insertRow(row: number): Promise<void> {
    return this.changeLinesHere('insert', 'row', row);
  }

  /** Insert an empty column before column number `column` (1-based) of the active sheet. */
  protected insertColumn(column: number): Promise<void> {
    return this.changeLinesHere('insert', 'column', column);
  }

  /** Delete row `row` of the active sheet, after confirming when cells would go. */
  protected deleteRow(row: number): Promise<void> {
    return this.changeLinesHere('delete', 'row', row);
  }

  protected deleteColumn(column: number): Promise<void> {
    return this.changeLinesHere('delete', 'column', column);
  }

  protected async confirmGridDeletion(): Promise<void> {
    const request = this.gridDeletion();
    this.gridDeletion.set(null);
    if (request) await this.changeLinesHere('delete', request.axis, request.index, true);
  }

  private async changeLinesHere(change: 'insert' | 'delete', axis: 'row' | 'column', index: number, confirmed = false): Promise<void> {
    this.headerMenu.set(null);
    this.closeCellContextMenu();
    if (!this.requireKernel() || index < 1) return;
    const sheet = this.activeSheet();
    if (change === 'delete' && !confirmed) {
      const removed = this.lineCells(sheet, axis, index, index);
      if (removed.length) {
        this.gridDeletion.set({ axis, index, count: 1, cells: removed.length, users: this.gridLineUsers(sheet, axis, index, 1) });
        return;
      }
    }
    const [column, row] = splitCellId(this.selectedId())[0] === sheet ? cellPosition(this.selectedId()) : [1, 1];
    const done = change === 'insert' ? await this.insertGridLines(sheet, axis, index, 1) : await this.deleteGridLines(sheet, axis, index, 1);
    if (!done) return;
    // Select where the change happened (the move selected the cells it shifted).
    const extent = axis === 'row' ? this.rows().length : this.columns().length;
    const at = Math.min(index, extent);
    this.selectCell(qualifyCellId(sheet, axis === 'row' ? `${columnLabel(column)}${at}` : `${columnLabel(at)}${row}`));
  }

  /** Cells of `sheet` whose anchor is in lines `from`..`to` (inclusive) along `axis`. */
  private lineCells(sheet: string, axis: 'row' | 'column', from: number, to = Number.POSITIVE_INFINITY): CellDefinition[] {
    const along = axis === 'row' ? 1 : 0;
    return this.cells().filter(cell => splitCellId(cell.id)[0] === sheet
      && cellPosition(cell.id)[along] >= from && cellPosition(cell.id)[along] <= to);
  }

  /** Cells and actions outside lines index..index+count-1 that read cells in them. */
  protected gridLineUsers(sheet: string, axis: 'row' | 'column', index: number, count: number): string[] {
    const removed = new Set(this.lineCells(sheet, axis, index, index + count - 1).map(cell => cell.id));
    const graph = this.graph(), dependencies = graph.sourceDependencies ?? graph.dependencies;
    const cells = this.cells().filter(cell => !removed.has(cell.id)
      && ((dependencies[cell.id] ?? []).some(id => removed.has(id))
        || Object.values(cell.view?.widget?.actionArguments ?? {}).some(binding => binding.cell !== undefined && removed.has(binding.cell))));
    const actions = this.actionDefinitions().filter(action => actionReferencesCells(action.source, action.references, removed)
      || Object.values(action.bindings).some(binding => binding.cell !== undefined && removed.has(binding.cell)));
    return [...cells.map(cell => cell.name || cell.id), ...actions.map(action => `${action.label || action.name} (action)`)];
  }

  private patchSheetLayout(sheet: string, patch: (layout: SheetLayout) => SheetLayout): void {
    const next = patch(this.layoutOf(sheet));
    if (sheet === this.activeSheet()) this.applyLayout(next);
    else this.storedLayouts.update(layouts => ({ ...layouts, [sheet]: next }));
  }

  /** Row heights (keys "3") or column widths (keys "C") after inserting (`delta` > 0) or
   * deleting lines at `index`: the ones after move along, deleted ones go. */
  private shiftTracks(tracks: Record<string, number>, axis: 'row' | 'column', index: number, delta: number): Record<string, number> {
    const number = (key: string) => axis === 'row' ? Number(key) : this.columnNumber(key);
    const key = (value: number) => axis === 'row' ? String(value) : columnLabel(value);
    const next: Record<string, number> = {};
    for (const [name, size] of Object.entries(tracks)) {
      const at = number(name);
      if (at < index) next[name] = size;
      else if (delta > 0) next[key(at + delta)] = size;
      else if (at >= index - delta) next[key(at + delta)] = size;
    }
    return next;
  }

  /** Tiles that start before `index` and reach into the changed lines grow over inserted ones,
   * or shrink by the deleted ones they covered. Presentation only; true when one changed. */
  private resizeCrossingTiles(sheet: string, axis: 'row' | 'column', index: number, delta: number): boolean {
    const along = axis === 'row' ? 1 : 0;
    let changed = false;
    this.cells.update(cells => cells.map(cell => {
      const span = cell.view?.span;
      if (!span || splitCellId(cell.id)[0] !== sheet) return cell;
      const start = cellPosition(cell.id)[along], end = start + span[along] - 1;
      if (start >= index || end < index) return cell;
      const covered = delta > 0 ? delta : -(Math.min(end, index - delta - 1) - index + 1);
      const next: [number, number] = [...span];
      next[along] = Math.max(1, span[along] + covered);
      changed = true;
      return { ...cell, view: { ...cell.view, span: next } };
    }));
    return changed;
  }

  private async agentGridLines(change: AgentGridLines, check: () => void): Promise<{ columns: number; rows: number }> {
    if (!this.requireKernel()) throw new Error('Start the workbook kernel first.');
    check();
    const { sheet, axis, index, count } = change;
    if (change.change === 'delete') {
      const users = this.gridLineUsers(sheet, axis, index, count);
      if (users.length && !change.allowBrokenReferences)
        throw new Error(`Deleted cells are read by ${users.join(', ')}. Update those references first, or pass allow_broken_references=true.`);
    }
    const before = this.cells(), label = `Agent ${change.change} ${count} ${axis}${count === 1 ? '' : 's'}`;
    const done = change.change === 'insert'
      ? await this.insertGridLines(sheet, axis, index, count, label)
      : await this.deleteGridLines(sheet, axis, index, count, label);
    if (!done) throw new Error(this.evaluationError ?? 'The workbook refused the change.');
    this.agentActivity.recordChanges(before, this.cells());
    const layout = this.layoutOf(sheet);
    return { columns: layout.columns, rows: layout.rows };
  }

  /** Insert `count` empty rows or columns before `index` on `sheet`. */
  private async insertGridLines(sheet: string, axis: 'row' | 'column', index: number, count: number, label?: string): Promise<boolean> {
    const extentKey = axis === 'row' ? 'rows' : 'columns', tracksKey = axis === 'row' ? 'rowHeights' : 'columnWidths';
    const extent = this.layoutOf(sheet)[extentKey];
    const moving = this.lineCells(sheet, axis, index);
    if (moving.length) {
      const [column, row] = cellPosition(moving[0].id);
      const target = qualifyCellId(sheet, axis === 'row' ? `${columnLabel(column)}${row + count}` : `${columnLabel(column + count)}${row}`);
      if (!await this.moveCellGroup(moving.map(cell => cell.id), moving[0].id, target)) return false; // refused: nothing changed
    } else {
      this.recordHistory(true, label);
    }
    // The move recorded the undo step; the layout and tiles belong to the same step.
    const step = this.undoStack.at(-1);
    if (step) { step.worksheetSize = sheet; if (label) step.label = label; }
    const grown = this.resizeCrossingTiles(sheet, axis, index, count);
    this.patchSheetLayout(sheet, layout => ({ ...layout, [extentKey]: Math.max(layout[extentKey], extent + count),
      [tracksKey]: this.shiftTracks(layout[tracksKey], axis, index, count) }));
    if (grown) await this.evaluateGraph(); // the kernel keeps the tiles' new spans
    return true;
  }

  /** Delete `count` rows or columns from `index` on `sheet`: their cells go, the rest moves back. */
  private async deleteGridLines(sheet: string, axis: 'row' | 'column', index: number, count: number, label?: string): Promise<boolean> {
    const extentKey = axis === 'row' ? 'rows' : 'columns', tracksKey = axis === 'row' ? 'rowHeights' : 'columnWidths';
    const along = axis === 'row' ? 1 : 0, last = index + count - 1;
    const extent = this.layoutOf(sheet)[extentKey];
    const removed = this.lineCells(sheet, axis, index, last);
    this.recordHistory(true, label);
    const step = this.undoStack.at(-1);
    if (step) step.worksheetSize = sheet;
    // Coordinate references to deleted cells must not silently read the cells that move into
    // their place: unlabelled ones get a deleted_<coordinate> label first, so their readers fail
    // with a clear NameError (labelled ones already do once the label is gone).
    let document = this.currentDraftDocument();
    for (const cell of removed.filter(cell => !cell.name)) {
      const base = `deleted_${splitCellId(cell.id)[1]}`;
      let name = base;
      for (let suffix = 2; document.cells.some(other => splitCellId(other.id)[0] === sheet && other.name === name); suffix++) name = `${base}_${suffix}`;
      document = refactorCellLabel(document, cell.id, name);
    }
    const removedIds = new Set(removed.map(cell => cell.id));
    this.dropCellDrafts([...removedIds]);
    this.actionDefinitions.set(document.actions ?? []);
    this.cells.set(sortCells(document.cells.filter(cell => !removedIds.has(cell.id))));
    this.resizeCrossingTiles(sheet, axis, index, -count);
    await this.evaluateGraph(); // the kernel deletes them before the rest moves
    const moving = this.lineCells(sheet, axis, last + 1);
    if (moving.length) {
      const [column, row] = cellPosition(moving[0].id);
      const target = qualifyCellId(sheet, axis === 'row' ? `${columnLabel(column)}${row - count}` : `${columnLabel(column - count)}${row}`);
      const entries = this.undoStack.length;
      if (!await this.moveCellGroup(moving.map(cell => cell.id), moving[0].id, target)) return false;
      if (this.undoStack.length > entries) this.undoStack.pop(); // one step: the deletion's
    }
    const occupied = Math.max(0, ...this.cells().filter(cell => splitCellId(cell.id)[0] === sheet)
      .map(cell => cellPosition(cell.id)[along] + (cell.view?.span?.[along] ?? 1) - 1));
    this.patchSheetLayout(sheet, layout => ({ ...layout, [extentKey]: Math.max(1, occupied, extent - count),
      [tracksKey]: this.shiftTracks(layout[tracksKey], axis, index, -count) }));
    return true;
  }

  private async queueCellMove<T>(operation:()=>Promise<T>):Promise<T | undefined> {
    const generation=this.workbookCommands.generation;
    this.pendingMove.set(true);
    this.moveStatus.set('Move waiting for workbook updates…');
    const waited=this.diagnostics.begin('ui.move-queue');
    try {
      return await this.workbookCommands.run(async()=>{
        if (!this.kernelRunning()) throw new Error('Start the workbook before moving cells.');
        waited();
        this.moveStatus.set('Moving cells…');
        return operation();
      });
    } catch(error) {
      if (generation===this.workbookCommands.generation) this.evaluationError=pythonErrorMessage(error);
      return undefined;
    } finally {
      if (generation===this.workbookCommands.generation) {
        this.updateTracePath.set(null);
    this.pendingMove.set(false); this.moveStatus.set(null); this.activity.settle();
      }
    }
  }

  private completeCellMove(graph:GraphResult,actions:ActionDefinition[]):void {
    this.graphWorkspace.resetViews();
    this.actionDefinitions.set(actions);
    const cells=this.cells();
    this.appliedCells=new Map(cells.map(c=>[c.id,c]));
    this.completedCells.set(new Map(cells.map(c=>[c.id,c])));
    this.activity.settle();
    this.acceptGraph(graph,false);
    this.runtime.noteMoveDocument(this.currentDraftDocument());
    this.snapshotSavedAt.set(null);
    if (this.autoDraftReady && this.autoDraftEnabled()) this.scheduleDraftSave(this.currentDraftDocument(),this.pendingStart());
    this.flashUpdatedCells(affectedCellIds(graph.changed,graph.dependencies));
    this.scheduleTypeCheck();
  }

  private growSheetToFit(sheet: string, ids: string[], definitions: readonly CellDefinition[] = this.cells()): void {
    const spans = new Map(definitions.map(cell => [cell.id, cell.view?.span]));
    const columns = Math.max(0, ...ids.map(id => cellPosition(id)[0] + (spans.get(id)?.[0] ?? 1) - 1));
    const rows = Math.max(0, ...ids.map(id => cellPosition(id)[1] + (spans.get(id)?.[1] ?? 1) - 1));
    if (sheet === this.activeSheet()) {
      while (this.columns().length < columns) this.addColumn();
      while (this.rows().length < rows) this.addRow();
      return;
    }
    const layout = this.layoutOf(sheet);
    if (layout.columns >= columns && layout.rows >= rows) return;
    this.storedLayouts.update((layouts) => ({
      ...layouts,
      [sheet]: { ...layout, columns: Math.max(layout.columns, columns), rows: Math.max(layout.rows, rows) },
    }));
  }

  protected cellClasses(cellId: string): Record<string, boolean> {
    const definition = this.definitionAt(cellId);
    const result = this.resultAt(cellId);
    return {
      selected: this.selectedIds().has(cellId),
      cut: this.cutCells()?.ids.includes(cellId) ?? false,
      dependency: this.selectedDependencies().has(cellId),
      dependent: this.selectedDependents().has(cellId),
      formula: definition?.kind === 'formula',
      resource: definition?.kind === 'resource',
      markdown: definition?.kind === 'markdown',
      'worksheet-text': definition?.kind === 'markdown' && !isNotePage(definition),
      effect: definition?.kind === 'effect',
      error: result?.error !== null && result?.error !== undefined,
      updated: this.updatedCellIds().has(cellId),
      drafted: this.cellDrafts().has(cellId),
      'type-finding': this.typeFindingsByCell().has(cellId),
      pending: this.activity.activity(cellId) === 'pending',
      running: this.activity.activity(cellId) === 'running',
      colored: Boolean(this.cellHighlight(cellId)),
    };
  }

  protected displayTimestamp(timestamp: string | null): string {
    if (timestamp === null) {
      return 'Never';
    }
    return new Date(timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  protected displayLogTimestamp(timestamp: string): string {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
      hour12: false,
    });
  }

  protected jumpTo(cellId: string): void {
    this.selectCell(cellId);
    this.gridElement(cellId)?.focus();
  }

  protected dismissError(): void {
    this.evaluationError = null;
    this.runtime.dismissError();
  }

  private recordHistory(resetNoteGroup = true, label?: string, worksheetSize?: string, environment = false): void {
    this.undoStack.push({ ...this.captureHistory(environment), label, worksheetSize });
    if (this.undoStack.length > HISTORY_LIMIT) {
      this.undoStack.shift();
    }
    this.redoStack.length = 0;
    if (resetNoteGroup) this.resetNoteHistoryGroup();
    this.updateHistoryState();
  }

  private captureHistory(environment = false): HistorySnapshot {
    return {
      ...(environment ? {environment: {...this.currentDraftDocument().environment}} : {}),
      cells: cloneCells(this.cells()),
      actions:structuredClone(this.actionDefinitions()),
      activeNoteId: this.activeNoteId(),
      noteDraft: this.noteDraft(),
      selectedId: this.selectedId(),
      selectedIds: [...this.selectedIds()],
      splitSheets: [...this.splitSheets()], splitNotes: [...this.splitNotes()],
      noteParents: {...this.noteParents()},
      noteOrder: [...this.noteOrder()],
      sheets: {
        first: this.sheetName(),
        extra: [...this.extraSheets()],
        layouts: Object.fromEntries(
          this.sheetTabs().map((tab) => [tab.name, this.layoutOf(tab.prefix)]),
        ),
      },
    };
  }

  private restoreHistory(snapshot: HistorySnapshot): void {
    if (snapshot.worksheetTracks !== undefined) {
      const sheets = snapshot.sheets, prefix = snapshot.worksheetTracks;
      const saved = sheets?.layouts[prefix || sheets.first];
      if (saved) {
        const layout = {...this.layoutOf(prefix), columnWidths: {...saved.columnWidths}, rowHeights: {...saved.rowHeights}};
        if (prefix === this.activeSheet()) this.applyLayout(layout);
        else this.storedLayouts.update(layouts => ({...layouts, [prefix]: layout}));
      }
      return;
    }

    if (snapshot.environment) this.setAgentEnvironment(snapshot.environment);
    const sheets = snapshot.sheets;
    if (
      sheets !== undefined &&
      (sheets.first !== this.sheetName() || sheets.extra.join('\n') !== this.extraSheets().join('\n'))
    ) {
      this.sheetName.set(sheets.first);
      this.extraSheets.set([...sheets.extra]);
      this.storedLayouts.set(
        Object.fromEntries(sheets.extra.map((name) => [name, sheets.layouts[name] ?? DEFAULT_SHEET_LAYOUT])),
      );
      this.applyLayout(sheets.layouts[sheets.first] ?? DEFAULT_SHEET_LAYOUT);
      this.activeSheet.set('');
    }
    if (sheets && snapshot.worksheetSize !== undefined) {
      const prefix = snapshot.worksheetSize;
      const extent = sheets.layouts[prefix || sheets.first];
      if (extent) {
        // The size, and the row heights and column widths an inserted row/column shifted.
        const layout = { ...this.layoutOf(prefix), columns: extent.columns, rows: extent.rows,
          columnWidths: { ...extent.columnWidths }, rowHeights: { ...extent.rowHeights } };
        if (prefix === this.activeSheet()) this.applyLayout(layout);
        else this.storedLayouts.update(layouts => ({ ...layouts, [prefix]: layout }));
      }
    }
    this.splitSheets.set(snapshot.splitSheets ?? [this.activeSheet(), this.activeSheet()]);
    this.splitNotes.set(snapshot.splitNotes ?? ['', '']);
    this.noteParents.set({...snapshot.noteParents});
    this.noteOrder.set([...snapshot.noteOrder]);
    this.cells.set(cloneCells(snapshot.cells));
    this.actionDefinitions.set(structuredClone(snapshot.actions ?? []));
    this.activeNoteId.set(snapshot.activeNoteId);
    this.noteDraft.set(snapshot.noteDraft);
    this.selectedId.set(snapshot.selectedId);
    this.selectedIds.set(new Set(snapshot.selectedIds ?? [snapshot.selectedId]));
    this.selectionAnchor = snapshot.selectedId;
    this.resetNoteHistoryGroup();
  }

  private resetNoteHistoryGroup(): void {
    this.lastNoteHistoryAt = 0;
    this.lastNoteHistoryId = '';
  }

  protected dismissSaveFeedback(): void {
    if (this.saveFeedbackTimer !== null) window.clearTimeout(this.saveFeedbackTimer);
    this.saveFeedbackTimer = null;
    this.saveFeedback.set(null);
  }

  private showSaveFeedback(message: string): void {
    this.saveFeedback.set(message);
    if (this.saveFeedbackTimer !== null) window.clearTimeout(this.saveFeedbackTimer);
    this.saveFeedbackTimer = window.setTimeout(() => {
      this.saveFeedback.set(null);
      this.saveFeedbackTimer = null;
    }, 3000);
  }

  private firstEmptyCellId(): string | null {
    const populated = this.definitionMap(), covered = this.coveredCells();
    for (const row of this.rows()) {
      for (const column of this.columns()) {
        const id = this.cellId(column, row);
        if (!populated.has(id) && !covered.has(id)) return id;
      }
    }
    return null;
  }

  private commitNoteDraftIfNeeded(evaluate = true): void {
    this.resetNoteHistoryGroup();
    const noteId = this.activeNoteId();
    const definition = this.definitionAt(noteId);
    const source = this.noteDraft().trim();
    if (definition?.kind !== 'markdown' || definition.source.trim() === source) {
      return;
    }
    this.cells.update((cells) =>
      cells.map((cell) => (cell.id === noteId ? { ...cell, source } : cell)),
    );
    if (this.selectedId() === noteId) this.editorSource = source;
    if (evaluate) void this.evaluateGraph();
  }

  private resolveActiveNote(): CellDefinition | undefined {
    const active = this.definitionAt(this.activeNoteId());
    if (active?.kind === 'markdown' && isNotePage(active)) return active;
    const selected = this.definitionAt(this.selectedId());
    return selected?.kind === 'markdown' && isNotePage(selected) ? selected : this.notePages()[0];
  }

  private openDocument(
    document: SheetDocument,
    requireExplicitStart = true,
    savedAt: string | null = null,
  ): void {
    this.endCellDrag();
    this.workbookMigration.set(document.sourceFormatVersion === 1 ? {sourceName: document.sourceFileName || `${fileStem(document.name)}.sheet.py`} : null);
    this.migrationFilename.set(migratedFilename(this.workbookMigration()?.sourceName ?? `workbook${WORKBOOK_SUFFIX}`));
    this.agentAccess.stop();
    for (const run of this.actionWorkspace.invocations())
      void this.runtime.cancelAction(run.name, run.id).catch(() => undefined);
    this.workbookCommands.reset();
    this.widgetWriteVersions.clear();
    this.writeReceipts.clear();
    this.writeReceiptEpoch = "";
    this.actionWorkspace.invocations.set([]);
    this.actionWorkspace.cancellingIds.set(new Set());
    this.runningAction.set(null);
    this.actionWorkspacePanel?.resetDrafts();
    this.actionApplied.set(null);
    this.actionApplying.set(false);
    this.actionError.set('');
    this.agentActivity.reset();
    this.agentActionActive = 0;
    this.graphWorkspace.resetViews();
    this.noteRenderer.clear();
    this.trustedCache.clear();
    this.updateTracePath.set(null);
    this.pendingMove.set(false); this.moveStatus.set(null);
    this.saveFailure.set(null);
    if (this.embeddedSession()) {
      this.stopSessionMonitor?.();
      this.runtime.detachSession();
      this.embeddedSession.set(false);
      this.sessionLink = null;
    }
    // An opened workbook is read first; Edit (or a new note) switches to editing.
    this.notesEditing.set(false);
    this.cancelRecoveryOutputs();
    this.recoveryOutputRevision = randomId();
    this.recoveryOutputsDirty = true;
    this.untouchedCheckpoint = null; // the window now holds a workbook the user chose
    this.workbookNameDraft.set(null);
    this.documentName.set(document.name);
    this.saveOutputs.set(document.saveOutputs !== false);
    // In the app, Python runs in the browser (or the attached CLI session); a workbook's
    // `local` setting means "with the CLI" and is kept when it is saved again.
    this.documentKernel = document.environment.kernel === 'local' ? 'local' : 'pyodide';
    this.kernelKind.set('pyodide');
    this.pythonVersion.set(document.environment.python ?? '');
    this.columns.set(makeColumns(document.grid.columns));
    this.rows.set(makeRows(document.grid.rows));
    this.sheetName.set(document.sheetName ?? DEFAULT_SHEET_NAME);
    this.extraSheets.set((document.sheets ?? []).map((sheet) => sheet.name));
    this.storedLayouts.set(
      Object.fromEntries(
        (document.sheets ?? []).map((sheet) => [
          sheet.name,
          {
            columns: sheet.grid.columns,
            rows: sheet.grid.rows,
            columnWidths: sheet.layout.columnWidths,
            rowHeights: sheet.layout.rowHeights,
          },
        ]),
      ),
    );
    this.activeSheet.set('');
    this.splitSheets.set(['', '']);
    this.splitNotes.set(['', '']);
    this.activeSplitPane.set(0);
    this.renamingSheet.set(null);
    this.cells.set(sortCells(document.cells));
    this.packages.set(document.environment.packages);
    this.packageSource = document.environment.packages.join('\n');
    const imports = document.environment.imports ?? [];
    this.imports.set(imports);
    this.importSource = imports.join('\n');
    this.sharedCode.set(document.environment.code ?? '');
    this.actionDefinitions.set(structuredClone(document.actions ?? []));
    this.actionsOpen.set(false);this.actionInitialSource.set('');
    this.liveLogs.set([]);
    this.actionApplying.set(false);this.actionApplied.set(null);
    this.variables.set(document.environment.variables);
    this.variableSource = Object.entries(document.environment.variables)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');
    this.columnWidths.set(document.layout.columnWidths);
    this.rowHeights.set(document.layout.rowHeights);
    this.zoom.set(document.layout.zoom);
    this.noteZoom.set(document.layout.noteZoom ?? 1);
    this.noteOrder.set(document.layout.noteOrder ?? []);
    this.noteParents.set(document.layout.noteParents ?? {});
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.resetNoteHistoryGroup();
    this.updateHistoryState();
    this.selectedId.set(document.cells[0]?.id ?? 'A1');
    this.selectedIds.set(new Set([this.selectedId()]));
    this.selectionAnchor = this.selectedId();
    this.resetCellDrafts();
    this.syncEditor();
    const firstNote = document.cells.find(isNotePage);
    if (firstNote !== undefined) {
      this.activeNoteId.set(firstNote.id);
      this.noteDraft.set(firstNote.source);
      const noteSheet = splitCellId(firstNote.id)[0];
      if (this.viewMode() === 'notes') {
        this.switchSheet(noteSheet);
        this.selectCell(firstNote.id);
      } else if (this.viewMode() === 'split') {
        // Notes are known from source, even before the kernel starts. Initialize
        // each note pane on its note's worksheet; leave other panes on sheet one.
        this.splitSheets.set(this.splitViews().map(view => view === 'notes' ? noteSheet : ''));
        this.splitNotes.set(this.splitViews().map(view => view === 'notes' ? firstNote.id : ''));
        if (this.splitViews()[this.activeSplitPane()] === 'notes') {
          this.switchSheet(noteSheet);
          this.selectCell(firstNote.id);
        }
      }
    } else {
      this.activeNoteId.set('');
      this.noteDraft.set('');
    }
    if (requireExplicitStart) this.runtime.suspend();
    this.pendingStart.set(requireExplicitStart);
    // Results (or the suspension error) of evaluations started for the previous
    // document are stale; ignore them.
    this.evaluationGeneration++;
    const snapshot = document.snapshot;
    this.loadedSnapshot = snapshot;
    this.snapshotSavedAt.set(snapshot?.savedAt ?? null);
    this.graph.set({
      cells: snapshot?.cells ?? [],
      dependencies: snapshot?.dependencies ?? {},
      sourceDependencies: snapshot?.sourceDependencies,
      dependencyStates: snapshot?.dependencyStates,
      widgetDependencies: snapshot?.widgetDependencies ?? {},
      effects: [],
      logs: [],
      changed: [],
      rebuilt: true,
      updateMode: 'initialized',
    });
    // Paused workbooks are a normal state, shown in the status bar and Start control.
    this.evaluationError = null;
    this.resetDocumentActivity(savedAt);
    void this.adoptEmbeddedImages();
    void this.refreshGit();
    this.typeCheckGeneration++; // findings of the previous workbook are stale
    this.typeFindings.set([]);
    this.selectionHistory.set(this.graphNavigationActive() ? visitSelection(EMPTY_SELECTION_HISTORY, this.selectionLocation()) : EMPTY_SELECTION_HISTORY);
  }

  /**
   * Inside the app notes hold `assets/<name>`, never image data: images embedded in
   * an opened file move into the asset store, and the saved outputs point at them too. A file
   * that was saved stays "saved" — only its in-memory form changed; the next save writes the
   * images as separate files (a CLI session next to the workbook, a download in a ZIP).
   */
  private async adoptEmbeddedImages(): Promise<void> {
    const cells = this.cells();
    if (!cells.some((cell) => cell.kind === 'markdown' && cell.source.includes('data:image/'))) return;
    const clean = !this.hasUnsavedChanges();
    const moved = await this.assets.extractEmbedded(cells);
    if (this.cells() !== cells) return; // edited meanwhile: the next save moves them
    this.cells.set(moved);
    const active = moved.find((cell) => cell.id === this.activeNoteId());
    if (active?.kind === 'markdown') this.noteDraft.set(active.source);
    const replace = (text: string) => this.assets.replaceEmbedded(text);
    this.loadedSnapshot = mapSnapshotNotes(this.loadedSnapshot, replace);
    this.graph.update((graph) => ({
      ...graph,
      cells: graph.cells.map((cell) => (cell.valueType === 'markdown' ? { ...cell, display: replace(cell.display) } : cell)),
    }));
    if (clean) {
      const checkpoint = this.currentDraftDocument();
      this.currentDocumentCheckpoint = checkpoint;
      this.savedDocumentCheckpoint = checkpoint;
      this.hasUnsavedChanges.set(false);
    }
  }

  private currentDraftDocument(): SheetDocument {
    const activeNote = this.activeNoteId();
    const draft = this.noteDraft();
    const cells = this.cells().map((cell) =>
      cell.id === activeNote && cell.kind === 'markdown' ? { ...cell, source: draft } : cell,
    );
    const layout = this.documentLayout();
    return createSheetDocument(
      this.documentName(),
      layout.first.columns,
      layout.first.rows,
      cells,
      this.packages(),
      {
        columnWidths: layout.first.columnWidths,
        rowHeights: layout.first.rowHeights,
        zoom: this.zoom(),
        noteZoom: this.noteZoom(),
        noteOrder: this.noteOrder(),
        noteParents: this.validNoteParents(),
      },
      this.variables(),
      this.imports(),
      undefined,
      { ...this.kernelSettings(), ...layout.sheets, code: this.sharedCode(), actions: this.actionDefinitions(), saveOutputs:this.saveOutputs() },
    );
  }

  private recoveryOutputsDirty = true;
  private recoveryOutputTimer: ReturnType<typeof setTimeout> | null = null;
  private recoveryOutputRevision: string = randomId();
  private readonly recoveryOutputWatcher = effect(() => {
    this.graph(); this.snapshotSavedAt();
    this.recoveryOutputsDirty = true;
    this.scheduleRecoveryOutputs();
  });
  private scheduleRecoveryOutputs(): void {
    if (!this.saveOutputs() || !this.autoDraftEnabled()) {
      this.cancelRecoveryOutputs();
      writeRecoveryOutputs(localStorage, this.draftKey, this.recoveryOutputRevision, undefined);
    } else if (this.recoveryOutputsDirty && this.autoDraftReady && this.recoveryOutputTimer === null) {
      this.recoveryOutputTimer = setTimeout(() => {
        this.recoveryOutputTimer = null;
        try {
          writeRecoveryOutputs(localStorage, this.draftKey, this.recoveryOutputRevision, this.snapshotForSave());
          this.recoveryOutputsDirty = false;
        } catch { /* Source recovery remains authoritative if optional previews cannot be saved. */ }
      }, 10000);
    }
  }
  private cancelRecoveryOutputs(): void {
    if (this.recoveryOutputTimer !== null) clearTimeout(this.recoveryOutputTimer);
    this.recoveryOutputTimer = null;
  }

  private scheduleDraftSave(document: SheetDocument, requireExplicitStart: boolean): void {
    if (this.draftTimer !== null) window.clearTimeout(this.draftTimer);
    this.scheduleRecoveryOutputs();
    this.draftTimer = window.setTimeout(() => this.writeDraft(document, requireExplicitStart), 450);
  }

  private writeDraft(document: SheetDocument, requireExplicitStart: boolean): void {
    {
      try {
        const savedAt = new Date().toISOString();
        localStorage.setItem(
          this.draftKey,
          JSON.stringify({
            savedAt,
            requireExplicitStart,
            notesEditing: this.notesEditing(),
            migration: this.workbookMigration(),
            cellDrafts: this.cellDraftsForStorage(),
            document: { ...document, snapshot: undefined, sourceFormatVersion: this.workbookMigration() ? 1 : 2, sourceFileName: this.workbookMigration()?.sourceName },
            lastSavedAt: this.lastSavedAt(),
            savedDocument: this.savedDocumentCheckpoint,
            outputRevision: this.recoveryOutputRevision,
          }),
        );
        this.lastDraftSaved.set(savedAt);
      } catch (error) {
        this.evaluationError = `Could not save local draft: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
  }

  private readStoredDraft(): StoredDraft | null {
    try {
      const draft = readRecoveryDraft<StoredDraft>(localStorage, this.draftKey);
      if (draft === null) return null;
      if (draft.hasDocument === false) return draft;
      return draft.document?.format === 'reaktiv-workbook' && draft.document.version === 4
        ? draft
        : null;
    } catch {
      return null;
    }
  }

  private restoreDraft(draft: StoredDraft): boolean {
    try {
      if (draft.document === undefined) return false;
      this.openDocument(
        draft.document,
        draft.requireExplicitStart ?? true,
        draft.lastSavedAt ?? null,
      );
      if (draft.migration && typeof draft.migration.sourceName === 'string') { this.workbookMigration.set({sourceName: draft.migration.sourceName}); this.migrationFilename.set(migratedFilename(draft.migration.sourceName)); }
      this.recoveryOutputRevision = draft.outputRevision ?? this.recoveryOutputRevision;
      this.currentDocumentCheckpoint = this.currentDraftDocument();
      this.savedDocumentCheckpoint = draft.savedDocument ?? legacyCheckpoint(draft.savedDocumentSignature);
      this.hasUnsavedChanges.set(!this.documentChanges.same(this.currentDocumentCheckpoint, this.savedDocumentCheckpoint));
      this.lastEditedAt.set(draft.savedAt ?? null);
      this.lastDraftSaved.set(draft.savedAt ?? null);
      this.notesEditing.set(draft.notesEditing ?? false);
      if (draft.cellDrafts) {
        this.resetCellDrafts(draft.cellDrafts);
        this.syncEditor();
      }
      return true;
    } catch {
      removeRecoveryDraft(localStorage, this.draftKey);
      return false;
    }
  }

  private updateHistoryState(): void {
    this.hasUndo.set(this.undoStack.length > 0);
    this.undoLabel.set(this.undoStack.at(-1)?.label ?? null);
    this.hasRedo.set(this.redoStack.length > 0);
  }

  protected activityTime(timestamp: string | null): string {
    if (timestamp === null) return '—';
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(timestamp));
  }

  private resetDocumentActivity(savedAt: string | null): void {
    const checkpoint = this.currentDraftDocument();
    this.currentDocumentCheckpoint = checkpoint;
    this.savedDocumentCheckpoint = checkpoint;
    this.hasUnsavedChanges.set(false);
    this.lastEditedAt.set(savedAt);
    this.lastSavedAt.set(savedAt);
  }

  private markNewDocumentEdited(): void {
    this.currentDocumentCheckpoint = this.currentDraftDocument();
    this.savedDocumentCheckpoint = null;
    this.hasUnsavedChanges.set(true);
    this.lastEditedAt.set(new Date().toISOString());
    this.lastSavedAt.set(null);
  }

  private markDocumentSaved(savedCheckpoint?: DocumentCheckpoint): void {
    const timestamp = new Date().toISOString();
    const checkpoint = this.currentDraftDocument();
    this.currentDocumentCheckpoint = checkpoint;
    this.savedDocumentCheckpoint = savedCheckpoint ?? checkpoint;
    this.hasUnsavedChanges.set(!this.documentChanges.same(checkpoint, this.savedDocumentCheckpoint));
    this.lastSavedAt.set(timestamp);
    if (this.lastEditedAt() === null) this.lastEditedAt.set(timestamp);
    if (this.autoDraftReady && this.autoDraftEnabled()) {
      this.scheduleDraftSave(this.currentDraftDocument(), this.pendingStart());
    }
  }

  private syncEditor(): void {
    const cellId = this.selectedId();
    // Leaving a cell keeps its unapplied edits as a draft.
    if (this.editorCellId !== null && this.editorCellId !== cellId) this.stashEditorDraft(this.editorCellId);
    const selectionChanged = this.editorCellId !== cellId;
    this.editorCellId = cellId;
    const definition = this.definitionAt(cellId);
    const draft = this.cellDrafts().get(cellId);
    this.editorKind = draft?.kind ?? definition?.kind ?? 'input';
    this.editorName = draft?.name ?? definition?.name ?? '';
    this.editorSource = draft?.source ?? definition?.source ?? '';
    if (selectionChanged) this.formulaExpanded.set(false);
    this.editorAnnotation = draft?.annotation ?? definition?.annotation ?? '';
    this.editorEqual = draft?.equal ?? definition?.equal ?? '';
    this.editorParams = draft?.params ?? definition?.params ?? '';
    this.editorComputation = draft ? draft.computation ?? '' : definition?.computation ?? '';
    this.editorResourceExplicit = (draft ? draft.params : definition?.params) !== undefined;
    this.editorBase = this.editorState();
    this.editorColor = definition?.color ?? '';
  }

  // ── Cell drafts ─────────────────────
  /** Unapplied edits of cells the editor left (code, kind, label), by cell id. */
  protected readonly cellDrafts = signal<ReadonlyMap<string, CellDraft>>(new Map());
  /** The cell whose content the editor holds. */
  private editorCellId: string | null = null;
  /** What the editor showed when it loaded that cell: only changes to it are edits. */
  private editorBase: CellDraft | null = null;

  private editorState(): CellDraft {
    return { kind: this.editorKind, name: this.editorName, source: this.editorSource, annotation: this.editorAnnotation, equal: this.editorEqual, params: this.editorKind === 'resource' && this.editorResourceExplicit ? this.editorParams : undefined, computation: this.editorKind === 'linked' ? this.editorComputation.trim() || undefined : undefined };
  }

  private stashEditorDraft(cellId: string): void {
    const draft = this.editorState();
    // Not edited since it was loaded: nothing to keep (a moved cell left the editor as it was).
    const base = this.editorBase;
    if (base !== null && sameDraft(base, draft)) return;
    const definition = this.definitionAt(cellId);
    const changed =
      definition === undefined
        ? draft.source.trim() !== '' || draft.name.trim() !== ''
        : !sameDraft(draft, {
            kind: definition.kind,
            name: definition.name ?? '',
            source: definition.source,
            annotation: definition.annotation ?? '',
          params: definition.params,
          computation: definition.computation,
            equal: definition.equal ?? '',
          });
    const previous = this.cellDrafts().get(cellId);
    const same = changed ? previous !== undefined && sameDraft(previous, draft) : previous === undefined;
    if (same) return; // no new map: saving the window's drafts must not trigger another save
    const drafts = new Map(this.cellDrafts());
    if (changed) drafts.set(cellId, draft);
    else drafts.delete(cellId);
    this.cellDrafts.set(drafts);
  }

  private dropCellDrafts(cellIds: Iterable<string>): void {
    const drafts = new Map(this.cellDrafts());
    let changed = false;
    for (const id of cellIds) changed = drafts.delete(id) || changed;
    if (changed) this.cellDrafts.set(drafts);
  }

  /** Cells got new ids (moved, sheet renamed or reordered): their drafts go with them. */
  private renameInCellDrafts(rename: (id: string) => string): void {
    if (this.editorCellId !== null) {
      this.stashEditorDraft(this.editorCellId); // edits still in the editor are kept too
      this.editorCellId = rename(this.editorCellId);
    }
    if (this.cellDrafts().size === 0) return;
    this.cellDrafts.set(new Map([...this.cellDrafts()].map(([id, draft]) => [rename(id), draft])));
  }

  /** Include edits still in the editor, before they have been stashed on selection changes. */
  protected hasCellDraft(cellId: string): boolean {
    if (this.editorCellId !== cellId) return this.cellDrafts().has(cellId);
    const definition = this.definitionAt(cellId);
    const state = this.editorState();
    return definition === undefined
      ? state.source.trim() !== '' || state.name.trim() !== ''
      : !sameDraft(state, {
          kind: definition.kind, name: definition.name ?? '', source: definition.source,
          annotation: definition.annotation ?? '',
          params: definition.params,
          computation: definition.computation,
            equal: definition.equal ?? '',
        });
  }

  /** Forget the selected cell's draft and show its applied content again. */
  protected discardCellDraft(cellId = this.selectedId()): void {
    this.dropCellDrafts([cellId]);
    if (this.editorCellId === cellId) {
      this.editorCellId = null;
      this.syncEditor();
    }
  }

  /** Drafts for the window's saved state, with what the editor holds right now. */
  private cellDraftsForStorage(): Record<string, CellDraft> | undefined {
    if (this.editorCellId !== null) this.stashEditorDraft(this.editorCellId);
    return this.cellDrafts().size > 0 ? Object.fromEntries(this.cellDrafts()) : undefined;
  }

  /** Another document: drafts belonged to the cells of the previous one. */
  private resetCellDrafts(drafts: Record<string, CellDraft> = {}): void {
    this.editorCellId = null;
    this.cellDrafts.set(new Map(Object.entries(drafts)));
  }

  private startResize(
    event: PointerEvent,
    startSize: number,
    minimum: number,
    maximum: number,
    update: (size: number) => void,
    axis: 'x' | 'y',
  ): void {
    event.preventDefault();
    event.stopPropagation();
    const start = axis === 'x' ? event.clientX : event.clientY;
    const move = (pointer: PointerEvent) => {
      const position = axis === 'x' ? pointer.clientX : pointer.clientY;
      const size = Math.round(startSize + (position - start) / this.zoom());
      update(Math.min(maximum, Math.max(minimum, size)));
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop, { once: true });
  }

  private writeReceiptEpoch = "";
  private readonly writeReceipts = new Map<string, number>();

  /** Merge kernel writes without re-applying the workbook or re-running effects. */
  private acceptGraph(graph: GraphResult, recordWrites = true, live = false): void {
    const previous = this.graph(), sequence = graph.snapshotSequence;
    const stale = sequence !== undefined && graph.snapshotEpoch === previous.snapshotEpoch && sequence < (previous.snapshotSequence ?? 0);
    if (graph.snapshotEpoch && graph.snapshotEpoch !== this.writeReceiptEpoch) {
      this.writeReceiptEpoch = graph.snapshotEpoch;
      this.writeReceipts.clear();
    }
    graph = {...graph, cells: shareCellResults(previous.cells, graph.cells)};
    const finish=this.diagnostics.begin('ui.accept-graph',{cells:graph.cells.length,changed:graph.changed.length,rebuilt:graph.rebuilt ? 1 : 0});
    const writes = new Map((graph.cellChanges ?? []).filter(cell => {
      if (sequence !== undefined && sequence < (this.writeReceipts.get(cell.id) ?? 0)) return false;
      if (sequence !== undefined) this.writeReceipts.set(cell.id, sequence);
      const current = this.definitionAt(cell.id);
      return current && current.kind === cell.kind && ['input', 'linked'].includes(cell.kind);
    }).map(cell => [cell.id, cell]));
    const updates = new Map([...writes].filter(([id, cell]) => {
      const current = this.definitionAt(id)!;
      return current.source !== cell.source || current.override !== cell.override;
    }));
    if (updates.size) {
      const beforeAgentWrites = this.agentActionActive ? this.cells() : null;
      if (recordWrites) this.recordHistory();
      if (this.editorCellId !== null) this.stashEditorDraft(this.editorCellId);
      this.cells.update(cells => cells.map(cell => {
        const update = updates.get(cell.id);
        return update ? {...cell, source: update.source, override: update.override} : cell;
      }));
      if (beforeAgentWrites) this.agentActivity.recordChanges(beforeAgentWrites, this.cells());
      if (updates.has(this.selectedId())) this.syncEditor();
      this.snapshotSavedAt.set(null);
      if (this.autoDraftReady && this.autoDraftEnabled()) this.scheduleDraftSave(this.currentDraftDocument(), this.pendingStart());
    }
    // A live widget write may already match the optimistic source. Its final
    // receipt still acknowledges that definition as applied/completed.
    if (writes.size) {
      const acknowledged = new Map([...writes].map(([id, write]) => [id, {...this.definitionAt(id)!, source: write.source, override: write.override}]));
      for (const [id, cell] of acknowledged) this.appliedCells.set(id, cell);
      this.completedCells.update(cells => new Map([...cells, ...acknowledged]));
    }
    if (stale) { finish(); return; }
    const draft = this.widgetDraft();
    if (draft) {
      const result = graph.cells.find(cell => cell.id === draft.cellId);
      if (!result || result.widgetError || (result.widget && widgetBlocked(result.widget))) {
        this.widgetDebouncers.get(draft.cellId)?.cancel();
        this.widgetDraft.set(null);
      }
    }
    this.graph.set(graph);
    const traced=this.updateTracePath();
    if (traced && !graph.updateTrace?.cells[traced.id]) this.updateTracePath.set(null);
    // The authoritative snapshot contains the streamed entries already.
    if (live) {
      const included = new Set(graph.logs.map(entry => entry.id));
      this.liveLogs.update(entries => entries.filter(entry => !included.has(entry.id)));
    } else this.liveLogs.set([]);
    finish();
    this.diagnostics.nextFrame('ui.graph-to-next-frame');
  }

  private async openEmbeddedSession(): Promise<void> {
    const link = this.sessionLink;
    if (!link) return;
    try {
      const state = await this.runtime.attachSession(link.endpoint, link.token);
      if (this.sessionDestroyed) return;
      this.appRun.set(state.mode === 'run');
      if (state.assets && Object.keys(state.assets).length) {
        const files = new Map<string, Blob>();
        for (const [name, encoded] of Object.entries(state.assets)) {
          const ext = name.split('.').pop();
          const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
          const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
          files.set(name, new Blob([bytes], {type: mime}));
        }
        await this.assets.importFiles(files);
        if (this.sessionDestroyed) return;
      }
      if (state.mode === 'run') this.viewMode.set('notes');
      this.openDocument(state.document, false);
      if (state.mode === 'edit') this.setWorkbookEditing(true);
      if (state.mode === 'run') this.setInspectorVisible(false);
      if (this.notePages().length === 0) this.viewMode.set('sheet');
      this.kernelKind.set('remote');
      this.remoteUrl = link.endpoint;
      this.attachedKernelSettings = { kernel: state.document.environment.kernel ?? 'pyodide', python: state.document.environment.python ?? '' };
      this.embeddedSession.set(true);
      this.acceptSessionState(state);
      if (state.mode === 'edit' && state.path) {
        // Git runs in the CLI session, in the workbook's folder.
        this.sessionWorkbookPath = state.path;
        this.gitService.transport = new HttpGitTransport(args => this.runtime.runGit(args));
        void this.refreshGit();
      }
      if (state.mode === 'edit') this.shareWithLinkedAgentBridge();
      this.stopSessionMonitor = this.runtime.monitorSession(state => this.acceptSessionState(state), error => {
        this.evaluationError = `Python session disconnected: ${error instanceof Error ? error.message : String(error)}`;
        // The CLI has stopped (fetch cannot connect): agents must not keep seeing this workbook on
        // the shared MCP endpoint, which other editors keep serving.
        if (error instanceof TypeError && this.agentAccess.shared()) {
          this.agentAccess.stop();
          this.logSystem('info', 'Stopped sharing with agents: the reaktiv-workbook command has ended.');
        }
      }, () => this.cells().every(cell => {
        const completed = this.completedCells().get(cell.id);
        return completed !== undefined && sameComputation(cell, completed);
      }));
    } catch (error) {
      this.evaluationError = error instanceof Error ? error.message : String(error);
    }
  }

  /** `reaktiv-workbook edit --mcp`: agents can work on this workbook right away. */
  private shareWithLinkedAgentBridge(): void {
    try {
      const bridge = linkedAgentBridge(location.search, location.hash, storedAgentPairing());
      if (bridge) this.agentAccess.share(bridge);
      // The pairing token is long-lived: keep it out of the address bar and browser history.
      const hash = withoutAgentToken(location.hash);
      if (hash !== null) history.replaceState(history.state, '', location.pathname + location.search + hash);
    } catch (error) {
      this.logSystem('warning', `Agent access not shared: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** CLI sessions: the session's Python and the declared packages missing from it. */
  protected readonly sessionEnvironment = signal<SessionEnvironment | null>(null);
  private readonly dismissedMissingPackages = signal('');
  /** Declared packages this session's Python lacks, until dismissed (for that list). */
  protected readonly missingPackages = computed(() => {
    const missing = this.sessionEnvironment()?.missing ?? [];
    return missing.length && missing.join(' ') !== this.dismissedMissingPackages() ? missing : [];
  });

  protected dismissMissingPackages(): void {
    this.dismissedMissingPackages.set((this.sessionEnvironment()?.missing ?? []).join(' '));
  }

  /** Restart the CLI session's Python, in a sandbox with the workbook's packages (the
   * settings fields included); the editor's workbook, unsaved edits too, carries over. */
  protected async restartWithPackages(): Promise<void> {
    if (!this.requireKernel() || !this.sessionEnvironment()?.restart) return;
    this.commitNoteDraftIfNeeded();
    this.takeEnvironmentFields();
    this.settingsOpen.set(false);
    try {
      const state = await this.runtime.restartSession(this.currentDraftDocument());
      this.acceptSessionState(state, false);
      this.logSystem('info', 'Python restarted with the workbook packages');
    } catch (error) {
      this.evaluationError = `Could not restart Python: ${pythonErrorMessage(error)}`;
    }
  }

  private acceptSessionState(state: EmbeddedSessionState, stashDraft = true): void {
    this.sessionEnvironment.set(state.environment ?? null);
    setPathsInWorkbookFolder(state.pathsInWorkbookFolder === true);
    if (stashDraft && this.editorCellId !== null) this.stashEditorDraft(this.editorCellId);
    const note = this.activeNoteId();
    const oldNote = this.definitionAt(note);
    const noteEdited = oldNote?.kind === 'markdown' && this.noteDraft() !== oldNote.source;
    this.cells.set(sortCells(state.document.cells));
    this.actionDefinitions.set(state.document.actions ?? []);
    this.appliedCells = new Map(state.document.cells.map(cell => [cell.id, cell]));
    this.completedCells.set(new Map(this.appliedCells));
    if (!noteEdited) {
      const current = this.definitionAt(note);
      this.noteDraft.set(current?.kind === 'markdown' ? current.source : '');
    }
    this.syncEditor();
    this.acceptGraph(state.graph, false);
    this.flashUpdatedCells(new Set(state.graph.changed));
  }

  private async recoverSessionConflict(): Promise<void> {
    if (this.editorCellId !== null) this.stashEditorDraft(this.editorCellId);
    const completed = this.completedCells();
    const drafts = new Map(this.cellDrafts());
    for (const cell of this.cells()) {
      const previous = completed.get(cell.id);
      if (!previous || !sameComputation(cell, previous)) drafts.set(cell.id, {
        kind: cell.kind, name: cell.name ?? '', source: cell.source,
        annotation: cell.annotation, equal: cell.equal, params: cell.params, computation: cell.computation,
      });
    }
    this.cellDrafts.set(drafts);
    const state = await this.runtime.readSession();
    if (state) this.acceptSessionState(state, false);
    this.evaluationError = 'The Python script changed the workbook. Your edits are kept as drafts; review and apply again.';
  }

  private async evaluateGraph(restoringHistory = false): Promise<void> {
    await this.workbookCommands.run(()=>this.evaluateGraphNow(restoringHistory));
  }

  private async evaluateGraphNow(restoringHistory = false, propagateError = false, widgetFallback = false): Promise<void> {
    if (this.pendingStart()) {
      return;
    }
    const generation = ++this.evaluationGeneration;
    if (!widgetFallback) this.widgetApplyBarrier = generation;
    this.evaluationError = null;
    const cells = cloneCells(this.cells());
    this.activity.expect(this.pendingAfter(cells));
    this.appliedCells = new Map(cells.map((cell) => [cell.id, cell]));
    try {
      const graph = await this.runtime.apply(cells, this.imports(), this.sheetNames(), this.sharedCode(), !restoringHistory, this.currentDraftDocument());
      if (generation === this.evaluationGeneration) {
        this.activity.settle();
        this.completedCells.set(new Map(cells.map((cell) => [cell.id, cell])));
        this.acceptGraph(graph, false);
        this.snapshotSavedAt.set(null);
        if (this.autoDraftReady && this.autoDraftEnabled()) {
          this.scheduleDraftSave(this.currentDraftDocument(), this.pendingStart());
        }
        this.flashUpdatedCells(affectedCellIds(graph.changed, graph.dependencies));
        this.scheduleTypeCheck();
      }
    } catch (error) {
      if (propagateError) { this.activity.settle(); throw error; }
      if (generation === this.evaluationGeneration && !(error instanceof KernelStoppedError)) {
        this.activity.settle();
        this.evaluationError = error instanceof Error ? error.message : String(error);
        if (this.embeddedSession() && this.evaluationError.includes('Session conflict:')) {
          try { await this.recoverSessionConflict(); }
          catch (refreshError) { this.evaluationError = String(refreshError); }
        }
      }
    }
  }

  private flashUpdatedCells(cellIds: ReadonlySet<string>): void {
    if (this.updateFlashTimer !== null) window.clearTimeout(this.updateFlashTimer);
    if (this.updateFlashFrame !== null) cancelAnimationFrame(this.updateFlashFrame);
    this.updatedCellIds.set(new Set());
    this.updateFlashFrame = requestAnimationFrame(() => {
      this.updatedCellIds.set(cellIds);
      this.updateFlashFrame = null;
    });
    this.updateFlashTimer = window.setTimeout(() => {
      this.updatedCellIds.set(new Set());
      this.updateFlashTimer = null;
    }, 900);
  }
}

function clampGraphZoom(zoom: number): number {
  return Math.min(2, Math.max(0.2, zoom));
}

const NOTES_SIDEBAR_COLLAPSED_KEY = 'reaktiv-workbook:notes-sidebar-collapsed:v1';

/** Below this width (px) the notes list starts folded and opens as a drawer over the page. */
const NARROW_WINDOW = 900;

function storedFlag(key: string, fallback = false): boolean {
  try {
    const stored = localStorage.getItem(key);
    return stored === null ? fallback : stored === 'true';
  } catch {
    return fallback;
  }
}

function normalizePrefixedCellSource(kind: CellKind, source: string): string {
  if ((kind === 'formula' || kind === 'linked') && source.startsWith('=')) return source.slice(1).trim();
  if (kind === 'effect' && source.startsWith('!')) return source.slice(1).trim();
  if (kind === 'resource' && source.startsWith('~')) return source.slice(1).trim();
  return source;
}

interface StoredDraft extends DraftSummary {
  migration?: WorkbookMigration | null;
  savedAt?: string;
  requireExplicitStart?: boolean;
  /** The worksheet's notes were in editing mode (absent in older drafts: editing). */
  notesEditing?: boolean;
  /** Unapplied edits of cells. */
  cellDrafts?: Record<string, CellDraft>;
  document?: SheetDocument;
  lastSavedAt?: string | null;
  savedDocumentSignature?: string; // pre-checkpoint recovery drafts
  savedDocument?: DocumentCheckpoint;
  outputRevision?: string;
}

interface SheetLayout {
  columns: number;
  rows: number;
  columnWidths: Record<string, number>;
  rowHeights: Record<string, number>;
}

const DEFAULT_SHEET_LAYOUT: SheetLayout = { columns: 10, rows: 16, columnWidths: {}, rowHeights: {} };


/** Top-left cell of a set of ids (reading order). */
function topLeft(ids: string[]): string {
  return [...ids].sort((left, right) => {
    const [leftColumn, leftRow] = cellPosition(left);
    const [rightColumn, rightRow] = cellPosition(right);
    return leftRow - rightRow || leftColumn - rightColumn;
  })[0];
}


function makeColumns(count: number): string[] {
  return Array.from({ length: count }, (_, index) => columnLabel(index + 1));
}




function makeRows(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index + 1);
}

/** Saved outputs with each note's text passed through `transform` (images: references, or inline). */
export function mapSnapshotNotes(
  snapshot: SheetSnapshot | undefined,
  transform: (text: string) => string,
): SheetSnapshot | undefined {
  if (snapshot === undefined) return undefined;
  return {
    ...snapshot,
    cells: snapshot.cells.map((cell) => (cell.valueType === 'markdown' ? { ...cell, display: transform(cell.display) } : cell)),
  };
}

/** The hidden field copy and paste of cells go through (see `useClipboardBridge`). */
function createClipboardBridge(): HTMLTextAreaElement {
  const field = document.createElement('textarea');
  field.className = 'clipboard-bridge';
  field.setAttribute('aria-hidden', 'true');
  field.tabIndex = -1;
  field.style.cssText = 'position:fixed;left:-10000px;top:0;width:1px;height:1px;opacity:0;';
  return field;
}

/** Unapplied edits of a cell the editor left (see `stashEditorDraft`). */
export interface CellDraft {
  kind: CellKind;
  name: string;
  source: string;
  /** Type hint of a formula; absent in drafts stored before it existed. */
  annotation?: string;
  equal?: string;
  params?: string;
  computation?: string;
}

function sameDraft(left: CellDraft, right: CellDraft): boolean {
  return (
    left.kind === right.kind &&
    left.name === right.name &&
    left.source === right.source &&
    (left.equal ?? '') === (right.equal ?? '') &&
    left.params === right.params &&
    left.computation === right.computation &&
    (left.annotation ?? '') === (right.annotation ?? '')
  );
}
