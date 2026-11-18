import { canNestNote, normalizeNoteParents, noteTreeRows, type NoteTreeItem } from './note-tree';
const notes: NoteTreeItem[] = [
  {id:'A1', title:'Planning', excerpt:'', source:'# Planning'},
  {id:'A2', title:'Work', excerpt:'', source:'# Work'},
  {id:'A3', title:'Project', excerpt:'', source:'# Project\nneedle'},
  {id:'Budget!A1', title:'Budget', excerpt:'', source:'# Budget'},
];
describe('Nested notes', () => {
  it('projects sibling order, nested depths and collapsed branches', () => {
    const parents = {A2:'A1', A3:'A2'};
    expect(noteTreeRows(notes, parents, new Set()).map(row=>[row.note.id,row.depth])).toEqual([['A1',0],['A2',1],['A3',2],['Budget!A1',0]]);
    expect(noteTreeRows(notes, parents, new Set(['A1'])).map(row=>row.note.id)).toEqual(['A1','Budget!A1']);
    expect(noteTreeRows(notes, parents, new Set(['A2']), 'needle').map(row=>row.note.id)).toEqual(['A1','A2','A3']);
  });
  it('prevents cycles, retains cross-sheet grouping and promotes orphans', () => {
    expect(canNestNote('A1','A3',{A2:'A1',A3:'A2'})).toBe(false);
    const cells = notes.map(note=>({...note,kind:'markdown' as const}));
    expect(normalizeNoteParents(cells,{A2:'A1',A3:'missing','Budget!A1':'A1'})).toEqual({A2:'A1','Budget!A1':'A1'});
    expect(normalizeNoteParents(cells,{A1:'A2',A2:'A1',A3:'A2'})).toEqual({});
    expect(normalizeNoteParents(cells.filter(cell=>cell.id!=='A1'),{A2:'A1',A3:'A2'})).toEqual({A3:'A2'});
  });
});
