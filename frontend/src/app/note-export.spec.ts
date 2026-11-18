import {
  exportFileName,
  notesToHtml,
  notesToMarkdown,
  withoutAppLinksHtml,
  withoutAppLinksMarkdown,
  type ExportedNote,
} from './note-export';

const notes: ExportedNote[] = [
  { id: 'A1', title: 'Budget', markdown: '# Budget\n\nTotal **1,200**\n', html: '<h1>Budget</h1><p>Total <strong>1,200</strong></p>' },
  { id: 'Home!B2', title: 'Home <&>', markdown: '# Home', html: '<h1>Home</h1>' },
];

describe('note export', () => {
  it('joins notes into one Markdown file', () => {
    expect(notesToMarkdown(notes)).toBe('# Budget\n\nTotal **1,200**\n\n---\n\n# Home\n');
    expect(notesToMarkdown(notes.slice(0, 1))).toBe('# Budget\n\nTotal **1,200**\n');
  });

  it('writes a standalone HTML document with one section per note', () => {
    const html = notesToHtml('Life <dashboard>', notes, new Date('2026-09-30T10:00:00Z'));
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain('<title>Life &lt;dashboard&gt;</title>');
    expect(html).toContain('<section class="note" id="A1">\n<h1>Budget</h1>');
    expect(html).toContain('<section class="note" id="Home!B2">');
    expect(html).toContain('break-before: page');
  });

  it('builds safe file names', () => {
    expect(exportFileName('🏡 Home & mortgage', 'markdown')).toBe('Home-mortgage.md');
    expect(exportFileName('///', 'html')).toBe('notes.html');
  });

  it('turns app-only links into plain text but keeps images and web links', () => {
    expect(
      withoutAppLinksMarkdown(
        '[Name: Alex](#sheet-input:owner?type=text) [see](#cell-Home!A1) [next](#note-F3) ![plot](data:image/png;base64,x) [web](https://x.y)',
      ),
    ).toBe('Name: Alex see next ![plot](data:image/png;base64,x) [web](https://x.y)');
    expect(withoutAppLinksHtml('<a href="#note-intro">Intro</a> <a href="#F1">kept</a>')).toBe(
      '<span>Intro</span> <a href="#F1">kept</a>',
    );
    expect(withoutAppLinksHtml('<a href="#sheet-input:owner?type=text">Name: <strong>Alex</strong></a>')).toBe(
      '<span>Name: <strong>Alex</strong></span>',
    );
  });
});
