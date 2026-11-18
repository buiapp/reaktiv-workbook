import { marked } from 'marked';
import { findMath, loadMath, renderMath, withMathOutput } from './markdown-math';

describe('LaTeX math in Markdown', () => {
  beforeAll(() => loadMath());

  it('finds inline and display math with pandoc rules', () => {
    expect(findMath('a $x_1$ b $$y$$').map((match) => [match.latex, match.display])).toEqual([
      ['x_1', false],
      ['y', true],
    ]);
    expect(findMath('costs $1.2M and $4.0M')).toEqual([]);
    expect(findMath('a $ b $ c')).toEqual([]);
    expect(findMath('\\$5 and $x$').map((match) => match.latex)).toEqual(['x']);
  });

  it('renders math through marked, MathML only for exports', () => {
    const html = marked.parse('Ohm: $V = Z \\cdot I$\n\n$$\nS = \\frac{V^2}{Z}\n$$', { async: false });
    expect(html).toContain('class="katex"');
    expect(html).toContain('<div class="math-block">');
    const exported = withMathOutput('mathml', () => renderMath('x^2', false));
    expect(exported).toContain('<math');
    expect(exported).not.toContain('katex-html');
  });

  it('keeps thousands separators from live values tight', () => {
    expect(renderMath('102,500', false)).toBe(renderMath('102{,}500', false));
  });

  it('shows errors in place instead of throwing', () => {
    expect(renderMath('\\frac{', false)).toContain('katex-error');
  });
});
