import { ChangeDetectionStrategy, Component, computed, input, output, ViewEncapsulation } from '@angular/core';
import type { CellDefinition, WorkbookUpdateTrace } from './sheet.types';
import { UiIconComponent } from './ui-icon.component';
import { UPDATE_STATES, updateExplanation, updatePath } from './update-trace';

@Component({
  selector:'app-update-trace',
  host:{'[class.trace-inspector]':'!controls()'},
  imports:[UiIconComponent],
  changeDetection:ChangeDetectionStrategy.OnPush,
  encapsulation:ViewEncapsulation.None,
  template:`
    @if (controls()) {
      <label class="inline-toggle"><input type="checkbox" [checked]="enabled()" (change)="enabledChange.emit($any($event.target).checked)" /> Trace updates</label>
    }
    @if (enabled() || !controls()) {
      @if (trace(); as trace) {
        @if (controls()) {
        <div class="update-trace-summary">Latest update #{{ trace.sequence }} · {{ summary() }}
          @if (pathTarget()) {
            <span>Showing {{ pathDirection() === 'downstream' ? 'dependents' : 'dependencies' }} of {{ pathTarget() }}.</span>
            <button type="button" (click)="clearPath.emit()">Show whole graph</button>
            <p>Trace paths include text, notes and all worksheets, overriding visibility filters until cleared.</p>
          }
          @if (roots().length) {
            <p>Update sources:
              @for (id of roots(); track id) { <button type="button" (click)="inspectRequested.emit(id)">{{ id }}</button> }
              @if (trace.roots.length > roots().length) { <span> +{{ trace.roots.length - roots().length }} more</span> }
            </p>
          }
        </div>
        }
        @if (row(); as row) {
          <div class="update-trace-detail" role="region" aria-label="Cell update explanation">
            <strong><app-ui-icon [name]="states[row.status].icon" /> {{ selectedId() }} · {{ states[row.status].label }}</strong>
            <p>{{ explanation() }}</p>
            <small>Executions in this update: {{ row.executions }}. @if (selectedKind() === 'resource') { Loader runs; parameter checks are separate. }</small>
            @if (row.output) {
              <p>{{ row.output === 'reused' ? 'Existing rich output reused.' : 'New rich-output payload prepared.' }}</p>
              @if (row.output === 'reused' && row.executions > 0) {
                <p>The calculation ran, but the output object identity matched the cache. In-place figure mutation can leave the displayed plot stale. Consider returning a new figure and reviewing equality rules.</p>
              }
            }
            @if (boundaries().length) {
              <p>Upstream equality decisions:
                @for (id of boundaries(); track id) { <button type="button" (click)="inspectRequested.emit(id)">{{ id }}</button> }
              </p>
            }
            <div class="update-trace-actions">
              <button type="button" (click)="traceRequested.emit({id:selectedId(),direction:'upstream'})">Why didn't this update?</button>
              <button type="button" (click)="traceRequested.emit({id:selectedId(),direction:'downstream'})">Trace dependents</button>
            </div>
          </div>
        } @else { <p>Select a cell to inspect its last update.</p> }
        @if (controls()) { <small>Observed dependencies and published versions; no extra evaluation. Badges persist until another update. Equality decisions identify boundaries, not proof of a bug.</small> }
      } @else { <p>Run an update with a current kernel to see execution and equality outcomes. Saved outputs and older kernels do not provide this trace.</p> }
    }
  `,
  styles:`
    app-update-trace { display:block; box-sizing:border-box; padding:8px 12px; border-top:1px solid var(--line); font-size:11px; }
    app-update-trace:not(.trace-inspector) { max-height:min(260px,35vh); overflow:auto; }
    app-update-trace .inline-toggle { display:inline-flex; align-items:center; gap:5px; }
    app-update-trace p { margin:6px 0; line-height:1.5; }
    app-update-trace small { color:var(--muted); }
    .update-trace-summary { margin:6px 0; color:var(--muted); }
    .update-trace-detail strong { display:flex; align-items:center; gap:5px; }
    .update-trace-actions { display:flex; flex-wrap:wrap; gap:6px; margin:8px 0; }
    app-update-trace button { padding:4px 7px; border:1px solid var(--line); border-radius:5px; color:var(--ink); background:var(--paper); cursor:pointer; font:inherit; }
    app-update-trace button:hover { background:var(--hover); }
    app-root .graph-node .graph-update-badge { display:inline-flex; align-items:center; gap:3px; font-weight:600; }
    app-root .graph-node .graph-update-badge app-ui-icon { width:11px; height:11px; flex-basis:11px; }
    app-root .graph-node.trace-equal { border-style:dashed; border-color:var(--theme-warning,light-dark(#956400,#d7b867)); }
    app-root .graph-node.trace-changed { box-shadow:inset 0 -3px var(--purple); }
    app-root .graph-edges path.update-trace-edge { stroke:var(--purple); opacity:1; stroke-width:2; }
  `,
})
export class UpdateTraceComponent {
  readonly trace=input<WorkbookUpdateTrace>();
  readonly cells=input<readonly CellDefinition[]>([]);
  readonly selectedId=input('');
  readonly enabled=input(false);
  readonly controls=input(true);
  readonly pathTarget=input<string | null>(null);
  readonly pathDirection=input<'upstream'|'downstream'|null>(null);
  readonly roots=computed(()=>this.trace()?.roots.slice(0,4) ?? []);
  readonly enabledChange=output<boolean>();
  readonly clearPath=output<void>();
  readonly traceRequested=output<{id:string;direction:'upstream'|'downstream'}>();
  readonly inspectRequested=output<string>();
  readonly states=UPDATE_STATES;
  readonly row=computed(()=>this.trace()?.cells[this.selectedId()]);
  readonly selectedKind=computed(()=>this.cells().find(cell=>cell.id===this.selectedId())?.kind);
  readonly explanation=computed(()=>this.row() ? updateExplanation(this.row()!,this.selectedKind()) : '');
  readonly summary=computed(()=>{
    const counts=new Map<string,number>();
    for(const row of Object.values(this.trace()?.cells ?? {})) counts.set(row.status,(counts.get(row.status) ?? 0)+1);
    return [...counts].map(([state,count])=>`${count} ${UPDATE_STATES[state as keyof typeof UPDATE_STATES].label.toLowerCase()}`).join(' · ');
  });
  readonly boundaries=computed(()=>[...updatePath(this.trace(),this.selectedId(),'upstream')]
    .filter(id=>id!==this.selectedId() && this.trace()?.cells[id]?.status==='equal').slice(0,8));
}
