import { describe, expect, it } from 'vitest';
import { buildOutline, headingElements, referencedNames } from './note-outline';

describe('note outline', () => {
  it('lists the headings of the page with relative depth', () => {
    const page = document.createElement('div');
    page.innerHTML =
      '<h2>Plan <span class="cell-value-node"><a class="live-value">2026</a></span></h2><p>text</p>' +
      '<h3>Inputs</h3><h3>  </h3><h4>Details</h4>' +
      '<span class="cell-value-node"><blockquote><h1>Embedded note</h1></blockquote></span><h2>Result</h2>';
    const headings = headingElements(page);
    expect(headings).toHaveLength(5);
    expect(buildOutline(headings)).toEqual([
      { index: 0, depth: 0, text: 'Plan 2026' },
      { index: 1, depth: 1, text: 'Inputs' },
      { index: 3, depth: 2, text: 'Details' },
      { index: 4, depth: 0, text: 'Result' },
    ]);
    expect(buildOutline([])).toEqual([]);
  });

  it('finds the cells an expression reads', () => {
    const known = (name: string) => ['revenue', 'tax_rate', 'Budget.A1', 'data', 'clock'].includes(name);
    expect(referencedNames('revenue * (1 - tax_rate) + revenue', known)).toEqual(['revenue', 'tax_rate']);
    expect(referencedNames('Budget.A1 + data.mean()', known)).toEqual(['Budget.A1', 'data']);
    expect(referencedNames('f"{clock:%H:%M}"', known)).toEqual(['clock']);
    expect(referencedNames('len(items)', known)).toEqual([]);
  });
});

it('resolves qualified labels before cell attributes with the same prefix', () => {
  const known = (name: string) => ['Snippets', 'Snippets.code_rate', 'Budget.A1', 'data'].includes(name);
  expect(referencedNames('Snippets.code_rate + Budget.A1 + data.mean()', known))
    .toEqual(['Snippets.code_rate', 'Budget.A1', 'data']);
  expect(referencedNames('Snippets.code_rate.title', known)).toEqual(['Snippets.code_rate']);
});
