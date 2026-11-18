import { RichOutputCache } from './rich-output-cache';
import type { PerformanceDiagnostics } from '../performance-diagnostics';
import type { CellDefinition, RuntimeRequest, RuntimeResponse } from '../sheet.types';

export type WorkerPayload = Omit<RuntimeRequest, 'id' | 'type' | 'cells' | 'diagnostics'>;
type WorkerResult = RuntimeResponse['result'];
interface PendingRequest {
  resolve(value: WorkerResult): void;
  reject(error: Error): void;
  releaseOutputs(): void;
  type: RuntimeRequest['type'];
  finish(extra?: Record<string, number>): void;
}

export interface WorkerChannelEvents {
  event(response: RuntimeResponse): void;
  result(response: RuntimeResponse): void;
  refused(type: RuntimeRequest['type'], error: Error): void;
  failed(error: Error): void;
}

/** Own request correlation and worker lifetime; never mutate workbook/UI state. */
export class WorkerRequestChannel {
  private readonly outputs = new RichOutputCache();
  private worker: Worker | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();

  constructor(
    private readonly diagnostics: PerformanceDiagnostics,
    private readonly events: WorkerChannelEvents,
  ) {}

  get active(): boolean {
    return this.worker !== null;
  }
  get pendingCount(): number {
    return this.pending.size;
  }

  start(): void {
    this.terminate();
    if (typeof Worker === 'undefined') return;
    const worker = new Worker(new URL('runtime.worker.js?v=20261009-debug', document.baseURI), {
      type: 'module',
    });
    this.worker = worker;
    worker.onmessage = ({ data }: MessageEvent<RuntimeResponse>) => {
      if (this.worker === worker) this.receive(data);
    };
    worker.onerror = (event: ErrorEvent) => {
      if (this.worker !== worker) return;
      console.error('Python runtime worker error:', event);
      const detail =
        event.message || (event.error instanceof Error ? event.error.message : undefined);
      this.fail(new Error(detail || 'The Python worker stopped unexpectedly.'));
    };
    worker.onmessageerror = () => {
      if (this.worker === worker)
        this.fail(new Error('Could not read the Python worker response.'));
    };
  }

  terminate(): void {
    this.worker?.terminate();
    this.worker = null;
    this.rejectPending(new Error('Python worker closed.'));
    this.outputs.clear();
  }

  request(
    type: RuntimeRequest['type'],
    cells?: CellDefinition[],
    payload: WorkerPayload = {},
  ): Promise<WorkerResult> {
    const worker = this.worker;
    if (!worker) return Promise.reject(new Error('Python worker unavailable.'));
    const id = this.nextId++;
    const outputLease = this.outputs.lease();
    const request: RuntimeRequest = {
      id,
      type,
      cells,
      ...payload,
      diagnostics: this.diagnostics.enabled(),
      knownOutputs: outputLease.keys,
    };
    const finish = this.diagnostics.begin(`worker.${type}`, {
      cells: cells?.length ?? 0,
      pending: this.pending.size,
    });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, type, finish, releaseOutputs: outputLease.release });
      try {
        worker.postMessage(request);
      } catch (error) {
        this.pending.delete(id);
        outputLease.release();
        finish({ failed: 1 });
        reject(error);
      }
    });
  }

  rejectPending(error: Error): void {
    for (const request of this.pending.values()) {
      request.releaseOutputs();
      request.finish({ failed: 1 });
      request.reject(error);
    }
    this.pending.clear();
  }

  private receive(response: RuntimeResponse): void {
    try {
      if (response.snapshot) response = {...response, snapshot: this.outputs.decode(response.snapshot)};
      if (response.result) response = {...response, result: this.outputs.decode(response.result)};
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    if (!['result', 'error'].includes(response.type)) {
      this.events.event(response);
      return;
    }
    if (response.id === undefined) return;
    const request = this.pending.get(response.id);
    if (!request) return;
    this.pending.delete(response.id);
    request.releaseOutputs();
    request.finish(response.timings);
    if (response.type === 'error') {
      const error = new Error(response.message ?? 'Unknown Python runtime error.');
      this.events.refused(request.type, error);
      request.reject(error);
    } else {
      this.events.result(response);
      request.resolve(response.result);
    }
  }

  private fail(error: Error): void {
    this.rejectPending(error);
    this.events.failed(error);
  }
}
