import { ChangeDetectionStrategy, Component, ElementRef, input, viewChild } from '@angular/core';
import { UiIconComponent } from './ui-icon.component';

let nextId = 0;

/**
 * The same "Options" button in every view header (Notes, Cells, Graph, split panes): the
 * view's secondary settings live in its popover so the header stays one row. Uses the
 * native Popover API (light dismiss, Escape, top layer); the content stays in the DOM.
 */
@Component({
  selector: 'app-view-options',
  imports: [UiIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button #trigger type="button" class="view-options-button" [attr.popovertarget]="id"
      [attr.aria-label]="label()" [title]="label()">
      <app-ui-icon name="settings" />
      <span class="label">Options</span>
    </button>
    <div #panel class="view-options-panel" popover [id]="id" role="dialog" [attr.aria-label]="label()"
      (toggle)="place($event)">
      <ng-content />
    </div>
  `,
  styles: `
    :host { display: inline-flex; }
    .view-options-panel {
      position: fixed; inset: auto; margin: 0; padding: 12px 14px;
      min-width: 240px; max-width: min(360px, calc(100vw - 16px)); max-height: calc(100vh - 80px); overflow: auto;
      border: 1px solid var(--line); border-radius: 10px; background: var(--paper); color: var(--ink);
      box-shadow: 0 10px 30px rgb(0 0 0 / 0.16);
      display: none; flex-direction: column; align-items: stretch; gap: 10px;
      font-size: 12.5px;
    }
    .view-options-panel:popover-open { display: flex; }
  `,
})
export class ViewOptionsComponent {
  readonly label = input('View options');
  protected readonly id = `view-options-${nextId++}`;
  private readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');
  private readonly panel = viewChild.required<ElementRef<HTMLElement>>('panel');

  /** Below the button, right-aligned with it, kept inside the window. */
  protected place(event: Event): void {
    if ((event as ToggleEvent).newState !== 'open') return;
    const button = this.trigger().nativeElement.getBoundingClientRect();
    const panel = this.panel().nativeElement;
    const width = panel.offsetWidth;
    panel.style.top = `${Math.round(button.bottom + 6)}px`;
    panel.style.left = `${Math.round(Math.max(8, Math.min(button.right - width, window.innerWidth - width - 8)))}px`;
  }
}
