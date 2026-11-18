import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  Output,
  ViewChild,
} from '@angular/core';

export interface SaveFailure {
  title: string;
  summary: string;
  details: string[];
  cells?: { id: string; label: string }[];
  actions?: string[];
}

@Component({
  selector: 'app-save-failure',
  template: ` <div
    class="save-failure-backdrop"
    (keydown.tab)="trapFocus($event)"
    (keydown.escape)="dismissed.emit(); $event.stopPropagation()"
  >
    <section
      #dialog
      tabindex="-1"
      class="save-failure-dialog"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="save-failure-title"
      aria-describedby="save-failure-summary"
    >
      <header>
        <h2 id="save-failure-title">{{ failure.title }}</h2>
        <button type="button" aria-label="Close save details" (click)="dismissed.emit()">×</button>
      </header>
      <div class="save-failure-body">
        <p id="save-failure-summary">{{ failure.summary }}</p>
        <ul>
          @for (detail of failure.details; track $index) {
            <li>{{ detail }}</li>
          }
        </ul>
        @if (failure.cells?.length) {
          <div class="save-cell-links" aria-label="Cells involved in the save problem">
            @for (cell of failure.cells; track cell.id) {
              <button type="button" (click)="cellRequested.emit(cell.id)">Open cell {{ cell.label }}</button>
            }
          </div>
        }
        @if (failure.actions?.length) {
          <div class="save-cell-links" aria-label="Actions involved in the save problem">
            @for (name of failure.actions; track name) {
              <button type="button" (click)="actionRequested.emit(name)">Open action {{ name }}</button>
            }
          </div>
        }
      </div>
      <footer>
        <button type="button" class="secondary-button" (click)="dismissed.emit()">
          Back to workbook</button
        ><button type="button" class="primary-button" [disabled]="busy" (click)="retried.emit()">
          Try again
        </button>
      </footer>
    </section>
  </div>`,
  styleUrl: './save-failure.component.scss',
})
export class SaveFailureComponent implements AfterViewInit {
  @Input({ required: true }) failure!: SaveFailure;
  @Input() busy = false;
  @Output() dismissed = new EventEmitter<void>();
  @Output() retried = new EventEmitter<void>();
  @Output() actionRequested = new EventEmitter<string>();
  @Output() cellRequested = new EventEmitter<string>();
  @ViewChild('dialog') dialog!: ElementRef<HTMLElement>;
  ngAfterViewInit(): void {
    this.dialog.nativeElement.focus();
  }
  trapFocus(event: Event): void {
    const keyboard = event as KeyboardEvent;
    const dialog = this.dialog.nativeElement;
    const buttons = [...dialog.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const first = buttons[0];
    const last = buttons.at(-1);
    if (
      keyboard.shiftKey &&
      (document.activeElement === first || document.activeElement === dialog)
    ) {
      keyboard.preventDefault();
      last?.focus();
    } else if (!keyboard.shiftKey && document.activeElement === last) {
      keyboard.preventDefault();
      first?.focus();
    }
  }
}
