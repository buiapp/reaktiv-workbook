import { parser } from '@lezer/python';
import { cellReferenceRanges, editorResultText } from './editor-intelligence';
import { pythonCompletionSource } from './python-editor.component';
import { CompletionContext } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';

const cells = [
  {label: 'price', cellId: 'A1'}, {label: 'count', cellId: 'A2'},
  {label: 'Other.price', cellId: 'Other!A1'},
  {label: 'Other.A1', cellId: 'Other!A1'},
  {label: 'Other', type: 'namespace' as const},
];
const references = (source: string) => cellReferenceRanges(parser.parse(source), source, cells).map(range => ({text: source.slice(range.from, range.to), id: range.cell.cellId}));

describe('editor dependency references', () => {
  it('marks sheet-scoped reads and object bases, excluding prose and named parameters', () => {
    expect(references('price + Other.price + count.real\nf(price=1)\n"price" # count')).toEqual([
      {text: 'price', id: 'A1'}, {text: 'Other.price', id: 'Other!A1'}, {text: 'count', id: 'A2'},
    ]);
  });
  it('respects local assignments, imports, functions, arguments and comprehensions', () => {
    for (const source of ['price = 3\nprice + count', 'def f(price):\n return price + count', 'import price\nprice + count', '[price for price in count]', 'price += count', 'def price():\n return count', 'x = price = 4\nprice + count', '(price := 4)\nprice + count', 'price: float = 4\nprice + count', 'with count as price:\n print(price)', 'lambda price: price + count']) {
      expect(references(source)).toEqual([{text: 'count', id: 'A2'}]);
    }
  });
  it('keeps references visible while code is unfinished and uses UTF-16 offsets', () => {
    const source = '"😀"; price + (';
    const ranges = cellReferenceRanges(parser.parse(source), source, cells);
    expect(ranges[0].from).toBe(source.indexOf('price'));
    expect(references(source)).toEqual([{text: 'price', id: 'A1'}]);
  });
  it('completes a sheet member without inserting the sheet name twice', () => {
    const source = 'Other.pr';
    const result = pythonCompletionSource(new CompletionContext(EditorState.create({doc: source}), source.length, true), cells);
    expect(result?.from).toBe(6);
    expect(result?.options.map(item => item.label)).toEqual(['price', 'A1']);
  });
  it('reads Pyright hover, signature and completion documentation as text', () => {
    expect(editorResultText({contents: {value: 'price: int'}})).toBe('price: int');
    expect(editorResultText({signatures: [{label: '(x: int) -> str'}]})).toBe('(x: int) -> str');
    expect(editorResultText({detail: 'upper() -> str', documentation: {value: 'Uppercase'}})).toBe('upper() -> str\nUppercase');
  });
});
