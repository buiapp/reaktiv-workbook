import { afterEach, describe, expect, it, vi } from 'vitest';
import { externalUrl, installExternalLinkHandler } from './external-links';

describe('externalUrl', () => {
  it('recognises web, mail and phone links and leaves in-app links alone', () => {
    const base = 'http://localhost:4200/';
    expect(externalUrl('https://example.com/a?b=1', base)).toBe('https://example.com/a?b=1');
    expect(externalUrl('mailto:someone@example.com', base)).toBe('mailto:someone@example.com');
    expect(externalUrl('#cell-A1', base)).toBeNull();
    expect(externalUrl('#sheet-input:rate?type=range', base)).toBeNull();
    expect(externalUrl('/examples/model.sheet.py', base)).toBeNull();
    expect(externalUrl('blob:http://localhost:4200/123', base)).toBeNull();
    expect(externalUrl('javascript:alert(1)', base)).toBeNull();
    expect(externalUrl('file:///etc/passwd', base)).toBeNull();
    expect(externalUrl(null, base)).toBeNull();
  });
});

describe('installExternalLinkHandler', () => {
  let remove: (() => void) | undefined;
  afterEach(() => {
    remove?.();
    document.body.innerHTML = '';
  });

  it('opens external links outside the app window and ignores the rest', () => {
    const open = vi.fn(() => Promise.resolve());
    remove = installExternalLinkHandler(undefined, open);
    document.body.innerHTML =
      '<a id="web" href="https://example.com/"><b>site</b></a><a id="cell" href="#cell-A1">A1</a>' +
      '<a id="file" href="blob:x" download="a.csv">file</a>';
    const click = (selector: string) => {
      const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
      document.querySelector(selector)!.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(click('#web b')).toBe(true);
    expect(open).toHaveBeenCalledWith('https://example.com/');
    expect(click('#cell')).toBe(false);
    expect(click('#file')).toBe(false);
    expect(open).toHaveBeenCalledTimes(1);
  });
});
