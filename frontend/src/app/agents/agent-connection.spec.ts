import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentConnection, readAgentPairing, validateAgentEndpoint } from './agent-connection';

const pairing = { endpoint: 'http://127.0.0.1:8766', token: 'test-pairing-token-at-least-32-characters' };
const reply = (body: unknown, status = 200) => ({ ok: status === 200, status, json: async () => body }) as Response;

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); localStorage.clear(); });

describe('AgentConnection', () => {
  it('does not expose a workbook before opt-in and remembers pairing without sharing consent', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => reply({ commands: [] })); vi.stubGlobal('fetch', fetch);
    const execute = vi.fn(async () => ({}));
    const connection = new AgentConnection(() => ({ name: 'Live', kernelRunning: true }), execute);
    expect(connection.shared()).toBe(false); expect(fetch).not.toHaveBeenCalled();
    expect(readAgentPairing()).toEqual(readAgentPairing());
    connection.share(pairing);
    await vi.waitFor(() => expect(connection.status()).toBe('Connected'));
    const request = JSON.parse(String(fetch.mock.calls[0][1]!.body));
    expect(request.name).toBe('Live');
    expect((fetch.mock.calls[0][1]!.headers as Record<string, string>)['Authorization']).toBe('Bearer ' + pairing.token);
    expect(readAgentPairing()).toEqual(pairing);
    connection.stop();
    expect(connection.shared()).toBe(false);
    expect(String(fetch.mock.calls.at(-1)![0])).toContain('/bridge/unshare');
    const fresh = new AgentConnection(() => ({ name: 'Other', kernelRunning: true }), execute);
    expect(fresh.shared()).toBe(false);
  });

  it('rechecks consent for a queued command and never retries a reply', async () => {
    let finish!: () => void;
    const command = { id: 'edit-1', operation: 'edit', payload: {}, expiresAt: Date.now() + 60000 };
    const execute = vi.fn(async (_command, assertShared) => {
      await new Promise<void>(resolve => { finish = resolve; });
      assertShared();
      return { revision: 'new' };
    });
    const fetch = vi.fn(async (url: string) => reply({ commands: url.endsWith('/poll') ? [command] : [] }));
    vi.stubGlobal('fetch', fetch);
    const connection = new AgentConnection(() => ({ name: 'Live', kernelRunning: true }), execute);
    connection.share(pairing);
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
    connection.stop(); finish();
    await Promise.resolve(); await Promise.resolve();
    expect(fetch.mock.calls.filter(([url]) => url.endsWith('/reply'))).toHaveLength(0);
    expect(connection.activity()).toBeNull();
  });

  it('reports pairing refusal and revokes access on pagehide', async () => {
    const fetch = vi.fn(async () => reply({}, 401)); vi.stubGlobal('fetch', fetch);
    const connection = new AgentConnection(() => ({ name: 'Live', kernelRunning: true }), async () => ({}));
    connection.share(pairing);
    await vi.waitFor(() => expect(connection.status()).toContain('token refused'));
    window.dispatchEvent(new Event('pagehide'));
    expect(connection.shared()).toBe(false);
  });

  it('accepts network addresses while rejecting wildcard binds and credential-bearing URLs', () => {
    for (const address of ['ftp://remote.example', 'http://127.0.0.1:8766/path', 'http://user@localhost:8766', 'http://localhost:8766#token', 'http://localhost:8766?token=secret'])
      expect(() => validateAgentEndpoint(address)).toThrow();
    expect(validateAgentEndpoint('http://localhost:8766/')).toBe('http://localhost:8766');
    expect(validateAgentEndpoint('192.0.2.10')).toBe('http://192.0.2.10:8766');
    expect(validateAgentEndpoint('192.0.2.10:9876')).toBe('http://192.0.2.10:9876');
    expect(validateAgentEndpoint('https://sheets.example')).toBe('https://sheets.example');
    expect(validateAgentEndpoint('http://[::1]:8766')).toBe('http://[::1]:8766');
    expect(() => validateAgentEndpoint('0.0.0.0')).toThrow('server listen addresses');
    expect(() => validateAgentEndpoint('http://[::]:8766')).toThrow('server listen addresses');
  });
});
