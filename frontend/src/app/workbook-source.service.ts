import { Injectable, OnDestroy } from '@angular/core';
import type { SheetDocument } from './sheet.types';

export interface WorkbookSource {
  source: string;
  problems: string[];
}

/** Python owns the file format; this service only transports editable document data. */
@Injectable({ providedIn: 'root' })
export class WorkbookSourceService implements OnDestroy {
  private worker: Worker | null = null;
  private nextId = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly requestTimeoutMs = 120000;
  private readonly idleMs = 30000;
  private readonly largeHeapBytes = 256 * 1024 * 1024;
  private readonly largeSourceChars = 4 * 1024 * 1024;
  private wasmHeapBytes: number | null = null;
  memoryDiagnostics(): object {
    return {
      active: this.worker !== null,
      pendingRequests: this.pending.size,
      wasmHeapBytes: this.wasmHeapBytes,
      scope: 'Serializer Wasm allocation only, excludes JS and runtime overhead',
    };
  }
  private readonly pending = new Map<
    number,
    { resolve: (value: WorkbookSource) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();

  serialize(document: SheetDocument): Promise<WorkbookSource> {
    try {
      this.cancelIdleRelease();
      if (document.cells.reduce((n, c) => n + c.source.length, 0) >= this.largeSourceChars)
        this.releaseWhenIdle = true;
      if (!this.worker) {
        const worker = new Worker(
          new URL('workbook-source.worker.js', globalThis.document.baseURI),
          { type: 'module' },
        );
        worker.onmessage = ({
          data,
        }: MessageEvent<{
          id: number;
          result?: WorkbookSource;
          error?: string;
          memory?: { wasmHeapBytes?: number | null };
        }>) => {
          if (this.worker !== worker) return;
          const heap = data.memory?.wasmHeapBytes;
          if (typeof heap === 'number' && Number.isFinite(heap) && heap >= 0)
            this.wasmHeapBytes = heap;
          const pending = this.pending.get(data.id);
          if (!pending) return;
          if (data.error || !isWorkbookSource(data.result)) {
            this.fail(new Error(data.error || 'Python returned an invalid workbook serialization result.'));
            return;
          }
          clearTimeout(pending.timer);
          this.pending.delete(data.id);
          pending.resolve(data.result);
          if (data.result.source.length >= this.largeSourceChars) this.releaseWhenIdle = true;
          if ((this.wasmHeapBytes ?? 0) >= this.largeHeapBytes) this.releaseWhenIdle = true;
          this.scheduleRelease();
        };
        worker.onerror = (event) => {
          if (this.worker === worker)
            this.fail(
              new Error(event.message || 'The Python file serializer stopped unexpectedly.'),
            );
        };
        worker.onmessageerror = () => {
          if (this.worker === worker)
            this.fail(new Error('Could not read the Python file serializer response.'));
        };
        this.worker = worker;
      }
      const id = ++this.nextId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => this.fail(new Error(
          'The Python file serializer did not respond within 2 minutes. Your edits are still open. Try saving again to start a fresh serializer; restarting the app is not required.',
        )), this.requestTimeoutMs);
        this.pending.set(id, { resolve, reject, timer });
        try {
          this.worker!.postMessage({ id, document: { ...document, snapshot: undefined } });
        } catch (error) {
          clearTimeout(timer);
          this.pending.delete(id);
          this.scheduleRelease();
          reject(error);
        }
      });
    } catch (error) {
      return Promise.reject(error);
    }
  }

  // Never interrupt a queued/in-flight save. Large allocations are released as
  // soon as the last response arrives; small workers stay warm briefly.
  private releaseWhenIdle = false;
  private cancelIdleRelease(): void {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }
  private scheduleRelease(): void {
    if (this.pending.size > 0) return;
    if (this.releaseWhenIdle) {
      this.release();
      return;
    }
    this.cancelIdleRelease();
    this.idleTimer = setTimeout(() => this.release(), this.idleMs);
  }
  private release(): void {
    this.cancelIdleRelease();
    this.worker?.terminate();
    this.worker = null;
    this.wasmHeapBytes = null;
    this.releaseWhenIdle = false;
  }

  ngOnDestroy(): void {
    this.fail(new Error('The Python file serializer was closed.'));
  }

  private fail(error: Error): void {
    this.release();
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
  }
}

function isWorkbookSource(value: unknown): value is WorkbookSource {
  if (!value || typeof value !== 'object') return false;
  const result = value as Partial<WorkbookSource>;
  return (
    typeof result.source === 'string' &&
    Array.isArray(result.problems) &&
    result.problems.every((item) => typeof item === 'string')
  );
}
