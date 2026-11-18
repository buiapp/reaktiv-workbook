import { marked } from 'marked';
import { MERMAID_FENCE } from './markdown-mermaid';

describe('Mermaid in Markdown', () => {
  it('finds mermaid fences only', () => {
    const text = '```mermaid\nflowchart LR\n  A --> B\n```\n\n```python\nx = 1\n```';
    expect([...text.matchAll(MERMAID_FENCE)].map((match) => match[3])).toEqual(['flowchart LR\n  A --> B']);
  });

  it('shows the source while the diagram renders, other code unchanged', () => {
    const html = marked.parse('```mermaid\ngraph TD\n  A --> B\n```\n\n```python\nx = 1\n```', { async: false });
    expect(html).toContain('class="mermaid-pending"');
    expect(html).toContain('graph TD');
    expect(html).toContain('language-python');
  });
});
