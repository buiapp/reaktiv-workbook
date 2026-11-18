import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

@Component({
  selector: 'app-workbook-migration-notice',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section role="status" aria-label="Workbook format migration">
      <div><strong>Format 1 workbook · Saving upgrades it to format 2</strong>
        @if (session()) {
          <p>Saving upgrades this file to format 2 in place. Older versions of Reaktiv Workbook cannot open format 2; use version control to keep the old file.</p>
        } @else {
          <p>Saving downloads a format-2 copy under a new name. Older versions cannot open format 2.</p>
        }
      </div>
      @if (!session()) {
        <label>New copy filename <input aria-label="Migrated workbook filename" [value]="filename()" (input)="filenameChanged.emit($any($event.target).value)" /></label>
        <button type="button" [disabled]="saving()" (click)="saveCopy.emit()">Save migrated copy…</button>
      }
    </section>`,
  styles: `
    :host { display:block; }
    section { display:flex; flex-wrap:wrap; align-items:center; gap:12px; padding:10px 16px; background:light-dark(#fff6db,#352d18); border-bottom:1px solid light-dark(#dfcc91,#6a5930); font-size:12px; }
    section > div { flex:1; min-width:240px; } p { margin:4px 0 0; }
    label { display:grid; gap:4px; } input { min-width:220px; } button { white-space:nowrap; }
  `,
})
export class WorkbookMigrationNoticeComponent {
  /** A CLI session upgrades the file in place on save; the browser downloads a copy. */
  readonly session = input(false);
  readonly saving = input(false);
  readonly filename = input('');
  readonly filenameChanged = output<string>();
  readonly saveCopy = output<void>();
}
