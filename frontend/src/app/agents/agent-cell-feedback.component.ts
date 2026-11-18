import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { AgentCellFeedback } from './agent-activity';

@Component({
  selector: 'app-agent-cell-feedback',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {'[class.inline]': 'inline()'},
  template: `@if (feedback(); as state) {
    @if (state.activity) { <i [class]="state.activity" [title]="'Agent ' + (state.activity === 'read' ? 'reading' : state.activity === 'write' ? 'writing' : 'working')" aria-hidden="true"></i> }
    @if (state.origin && showOrigin()) { <span role="img" [attr.aria-label]="'Agent ' + state.origin + ' this cell during this session'">Agent {{state.origin === 'created' ? '+' : '✎'}}<b>{{state.origin}}</b></span> }
    @if (inline() && state.activity) { <em>Agent {{state.activity === 'read' ? 'reading' : state.activity === 'write' ? 'writing' : 'working'}}</em> }
  }`,
  styles: `
    :host { position:absolute; inset:0; pointer-events:none; z-index:3; border-radius:inherit; }
    i { position:absolute; inset:1px; border:2px solid #397bdb; border-radius:inherit; background:rgb(57 123 219 / 9%); animation:agent-pulse 1s ease-in-out infinite; }
    i.write { border-color:#b47a08; background:rgb(180 122 8 / 10%); }
    i.command { border-color:#8652c7; }
    span { position:absolute; left:15px; top:1px; border-radius:3px; padding:1px 3px; color:light-dark(#53308c,#dfc6ff);
      background:light-dark(#f0e6ff,#352345); font:600 9px/1.25 system-ui; white-space:nowrap; }
    b { display:none; }
    :host.inline { position:static; display:inline-flex; vertical-align:middle; }
    :host.inline i { display:none; }
    :host.inline span { position:static; font-size:11px; padding:3px 6px; }
    :host.inline b { display:inline; margin-left:3px; }
    em { margin-left:5px; color:var(--muted); font:11px/1.4 system-ui; }
    @keyframes agent-pulse { 50% { opacity:.4; } }
    @media (prefers-reduced-motion: reduce) { i { animation:none; } }
  `,
})
export class AgentCellFeedbackComponent {
  readonly feedback = input<AgentCellFeedback | null>(null);
  readonly showOrigin = input(true);
  readonly inline = input(false);
}
