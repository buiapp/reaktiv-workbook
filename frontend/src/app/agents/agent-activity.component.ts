import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import type { AgentActivityEntry } from './agent-activity';

@Component({
  selector: 'app-agent-activity',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" class="launcher" [class.busy]="pending() > 0" [attr.aria-expanded]="open()"
      [title]="entries()[0] ? entries()[0].label + ' · ' + entries()[0].status : 'Show agent activity in this session'" (click)="open.set(!open())">
      <i aria-hidden="true"></i>Agent activity @if (pending()) { · {{pending()}} active }
      @else if (created() || edited()) { · {{created() + edited()}} changed }
    </button>
    @if (open()) {
      <section role="region" aria-label="Agent activity" (keydown.escape)="open.set(false); $event.stopPropagation()">
        <header><strong>Agent activity</strong><button type="button" aria-label="Close agent activity" (click)="open.set(false)">×</button></header>
        <p>Current session · {{created()}} created · {{edited()}} edited</p>
        <label><input type="checkbox" [checked]="showOrigins()" (change)="originsChanged.emit($any($event.target).checked)" /> Show Agent labels on cells</label>
        <p class="legend">Blue: reading · Amber: writing · Purple: running commands</p>
        <button type="button" [disabled]="pending() > 0" (click)="cleared.emit()">Clear activity and cell badges</button>
        <ol>
          @for (entry of entries(); track entry.id) {
            <li [class.failed]="entry.status === 'failed'" [class.running]="entry.status === 'running'">
              <div><span class="kind" [class]="'kind ' + entry.kind">{{entry.kind}}</span> <strong>{{entry.label}}</strong></div>
              <small>{{time(entry.time)}} · {{entry.status}} @if (entry.cellCount) { · {{entry.cellCount}} cells }</small>
              @if (entry.error) { <p class="error">{{entry.error}}</p> }
              <div class="cells">
                @for (id of entry.cellIds.slice(0, 8); track id) {
                  <button type="button" [disabled]="!cellIds().has(id)" (click)="cellRequested.emit(id)">{{id}}</button>
                }
                @if (entry.cellCount > 8) { <small>+{{entry.cellCount - 8}} more</small> }
              </div>
            </li>
          } @empty { <li>No agent requests in this session yet.</li> }
        </ol>
        <small>Latest 50 requests. Badges describe current cell content and are not saved to the workbook.</small>
      </section>
    }
  `,
  styles: `
    :host { display:inline-flex; font:12px/1.4 system-ui; color:var(--ink); }
    button { font:inherit; color:inherit; background:var(--paper); border:1px solid var(--line); border-radius:5px; padding:3px 7px; cursor:pointer; }
    button:disabled { opacity:.5; cursor:default; }
    .launcher { display:flex; align-items:center; gap:5px; background:transparent; }
    i { width:7px; height:7px; border-radius:50%; background:#8652c7; }
    .busy i { animation:agent-busy 1s ease-in-out infinite; }
    section { position:fixed; right:12px; bottom:42px; z-index:120; width:min(430px, calc(100vw - 24px)); max-height:65vh;
      overflow:auto; box-sizing:border-box; padding:14px; border:1px solid var(--line); border-radius:10px;
      background:var(--paper, white); box-shadow:0 8px 32px #0003; white-space:normal; }
    header { display:flex; justify-content:space-between; align-items:center; font-size:14px; }
    p { margin:8px 0; } .legend, small { color:var(--muted); } ol { list-style:none; margin:12px 0; padding:0; }
    li { border-top:1px solid var(--line); padding:9px 0; } li.running { border-left:3px solid #8652c7; padding-left:8px; }
    .error { color:var(--red, #c63333); overflow-wrap:anywhere; } .cells { display:flex; flex-wrap:wrap; gap:4px; margin-top:4px; }
    .kind { font-size:10px; padding:1px 4px; border-radius:3px; background:rgb(57 123 219 / 13%); }
    .kind.write { background:rgb(180 122 8 / 18%); } .kind.command { background:rgb(134 82 199 / 16%); }
    @keyframes agent-busy { 50% { opacity:.35; } }
    @media (prefers-reduced-motion: reduce) { .busy i { animation:none; } }
  `,
})
export class AgentActivityComponent {
  readonly showOrigins = input(true);
  readonly originsChanged = output<boolean>();
  readonly entries = input<readonly AgentActivityEntry[]>([]);
  readonly pending = input(0);
  readonly created = input(0);
  readonly edited = input(0);
  readonly cellIds = input.required<ReadonlySet<string>>();
  readonly cellRequested = output<string>();
  readonly cleared = output<void>();
  readonly open = signal(false);
  time(value: number): string { return new Date(value).toLocaleTimeString(); }
}
