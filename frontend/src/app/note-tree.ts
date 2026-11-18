import type { CellDefinition } from './sheet.types';
export type NoteParents = Record<string, string>;
/** Drop missing/non-page parents and cyclic chains so every note stays reachable. */
export function normalizeNoteParents(notes: readonly Pick<CellDefinition, 'id' | 'kind' | 'view'>[], parents: NoteParents = {}): NoteParents {
  if (parents === null || typeof parents !== 'object' || Array.isArray(parents) || Object.values(parents).some(parent => typeof parent !== 'string')) throw new Error('Note parents must map child cell ids to parent cell ids.');
  const ids = new Set(notes.filter(note => note.kind === 'markdown' && note.view?.page !== false).map(note => note.id));
  const valid: NoteParents = Object.fromEntries(Object.entries(parents).filter(([id, parent]) => ids.has(id) && ids.has(parent) && id !== parent));
  return Object.fromEntries(Object.entries(valid).filter(([id]) => {
    const seen = new Set<string>([id]);
    let parent = valid[id];
    while (parent) { if (seen.has(parent)) return false; seen.add(parent); parent = valid[parent]; }
    return true;
  }));
}
export function canNestNote(id: string, parent: string, parents: NoteParents): boolean {
  const seen = new Set<string>([id]);
  while (parent) { if (seen.has(parent)) return false; seen.add(parent); parent = parents[parent]; }
  return true;
}
export interface NoteTreeItem { id: string; title: string; excerpt: string; source: string; }
export interface NoteTreeRow { note: NoteTreeItem; depth: number; hasChildren: boolean; expanded: boolean; }
export function noteTreeRows(notes: readonly NoteTreeItem[], parents: NoteParents, collapsed: ReadonlySet<string>, query = ''): NoteTreeRow[] {
  const children = new Map<string, NoteTreeItem[]>();
  for (const note of notes) { const parent = parents[note.id] ?? ''; const siblings = children.get(parent) ?? []; siblings.push(note); children.set(parent, siblings); }
  const search = query.trim().toLocaleLowerCase();
  const included = new Set<string>();
  if (search) for (const note of notes) {
    if (!`${note.title}\n${note.source}`.toLocaleLowerCase().includes(search)) continue;
    included.add(note.id);
    let parent = parents[note.id];
    while (parent && !included.has(parent)) { included.add(parent); parent = parents[parent]; }
  }
  const rows: NoteTreeRow[] = [];
  const pending = [...children.get('') ?? []].reverse().map(note => ({note, depth: 0}));
  while (pending.length) {
    const item = pending.pop()!;
    if (search && !included.has(item.note.id)) continue;
    const nested = children.get(item.note.id) ?? [];
    const expanded = !!search || !collapsed.has(item.note.id);
    rows.push({...item, hasChildren: nested.length > 0, expanded});
    if (expanded) for (const note of [...nested].reverse()) pending.push({note, depth: item.depth + 1});
  }
  return rows;
}
