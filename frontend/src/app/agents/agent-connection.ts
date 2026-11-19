import { signal } from '@angular/core';
import type { AgentCommand } from './live-agent-workbook';
import type { AgentViewContext } from './agent-context';

export interface AgentPairing { endpoint: string; token: string; }
const PAIRING_KEY = 'reaktiv-workbook:agent-pairing';

/** The pairing remembered on this origin, if any. */
export function storedAgentPairing(): AgentPairing | null {
  try {
    const value: AgentPairing = JSON.parse(localStorage.getItem(PAIRING_KEY) ?? 'null');
    if (value && typeof value.token === 'string' && value.token.length >= 32) {
      validateAgentEndpoint(value.endpoint);
      return value;
    }
  } catch { /* A device without storage can still pair for the current window. */ }
  return null;
}

export function readAgentPairing(): AgentPairing {
  const stored = storedAgentPairing();
  if (stored) return stored;
  const pairing = { endpoint: 'http://127.0.0.1:8766', token: crypto.randomUUID() + crypto.randomUUID() };
  rememberAgentPairing(pairing);
  return pairing;
}

export function rememberAgentPairing(pairing: AgentPairing): void {
  try { localStorage.setItem(PAIRING_KEY, JSON.stringify(pairing)); } catch { /* Window-only pairing. */ }
}

export function validateAgentEndpoint(value: string): string {
  const text = value.trim();
  let url: URL;
  try {
    const qualified = /^[a-z][a-z\d+.-]*:\/\//i.test(text);
    url = new URL(qualified ? text : 'http://' + text);
    if (!qualified && !url.port) url.port = '8766';
  } catch { throw new Error('Use an HTTP(S) bridge address, such as http://192.0.2.10:8766.'); }
  if (['0.0.0.0', '[::]'].includes(url.hostname))
    throw new Error('0.0.0.0 and :: are server listen addresses. Start the server with --host 0.0.0.0, then connect using its actual IP address or hostname.');
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname ||
      url.username || url.password || url.search || url.hash || url.pathname !== '/')
    throw new Error('Use an HTTP(S) bridge address without credentials, a path, query or fragment.');
  return url.origin;
}

/** HTTP is only a rendezvous: all workbook commands run through the window's queue. */
export class AgentConnection {
  readonly shared = signal(false);
  readonly status = signal('Not shared');
  readonly activity = signal<string | null>(null);
  readonly lastActivity = signal<string | null>(null);
  private binding: { id: string; pairing: AgentPairing; abort: AbortController } | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly onPageHide = () => this.stop();

  constructor(private readonly summary: () => { name: string; kernelRunning: boolean; context?: AgentViewContext },
    private readonly execute: (command: AgentCommand, assertShared: () => void) => Promise<Record<string, unknown>>) {}

  share(pairing: AgentPairing): void {
    if (pairing.token.length < 32) throw new Error('Pairing token must have at least 32 characters.');
    const endpoint = validateAgentEndpoint(pairing.endpoint);
    this.stop();
    pairing = { ...pairing, endpoint };
    rememberAgentPairing(pairing);
    const binding = { id: crypto.randomUUID(), pairing, abort: new AbortController() };
    this.binding = binding;
    window.addEventListener('pagehide', this.onPageHide);
    this.shared.set(true);
    this.status.set('Waiting for MCP client');
    this.lastActivity.set(null);
    void this.poll(binding);
  }

  stop(): void {
    window.removeEventListener('pagehide', this.onPageHide);
    const binding = this.binding;
    this.binding = null;
    binding?.abort.abort();
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.shared.set(false);
    this.status.set('Not shared');
    this.activity.set(null);
    if (binding) void this.post(binding, '/bridge/unshare', { workbook: binding.id }, true).catch(() => undefined);
  }

  private async post(binding: NonNullable<AgentConnection['binding']>, path: string, body: unknown, release = false): Promise<unknown> {
    const response = await fetch(binding.pairing.endpoint + path, {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + binding.pairing.token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), cache: 'no-store', credentials: 'omit',
      signal: release ? AbortSignal.timeout(2000) : AbortSignal.any([binding.abort.signal, AbortSignal.timeout(5000)]),
      keepalive: release,
    });
    if (!response.ok) throw new Error(response.status === 401 ? 'Pairing token refused — check the MCP configuration' : `MCP bridge refused the connection (${response.status})`);
    return response.json();
  }

  private async poll(binding: NonNullable<AgentConnection['binding']>): Promise<void> {
    try {
      const reply = await this.post(binding, '/bridge/poll', { id: binding.id, ...this.summary() });
      if (this.binding !== binding) return;
      if (!reply || typeof reply !== 'object' || !Array.isArray((reply as { commands?: unknown }).commands))
        throw new Error('Invalid MCP bridge response');
      this.status.set('Connected');
      for (const command of (reply as { commands: unknown[] }).commands) {
        if (isCommand(command)) void this.handle(binding, command);
      }
    } catch (error) {
      if (this.binding !== binding) return;
      this.status.set(error instanceof Error && error.message.includes('token') ? error.message : 'Disconnected — check MCP client and local network access');
    }
    if (this.binding === binding) this.timer = setTimeout(() => void this.poll(binding), 1000);
  }

  private async handle(binding: NonNullable<AgentConnection['binding']>, command: AgentCommand): Promise<void> {
    const assertShared = () => {
      if (this.binding !== binding) throw new Error('Workbook sharing was revoked.');
    };
    const label = (['edit', 'action-edit', 'colors', 'resize', 'tracks', 'move', 'label', 'grid-lines', 'worksheets', 'environment', 'asset'].includes(command.operation) && !(command.operation === 'environment' && command.payload['read'] === true)) ? 'Agent editing workbook' : command.operation === 'save' ? 'Agent saving workbook' : ['kernel-control', 'action-run', 'action-cancel'].includes(command.operation) ? 'Agent running command' : 'Agent reading workbook';
    this.activity.set(label);
    let result: Record<string, unknown> | undefined, error: string | undefined;
    try {
      result = await this.execute(command, assertShared);
      assertShared();
      this.lastActivity.set(command.operation === 'asset' ? 'Agent uploaded an image asset' : (['edit', 'action-edit', 'colors', 'resize', 'tracks', 'move', 'label', 'grid-lines', 'worksheets', 'environment', 'asset'].includes(command.operation) && !(command.operation === 'environment' && command.payload['read'] === true)) ? 'Agent changes applied · Undo is available' : command.operation === 'save' ? 'Agent saved workbook' : ['kernel-control', 'action-run', 'action-cancel'].includes(command.operation) ? 'Agent command completed' : 'Agent read workbook');
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
      if (this.binding === binding) this.lastActivity.set(error);
    } finally {
      if (this.binding === binding) this.activity.set(null);
    }
    // Replies are never retried: a timeout requires an explicit read/reconcile by the agent.
    if (this.binding === binding) await this.post(binding, '/bridge/reply', { workbook: binding.id, id: command.id, result, error }).catch(() => undefined);
  }
}

function isCommand(value: unknown): value is AgentCommand {
  if (!value || typeof value !== 'object') return false;
  const command = value as Partial<AgentCommand>;
  return typeof command.id === 'string' && ['read', 'context', 'edit', 'save', 'overview', 'inspect', 'dependencies', 'logs', 'diagnostics', 'kernel-status', 'kernel-control', 'actions', 'action-edit', 'action-run', 'action-cancel', 'colors', 'resize', 'tracks', 'move', 'label', 'grid-lines', 'worksheets', 'environment', 'asset', 'visual'].includes(command.operation ?? '') &&
    !!command.payload && typeof command.payload === 'object' && !Array.isArray(command.payload) &&
    typeof command.expiresAt === 'number' && Number.isFinite(command.expiresAt);
}
