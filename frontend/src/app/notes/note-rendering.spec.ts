import { vi } from 'vitest';
import { marked } from 'marked';
import { NoteRenderer } from './note-rendering';

describe('NoteRenderer', () => {
  it('reuses rendering until its dependencies change and isolates window caches', () => {
    const parse = vi.spyOn(marked, 'parse');
    try {
      const renderer = new NoteRenderer();
      expect(renderer.render('**same**')).toContain('<strong>same</strong>');
      renderer.render('**same**');
      expect(parse).toHaveBeenCalledTimes(1);
      renderer.invalidate('math-loaded');
      renderer.render('**same**');
      expect(parse).toHaveBeenCalledTimes(2);
      expect(new NoteRenderer().diagnostics().entries).toBe(0);
      renderer.clear();
      expect(renderer.diagnostics()).toEqual({
        entries: 0,
        keyChars: 0,
        htmlChars: 0,
        activeCells: { entries: 0, sourceChars: 0, htmlChars: 0 },
      });
    } finally {
      parse.mockRestore();
    }
  });

  it('bounds retained characters as well as entry count', () => {
    const renderer = new NoteRenderer();
    for (let index = 0; index < 270; index++) renderer.render(`note ${index}`);
    expect(renderer.diagnostics().entries).toBe(256);
    renderer.render('x'.repeat(4 * 1024 * 1024 + 1));
    const report = renderer.diagnostics();
    expect(report.entries).toBe(256);
    expect(report.keyChars + report.htmlChars).toBeLessThanOrEqual(4 * 1024 * 1024);
  });

  it.each([
    { count: 40, characters: 72000 },
    { count: 270, characters: 20 },
    { count: 1, characters: 4 * 1024 * 1024 + 1 },
  ])(
    'reuses current cells beyond shared limits ($count cells, $characters characters)',
    ({ count, characters }) => {
      const parse = vi.spyOn(marked, 'parse').mockImplementation((source) => `<p>${source}</p>`);
      try {
        const renderer = new NoteRenderer();
        const sources = Array.from(
          { length: count },
          (_, index) => `Note ${index}: ${'x'.repeat(characters)}`,
        );
        const first = sources.map((source, index) => renderer.renderCell(`A${index + 1}`, source));
        expect(parse.mock.calls.length).toBe(count);
        for (let pass = 0; pass < 3; pass++) {
          sources.forEach((source, index) =>
            expect(renderer.renderCell(`A${index + 1}`, source)).toBe(first[index]),
          );
        }
        expect(parse.mock.calls.length).toBe(count);
        expect(renderer.diagnostics().activeCells.entries).toBe(count);
        expect(renderer.diagnostics().entries).toBeLessThanOrEqual(256);
        expect(
          renderer.diagnostics().keyChars + renderer.diagnostics().htmlChars,
        ).toBeLessThanOrEqual(4 * 1024 * 1024);
        renderer.renderCell('A1', 'Changed');
        expect(parse.mock.calls.length).toBe(count + 1);
      } finally {
        parse.mockRestore();
      }
    },
  );

  it('releases removed cells and clears active outputs on format or workbook changes', () => {
    const parse = vi.spyOn(marked, 'parse').mockImplementation((source) => `<p>${source}</p>`);
    try {
      const renderer = new NoteRenderer();
      renderer.renderCell('A1', 'x'.repeat(4 * 1024 * 1024 + 1));
      expect(renderer.diagnostics().entries).toBe(0);
      renderer.retainCells([]);
      expect(renderer.diagnostics().activeCells).toEqual({
        entries: 0,
        sourceChars: 0,
        htmlChars: 0,
      });
      renderer.renderCell('A2', '**note**');
      renderer.invalidate('math-loaded');
      expect(renderer.diagnostics().activeCells.entries).toBe(0);
      renderer.renderCell('A2', '**note**');
      expect(parse.mock.calls.length).toBe(3);
      renderer.invalidate('math-loaded');
      renderer.renderCell('A2', '**note**');
      expect(parse.mock.calls.length).toBe(3);
      renderer.clear();
      expect(renderer.diagnostics().activeCells.entries).toBe(0);
      expect(renderer.diagnostics().entries).toBe(0);
    } finally {
      parse.mockRestore();
    }
  });
});
