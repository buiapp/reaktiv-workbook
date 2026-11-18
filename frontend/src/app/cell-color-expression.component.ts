import { ChangeDetectionStrategy, Component, effect, input, output, signal } from '@angular/core';
import { PythonEditorComponent, type PythonCompletion } from './python-editor.component';

@Component({
  selector: 'app-cell-color-expression',
  imports: [PythonEditorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label>Reactive color · Python expression</label>
    <app-python-editor [value]="draft()" (valueChange)="draft.set($event)" [readOnly]="!enabled()"
      [completions]="completions()" ariaLabel="Reactive cell color expression" [resizable]="false" />
    <small>Return #RRGGBB, None or ''. Example: '#ffcccc' if temperature > 80 else '#ccffcc'. A cell label or signal call also works.</small>
    <button type="button" [disabled]="!enabled() || draft().trim() === expression()" (click)="applied.emit(draft().trim())">Apply color expression</button>
    @if (error()) { <p role="alert">{{ error() }} · Using the fixed color.</p> }
  `,
  styles: `:host { display: grid; gap: 6px; margin: 8px 0; } label { font-size: 11px; font-weight: 600; }
    small { color: var(--muted); } p { color: var(--danger); margin: 0; }
    button { justify-self: start; font: inherit; color: var(--ink); background: var(--panel); border: 1px solid var(--line); border-radius: 5px; padding: 5px 8px; }`,
})
export class CellColorExpressionComponent {
  readonly cellId = input.required<string>();
  readonly expression = input('');
  readonly error = input('');
  readonly enabled = input(false);
  readonly completions = input<readonly PythonCompletion[]>([]);
  readonly applied = output<string>();
  readonly draft = signal('');
  constructor() { effect(() => { this.cellId(); this.draft.set(this.expression()); }); }
}
