import { ChangeDetectionStrategy, Component, input, output, signal, effect, untracked } from '@angular/core';
import { PythonEditorComponent } from './python-editor.component';
import { pythonLiteral } from './input-widgets';
@Component({
  selector: 'app-linked-input',
  imports: [PythonEditorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<section aria-label="Linked input value">
    <header><strong>{{ override() === undefined && !runtimeOverride() ? 'Derived value' : 'Overridden' }}</strong><button type="button" [disabled]="readOnly() || (override() === undefined && !runtimeOverride())" (click)="clear()">Reset to derived value</button></header>
    <p>Source changes recompute this value. An optional computation can keep the previous value. Editing the derivation or resetting starts fresh.</p>
    <p>Manual value (Python literal)</p>
    <app-python-editor [value]="draft()" [readOnly]="readOnly()" [resizable]="false" ariaLabel="Linked input manual value" (valueChange)="edit($event)" (commit)="apply()" />
    <button type="button" [disabled]="readOnly() || !draft().trim()" (click)="apply()">Set override</button>
  </section>`,
  styles: `section { display: grid; gap: 8px; padding: 10px; border: 1px solid var(--theme-line-strong, light-dark(#d7d6d0, #3a3a36)); border-radius: 8px; margin-block: 10px; } header { display: flex; gap: 8px; align-items: center; justify-content: space-between; } strong { font-size: 12px; } p { margin: 0; font-size: 11px; color: var(--theme-muted, light-dark(#7a7a73, #8f8f88)); } button { font: inherit; padding: 5px 8px; border: 1px solid var(--theme-line-strong, light-dark(#d7d6d0, #3a3a36)); border-radius: 6px; color: inherit; background: var(--theme-paper, light-dark(#fdfdfb, #161614)); cursor: pointer; } button:disabled { opacity: .5; cursor: default; } @media (pointer: coarse) { button { min-height: 44px; } }`,
})
export class LinkedInputComponent {
  readonly cellId = input.required<string>();
  readonly value = input<unknown>();
  readonly override = input<string>();
  readonly readOnly = input(false);
  readonly runtimeOverride = input(false);
  readonly changed = output<string>();
  readonly reset = output<void>();
  readonly draft = signal('');
  private editing = false;
  private previousId = '';
  private readonly synchronize = effect(() => {
    const id = this.cellId(), override = this.override(), value = this.value();
    untracked(() => {
      if (id !== this.previousId || !this.editing) this.draft.set(override ?? pythonLiteral(value) ?? '');
      if (id !== this.previousId) this.editing = false;
      this.previousId = id;
    });
  });
  apply(): void { if (this.readOnly() || !this.draft().trim()) return; this.editing = false; this.changed.emit(this.draft()); }
  clear(): void { if (this.readOnly() || (this.override() === undefined && !this.runtimeOverride())) return; this.editing = false; this.reset.emit(); }
  edit(source: string): void { this.editing = true; this.draft.set(source); }
}
