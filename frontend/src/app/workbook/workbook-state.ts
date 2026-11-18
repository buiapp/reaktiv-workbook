import { computed, signal, type WritableSignal } from '@angular/core';
import { graphErrors } from '../graph-errors';
import { buildProblems } from '../log-view';
import { DEFAULT_SHEET_NAME } from '../sheet-file';
import type {
  ActionDefinition,
  ArtifactResult,
  CellDefinition,
  CellResult,
  GraphResult,
} from '../sheet.types';
import { isNotePage, literalInputResult } from './cell-model';
import { indexDependents } from './dependency-index';
import type { WorkbookMigration } from '../files/workbook-migration';

/**
 * One state owner per workbook window. The command coordinator writes these
 * independent facts; components consume values and computed projections.
 * There are no effects copying derived state and no kernel or DOM dependencies.
 */
export class WorkbookState {
  /** Workbook-wide presentation mode: input controls stay interactive in either mode. */
  readonly workbookEditing = signal(true);
  readonly migration = signal<WorkbookMigration | null>(null);
  readonly cells: WritableSignal<CellDefinition[]>;
  readonly graph = signal<GraphResult>({
    cells: [],
    dependencies: {},
    effects: [],
    logs: [],
    changed: [],
    rebuilt: true,
    updateMode: 'initialized',
  });
  readonly packages = signal<string[]>([]);
  readonly imports = signal<string[]>([]);
  readonly variables = signal<Record<string, string>>({});
  readonly code = signal('');
  readonly actions = signal<ActionDefinition[]>([]);
  readonly sheetName = signal(DEFAULT_SHEET_NAME);
  readonly extraSheets = signal<string[]>([]);

  readonly definitionMap = computed(() => new Map(this.cells().map((cell) => [cell.id, cell])));
  readonly markdownCells = computed(() => this.cells().filter((cell) => cell.kind === 'markdown'));
  readonly notePages = computed(() => this.markdownCells().filter(isNotePage));
  readonly availableActions = computed(() => this.actions().filter((action) => action.exposed));
  readonly resultMap = computed(() => {
    const results = new Map(this.graph().cells.map((cell) => [cell.id, cell]));
    for (const cell of this.cells()) {
      if (cell.kind === 'input' && !results.has(cell.id))
        results.set(cell.id, literalInputResult(cell));
    }
    return results;
  });
  readonly artifactCells = computed(() =>
    this.graph().cells.filter(
      (cell): cell is CellResult & { artifact: ArtifactResult } => cell.artifact !== undefined,
    ),
  );
  readonly problems = computed(() => buildProblems(this.graph().cells));
  readonly errors = computed(() => graphErrors(this.graph().cells));
  readonly timerMap = computed(
    () => new Map((this.graph().timers ?? []).map((timer) => [timer.cellId, timer])),
  );
  readonly dependencies = computed(() => this.graph().dependencies);
  readonly dependents = computed(() => indexDependents(this.dependencies()));
  readonly graphDependencies = computed(() => {
    const dependencies = { ...this.dependencies() };
    for (const [id, reads] of Object.entries(this.graph().widgetDependencies ?? {})) {
      dependencies[id] = [...new Set([...(dependencies[id] ?? []), ...reads])];
    }
    return dependencies;
  });

  constructor(cells: CellDefinition[] = []) {
    this.cells = signal(cells);
  }
}
