/**
 * Table of contents of a note (like Outline's "Contents"): the headings of the page as
 * it is rendered, so live values in headings read as their current value.
 */
export interface OutlineItem {
  /** Position among the note's headings (to find the element again). */
  index: number;
  /** Indentation, 0 for the highest heading level used in the note. */
  depth: number;
  text: string;
}

const HEADINGS = 'h1, h2, h3, h4';

/** The headings of the page; headings inside live values (embedded notes) are skipped. */
export function headingElements(page: ParentNode): HTMLElement[] {
  return [...page.querySelectorAll<HTMLElement>(HEADINGS)].filter(
    (heading) => heading.closest('.cell-value-node, .mermaid-node') === null,
  );
}

export function buildOutline(headings: readonly HTMLElement[]): OutlineItem[] {
  const items = headings
    .map((heading, index) => ({
      index,
      level: Number(heading.tagName.slice(1)),
      text: (heading.textContent ?? '').replace(/\s+/g, ' ').trim(),
    }))
    .filter((item) => item.text !== '');
  const top = Math.min(...items.map((item) => item.level));
  return items.map(({ index, level, text }) => ({ index, depth: level - top, text }));
}

/** The heading the reader is in: the last one at or above `line` (a viewport y). */
export function activeHeading(headings: readonly HTMLElement[], line: number): number {
  let active = -1;
  headings.forEach((heading, index) => {
    if (heading.getBoundingClientRect().top <= line) active = index;
  });
  return active;
}

/** Identifiers of an expression that name cells, in order of appearance. */
export function referencedNames(expression: string, known: (name: string) => boolean): string[] {
  const names: string[] = [];
  for (const match of expression.matchAll(/[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/g)) {
    // Prefer a known qualified label/coordinate, then its owning cell for attribute reads.
    const parts = match[0].split('.');
    const candidates = parts.map((_, index) => parts.slice(0, parts.length - index).join('.'));
    const name = candidates.find(known);
    if (name !== undefined && !names.includes(name)) names.push(name);
  }
  return names;
}
