import { ChangeDetectionStrategy, Component, ElementRef, computed, input, output, signal, viewChild, type AfterViewInit } from '@angular/core';

/** One entry of the command palette; the app owns the list and what each entry does. */
export interface PaletteCommand {
  id: string;
  label: string;
  group: string;
  /** Keyboard shortcut shown next to the entry. */
  shortcut?: string;
  disabled?: boolean;
  run: () => void;
}

/** All words of the query appear in the label or group, in any order (case-insensitive). */
export function matchesCommand(command: PaletteCommand, query: string): boolean {
  const text = `${command.label} ${command.group}`.toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every(word => text.includes(word));
}

/**
 * Ctrl/Cmd+K: every workbook command in one searchable list, so rarely used commands do
 * not need a toolbar button. Enter runs the highlighted entry; Escape closes.
 */
@Component({
  selector: 'app-command-palette',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dialog class="command-palette" aria-label="Command palette" (cancel)="$event.preventDefault(); closed.emit()"
      (click)="$event.target === dialog && closed.emit()">
      <input #search type="search" class="command-palette-search" placeholder="Type a command…"
        aria-label="Search commands" role="combobox" aria-controls="command-palette-list" aria-expanded="true"
        [attr.aria-activedescendant]="activeId()" [value]="query()"
        (input)="query.set($any($event.target).value); active.set(0)" (keydown)="keydown($event)" />
      <ul id="command-palette-list" class="command-palette-list" role="listbox" aria-label="Commands">
        @for (command of matches(); track command.id; let index = $index) {
          @if (index === 0 || matches()[index - 1].group !== command.group) {
            <li class="command-palette-group" role="presentation">{{ command.group }}</li>
          }
          <li [id]="'command-' + command.id" role="option" class="command-palette-item"
            [class.active]="index === active()" [attr.aria-selected]="index === active()" [attr.aria-disabled]="command.disabled || null"
            (mousemove)="active.set(index)" (click)="run(command)">
            <span>{{ command.label }}</span>
            @if (command.shortcut) { <kbd>{{ command.shortcut }}</kbd> }
          </li>
        } @empty {
          <li class="command-palette-empty" role="presentation">No matching command.</li>
        }
      </ul>
    </dialog>
  `,
  styles: `
    .command-palette {
      width: min(560px, calc(100vw - 32px)); max-height: min(520px, calc(100vh - 120px));
      margin: 12vh auto auto; padding: 0; overflow: hidden;
      border: 1px solid var(--line); border-radius: 12px; color: var(--ink); background: var(--paper);
      box-shadow: 0 24px 60px rgb(0 0 0 / 0.25);
    }
    .command-palette[open] { display: flex; flex-direction: column; }
    .command-palette::backdrop { background: rgb(0 0 0 / 0.18); }
    .command-palette-search {
      flex: none; padding: 14px 16px; border: 0; border-bottom: 1px solid var(--line);
      color: inherit; background: transparent; font: inherit; font-size: 15px; outline: none;
    }
    .command-palette-list { flex: 1; margin: 0; padding: 6px; overflow-y: auto; list-style: none; }
    .command-palette-group { padding: 8px 10px 4px; color: var(--muted); font-size: 10.5px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
    .command-palette-item {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      padding: 7px 10px; border-radius: 7px; font-size: 13px; cursor: pointer;
    }
    .command-palette-item.active { background: var(--hover, light-dark(#f1f2ee, #222220)); }
    .command-palette-item[aria-disabled='true'] { color: var(--muted); cursor: default; }
    .command-palette-item kbd { color: var(--muted); font: 11px ui-monospace, monospace; }
    .command-palette-empty { padding: 14px 10px; color: var(--muted); }
  `,
})
export class CommandPaletteComponent implements AfterViewInit {
  readonly commands = input.required<readonly PaletteCommand[]>();
  readonly closed = output<void>();
  protected readonly query = signal('');
  protected readonly active = signal(0);
  protected readonly matches = computed(() => this.commands().filter(command => matchesCommand(command, this.query())));
  protected readonly activeId = computed(() => {
    const command = this.matches()[this.active()];
    return command ? 'command-' + command.id : null;
  });
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly search = viewChild.required<ElementRef<HTMLInputElement>>('search');

  ngAfterViewInit(): void {
    const dialog = this.dialog().nativeElement;
    if (typeof dialog.showModal === 'function' && !dialog.open) dialog.showModal();
    this.search().nativeElement.focus();
  }

  protected keydown(event: KeyboardEvent): void {
    const count = this.matches().length;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (count) this.active.set((this.active() + (event.key === 'ArrowDown' ? 1 : count - 1)) % count);
      queueMicrotask(() => this.dialog().nativeElement.querySelector<HTMLElement>('.command-palette-item.active')?.scrollIntoView?.({ block: 'nearest' }));
    } else if (event.key === 'Escape') {
      // A search field would use the first Escape to clear itself; the palette closes at once.
      event.preventDefault();
      this.closed.emit();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const command = this.matches()[this.active()];
      if (command) this.run(command);
    }
  }

  protected run(command: PaletteCommand): void {
    if (command.disabled) return;
    this.closed.emit();
    command.run();
  }
}
