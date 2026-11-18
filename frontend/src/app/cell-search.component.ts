import { ToolbarPopupDirective } from './toolbar-popup.directive';
import { ChangeDetectionStrategy, Component, input, output, computed, signal, viewChild, ElementRef, afterNextRender } from '@angular/core';
import type { CellDefinition } from './sheet.types';
import { searchCells } from './cell-search';
@Component({
  selector: 'app-cell-search',
  imports: [ToolbarPopupDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<dialog appToolbarPopup="dialog" #dialog aria-labelledby="cell-search-title" (cancel)="$event.preventDefault(); closed.emit()" (click)="backdrop($event)">
    <header><strong id="cell-search-title">Search cells</strong><button type="button" aria-label="Close cell search" (click)="closed.emit()">×</button></header>
    <input #search type="search" aria-label="Search cell labels, coordinates and code" placeholder="Label, coordinate, or Python code…" [value]="query()" (input)="update($any($event.target).value)" (keydown)="key($event)" role="combobox" aria-controls="cell-search-results" [attr.aria-expanded]="shown().length > 0" [attr.aria-activedescendant]="shown().length ? 'cell-search-result-' + selected() : null" autocomplete="off" />
    <p class="summary" aria-live="polite">{{ query().trim() ? matches().length + ' matching cells across all sheets' : 'Search across all sheets, including drafts.' }}{{ matches().length > 100 ? ' · Showing the first 100' : '' }}</p>
    <div class="results" id="cell-search-results" role="listbox" aria-label="Matching cells">
      @for (result of shown(); track result.cell.id; let index = $index) {
        <button type="button" role="option" [id]="'cell-search-result-' + index" [attr.aria-selected]="index === selected()" (click)="chosen.emit(result.cell.id)">
          <span><strong>{{ result.cell.name || result.cell.id }}</strong><small>{{ result.cell.id }} · {{ result.cell.kind }}</small></span><code>{{ result.snippet }}</code>
        </button>
      }
      @if (query().trim() && !matches().length) { <p>No matching cells.</p> }
    </div>
    <footer>↑↓ to select · Enter to open · Esc to close</footer>
  </dialog>`,
  styles: `dialog { width: min(640px, calc(100vw - 24px)); max-height: min(80dvh, 620px); box-sizing: border-box; padding: 16px; border: 1px solid var(--line-strong); border-radius: 12px; color: var(--ink); background: var(--paper); box-shadow: 0 12px 40px light-dark(#0003, #0008); } dialog::backdrop { background: light-dark(#0003, #0008); } header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; } input { width: 100%; box-sizing: border-box; padding: 10px; font: inherit; color: var(--ink); background: var(--panel); border: 1px solid var(--line); border-radius: 6px; } button { font: inherit; color: inherit; background: transparent; border: 0; cursor: pointer; } header button { font-size: 20px; } .summary, footer, small { color: var(--muted); font-size: 11px; } .results { max-height: 48dvh; overflow: auto; } .results button { width: 100%; text-align: left; display: grid; gap: 5px; border-radius: 6px; padding: 10px; } .results button[aria-selected='true'], .results button:hover { background: var(--panel); } .results span { display: flex; justify-content: space-between; gap: 8px; } strong, code { overflow-wrap: anywhere; } code { font-size: 11px; white-space: pre-wrap; } footer { margin-top: 12px; }`,
})
export class CellSearchComponent {
  readonly cells = input.required<readonly CellDefinition[]>();
  readonly closed = output<void>();
  readonly chosen = output<string>();
  readonly query = signal('');
  readonly selected = signal(0);
  readonly matches = computed(() => searchCells(this.cells(), this.query()));
  readonly shown = computed(() => this.matches().slice(0, 100));
  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('dialog');
  private readonly search = viewChild<ElementRef<HTMLInputElement>>('search');
  constructor() { afterNextRender(() => { this.dialog()?.nativeElement.showModal(); this.search()?.nativeElement.focus(); }); }
  update(query: string): void { this.query.set(query); this.selected.set(0); }
  backdrop(event: MouseEvent): void { if (event.target === this.dialog()?.nativeElement) { const bounds = this.dialog()!.nativeElement.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) this.closed.emit(); } }
  key(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      this.selected.update(index => Math.max(0, Math.min(this.shown().length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))));
      this.dialog()?.nativeElement.querySelector(`#cell-search-result-${this.selected()}`)?.scrollIntoView({block: 'nearest'});
    } else if (event.key === 'Enter') { event.preventDefault(); const result = this.shown()[this.selected()]; if (result) this.chosen.emit(result.cell.id); }
  }
}
