import { Component, EventEmitter, Input, OnChanges, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { ActionBinding, ActionParameter, CellDefinition } from './sheet.types';

/** Per-button overrides. Omitted arguments inherit the action's saved settings. */
@Component({
  selector: 'app-action-arguments',
  imports: [FormsModule],
  template: `
    @for (parameter of parameters; track parameter.name) {
      @let field = fields[parameter.name];
      <div class="argument">
        <label
          >{{ parameter.name }} <small>{{ parameter.annotation }}</small>
          <select
            [attr.aria-label]="parameter.name + ' argument mode'"
            [(ngModel)]="field.mode"
            [disabled]="disabled"
            (change)="publish()"
          >
            <option value="inherit">Use action settings</option>
            @if (!parameter.required) {
              <option value="default">Use method default</option>
            }
            <option value="literal">Enter value</option>
            <option value="cell">Bind cell</option>
          </select>
        </label>
        @if (field.mode === 'cell') {
          <select
            [attr.aria-label]="parameter.name + ' argument cell'"
            [(ngModel)]="field.cell"
            [disabled]="disabled"
            (change)="publish()"
          >
            <option value="">Choose a cell…</option>
            @for (cell of cells; track cell.id) {
              @if (cell.kind !== 'effect') {
                <option [value]="cell.id">{{ cell.name || cell.id }} · {{ cell.id }}</option>
              }
            }
          </select>
        } @else if (field.mode === 'literal') {
          @if (booleanParameter(parameter.annotation)) {
            <select
              [attr.aria-label]="parameter.name + ' argument value'"
              [(ngModel)]="field.text"
              [disabled]="disabled"
              (change)="publish()"
            >
              <option value="true">True</option>
              <option value="false">False</option>
            </select>
          } @else {
            <input
              [attr.aria-label]="parameter.name + ' argument value'"
              [(ngModel)]="field.text"
              [readonly]="disabled"
              (change)="publish()"
              [placeholder]="parameter.annotation || 'JSON value'"
            />
          }
        }
      </div>
    }
    @if (error) {
      <p role="alert">{{ error }}</p>
    }
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .argument,
    label {
      display: grid;
      gap: 5px;
    }
    .argument {
      margin: 10px 0;
    }
    input,
    select {
      box-sizing: border-box;
      width: 100%;
      min-width: 0;
      font: inherit;
      color: var(--ink);
      background: var(--panel);
      border: 1px solid var(--line-strong);
      border-radius: 5px;
      padding: 6px;
    }
    small {
      color: var(--muted);
    }
    p {
      font-size: 12px;
      color: light-dark(#b32b2b, #ff9c9c);
    }
  `,
})
export class ActionArgumentsComponent implements OnChanges {
  @Input() parameters: ActionParameter[] = [];
  @Input() bindings: Record<string, ActionBinding> = {};
  @Input() cells: CellDefinition[] = [];
  @Input() disabled = false;
  @Output() changed = new EventEmitter<Record<string, ActionBinding>>();
  fields: Record<string, { mode: string; text: string; cell: string }> = {};
  error = '';
  private shown = '';
  booleanParameter(annotation: string): boolean {
    return annotation.replaceAll("'", '').replaceAll('"', '') === 'bool';
  }
  ngOnChanges(): void {
    const key = JSON.stringify([this.parameters, this.bindings]);
    if (key === this.shown) return;
    this.shown = key;
    this.error = '';
    this.fields = {};
    for (const parameter of this.parameters) {
      const binding = this.bindings[parameter.name];
      this.fields[parameter.name] = {
        mode: binding?.cell
          ? 'cell'
          : binding?.default
            ? 'default'
            : binding && 'value' in binding
              ? 'literal'
              : 'inherit',
        cell: binding?.cell ?? '',
        text:
          binding && 'value' in binding
            ? this.text(binding.value)
            : parameter.default !== undefined
              ? this.text(parameter.default)
              : this.booleanParameter(parameter.annotation)
                ? 'false'
                : '',
      };
    }
  }
  private text(value: unknown): string {
    return typeof value === 'string' ? value : JSON.stringify(value);
  }
  publish(): void {
    if (this.disabled) return;
    this.error = '';
    const bindings: Record<string, ActionBinding> = {};
    try {
      for (const parameter of this.parameters) {
        const field = this.fields[parameter.name];
        if (field.mode === 'inherit') continue;
        if (field.mode === 'default') {
          bindings[parameter.name] = { default: true };
          continue;
        }
        if (field.mode === 'cell') {
          if (!field.cell) throw new Error(`Choose a cell for ${parameter.name}`);
          bindings[parameter.name] = { cell: field.cell };
          continue;
        }
        const annotation = parameter.annotation.replaceAll("'", '').replaceAll('"', '');
        const value =
          annotation === 'str' || (!annotation && typeof parameter.default === 'string')
            ? field.text
            : JSON.parse(field.text);
        if (annotation === 'int' && !Number.isInteger(value))
          throw new Error(`${parameter.name} needs an integer`);
        if (annotation === 'float' && (typeof value !== 'number' || !Number.isFinite(value)))
          throw new Error(`${parameter.name} needs a number`);
        bindings[parameter.name] = { value };
      }
      this.changed.emit(bindings);
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    }
  }
}
