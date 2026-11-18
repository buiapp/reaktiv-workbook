import type { CellDefinition } from './sheet.types';
export interface CellSearchResult { cell: CellDefinition; snippet: string; }
/** Plain text, all terms must match; exact coordinates and labels come first. */
export function searchCells(cells: readonly CellDefinition[], query: string): CellSearchResult[] {
  const text = query.trim().toLocaleLowerCase();
  if (!text) return [];
  const terms = text.split(/\s+/);
  return cells.filter(cell => {
    const haystack = `${cell.id}\n${cell.name ?? ''}\n${cell.source}`.toLocaleLowerCase();
    return terms.every(term => haystack.includes(term));
  }).map(cell => {
    const lines = cell.source.split('\n');
    const snippet = lines.find(line => terms.some(term => line.toLocaleLowerCase().includes(term))) ?? lines.find(line => line.trim()) ?? '';
    return {cell, snippet: snippet.trim().slice(0, 180)};
  }).sort((a, b) => {
    const rank = (cell: CellDefinition) => [cell.id, cell.name ?? ''].some(label => label.toLocaleLowerCase() === text) ? 0 : [cell.id, cell.name ?? ''].some(label => label.toLocaleLowerCase().startsWith(text)) ? 1 : 2;
    return rank(a.cell) - rank(b.cell) || a.cell.id.localeCompare(b.cell.id, undefined, {numeric: true});
  });
}
