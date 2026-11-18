import type { CellUpdateObservation, CellUpdateStatus, WorkbookUpdateTrace } from './sheet.types';
import type { UiIconName } from './ui-icon.component';

export const UPDATE_STATES: Record<CellUpdateStatus, {label:string;icon:UiIconName}> = {
  changed:{label:'Changed',icon:'check'}, equal:{label:'Equal',icon:'equal'},
  cached:{label:'Cached',icon:'history'}, failed:{label:'Failed',icon:'stop'},
  unaffected:{label:'Unaffected',icon:'minus'}, ran:{label:'Executed',icon:'restart'},
  waiting:{label:'Waiting',icon:'async-resource'}, 'not-run':{label:'Not run',icon:'minus'},
};
export function updateExplanation(row:CellUpdateObservation,kind?:string):string {
  switch(row.status) {
    case 'changed':return 'Published a changed value in this update.';
    case 'equal':return row.executions
      ? `Evaluated, but ${row.equality === 'custom' ? 'custom' : 'default'} equality suppressed propagation. Dependents may keep their cached values.`
      : `The write or replacement compared equal under ${row.equality === 'custom' ? 'custom' : 'default'} equality; no changed value was published.`;
    case 'cached':return kind === 'input'
      ? 'Input initializers run once, without ongoing subscriptions. Write to this input or use a formula for a reactive derivation.'
      : kind === 'resource' ? 'The loader did not execute. Request parameter checks may still have run; inspect the resource parameters and trigger rules.'
      : row.changedDependencies.length
        ? 'No execution was observed despite a changed dependency. Check stopped cells, resource parameters, or manual execution rules.'
        : 'Did not execute; its observed dependencies published no changed values in this update.';
    case 'not-run':return 'The effect did not execute in this update. Check automatic/manual trigger, enabled state and stopped cells.';
    case 'unaffected':return kind === 'input' ? 'No input write or initialization was observed. Input initializers do not subscribe to future dependency changes.' : 'No execution or published change was observed, and no path from this update reached this cell through observed dependencies. Unused branches and untracked reads do not establish live dependencies.';
    case 'failed':return 'The cell has an error. See the error details; this may be a retained error from an earlier evaluation.';
    case 'waiting':return 'The resource is idle or waiting for a result. Loader execution and parameter checks are different stages.';
    case 'ran':return kind === 'effect' ? 'The effect executed. Effects report execution rather than publishing a result value.' : 'Executed without a published version change. No equality-suppression decision was recorded.';
  }
}

/** Follow only observed cell dependencies. Cycles and unrelated branches are bounded. */
export function updatePath(trace:WorkbookUpdateTrace | undefined,target:string,direction:'upstream'|'downstream'):Set<string> {
  if (!trace?.cells[target]) return new Set();
  const next:Record<string,string[]> = {};
  for (const [id,row] of Object.entries(trace.cells)) {
    if (direction === 'upstream') next[id]=row.dependencies;
    else for (const dep of row.dependencies) (next[dep] ??= []).push(id);
  }
  const seen=new Set([target]), pending=[target];
  while(pending.length) for(const id of next[pending.pop()!] ?? []) if(!seen.has(id) && trace.cells[id]) {
    seen.add(id);pending.push(id);
  }
  return seen;
}
