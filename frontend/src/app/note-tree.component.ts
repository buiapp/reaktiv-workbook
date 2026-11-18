import { ChangeDetectionStrategy, Component, input, output, signal, computed, effect, untracked } from '@angular/core';
import { canNestNote, noteTreeRows, type NoteParents, type NoteTreeItem } from './note-tree';
@Component({
  selector: 'app-note-tree',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="note-list" aria-label="Note pages">
    @for (row of rows(); track row.note.id) {
      <div class="row" [style.padding-left.px]="Math.min(row.depth, 8) * 12" [class.drop-inside]="dropTarget()?.id === row.note.id && dropTarget()?.mode === 'inside'" [class.drop-before]="dropTarget()?.id === row.note.id && dropTarget()?.mode === 'before'" [class.drop-after]="dropTarget()?.id === row.note.id && dropTarget()?.mode === 'after'" (dragover)="over($event, row.note.id)" (drop)="drop($event, row.note.id)" (contextmenu)="context($event, row.note.id)">
        @if (hasHierarchy()) {
        <button type="button" class="disclosure" [disabled]="!row.hasChildren" [attr.aria-label]="(row.expanded ? 'Collapse ' : 'Expand ') + row.note.title" [attr.aria-expanded]="row.hasChildren ? row.expanded : null" (click)="toggle(row.note.id)">@if (row.hasChildren) { <svg viewBox="0 0 24 24" aria-hidden="true" [class.collapsed]="!row.expanded"><path d="m6 9 6 6 6-6" /></svg> }</button>
        }
        <button type="button" class="note-list-item" [attr.data-note]="row.note.id" [class.active]="selected() === row.note.id" draggable="true" (dragstart)="start($event, row.note.id)" (dragend)="end()" (keydown)="key($event, row.note.id, row.hasChildren, row.expanded)" (click)="picked.emit(row.note.id)">
          <strong>{{ row.note.title }}</strong><small>{{ row.note.excerpt || row.note.id }}</small>
        </button>
      </div>
    } @empty { <p class="empty-note">{{ query() ? 'No notes match “' + query() + '”.' : 'Create the first note.' }}</p> }
    @if (dragged()) { <div class="root-drop" (dragover)="$event.preventDefault(); dropTarget.set(null)" (drop)="$event.preventDefault(); moveUnder(dragged()!, ''); end()">Move to top level</div> }
  </div>`,
  styles: `:host { display: block; flex: 1; min-height: 0; min-width: 0; overflow: auto; } .note-list { display: grid; gap: 3px; padding-block: 5px; } .row { display: flex; min-width: 0; align-items: center; border: 1px solid transparent; border-radius: 7px; } button { font: inherit; color: var(--ink); background: transparent; border: 0; cursor: pointer; } .disclosure { display: grid; place-items: center; flex: 0 0 32px; min-height: 36px; padding: 0; border-radius: 5px; color: var(--muted); } .disclosure svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; } .disclosure svg.collapsed { transform: rotate(-90deg); } .disclosure:hover:not(:disabled) { color: var(--ink); } .disclosure:disabled { opacity: .3; cursor: default; } .note-list-item { flex: 1; min-width: 0; text-align: left; padding: 8px 4px; display: grid; gap: 3px; border-radius: 5px; } .note-list-item:hover, .note-list-item.active { background: var(--panel); } .note-list-item.active strong { color: var(--purple); } strong, small { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; } strong { font-size: 12px; } small, p { font-size: 10px; color: var(--muted); } .drop-inside { border-color: var(--purple); background: var(--panel); } .drop-before { border-top-color: var(--purple); } .drop-after { border-bottom-color: var(--purple); } .root-drop { padding: 12px; border: 1px dashed var(--line-strong); color: var(--muted); font-size: 11px; }`,
})
export class NoteTreeComponent {
  readonly Math = Math;
  readonly notes = input.required<readonly NoteTreeItem[]>();
  readonly parents = input<NoteParents>({});
  readonly selected = input('');
  readonly query = input('');
  readonly picked = output<string>();
  readonly reparented = output<{id: string; parent: string}>();
  readonly reordered = output<{id: string; before: string | null; parent: string}>();
  readonly contextRequested = output<{id: string; x: number; y: number}>();
  readonly collapsed = signal<ReadonlySet<string>>(new Set());
  readonly dragged = signal<string | null>(null);
  readonly dropTarget = signal<{id: string; mode: 'inside' | 'before' | 'after'} | null>(null);
  readonly rows = computed(() => noteTreeRows(this.notes(), this.parents(), this.collapsed(), this.query()));
  readonly hasHierarchy = computed(() => this.rows().some(row => row.hasChildren || row.depth > 0));
  private readonly revealSelection = effect(() => {
    let parent = this.parents()[this.selected()];
    const ancestors = new Set<string>();
    while (parent && !ancestors.has(parent)) { ancestors.add(parent); parent = this.parents()[parent]; }
    untracked(() => this.collapsed.update(previous => new Set([...previous].filter(id => !ancestors.has(id)))));
  });
  context(event: MouseEvent, id: string): void {
    event.preventDefault(); event.stopPropagation();
    this.contextRequested.emit({id, x: event.clientX, y: event.clientY});
  }
  moveUnder(id: string, parent: string): void {
    if (!canNestNote(id, parent, this.parents())) return;
    const ancestors = new Set<string>(); let cursor = parent;
    while (cursor && !ancestors.has(cursor)) { ancestors.add(cursor); cursor = this.parents()[cursor]; }
    this.collapsed.update(previous => new Set([...previous].filter(item => !ancestors.has(item))));
    this.reparented.emit({id, parent});
  }
  toggle(id: string): void { this.collapsed.update(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  start(event: DragEvent, id: string): void { this.dragged.set(id); event.dataTransfer?.setData('text/plain', id); if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'; }
  end(): void { this.dragged.set(null); this.dropTarget.set(null); }
  over(event: DragEvent, id: string): void {
    const dragged = this.dragged(); if (!dragged || dragged === id) { this.dropTarget.set(null); return; }
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const position = (event.clientY - rect.top) / rect.height;
    const mode = position < .3 ? 'before' : position > .7 ? 'after' : 'inside';
    if (!canNestNote(dragged, mode === 'inside' ? id : this.parents()[id] ?? '', this.parents())) { this.dropTarget.set(null); return; }
    event.preventDefault(); this.dropTarget.set({id, mode});
  }
  drop(event: DragEvent, id: string): void {
    event.preventDefault(); const dragged = this.dragged(), target = this.dropTarget();
    this.end(); if (!dragged || !target || target.id !== id) return;
    if (target.mode === 'inside') this.moveUnder(dragged, id);
    else {
      const parent = this.parents()[id] ?? '';
      const siblings = this.notes().filter(note => note.id !== dragged && (this.parents()[note.id] ?? '') === parent);
      this.reordered.emit({id: dragged, parent, before: target.mode === 'before' ? id : siblings[siblings.findIndex(note => note.id === id) + 1]?.id ?? null});
    }
  }
  key(event: KeyboardEvent, id: string, children: boolean, expanded: boolean): void {
    if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') {
      event.preventDefault(); event.stopPropagation();
      const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
      this.contextRequested.emit({id, x: bounds.left, y: bounds.bottom}); return;
    }
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault(); const parent = this.parents()[id] ?? '';
      const siblings = this.notes().filter(note => (this.parents()[note.id] ?? '') === parent);
      const index = siblings.findIndex(note => note.id === id);
      if (event.key === 'ArrowUp' && index > 0) this.reordered.emit({id, parent, before: siblings[index - 1].id});
      if (event.key === 'ArrowDown' && index < siblings.length - 1) this.reordered.emit({id, parent, before: siblings[index + 2]?.id ?? null});
    } else if (event.key === 'ArrowRight' && children && !expanded || event.key === 'ArrowLeft' && children && expanded) { event.preventDefault(); this.toggle(id); }
  }
}
