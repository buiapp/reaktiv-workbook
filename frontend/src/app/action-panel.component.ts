import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  CUSTOM_ELEMENTS_SCHEMA,
  ViewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { ToolbarPopupDirective } from './toolbar-popup.directive';
import { UiIconComponent } from './ui-icon.component';
import { FormsModule } from '@angular/forms';
import { PythonEditorComponent } from './python-editor.component';
import type { EditorLanguageService } from './editor-intelligence';
import type { PythonCompletion, PythonEditorPosition } from './python-editor.component';
import type {
  ActionBinding,
  ActionDefinition,
  ActionResult,
  CellDefinition,
} from './sheet.types';
import { renderTableHtml } from './data-table';

@Component({
  selector: 'app-action-panel',
  host: { '[class.runner-host]': "mode === 'runner'" },
  imports: [FormsModule, PythonEditorComponent, UiIconComponent, NgTemplateOutlet, ToolbarPopupDirective],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: ` <div
    class="action-surface"
    [class.authoring]="mode === 'workspace'"
    [class.runner]="mode === 'runner'"
  >
    <section
      class="action-dialog"
      [appToolbarPopup]="mode === 'runner' ? 'popup' : 'none'"
      [attr.role]="mode === 'runner' ? 'dialog' : 'region'"
      [attr.aria-modal]="null"
      [attr.aria-labelledby]="'actions-' + mode + '-title'"
      (click)="$event.stopPropagation()"
      (keydown.escape)="escape($event)"
    >
      @if (mode === 'runner') {
        <header class="runner-heading">
          <h2 [id]="'actions-' + mode + '-title'">Run action</h2>
          <button class="icon-button" type="button" aria-label="Close actions" (click)="closed.emit()">×</button>
        </header>
      }
      <div class="action-layout">
        <nav aria-label="Available actions">
          @if (mode === 'workspace') {
            <div class="list-heading"><h2 id="actions-workspace-title">Actions <small aria-hidden="true">{{actions.length}}</small></h2>
              <button class="icon-button" type="button" aria-label="New action" title="New action" [disabled]="!canEdit || !enabled || !!busyName || applying" (click)="create()"><app-ui-icon name="plus" /></button>
            </div>
          }
          <input
            type="search"
            aria-label="Search actions"
            placeholder="Search actions…"
            [(ngModel)]="search"
          />
          @if (mode === 'runner' && canEdit) {
            <button class="manage-link" type="button" (click)="managed.emit()"><app-ui-icon name="code" />Edit actions</button>
          }
          @for (item of listedActions; track item.name) {
            @if (mode === 'runner' && isGroupStart(item.name)) { <span class="list-group">{{pinned.includes(item.name) ? 'Pinned' : 'All actions'}}</span> }
            <button class="action-list-item"
              type="button"
              [class.chosen]="selected === item.name"
              (click)="choose(item.name)"
            >
              <app-ui-icon [name]="mode === 'workspace' ? 'code' : 'play'" />
              <span>{{ item.label }}<small>{{item.name}}</small></span>
              @if (isRunning(item)) { <span class="running-indicator">Running</span> }
            </button>
          }
          @if (!listedActions.length) { <p class="list-empty">{{search ? 'No matching actions.' : 'No actions yet.'}}</p> }
          @if (busyName || runningNames.length) {
            <p class="execution-hint">Actions are running. Editing is paused; other actions can still run.</p>
          }
        </nav>
        <div class="action-detail" [class.editing-method]="editing || (mode === 'workspace' && selectedDefinition)">
          @if (editing || (mode === 'workspace' && selectedDefinition)) {
            <div class="action-editor-bar">
              <div class="method-identity"><span class="eyebrow">Workbook action</span><strong>{{editing ? draftLabel || editingName || 'New action' : selectedDefinition?.label || selected}}</strong><small>{{editing ? editingName || 'New action' : selected}} · {{editing && canEdit ? 'Editing' : 'Read only'}}@if (!canEdit) { · switch to <strong>Edit</strong> mode in the top bar to change it}</small></div>
              <div class="editor-controls">
                <button class="icon-button" type="button" title="Find / replace · Ctrl/Cmd+F" aria-label="Find or replace in action" (click)="editor?.openSearch()"><app-ui-icon name="search" /></button>
                @if (current && (editingName || !editing)) {
                  <button class="run-toggle" type="button" title="Show action arguments and run controls" aria-label="Run saved action" [attr.aria-expanded]="runOpen" (click)="showRun()"><app-ui-icon name="play" />Run</button>
                }
                @if (editing) {
                  <button class="primary-button" type="button" aria-label="Apply action edits" [disabled]="!canEdit || !enabled || !!busyName || applying || !visibleDraftChanged()" (click)="saveDraft()">{{applying ? 'Applying…' : 'Apply edits'}}</button>
                }
                <details class="method-menu"><summary aria-label="Action options"><app-ui-icon name="more" /></summary>
                  <div class="method-menu-content">
                    @if (current && (editingName || !editing)) {
                      <button type="button" [attr.aria-pressed]="pinned.includes(selected)" (click)="pinToggled.emit(selected)">{{pinned.includes(selected) ? 'Unpin action' : 'Pin action'}}</button>
                      <button type="button" [disabled]="!canEdit || !!busyName || !enabled || applying" (click)="removed.emit(selected)">Delete action</button>
                    }
                    @if (editing) { <button type="button" (click)="cancelEdit()">Discard edits</button> }
                  </div>
                </details>
              </div>
            </div>
            <div class="action-editor-body">
              <div class="source-pane">
                @if (editing) {
                  <label class="action-label-field">Display label
                    <input [ngModel]="draftLabel" (ngModelChange)="draftLabel = $event; applyMessage = ''" [placeholder]="editingName || 'Name shown on buttons and in the action list'" [disabled]="!canEdit || !enabled || !!busyName || applying" />
                  </label>
                }
                <div class="action-code">
                  <app-python-editor [value]="editing ? draftSource : selectedDefinition?.source ?? ''" (valueChange)="draftSource = $event; applyMessage = ''"
                    [completions]="completions" [readOnly]="!canEdit || !editing || !enabled || !!busyName || applying" [languageService]="languageService"
                    [searchEnabled]="true" [position]="editorPosition" [resizable]="false" ariaLabel="Action Python source" (commit)="saveDraft()" />
                </div>
              </div>
              @if (runOpen && current; as item) {
                <section class="workspace-run" aria-label="Run selected action">
                  <ng-container *ngTemplateOutlet="runForm" />
                </section>
              }
            </div>
          } @else if (current; as item) {
            <ng-container *ngTemplateOutlet="runForm" />
          } @else {
            <div class="action-empty">
              <h3>{{ actions.length ? 'Choose an action' : 'Actions' }}</h3>
              <p>
                An action is a command you run on purpose: import data, reset a scenario,
                export a report. Formulas update by themselves when their inputs change; an
                action runs only when someone chooses <strong>Run</strong>, presses its button
                in a note, or an agent calls it.
              </p>
              <ul>
                <li>It can read any cell and set inputs: <code>self.Sheet1.price.set(10)</code></li>
                <li>Its parameters become a form, so it can ask for values when it runs</li>
                <li>What it returns (a value, table or chart) is shown here</li>
              </ul>
              <pre class="action-example"><code>def reset_scenario(self, growth: float = 0.05):
    """Back to the default assumptions."""
    self.Sheet1.growth.set(growth)</code></pre>
              @if (mode === 'workspace') {
                @if (canEdit) {
                  <button class="primary-button" type="button" [disabled]="!enabled || !!busyName || applying" (click)="create()">
                    <app-ui-icon name="plus" />New action
                  </button>
                } @else {
                  <p class="action-empty-hint">Switch to <strong>Edit</strong> mode in the top bar to create actions.</p>
                }
              }
            </div>
          }
          @if (applying || applyMessage) { <p role="status" aria-live="polite">{{applying ? 'Applying action edits…' : applyMessage}}</p> }
          @if (localError || error) {
            <p class="action-error" role="alert">{{ localError || error }}</p>
          }
        </div>
      </div>
    </section>
  </div>
  <ng-template #runForm>
    @if (current; as item) {
            <header class="run-heading">
              <div><h3>{{ item.label }}</h3><code>{{item.name}}</code></div>
              <button class="pin-button" type="button" [attr.aria-pressed]="pinned.includes(item.name)" (click)="pinToggled.emit(item.name)">{{pinned.includes(item.name) ? 'Unpin' : 'Pin'}}</button>
            </header>
            @if (item.description) { <p class="action-description">{{item.description}}</p> }
            <section class="execution-section" aria-label="Action execution">
            <div class="action-buttons">
              <button
                type="button"
                class="primary-button"
                [disabled]="!enabled || applying || hasUnappliedDrafts || isRunning(item)"
                (click)="invoke()"
              >
                Run {{ item.label }}
              </button>
              @if (isRunning(item) && isAsync) {
                <button type="button" class="cancel-button" (click)="cancelCurrent()">Cancel action</button>
              }
            </div>
            @if (isRunning(item)) {
              <p class="execution-status running" role="status"><span class="status-dot"></span>Running…</p>
            } @else if (item.cancelled || item.status === 'cancelled') {
              <p class="execution-status" role="status">Action cancelled</p>
            } @else if (item.error) {
              <div class="execution-status failed" role="alert"><strong>Action failed</strong><pre>{{item.error}}</pre></div>
            } @else if (item.status === 'succeeded') {
              <p class="execution-status" role="status">Completed successfully</p>
            }
            @if (!enabled) { <p class="muted">Start the kernel to run actions.</p> }
            @else if (hasUnappliedDrafts) { <p class="muted">Apply action edits or save the workbook before running.</p> }
            @else if (applying) { <p class="muted">Wait for the current changes to finish applying.</p> }
            </section>
            <section class="argument-section" aria-label="Action arguments">
            <h4>Arguments</h4>
            @if (!item.parameters.length) { <p class="muted">This action takes no arguments.</p> }
            @for (parameter of item.parameters; track parameter.name) {
              @let form = arguments[parameter.name];
              <div class="action-argument">
                <label
                  >{{ parameter.name }} <small>{{ parameter.annotation || 'JSON value' }}</small>
                  <select [(ngModel)]="form.mode" [disabled]="!enabled || applying">
                    @if (!parameter.required) {
                      <option value="default">
                        Use default · {{ stringify(parameter.default) }}
                      </option>
                    }
                    <option value="literal">Enter value</option>
                    <option value="cell">Bind workbook cell</option>
                  </select>
                </label>
                @if (form.mode === 'cell') {
                  <select
                    [attr.aria-label]="parameter.name + ' cell'"
                    [(ngModel)]="form.cell"
                    [disabled]="!enabled || applying"
                  >
                    <option value="">Choose a cell…</option>
                    @for (cell of cells; track cell.id) {
                      @if (cell.kind !== 'effect') {
                        <option [value]="cell.id">
                          {{ cell.name ?? cell.id }} · {{ cell.id }}
                        </option>
                      }
                    }
                  </select>
                } @else if (form.mode === 'literal') {
                  @if (isBoolean(parameter.annotation, parameter.default)) {
                    <select
                      [attr.aria-label]="parameter.name + ' value'"
                      [(ngModel)]="form.text"
                      [disabled]="!enabled || applying"
                    >
                      <option value="true">True</option>
                      <option value="false">False</option>
                    </select>
                  } @else {
                    <input
                      [attr.aria-label]="parameter.name + ' value'"
                      [(ngModel)]="form.text"
                      [disabled]="!enabled || applying"
                      [placeholder]="parameter.annotation || 'JSON literal'"
                    />
                  }
                }
              </div>
            }
            @if (item.parameters.length) {
              <details class="argument-options"><summary>Argument defaults</summary>
                <button type="button" [disabled]="!canEdit || !enabled || !!busyName || applying" (click)="storeBindings()">Save argument defaults</button>
              </details>
            }
            </section>
            @if (item.output.artifact || item.output.richOutput || item.output.table || item.output.value !== null) {
              <section class="result-section" aria-label="Last successful result">
              <h4>Last successful result</h4>
            @if (item.output.artifact; as file) {
              <a
                [href]="'data:' + file.mimeType + ';base64,' + file.dataBase64"
                [download]="file.filename"
                >Download {{ file.filename }}</a
              >
            } @else if (item.output.richOutput; as output) {
              @if (output.mimeType === 'application/vnd.plotly.v1+json') {
                <reaktiv-plotly [attr.data-spec]="output.dataBase64" />
              } @else if (output.mimeType === 'application/vnd.anywidget+json') {
                <reaktiv-anywidget
                  [attr.data-cell]="'action:' + item.name"
                  [attr.data-spec]="output.dataBase64"
                />
              } @else if (output.mimeType === 'text/html') {
                <reaktiv-html [attr.data-spec]="output.dataBase64" />
              } @else {
                <img
                  [src]="'data:' + output.mimeType + ';base64,' + output.dataBase64"
                  alt="Action result"
                />
              }
            } @else if (item.output.table; as table) {
              <div class="action-table" [innerHTML]="tableHtml(table)"></div>
            } @else if (item.output.value !== null) {
              <pre>{{ item.output.display }}</pre>
            }
              </section>
            }
            @if (item.runs?.length) {
              <details class="secondary-section run-history">
                <summary>Recent runs <span>{{item.runs?.length}}</span></summary>
                @for (run of (item.runs ?? []).slice(-10).reverse(); track run.id) {
                  <div class="action-invocation" [attr.data-invocation]="run.id">
                    <strong>{{run.status === 'succeeded' ? 'Completed' : run.status === 'cancelled' ? 'Cancelled' : run.status === 'failed' ? 'Failed' : 'Running'}}</strong>
                    <code [title]="run.id">{{run.id.slice(0, 8)}}</code>
                    @if (run.error && run.status === 'failed') { <pre>{{run.error}}</pre> }
                  </div>
                }
              </details>
            }
            @if (mode === 'workspace') {
              <details class="secondary-section">
                <summary>Use in notes</summary>
                <label>Button link<input readonly [value]="'[' + item.label + '](#sheet-action:' + item.name + ')'" (focus)="$any($event.target).select()" /></label>
                <p class="muted">Button clicks capture bound cell values once. Required arguments without bindings open the run form. Input changes never run an action automatically.</p>
              </details>
            }
    }
  </ng-template>`,
  styleUrl: './action-panel.component.scss',
})
export class ActionPanelComponent implements OnChanges {
  isRunning(item: ActionResult): boolean {
    return item.running || this.busyName === item.name || this.runningNames.includes(item.name) ||
      !!item.runs?.some(run => run.status === 'running');
  }
  cancelCurrent(): void {
    const item = this.current;
    if (!item || !this.isAsync || !this.isRunning(item)) return;
    const run = item.runs?.find(run => run.status === 'running');
    if (run) this.invocationCancelled.emit({name: item.name, id: run.id});
    else this.cancelled.emit(item.name);
  }
  @Input() mode: 'workspace' | 'runner' = 'workspace';
  @Input() pinned: string[] = [];
  @Input() languageService: EditorLanguageService | null = null;
  runOpen = false;
  showRun(): void { this.runOpen = !this.runOpen; }
  @Output() managed = new EventEmitter<void>();
  @Output() pinToggled = new EventEmitter<string>();
  @ViewChild(PythonEditorComponent) protected editor?: PythonEditorComponent;
  protected editorPosition: PythonEditorPosition = { top: 0, left: 0, anchor: 0, head: 0 };
  private readonly positions = new Map<string, PythonEditorPosition>();
  search = '';
  get filteredActions() {
    const query = this.search.trim().toLowerCase();
    return this.actions.filter((item) =>
      `${item.label} ${item.name} ${item.description}`.toLowerCase().includes(query),
    );
  }
  get listedActions() {
    const items = this.filteredActions;
    return this.mode === 'runner' ? [...items.filter(item => this.pinned.includes(item.name)), ...items.filter(item => !this.pinned.includes(item.name))] : items;
  }
  isGroupStart(name: string): boolean {
    const items = this.listedActions;
    const index = items.findIndex(item => item.name === name);
    return index === 0 || this.pinned.includes(items[index - 1].name) !== this.pinned.includes(name);
  }
  @Input() definitions: ActionDefinition[] = [];
  @Input() actions: ActionResult[] = [];
  @Input() cells: CellDefinition[] = [];
  @Input() enabled = false;
  @Input() canEdit = true;
  @Input() busyName: string | null = null;
  @Input() runningNames: readonly string[] = [];
  @Input() error = '';
  @Input() applying = false;
  @Input() applied:ActionDefinition | null = null;
  private acknowledged:ActionDefinition | null = null;
  applyMessage = '';
  @Input() selected = '';
  @Input() initialSource = '';
  @Input() initialArguments: Record<string, ActionBinding> | null = null;
  @Input() completions: readonly PythonCompletion[] = [];
  @Output() closed = new EventEmitter<void>();
  @Output() invoked = new EventEmitter<{
    name: string;
    arguments: Record<string, ActionBinding>;
  }>();
  @Output() saved = new EventEmitter<ActionDefinition>();
  @Output() bindingsSaved = new EventEmitter<{
    name: string;
    bindings: Record<string, ActionBinding>;
  }>();
  @Output() removed = new EventEmitter<string>();
  @Output() cancelled = new EventEmitter<string>();
  @Output() invocationCancelled = new EventEmitter<{name: string; id: string}>();
  editing = false;
  draftLabel = '';
  draftSource = '';
  localError = '';
  arguments: Record<string, { mode: string; text: string; cell: string }> = {};
  protected editingName = '';
  private newDraftKey = '';
  private editingBase: {source: string; label: string} | null = null;
  private drafts = new Map<string, { source: string; label: string }>();
  private stashDraft(): void {
    if (this.editing) {
      const key = this.editingName || this.newDraftKey || this.sourceName(this.draftSource) || '';
      if (this.visibleDraftChanged()) this.drafts.set(key, { source: this.draftSource, label: this.draftLabel });
      else this.drafts.delete(key);
    }
    const key = this.editing ? this.editingName || this.newDraftKey || this.sourceName(this.draftSource) || '' : this.selected;
    const position = this.editor?.capturePosition();
    if (key && position) this.positions.set(key, position);
  }
  protected visibleDraftChanged(): boolean {
    return this.editing && (!this.editingBase || this.draftSource !== this.editingBase.source || this.draftLabel !== this.editingBase.label);
  }
  /** Includes stashed drafts when this deferred workspace is hidden. */
  get hasUnappliedDrafts(): boolean {
    const differs = (name: string, source: string, label: string) => {
      const current = this.definitions.find(item => item.name === name);
      return !current || current.source !== source || current.label !== label;
    };
    const visibleKey = this.editing ? this.editingName || this.newDraftKey || this.sourceName(this.draftSource) || '' : null;
    return (this.visibleDraftChanged() && differs(this.editingName, this.draftSource, this.draftLabel)) ||
      [...this.drafts].some(([name, draft]) => name !== visibleKey && differs(name, draft.source, draft.label));
  }
  private shown = '';
  private initialShown = '';
  private parameterKey = '';
  readonly tableHtml = renderTableHtml;
  readonly stringify = JSON.stringify;
  get current() {
    return this.actions.find((item) => item.name === this.selected);
  }
  get selectedDefinition() {
    return this.definitions.find(item => item.name === this.selected);
  }
  get isAsync() {
    return /^\s*async\s+def\b/.test(
      this.definitions.find((item) => item.name === this.selected)?.source ?? '',
    );
  }
  escape(event: Event): void {
    // CodeMirror owns Escape for completion, signature help and leaving Tab mode.
    if (event.defaultPrevented || (event.target instanceof Element && event.target.closest('app-python-editor'))) return;
    event.stopPropagation();
    this.closed.emit();
  }
  ngOnChanges(): void {
    const starting = !!this.initialSource && this.initialSource !== this.initialShown;
    if (starting) {
      this.initialShown = this.initialSource;
      this.editingBase = null;
      this.draftSource = this.initialSource;
      this.editingName = '';
      this.newDraftKey = this.sourceName(this.initialSource) || '';
      this.restoreEditorPosition(this.newDraftKey);
      this.draftLabel = '';
      this.editing = true;
    }
    // An untouched editor is a view of the installed method, not a user draft.
    // MCP and argument-default updates can replace definitions while it stays open.
    if (!starting && this.editing && this.editingName && !this.visibleDraftChanged()) {
      const method = this.definitions.find(item => item.name === this.editingName);
      if (method) {
        this.draftSource = method.source;
        this.draftLabel = method.label;
        this.editingBase = {source: method.source, label: method.label};
      } else this.editing = false;
    }
    if (!this.selected && this.actions.length) this.selected = this.actions[0].name;
    if (this.applied && this.applied!==this.acknowledged) {
      this.acknowledged=this.applied;
      this.acknowledgeSaved([this.applied]);
      this.applyMessage='Edits applied to '+this.applied.name+'. Use Run to execute the action.';
    }
    const key = JSON.stringify([this.current?.parameters, this.initialArguments]);
    if (this.shown !== this.selected || key !== this.parameterKey) {
      if (this.shown !== this.selected && !starting) {
        this.runOpen = false;
        this.stashDraft();
        this.editing = false;
      }
      this.parameterKey = key;
      this.resetArguments();
      if (this.mode === 'workspace' && !this.editing && !this.initialSource) this.restoreEditorPosition(this.selected);
    }
    this.openEditor();
  }
  /** In Edit mode the workspace shows the selected action ready to edit; there is no separate Edit step. */
  private openEditor(): void {
    if (this.mode === 'workspace' && !this.editing) this.edit(false);
  }
  choose(name: string): void {
    if (this.applying) return;
    this.applyMessage='';
    this.stashDraft();
    this.runOpen = false;
    this.selected = name;
    this.initialArguments = null;
    this.editing = false;
    this.localError = '';
    this.resetArguments();
    this.restoreEditorPosition(name);
    this.openEditor();
  }
  private resetArguments(): void {
    this.shown = this.selected;
    this.arguments = {};
    for (const parameter of this.current?.parameters ?? []) {
      const binding =
        this.initialArguments?.[parameter.name] ?? this.current?.bindings[parameter.name];
      this.arguments[parameter.name] = {
        mode: binding?.default
          ? 'default'
          : binding?.cell
            ? 'cell'
            : binding && 'value' in binding
              ? 'literal'
              : parameter.required
                ? 'literal'
                : 'default',
        cell: binding?.cell ?? '',
        text:
          binding && 'value' in binding
            ? this.text(binding.value)
            : parameter.default === undefined
              ? this.isBoolean(parameter.annotation, undefined)
                ? 'false'
                : ''
              : this.text(parameter.default),
      };
    }
  }
  private text(value: unknown): string {
    return typeof value === 'string' ? value : JSON.stringify(value);
  }
  isBoolean(annotation: string, value: unknown): boolean {
    return (
      annotation.replaceAll("'", '').replaceAll('"', '') === 'bool' || typeof value === 'boolean'
    );
  }
  cellLabel(id: string): string {
    return this.cells.find((item) => item.id === id)?.name ?? id;
  }
  cancelEdit(): void {
    if (this.applying) return;
    this.applyMessage='';
    this.drafts.delete(this.editingName || this.newDraftKey || this.sourceName(this.draftSource) || '');
    this.editing = false;
    this.openEditor();
  }
  create(): void {
    if (!this.canEdit || this.applying) return;
    this.runOpen = false;
    this.applyMessage='';
    this.stashDraft();
    let name = 'new_action';
    let index = 2;
    while (
      this.drafts.has(name) || this.definitions.some((item) => item.name === name) ||
      this.cells.some((item) => item.name === name)
    )
      name = `new_action_${index++}`;
    this.editingBase = null;
    this.draftSource = `def ${name}(self):\n    \"\"\"Describe what this command does.\"\"\"\n    return None`;
    this.editingName = '';
    this.newDraftKey = name;
    this.restoreEditorPosition(name);
    this.draftLabel = '';
    this.editing = true;
    this.localError = '';
  }
  edit(capturePosition = true): void {
    if (!this.canEdit) return;
    const position = this.editor?.capturePosition();
    if (capturePosition && !this.editing && position) this.positions.set(this.selected, position);
    const method = this.definitions.find((item) => item.name === this.selected);
    const draft = this.drafts.get(this.selected);
    if (method || draft) {
      this.editingName = method?.name ?? '';
      this.editingBase = method ? {source: method.source, label: method.label} : null;
      this.newDraftKey = method ? '' : this.selected;
      this.restoreEditorPosition(this.selected);
      this.draftSource = draft?.source ?? method!.source;
      this.draftLabel = draft?.label ?? method!.label;
      this.editing = true;
    }
  }
  private sourceName(source: string): string | undefined {
    return /^\s*(?:async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(source)?.[1];
  }
  private definitionForDraft(originalName: string, source: string, label: string): ActionDefinition {
    const name = this.sourceName(source);
    if (!name) throw new Error(`Action ${originalName || '(new action)'}: define one method: def name(self, ...):`);
    if (originalName && name !== originalName)
      throw new Error(`Action ${originalName}: keep the method name when editing, or create a new action.`);
    const previous = this.definitions.find(item => item.name === name);
    return { name, source, label, references: previous?.references ?? {}, bindings: previous?.bindings ?? {}, exposed: previous?.exposed ?? true };
  }
  /** Capture both the visible editor and drafts stashed while switching methods. */
  pendingDefinitions(): ActionDefinition[] {
    this.stashDraft();
    return [...this.drafts].flatMap(([name, draft]) => {
      const previous = this.definitions.find(item => item.name === name);
      if (previous?.source === draft.source && previous.label === draft.label) return [];
      return [this.definitionForDraft(previous ? name : '', draft.source, draft.label)];
    });
  }
  /** A late acknowledgement must never discard text typed after submission. */
  acknowledgeSaved(definitions: readonly ActionDefinition[]): void {
    for (const applied of definitions) {
      for (const [key, stored] of this.drafts) {
        if (stored.source === applied.source && stored.label === applied.label) this.drafts.delete(key);
      }
      if (this.editing && (this.editingName === applied.name || !this.editingName) &&
          this.draftSource === applied.source && this.draftLabel === applied.label) {
        // The visible editor supersedes an older copy stashed before selection
        // changed. Confirming it also retires that copy, even if its text differs.
        this.drafts.delete(this.editingName || this.newDraftKey || this.sourceName(this.draftSource) || '');
        this.selected = applied.name;
        this.editingName = applied.name;
        this.editingBase = {source: applied.source, label: applied.label};
      }
    }
  }
  private restoreEditorPosition(key: string): void {
    this.editorPosition = this.positions.get(key) ?? { top: 0, left: 0, anchor: 0, head: 0 };
  }
  resetDrafts(): void {
    this.runOpen = false;
    this.positions.clear();
    this.restoreEditorPosition('');
    this.drafts.clear();
    this.editingBase = null;
    this.editing = false;
    this.editingName = this.newDraftKey = this.shown = this.initialShown = '';
    this.draftSource = this.draftLabel = this.applyMessage = this.localError = '';
    this.acknowledged = null;
  }
  saveDraft(): void {
    if (!this.canEdit || !this.editing || this.applying || !this.enabled || this.busyName) return;
    try {
      const definition = this.definitionForDraft(this.editingName, this.draftSource, this.draftLabel);
      this.localError = this.applyMessage = '';
      this.saved.emit(definition);
    } catch (error) {
      this.localError = error instanceof Error ? error.message : String(error);
    }
  }
  private collect(): Record<string, ActionBinding> | null {
    this.localError = '';
    const result: Record<string, ActionBinding> = {};
    try {
      for (const parameter of this.current?.parameters ?? []) {
        const form = this.arguments[parameter.name];
        if (form.mode === 'default') {
          result[parameter.name] = { default: true };
          continue;
        }
        if (form.mode === 'cell') {
          if (!form.cell) throw new Error(`Choose a cell for ${parameter.name}`);
          result[parameter.name] = { cell: form.cell };
          continue;
        }
        const annotation = parameter.annotation.replaceAll("'", '').replaceAll('"', '');
        const string =
          annotation === 'str' || (!annotation && typeof parameter.default === 'string');
        const value = string ? form.text : JSON.parse(form.text);
        if (annotation === 'int' && !Number.isInteger(value))
          throw new Error(`${parameter.name} needs an integer`);
        if (annotation === 'float' && (typeof value !== 'number' || !Number.isFinite(value)))
          throw new Error(`${parameter.name} needs a number`);
        result[parameter.name] = { value };
      }
      return result;
    } catch (error) {
      this.localError = error instanceof Error ? error.message : String(error);
      return null;
    }
  }
  invoke(): void {
    if (this.current && this.isRunning(this.current)) return;
    const args = this.collect();
    if (args) this.invoked.emit({ name: this.selected, arguments: args });
  }
  storeBindings(): void {
    const args = this.collect();
    if (args) this.bindingsSaved.emit({ name: this.selected, bindings: args });
  }
}
