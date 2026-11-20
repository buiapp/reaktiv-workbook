import { linkedAgentBridge, linkedSession, withoutAgentToken } from './embedded-session';

describe('embedded session links', () => {
  it('requires an explicit loopback endpoint and fragment token', () => {
    expect(linkedSession('', '#token=abc')).toBeNull();
    expect(linkedSession('?session=http%3A%2F%2F127.0.0.1%3A8765', '#token=abc')).toEqual({ endpoint:'http://127.0.0.1:8765', token:'abc' });
    expect(() => linkedSession('?session=https://example.org', '#token=abc')).toThrow(/local/);
    expect(() => linkedSession('?session=http://127.0.0.1:8765', '')).toThrow(/token/);
    expect(() => linkedSession('?session=http://abc:secret@127.0.0.1:8765', '#token=abc')).toThrow(/local/);
  });

  it('attaches to the server that served the page, under any address (--allow-remote, proxies)', () => {
    const origin = 'https://workbook.example.ts.net';
    expect(linkedSession('?session=%2F', '#token=abc', origin)).toEqual({ endpoint: origin, token: 'abc' });
    expect(linkedSession('?session=http%3A%2F%2F192.168.1.5%3A8800', '#token=abc', 'http://192.168.1.5:8800'))
      .toEqual({ endpoint: 'http://192.168.1.5:8800', token: 'abc' });
    // Never another network server, so a link cannot attach the hosted app to a stranger's kernel.
    expect(() => linkedSession('?session=http%3A%2F%2F192.168.1.5%3A8800', '#token=abc', origin)).toThrow(/local/);
    expect(() => linkedSession('?session=%2F%2Fevil.example', '#token=abc', origin)).toThrow(/local/);
  });
});

describe('agent bridge links (edit --mcp)', () => {
  it('reads a local bridge with its pairing token from the fragment', () => {
    expect(linkedAgentBridge('?session=x', '#token=abc')).toBeNull();
    expect(linkedAgentBridge('?mcp=http%3A%2F%2F127.0.0.1%3A8766', '#token=abc&mcpToken=pair'))
      .toEqual({ endpoint: 'http://127.0.0.1:8766', token: 'pair' });
    expect(() => linkedAgentBridge('?mcp=https%3A%2F%2Fexample.com', '#mcpToken=pair')).toThrow(/local/);
    expect(() => linkedAgentBridge('?mcp=http%3A%2F%2F127.0.0.1%3A8766', '#token=abc')).toThrow(/pairing token/);
  });

  it('uses the remembered pairing of the same bridge after the token left the address', () => {
    const remembered = { endpoint: 'http://127.0.0.1:8766', token: 'saved' };
    expect(linkedAgentBridge('?mcp=http%3A%2F%2F127.0.0.1%3A8766', '#token=abc', remembered)).toEqual(remembered);
    expect(() => linkedAgentBridge('?mcp=http%3A%2F%2F127.0.0.1%3A9000', '#token=abc', remembered)).toThrow(/pairing token/);
    expect(linkedAgentBridge('?mcp=http%3A%2F%2F127.0.0.1%3A8766', '#mcpToken=new', remembered)?.token).toBe('new');
  });

  it('removes only the pairing token from the fragment', () => {
    expect(withoutAgentToken('#token=abc&mcpToken=pair')).toBe('#token=abc');
    expect(withoutAgentToken('#mcpToken=pair')).toBe('');
    expect(withoutAgentToken('#token=abc')).toBeNull();
  });
});
