import { htmlToMarkdown, markdownImageSizes, markdownToHtml, outputQuery, parseOutputQuery } from './markdown-conversion';
import { PROSEKIT_BLOCK_COMMANDS } from './prosekit-block-editor.component';

describe('Markdown authoring conversion', () => {
  it('round-trips GFM structures used by the ProseKit editor', () => {
    const markdown = [
      '## Summary',
      '',
      '- [ ] Review {{ revenue }}',
      '',
      '| Metric | Value |',
      '| --- | --- |',
      '| Revenue | 42 |',
      '',
      '```python',
      'print("ok")',
      '```',
    ].join('\n');

    const roundTripped = htmlToMarkdown(markdownToHtml(markdown));

    expect(roundTripped).toContain('## Summary');
    expect(roundTripped).toMatch(/[-*] \[ \] Review \{\{ revenue \}\}/);
    expect(roundTripped).toContain('| Metric');
    expect(roundTripped).toContain('```python');
  });

  it('offers every requested slash-menu block plus cell completion', () => {
    expect(PROSEKIT_BLOCK_COMMANDS.map((command) => command.id)).toEqual([
      'text',
      'heading-1',
      'heading-2',
      'heading-3',
      'bulleted-list',
      'numbered-list',
      'checklist',
      'divider',
      'quote',
      'table',
      'image',
      'link',
      'code',
      'math',
      'diagram',
      'cell',
      'widget',
    ]);
  });

  it('round-trips LaTeX math and keeps prices and code literal', () => {
    const markdown =
      'Inline $Z = R + jX$ and $|Z| = {{ z }}\\,\\Omega$.\n\n$$\nS_{sc} = \\frac{V^2}{|Z|}\n$$\n\nPrices $1.2M and $4.0M, code `$x$`.';
    const html = markdownToHtml(markdown);
    expect(html).toContain('<span data-math="Z = R + jX"></span>');
    expect(html).toContain('<span data-math="|Z| = {{ z }}\\,\\Omega"></span>');
    expect(html).toContain('<div data-math-block="S_{sc} = \\frac{V^2}{|Z|}"></div>');
    expect(html).toContain('Prices $1.2M and $4.0M');
    expect(html).toContain('<code>$x$</code>');
    expect(htmlToMarkdown(html)).toBe(markdown);
  });

  it('preserves interactive input links as Markdown', () => {
    const widget =
      '[Region: {{ region }}](#sheet-input:region?type=select&options=All,North,South)';

    expect(htmlToMarkdown(markdownToHtml(widget))).toContain(widget);
  });

  it('preserves self-contained base64 images', () => {
    const image = '![chart](data:image/png;base64,iVBORw0KGgo=)';

    expect(htmlToMarkdown(markdownToHtml(image))).toContain(image);
  });

  it('preserves resized image dimensions as portable Markdown metadata', () => {
    const markdown = htmlToMarkdown(
      '<img src="https://example.com/chart.png" width="480" height="270">',
    );

    expect(markdown).toContain('"reaktiv-size:480x270"');
    expect(markdownImageSizes(markdown)).toEqual([{ width: 480, height: 270 }]);
  });

  it('round-trips Mermaid diagrams as diagram nodes, with live values in their source', () => {
    const markdown = '# Flow\n\n```mermaid\nflowchart LR\n  A[{{ start }}] --> B\n```\n\nAfter.';
    const html = markdownToHtml(markdown);
    expect(html).toContain('<div data-mermaid="flowchart LR\n  A[{{ start }}] --&gt; B"></div>');
    expect(html).not.toContain('<pre');
    expect(htmlToMarkdown(html)).toBe(markdown);
  });
});

describe('wide and full-width blocks', () => {
  it('keeps a value\'s layout (and size) through the editor', () => {
    const wide = '[{{ board }}](#sheet-output?layout=wide)';
    const html = markdownToHtml(wide);
    expect(html).toContain('data-layout="wide"');
    expect(htmlToMarkdown(html).trim()).toBe(wide);
    const sized = '[{{ chart }}](#sheet-output?width=480&height=320&layout=full)';
    expect(htmlToMarkdown(markdownToHtml(sized)).trim()).toBe(sized);
    expect(htmlToMarkdown(markdownToHtml('[{{ chart }}](#sheet-output?width=480&height=320)')).trim()).toBe(
      '[{{ chart }}](#sheet-output?width=480&height=320)',
    );
  });

  it('reads and writes the query and image titles', () => {
    expect(parseOutputQuery('width=4&height=3&layout=full')).toEqual({ width: '4', height: '3', layout: 'full' });
    expect(parseOutputQuery('layout=huge')).toEqual({});
    expect(outputQuery(null, null, 'wide')).toBe('layout=wide');
    expect(outputQuery(4, 3, null)).toBe('width=4&height=3');
    expect(markdownImageSizes('![a](x.png "reaktiv-size:400x300 reaktiv-layout:wide")\n\n![b](y.png "reaktiv-layout:full")')).toEqual([
      { width: 400, height: 300, layout: 'wide' },
      { layout: 'full' },
    ]);
    expect(htmlToMarkdown('<p><img src="x.png" data-layout="full"></p>').trim()).toBe('![](x.png "reaktiv-layout:full")');
  });
});


describe('note images while editing', () => {
  it('keeps the blob: and asset: URLs images are shown with through both conversions', () => {
    for (const url of [
      'blob:http://localhost:4311/22606f90-57b5-44d1-9fe8-c3ac9f36c803',
      'asset://localhost/%2FUsers%2Fme%2Fnotes%2Fassets%2F0123456789abcdef.webp',
      'assets/0123456789abcdef.webp',
    ]) {
      const html = markdownToHtml(`![Plan](${url})\n\nText`);
      expect(html).toContain(`src="${url}"`);
      expect(htmlToMarkdown(html)).toContain(`![Plan](${url})`);
    }
  });
});

it.each(['Budget.rate', 'Budget.A1'])('round-trips qualified widgets and output layouts: %s', reference => {
  const widget = `[Rate](#sheet-input:${reference})`;
  const output = `[{{ ${reference} }}](#sheet-output?layout=wide)`;
  const html = markdownToHtml(widget + '\n\n' + output);
  expect(html).toContain(`data-sheet-widget="${reference}"`);
  expect(html).toContain('data-layout="wide"');
  const saved = htmlToMarkdown(html);
  expect(saved).toContain(widget);
  expect(saved).toContain(output);
});
