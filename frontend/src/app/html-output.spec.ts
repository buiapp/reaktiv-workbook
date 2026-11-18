import { describe, expect, it } from 'vitest';
import { decodeHtmlOutput, registerHtmlOutput, sanitizeHtmlOutput } from './html-output';

const encode = (text: string): string => btoa(String.fromCharCode(...new TextEncoder().encode(text)));

describe('HTML output', () => {
  it('removes everything executable but keeps styles, inline styles, and SVG', () => {
    const clean = sanitizeHtmlOutput(
      '<style>.card{color:red}</style><div class="card" style="padding:4px" onclick="alert(1)">Hi</div>' +
        '<script>alert(1)</script><iframe src="https://example.com"></iframe>' +
        '<form action="https://example.com"><input name="x"></form><a href="javascript:alert(1)" target="_blank">x</a>' +
        '<svg viewBox="0 0 10 10"><circle r="4"></circle></svg>',
    );
    expect(clean).toContain('<style>.card{color:red}</style>');
    expect(clean).toContain('<div class="card" style="padding:4px">Hi</div>');
    expect(clean).toContain('<circle r="4"></circle>');
    expect(clean).not.toMatch(/script|onclick|iframe|<form|javascript:|target=/);
  });

  it('decodes UTF-8 and renders into a shadow root, not the page', () => {
    expect(decodeHtmlOutput(encode('Größe ✓'))).toBe('Größe ✓');
    registerHtmlOutput();
    const element = document.createElement('reaktiv-html');
    element.setAttribute('data-spec', encode('<style>p{color:red}</style><p>Hello</p><script>window.hacked=1</script>'));
    document.body.append(element);
    expect(element.innerHTML).toBe('');
    expect(element.shadowRoot?.querySelector('p')?.textContent).toBe('Hello');
    expect(element.shadowRoot?.querySelector('script')).toBeNull();
    element.setAttribute('data-spec', encode('<b>Updated</b>'));
    expect(element.shadowRoot?.querySelector('b')?.textContent).toBe('Updated');
    element.remove();
  });
});
