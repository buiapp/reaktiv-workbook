import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { UiIconComponent } from './ui-icon.component';

@Component({
  selector: 'app-selection-navigation',
  imports: [UiIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div role="group" aria-label="Graph selection history">
    <button
      type="button"
      aria-label="Previous selection"
      title="Previous graph selection (Alt+←)"
      [disabled]="!canBack()"
      (click)="back.emit()"
    >
      <app-ui-icon name="arrow-left" />
    </button>
    <button
      type="button"
      aria-label="Next selection"
      title="Next graph selection (Alt+→)"
      [disabled]="!canForward()"
      (click)="forward.emit()"
    >
      <app-ui-icon name="arrow-right" />
    </button>
  </div>`,
  styles: `
    :host {
      display: inline-flex;
      flex: none;
    }
    div {
      display: flex;
      gap: 2px;
    }
    button {
      display: grid;
      place-items: center;
      width: 30px;
      height: 30px;
      padding: 0;
      border: 0;
      border-radius: 6px;
      color: var(--ink);
      background: transparent;
      cursor: pointer;
    }
    button:hover:not(:disabled) {
      background: var(--line);
    }
    button:disabled {
      opacity: 0.3;
      cursor: default;
    }
    @media (pointer: coarse) {
      button {
        width: 44px;
        height: 44px;
      }
    }
  `,
})
export class SelectionNavigationComponent {
  readonly canBack = input(false);
  readonly canForward = input(false);
  readonly back = output<void>();
  readonly forward = output<void>();
}
