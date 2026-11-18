import { workbookCellMemberNames } from '../sheet-file';
import type { AgentTrackChange } from './agent-track-layout';
import { assertChangedCellPlacements } from '../cell-placement';
import { cellIds, cellPreview, dependencyContext, integerOption, queryLogs, workbookOverview } from './agent-introspection';
import { buildProblems } from '../log-view';
import type { ActionBinding, ActionDefinition, LogEntry } from '../sheet.types';
import type { CellDefinition, GraphResult, SheetDocument } from '../sheet.types';
import { DocumentChanges } from '../workbook/document-changes';
import type { AgentViewContext } from './agent-context';
import type { AgentCellLayout } from './agent-layout';

export interface AgentCommand {
  id: string;
  operation: 'read' | 'context' | 'edit' | 'save' | 'overview' | 'inspect' | 'dependencies' | 'logs' | 'diagnostics' | 'kernel-status' | 'kernel-control' | 'actions' | 'action-edit' | 'action-run' | 'action-cancel' | 'colors' | 'resize' | 'worksheets' | 'environment' | 'asset' | 'visual' | 'tracks' | 'move' | 'label';
  payload: Record<string, unknown>;
  expiresAt: number;
}

export interface AgentWorksheetChange {
  action: 'create' | 'update' | 'delete'; name: string; newName?: string;
  columns?: number; rows?: number; allowBrokenReferences?: boolean;
}
export interface AgentEnvironmentChange { code?: string; imports?: string[]; packages?: string[]; }

/** Narrow ports into the window's existing owners. The bridge never owns a document. */
export interface LiveAgentPorts {
  observe?(command: AgentCommand, execute: () => Promise<Record<string, unknown>>): Promise<Record<string, unknown>>;
  document(): SheetDocument;
  graph(): GraphResult | null;
  drafts(): string[];
  kernelRunning(): boolean;
  context?(): AgentViewContext;
  cellLayouts?(ids: string[]): AgentCellLayout[];
  logs?(): readonly LogEntry[];
  diagnostics?(): Record<string, unknown>;
  kernelStatus?(): Record<string, unknown>;
  controlKernel?(action: 'start' | 'restart' | 'interrupt', force: boolean, check: () => void): Promise<void>;
  actionDrafts?(): boolean;
  actionStatus?(): Record<string, unknown>;
  editAction?(definition: ActionDefinition, check: () => void): Promise<void>;
  runAction?(name: string, args: Record<string, ActionBinding>, check: () => void): Promise<void>;
  cancelAction?(name: string, runId?: string): Promise<void>;
  colorCells?(ids: string[], color: string, expression?: string): Promise<void>;
  resizeWorksheet?(sheet: string, columns: number, rows: number): Promise<{ columns: number; rows: number }>;
  setTracks?(change: AgentTrackChange): Promise<void>;
  moveCells?(source: string, target: string, ids: string[] | undefined): Promise<void>;
  labelCell?(id: string, label: string, check: () => void): Promise<void>;
  manageWorksheet?(change: AgentWorksheetChange, check: () => void): Promise<void>;
  updateEnvironment?(change: AgentEnvironmentChange, check: () => void): Promise<void>;
  environmentStatus?(): Record<string, unknown>;
  addImage?(mime: string, data: string, check: () => void): Promise<string>;
  inspectVisual?(id: string, pane?: number): Promise<Record<string, unknown>>;
  validate(document: SheetDocument): Promise<void>;
  commit(cells: CellDefinition[]): Promise<void>;
  save(): Promise<void>;
}

export class LiveAgentWorkbook {
  private readonly changes = new DocumentChanges();
  private checkpoint: SheetDocument | null = null;
  private graph: GraphResult | null = null;
  private revision = crypto.randomUUID();

  constructor(private readonly ports: LiveAgentPorts) {}

  private checkpointState(): { document: SheetDocument; graph: GraphResult | null } {
    const document = this.ports.document();
    const graph = this.ports.graph();
    if (!this.changes.same(document, this.checkpoint) || graph !== this.graph) {
      this.revision = crypto.randomUUID();
      this.checkpoint = document;
      this.graph = graph;
    }
    return { document, graph };
  }

  read(): Record<string, unknown> {
    const { document, graph } = this.checkpointState();
    return {
      revision: this.revision, document, draftedCells: this.ports.drafts(),
      kernelRunning: this.ports.kernelRunning(),
      context: this.ports.context?.() ?? null,
      graph: graph ? { ...graph, actions: graph.actions?.map(action => ({ ...action, output: cellPreview(action.output) })), cells: graph.cells.map(({ richOutput, artifact, ...cell }) => ({
        ...cell, ...(artifact ? { artifact: { ...artifact, dataBase64: undefined } } : {}),
      })) } : null,
    };
  }

  async execute(command: AgentCommand, assertShared: () => void): Promise<Record<string, unknown>> {
    const execute = () => this.executeCommand(command, assertShared);
    return this.ports.observe ? this.ports.observe(command, execute) : execute();
  }

  private async executeCommand(command: AgentCommand, assertShared: () => void): Promise<Record<string, unknown>> {
    const check = () => {
      assertShared();
      if (Date.now() >= command.expiresAt) throw new Error('Agent command expired; read before retrying.');
    };
    check();
    if (command.operation === 'context') return { context: this.ports.context?.() ?? null };
    const { document, graph } = this.checkpointState();
    const envelope = { revision: this.revision, sampledAt: new Date().toISOString(),
      kernelRunning: this.ports.kernelRunning(), resultFreshness: 'latest-settled-snapshot' };
    if (command.operation === 'overview') return { ...envelope, ...workbookOverview(document, graph),
      context: this.ports.context?.() ?? null, draftedCells: this.ports.drafts() };
    if (command.operation === 'inspect') {
      const ids = new Set(cellIds(command.payload['cellIds'], document));
      const members = workbookCellMemberNames(document.cells, document.sheetName ?? 'Sheet1');
      return { ...envelope, cells: document.cells.filter(cell => ids.has(cell.id)).map(cell => ({
        ...cell, modelReference: `self.${members.get(cell.id)}`,
      })),
        results: (graph?.cells ?? []).filter(cell => ids.has(cell.id)).map(cellPreview),
        layout: this.ports.cellLayouts?.([...ids]) ?? [],
        draftedCells: this.ports.drafts().filter(id => ids.has(id)) };
    }
    if (command.operation === 'environment' && command.payload['read'] === true)
      return {...envelope, code: document.environment.code ?? '', imports: document.environment.imports ?? [], packages: document.environment.packages, ...this.ports.environmentStatus?.()};
    if (command.operation === 'visual') {
      const [id] = cellIds([command.payload['cellId']], document);
      const pane = command.payload['pane'];
      if (pane !== undefined && (typeof pane !== 'number' || !Number.isInteger(pane) || pane < 0 || pane > 1)) throw new Error('pane must be 0 or 1.');
      if (!this.ports.inspectVisual) throw new Error('Visual inspection is unavailable.');
      const visual = await this.ports.inspectVisual(id, pane); check();
      if (!this.changes.same(this.checkpointState().document, document) || this.ports.graph() !== graph) throw new Error('Workbook changed during capture; inspect again.');
      return {...envelope, ...visual};
    }
    if (command.operation === 'dependencies') return { ...envelope, ...dependencyContext(document, graph, command.payload) };
    if (command.operation === 'logs') return { ...envelope, ...queryLogs(this.ports.logs?.() ?? graph?.logs ?? [], command.payload) };
    if (command.operation === 'diagnostics') return { ...envelope, problems: buildProblems(graph?.cells ?? []),
      timings: graph?.timings ?? null, updateTrace: graph?.updateTrace ?? null,
      updateTraceAvailable: graph?.updateTrace !== undefined, ...this.ports.diagnostics?.() };
    if (command.operation === 'kernel-status') return { ...envelope, ...this.ports.kernelStatus?.() };
    if (command.operation === 'actions') return { ...envelope, definitions: document.actions ?? [],
      actions: (graph?.actions ?? []).map(action => ({ ...action, output: cellPreview(action.output) })),
      userDrafts: this.ports.actionDrafts?.() ?? false, ...this.ports.actionStatus?.() };
    if (command.operation === 'action-cancel') {
      const name = command.payload['name'];
      if (typeof name !== 'string' || !document.actions?.some(action => action.name === name && action.exposed))
        throw new Error('Unknown exposed action.');
      if (!this.ports.cancelAction) throw new Error('Action cancellation is unavailable.');
      const runId = command.payload['runId'];
      if (runId !== undefined && typeof runId !== 'string') throw new Error('runId must be a string.');
      await this.ports.cancelAction(name, runId); check();
      return { ...this.read(), cancellationRequested: name };
    }
    if (command.operation === 'kernel-control') {
      const action = command.payload['action'], force = command.payload['force'] ?? false;
      if (!['start', 'restart', 'interrupt'].includes(String(action)) || typeof force !== 'boolean')
        throw new Error('Use action start/restart/interrupt and a boolean force.');
      if (force && action !== 'interrupt') throw new Error('force applies only to interrupt.');
      if (action !== 'interrupt' || force) {
        if (command.payload['revision'] !== this.revision) throw new Error('Workbook conflict: read current status before kernel control.');
        if (this.ports.drafts().length) throw new Error('User drafts are open. Apply or discard them before restarting/starting Python.');
      }
      if (!this.ports.controlKernel) throw new Error('Kernel controls are unavailable.');
      const checkControl = () => {
        check();
        if (action !== 'interrupt' || force) {
          this.checkpointState();
          if (command.payload['revision'] !== this.revision || this.ports.drafts().length)
            throw new Error('Workbook changed before kernel control. Read and reconcile.');
        }
      };
      await this.ports.controlKernel(action as 'start' | 'restart' | 'interrupt', force, checkControl);
      check(); this.checkpointState();
      return { revision: this.revision, ...this.ports.kernelStatus?.() };
    }
    const state = this.read();
    if (command.operation === 'read') return state;
    const checkRevision = () => {
      check();
      if (command.payload['revision'] !== this.read()['revision'])
        throw new Error('Workbook conflict: the user or runtime changed it. Read and reconcile before editing.');
    };
    checkRevision();
    if (['worksheets', 'environment', 'asset'].includes(command.operation)) {
      const checkMutation = () => {
        checkRevision();
        if (this.ports.drafts().length || this.ports.actionDrafts?.()) throw new Error('User drafts are open. Apply or discard them first.');
      };
      checkMutation();
      if (command.operation === 'worksheets') {
        if (!this.ports.kernelRunning()) throw new Error('Start the workbook kernel before managing worksheets.');
        const {action, name, newName, columns, rows, allowBrokenReferences} = command.payload;
        if (!['create', 'update', 'delete'].includes(String(action)) || typeof name !== 'string' ||
            (newName !== undefined && typeof newName !== 'string') ||
            (allowBrokenReferences !== undefined && typeof allowBrokenReferences !== 'boolean')) throw new Error('Provide a worksheet action and explicit name.');
        const width = columns === undefined ? undefined : integerOption(columns, 10, 1000);
        const height = rows === undefined ? undefined : integerOption(rows, 16, 1000);
        if ((width ?? 10) * (height ?? 16) > 100000) throw new Error('Worksheet grid is limited to 100000 visible slots.');
        if (!this.ports.manageWorksheet) throw new Error('Worksheet management is unavailable.');
        await this.ports.manageWorksheet({action: action as AgentWorksheetChange['action'], name, newName: newName as string | undefined,
          columns: width, rows: height, allowBrokenReferences: allowBrokenReferences as boolean | undefined}, checkMutation);
      } else if (command.operation === 'environment') {
        const next: AgentEnvironmentChange = {};
        for (const key of ['code', 'imports', 'packages'] as const) {
          const value = command.payload[key];
          if (value === undefined) continue;
          if (key === 'code') {
            if (typeof value !== 'string') throw new Error('Shared code must be a string.');
            next.code = value;
          } else {
            if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) throw new Error(`${key} must be an array of strings.`);
            next[key] = value;
          }
        }
        if (!Object.keys(next).length) throw new Error('Provide code, imports or packages.');
        await this.ports.validate({...document, environment: {...document.environment, ...next}});
        checkMutation();
        if (!this.ports.updateEnvironment) throw new Error('Environment editing is unavailable.');
        await this.ports.updateEnvironment(next, checkMutation);
      } else {
        const mime = command.payload['mimeType'], data = command.payload['dataBase64'];
        if (typeof mime !== 'string' || !['image/png','image/jpeg','image/webp','image/gif'].includes(mime) ||
            typeof data !== 'string' || !data.length || data.length > 7 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data))
          throw new Error('Provide a PNG/JPEG/WebP/GIF image up to 5 MB in base64. SVG uploads are not supported.');
        if (!this.ports.addImage) throw new Error('Image uploads are unavailable.');
        const reference = await this.ports.addImage(mime, data, checkMutation);
        check(); return {...this.read(), reference, markdown: `![Image](${reference})`, inserted: false};
      }
      check(); return {...this.read(), ...this.ports.environmentStatus?.()};
    }
    if (command.operation === 'colors') {
      const ids = cellIds(command.payload['cellIds'], document), color = command.payload['color'];
      if (typeof color !== 'string' || (color !== '' && !/^#[0-9a-f]{6}$/i.test(color)))
        throw new Error('Use #RRGGBB or an empty string to clear cell color.');
      const expression = command.payload['expression'];
      if (expression !== undefined && (typeof expression !== 'string' || !expression.trim())) throw new Error('Color expression must be nonempty Python.');
      if (expression !== undefined && !this.ports.kernelRunning()) throw new Error('Start the kernel before setting reactive colors.');
      if (!this.ports.colorCells) throw new Error('Cell styling is unavailable.');
      await this.ports.colorCells(ids, color.toLowerCase(), typeof expression === 'string' ? expression.trim() : undefined); check();
      return this.read();
    }
    if (command.operation === 'tracks') {
      const worksheet = command.payload['worksheet'];
      if (typeof worksheet !== 'string' || ![document.sheetName ?? 'Sheet1', ...(document.sheets ?? []).map(sheet => sheet.name)].includes(worksheet))
        throw new Error('Use an explicit worksheet name from overview.');
      if (!this.ports.setTracks) throw new Error('Track sizing is unavailable.');
      await this.ports.setTracks({worksheet, rowHeights: command.payload['rowHeights'] as AgentTrackChange['rowHeights'],
        columnWidths: command.payload['columnWidths'] as AgentTrackChange['columnWidths']});
      check(); return this.read();
    }
    if (command.operation === 'move' || command.operation === 'label') {
      if (!this.ports.kernelRunning()) throw new Error('Start the workbook kernel before moving or relabelling cells.');
      if (this.ports.drafts().length || this.ports.actionDrafts?.()) throw new Error('User drafts are open. Apply or discard them first.');
      const [source] = cellIds([command.payload['cellId']], document);
      if (command.operation === 'label') {
        const label = command.payload['label'];
        if (typeof label !== 'string') throw new Error('label must be a string, or empty to remove.');
        if (!this.ports.labelCell) throw new Error('Label refactoring is unavailable.');
        await this.ports.labelCell(source, label, checkRevision);
      } else {
        const target = command.payload['targetId'];
        if (typeof target !== 'string' || !/^(?:[A-Za-z_][A-Za-z0-9_]*!)?[A-Z]+[1-9][0-9]*$/.test(target)) throw new Error('Provide a valid targetId.');
        const prefix = target.includes('!') ? target.split('!')[0] : '';
        if (prefix && !(document.sheets ?? []).some(sheet => sheet.name === prefix)) throw new Error('Unknown target worksheet.');
        const ids = command.payload['cellIds'] === undefined ? undefined : cellIds(command.payload['cellIds'], document);
        if (ids && !ids.includes(source)) throw new Error('cellIds must contain the anchor cellId.');
        if (document.cells.some(cell => cell.id === target) && target !== source) throw new Error('Destination is occupied. Move to an empty anchor.');
        if (!this.ports.moveCells) throw new Error('Atomic moves are unavailable.');
        await this.ports.moveCells(source, target, ids);
      }
      check(); return this.read();
    }
    if (command.operation === 'resize') {
      const name = command.payload['worksheet'];
      if (typeof name !== 'string' || ![document.sheetName ?? 'Sheet1', ...(document.sheets ?? []).map(sheet => sheet.name)].includes(name))
        throw new Error('Use an explicit worksheet name from the overview.');
      const columns = integerOption(command.payload['columns'], 0, 1000), rows = integerOption(command.payload['rows'], 0, 1000);
      if (!columns || !rows || columns * rows > 100000) throw new Error('Provide positive dimensions with at most 100000 visible grid slots.');
      if (!this.ports.resizeWorksheet) throw new Error('Worksheet resizing is unavailable.');
      const dimensions = await this.ports.resizeWorksheet(name === (document.sheetName ?? 'Sheet1') ? '' : name, columns, rows);
      check(); return { ...this.read(), worksheet: name, dimensions };
    }
    if (command.operation === 'action-edit' || command.operation === 'action-run') {
      if (!this.ports.kernelRunning()) throw new Error('Start the workbook kernel before changing/running actions.');
      const checkAction = () => {
        checkRevision();
        if (!this.ports.kernelRunning()) throw new Error('The workbook kernel stopped.');
        if (this.ports.actionDrafts?.()) throw new Error('User action drafts are open. Apply or discard them first.');
        if (command.operation === 'action-run' && this.ports.drafts().length)
          throw new Error('User cell drafts are open. Actions can write inputs; review drafts first.');
      };
      checkAction();
      if (command.operation === 'action-edit') {
        const definition = parseAction(command.payload['definition']);
        const next = [...(document.actions ?? []).filter(action => action.name !== definition.name), definition];
        await this.ports.validate({ ...document, actions: next });
        checkAction();
        if (!this.ports.editAction) throw new Error('Action editing is unavailable.');
        await this.ports.editAction(definition, checkAction);
      } else {
        const name = command.payload['name'];
        if (typeof name !== 'string' || !document.actions?.some(action => action.name === name && action.exposed))
          throw new Error('Unknown exposed action.');
        const args = parseBindings(command.payload['arguments'] ?? {}, document);
        if (!this.ports.runAction) throw new Error('Action execution is unavailable.');
        await this.ports.runAction(name, args, checkAction);
      }
      check(); return this.read();
    }
    if (command.operation === 'save') {
      if (this.ports.drafts().length) throw new Error('User drafts are open. Save from the app after reviewing them.');
      await this.ports.save();
      return { ...this.read(), saved: true };
    }
    if (!this.ports.kernelRunning()) throw new Error('Start the workbook kernel in the app before editing.');
    const raw = command.payload['cells'];
    const deleted = command.payload['delete'] ?? [];
    if (!Array.isArray(raw) || !Array.isArray(deleted) || !deleted.every(id => typeof id === 'string'))
      throw new Error('cells and delete must be arrays.');
    const cells = raw.map(parseCell);
    const ids = cells.map(cell => cell.id);
    if (new Set(ids).size !== ids.length || ids.some(id => deleted.includes(id)))
      throw new Error('Duplicate or conflicting cell edits.');
    const affected = new Set([...ids, ...deleted]);
    if (deleted.some(id => !document.cells.some(cell => cell.id === id)))
      throw new Error('Cannot delete an unknown cell.');
    const checkDrafts = () => {
      const drafts = this.ports.drafts().filter(id => affected.has(id));
      if (drafts.length) throw new Error(`User drafts conflict in ${drafts.join(', ')}. Ask the user to apply or discard them.`);
    };
    checkDrafts();
    const updates = new Map(cells.map(cell => [cell.id, cell]));
    for (const cell of cells) {
      const old = document.cells.find(item => item.id === cell.id);
      if (old && (old.name ?? '') !== (cell.name ?? '')) throw new Error('Use set_cell_label to refactor an existing label atomically.');
    }
    const existing = new Set(document.cells.map(cell => cell.id));
    const next = [...document.cells.filter(cell => !deleted.includes(cell.id)).map(cell => updates.get(cell.id) ?? cell),
      ...cells.filter(cell => !existing.has(cell.id))];
    if (this.changes.same(document.cells, next)) return this.read();
    assertChangedCellPlacements(document.cells, next);
    await this.ports.validate({ ...document, cells: next });
    // The user can type, switch documents or revoke sharing while validation awaits Python.
    checkRevision();
    checkDrafts();
    if (!this.ports.kernelRunning()) throw new Error('The workbook kernel stopped before the edit.');
    await this.ports.commit(next);
    check();
    return this.read();
  }
}

function parseCell(value: unknown): CellDefinition {
  if (!value || typeof value !== 'object') throw new Error('A cell must be an object.');
  const cell = value as Record<string, unknown>;
  if (typeof cell['id'] !== 'string' || typeof cell['source'] !== 'string' ||
      !['input', 'linked', 'formula', 'resource', 'markdown', 'effect'].includes(String(cell['kind'])))
    throw new Error('Each cell needs id, kind and source.');
  // Full optional-field/reference validation belongs to the canonical Python writer.
  return { enabled: true, trigger: 'auto', ...cell } as unknown as CellDefinition;
}

function parseBindings(value: unknown, document: SheetDocument): Record<string, ActionBinding> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Action arguments must be a bindings object.');
  for (const binding of Object.values(value)) {
    if (!binding || typeof binding !== 'object' || Array.isArray(binding) || Object.keys(binding).length !== 1)
      throw new Error('Each argument requires exactly one of value, cell or default.');
    if ('cell' in binding) {
      if (typeof binding.cell !== 'string' || !document.cells.some(cell => cell.id === binding.cell)) throw new Error('Unknown argument cell.');
    } else if ('default' in binding) {
      if (binding.default !== true) throw new Error('A default binding must be true.');
    } else if (!('value' in binding)) throw new Error('Unknown argument binding.');
  }
  return value as Record<string, ActionBinding>;
}

function parseAction(value: unknown): ActionDefinition {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Provide an action definition.');
  const action = value as Record<string, unknown>;
  if (typeof action['name'] !== 'string' || typeof action['source'] !== 'string') throw new Error('An action needs name and source.');
  // The canonical Python writer validates source, references, defaults and bindings.
  return { label: '', references: {}, bindings: {}, exposed: true, ...action } as unknown as ActionDefinition;
}
