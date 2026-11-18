import { RichOutputCache } from './rich-output-cache';
import type { PerformanceDiagnostics } from '../performance-diagnostics';
import type { CellProgress, GraphResult, LogEntry } from '../sheet.types';

export interface KernelConnection {
  url: string;
  token: string | null;
  sessionRevision?: number;
}

/** A refused request leaves the Python process available. */
export class RequestTooLargeError extends Error {}

/** A valid connection can refuse an invalid edit without becoming unavailable. */
export class KernelRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

const RUNS_CELLS = new Set([
  '/v1/move-workbook',
  '/v1/apply',
  '/v1/tick-timer',
  '/v1/run-effect',
  '/v1/run-action',
  '/v1/set-inputs',
  '/v1/session-reset-input',
  '/v1/update-action',
  '/v1/widget-update',
  '/v1/widget-message',
]);
const PROGRESS_POLL_MS = 200;
/** The last progress read after a request ends must not hold up its result for long. */
const FINAL_PROGRESS_MS = 2000;

/**
 * JSON/progress transport for both local and remote Python. It does not own UI
 * status, workbook state, retries, or kernel lifecycle. Connections are captured
 * at the start of an operation so its progress uses the same endpoint and token.
 */
export class HttpKernelTransport {
  private generation = 0;
  private readonly outputs = new RichOutputCache();

  constructor(
    private readonly connection: () => KernelConnection,
    private readonly diagnostics: PerformanceDiagnostics,
    private readonly progress: (event: CellProgress) => void,
    private readonly log: (entry: LogEntry) => void,
    private readonly snapshot: (graph: GraphResult) => void = () => {},
  ) {}

  invalidate(): void {
    this.generation++;
    this.outputs.clear();
  }

  async sideRequest<T>(
    path: string,
    payload: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T> {
    const connection = this.connection();
    const generation = this.generation;
    const lease = this.outputs.lease();
    try {
      const response = await this.fetch(connection, path, this.withOutputs(payload, lease.keys), signal);
      const value = (await response.json()) as T & { error?: string };
      if (!response.ok)
        throw new Error(value?.error ?? `Python request ${path} failed (${response.status}).`);
      return generation === this.generation ? this.outputs.decode(value) : value;
    } finally { lease.release(); }
  }

  async request<T>(
    path: string,
    payload: Record<string, unknown>,
    pollProgress = true,
  ): Promise<T> {
    const connection = this.connection();
    const generation = this.generation;
    const start =
      pollProgress && RUNS_CELLS.has(path) ? await this.progressSince(connection, null) : null;
    if (generation !== this.generation)
      throw new Error('Python kernel changed before the request started.');
    if (start === null) return this.call<T>(connection, path, payload);
    let cursor = start.seq;
    let done = false;
    const poll = async () => {
      while (!done && generation === this.generation) {
        await new Promise((resolve) => setTimeout(resolve, PROGRESS_POLL_MS));
        if (done || generation !== this.generation) return;
        const next = await this.progressSince(connection, cursor);
        if (next === null || done || generation !== this.generation) return;
        cursor = next.seq;
        for (const event of next.events) this.progress(event);
        for (const entry of next.logs) this.log(entry);
        if (next.snapshot) this.snapshot(next.snapshot);
      }
    };
    try {
      const result = this.call<T>(connection, path, payload);
      void poll();
      return await result;
    } finally {
      done = true;
      // Cells that ended (and output printed) after the last poll: without them a cell
      // stays marked running. A poll still in flight is ignored; this reads from the last
      // delivered position instead. The response's graph replaces any later snapshot.
      if (generation === this.generation) {
        const rest = await this.progressSince(connection, cursor, AbortSignal.timeout(FINAL_PROGRESS_MS));
        if (rest !== null && generation === this.generation) {
          for (const event of rest.events) this.progress(event);
          for (const entry of rest.logs) this.log(entry);
        }
      }
    }
  }

  private withOutputs(payload: Record<string, unknown>, keys: string[]): Record<string, unknown> {
    return this.outputs.supported ? {...payload, knownOutputs: keys} : payload;
  }

  private fetch(
    connection: KernelConnection,
    path: string,
    payload: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Response> {
    return fetch(`${connection.url}${path}`, {
      method: 'POST',
      signal,
      headers: this.headers(connection),
      body: JSON.stringify(payload),
    });
  }

  private headers(connection: KernelConnection): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      ...(connection.token ? { Authorization: `Bearer ${connection.token}` } : {}),
    };
  }

  private async progressSince(
    connection: KernelConnection,
    after: number | null,
    signal?: AbortSignal,
  ): Promise<{
    seq: number;
    events: CellProgress[];
    logs: LogEntry[];
    snapshot: GraphResult | null;
  } | null> {
    const generation = this.generation;
    const lease = this.outputs.lease();
    try {
      const response = await this.fetch(
        connection,
        '/v1/progress',
        this.withOutputs(after === null ? {} : { after }, lease.keys),
        signal,
      );
      if (!response.ok) return null;
      const raw = await response.json();
      const value = (generation === this.generation ? this.outputs.decode(raw) : raw) as { seq?: unknown; events?: unknown; logs?: unknown; snapshot?: GraphResult };
      if (typeof value.seq !== 'number' || !Array.isArray(value.events)) return null;
      return {
        seq: value.seq,
        events: value.events as CellProgress[],
        logs: Array.isArray(value.logs) ? (value.logs as LogEntry[]) : [],
        snapshot: value.snapshot ?? null,
      };
    } catch {
      return null;
    } finally { lease.release(); }
  }

  private async call<T>(
    connection: KernelConnection,
    path: string,
    payload: Record<string, unknown>,
  ): Promise<T> {
    const generation = this.generation;
    const lease = this.outputs.lease();
    payload = this.withOutputs(payload, lease.keys);
    const finish = this.diagnostics.begin(`http.${path.replace('/v1/', '')}`);
    try {
      const encoded = this.diagnostics.begin('http.encode');
      const body = JSON.stringify(
        connection.sessionRevision === undefined
          ? payload
          : { ...payload, sessionRevision: connection.sessionRevision },
      );
      encoded({ requestChars: body.length });
      const transferred = this.diagnostics.begin('http.wait-and-read');
      const response = await fetch(`${connection.url}${path}`, {
        method: 'POST',
        headers: this.headers(connection),
        body,
      });
      if (response.status === 413) {
        const value: unknown = await response.json().catch(() => null);
        transferred();
        const detail = value && typeof value === 'object' && 'error' in value ? value.error : null;
        throw new RequestTooLargeError(
          typeof detail === 'string'
            ? detail
            : 'Workbook request exceeds the server size limit. Update the Python kernel or increase its request limit.',
        );
      }
      let result: T & { error?: string };
      if (this.diagnostics.enabled()) {
        const text = await response.text();
        transferred({ responseChars: text.length });
        const parsed = this.diagnostics.begin('http.parse');
        result = JSON.parse(text) as T & { error?: string };
        parsed();
      } else result = (await response.json()) as T & { error?: string };
      if (!response.ok)
        throw new KernelRequestError(result?.error ?? `Remote Python request failed (${response.status}).`, response.status);
      return generation === this.generation ? this.outputs.decode(result) : result;
    } finally {
      lease.release();
      finish();
    }
  }
}
