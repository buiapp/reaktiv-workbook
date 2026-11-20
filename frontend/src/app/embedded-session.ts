import type { GraphResult, SheetDocument } from './sheet.types';

export interface SessionEnvironment {
  /** Running in a uv sandbox built from the workbook's packages. */
  sandboxed: boolean;
  /** `reaktiv-workbook edit` can restart this Python (in a sandbox; needs uv). */
  restart: boolean;
  /** Declared packages that are not installed in this Python. */
  missing: string[];
}

export interface EmbeddedSessionState {
  mode?: 'embedded' | 'edit' | 'run';
  /** The workbook file the CLI session owns (absolute path on its machine). */
  path?: string;
  assets?: Record<string, string>;
  /** CLI sessions: the session's Python, and whether the CLI can restart it with the workbook's packages. */
  environment?: SessionEnvironment;
  revision: number;
  document: SheetDocument;
  graph: GraphResult;
}

/**
 * Explicit attachment to a local session, or to the session that served this page (`session=/`,
 * which keeps working through tunnels and proxies). The bearer token stays in the fragment.
 */
export function linkedSession(search: string, hash: string, origin = globalThis.location?.origin ?? ''):
    { endpoint: string; token: string } | null {
  const requested = new URLSearchParams(search).get('session');
  if (requested === null) return null;
  const url = new URL(requested, origin.startsWith('http') ? origin : undefined);
  const local = url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  const ownOrigin = ['http:', 'https:'].includes(url.protocol) && url.origin === origin;
  if (!(local || ownOrigin) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Embedded sessions must use a local HTTP kernel URL or the page’s own server.');
  }
  const token = new URLSearchParams(hash.replace(/^#/, '')).get('token');
  if (!token) throw new Error('The embedded session link is missing its access token.');
  return { endpoint: url.origin, token };
}

/**
 * The agent (MCP) bridge started by `reaktiv-workbook edit --mcp`: share this workbook with it.
 * Like the session, it must be local; the pairing token comes in the fragment. The token is
 * long-lived, so the page removes it from the address (`withoutAgentToken`); after a reload the
 * pairing remembered for the same bridge is used instead.
 */
export function linkedAgentBridge(search: string, hash: string,
                                  remembered: { endpoint: string; token: string } | null = null): { endpoint: string; token: string } | null {
  const requested = new URLSearchParams(search).get('mcp');
  if (requested === null) return null;
  const url = new URL(requested);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('The agent bridge must be a local HTTP URL.');
  }
  const token = new URLSearchParams(hash.replace(/^#/, '')).get('mcpToken')
    ?? (remembered?.endpoint === url.origin ? remembered.token : null);
  if (!token) throw new Error('The agent bridge link is missing its pairing token.');
  return { endpoint: url.origin, token };
}

/** The fragment without the agent pairing token (null when there is none to remove). */
export function withoutAgentToken(hash: string): string | null {
  const parameters = new URLSearchParams(hash.replace(/^#/, ''));
  if (!parameters.has('mcpToken')) return null;
  parameters.delete('mcpToken');
  const rest = parameters.toString();
  return rest ? '#' + rest : '';
}
