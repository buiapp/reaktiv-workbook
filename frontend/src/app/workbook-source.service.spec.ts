import type { SheetDocument } from './sheet.types';
import { WorkbookSourceService } from './workbook-source.service';
import { createSheetDocument } from './sheet-file';

class FileWorker {
  static instances: FileWorker[] = [];
  readonly messages: Array<{ id: number; document: unknown }> = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminate = vi.fn();
  constructor(readonly url: URL) {
    FileWorker.instances.push(this);
  }
  postMessage(message: { id: number; document: unknown }) {
    this.messages.push(message);
  }
  reply(data: unknown) {
    this.onmessage?.({ data });
  }
}

describe('Python workbook source service', () => {
  beforeEach(() => {
    FileWorker.instances = [];
    vi.stubGlobal('Worker', FileWorker);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('reports worker allocation without exposing documents and clears it on shutdown', async () => {
    const service = new WorkbookSourceService();
    expect(service.memoryDiagnostics()).toMatchObject({ active: false, wasmHeapBytes: null });
    const pending = service.serialize({ cells: [] } as never);
    expect(service.memoryDiagnostics()).toMatchObject({ active: true, pendingRequests: 1 });
    FileWorker.instances[0].reply({
      id: 1,
      result: { source: 'private code', problems: [] },
      memory: { wasmHeapBytes: 31457280 },
    });
    await pending;
    expect(service.memoryDiagnostics()).toMatchObject({
      pendingRequests: 0,
      wasmHeapBytes: 31457280,
    });
    expect(JSON.stringify(service.memoryDiagnostics())).not.toContain('private code');
    service.ngOnDestroy();
    expect(service.memoryDiagnostics()).toMatchObject({ active: false, wasmHeapBytes: null });
  });

  it('releases idle workers and initializes a new worker for a later save', async () => {
    vi.useFakeTimers();
    const service = new WorkbookSourceService();
    const doc = createSheetDocument('Test', 1, 1, []);
    const first = service.serialize(doc);
    const worker = FileWorker.instances[0];
    worker.reply({ id: 1, result: { source: 'valid', problems: [] } });
    await first;
    await vi.advanceTimersByTimeAsync(29999);
    expect(worker.terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(service.memoryDiagnostics()).toMatchObject({ active: false, wasmHeapBytes: null });
    const next = service.serialize(doc);
    // Ignore stale responses from the released worker.
    worker.reply({ id: 2, result: { source: 'stale', problems: [] } });
    FileWorker.instances[1].reply({ id: 2, result: { source: 'fresh', problems: [] } });
    await expect(next).resolves.toMatchObject({ source: 'fresh' });
    service.ngOnDestroy();
  });

  it('releases a large heap only after all outstanding saves have completed', async () => {
    vi.useFakeTimers();
    const service = new WorkbookSourceService();
    const doc = createSheetDocument('Test', 1, 1, []);
    const first = service.serialize(doc),
      second = service.serialize(doc);
    const worker = FileWorker.instances[0];
    worker.reply({
      id: 1,
      result: { source: 'large', problems: [] },
      memory: { wasmHeapBytes: 300 * 1024 * 1024 },
    });
    await first;
    await vi.advanceTimersByTimeAsync(60000);
    expect(worker.terminate).not.toHaveBeenCalled();
    worker.reply({ id: 2, result: { source: 'second', problems: [] } });
    await second;
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(service.memoryDiagnostics()).toMatchObject({
      active: false,
      pendingRequests: 0,
      wasmHeapBytes: null,
    });
    service.ngOnDestroy();
  });

  it('releases a worker after a large document even if serialization fails', async () => {
    const service = new WorkbookSourceService();
    const doc = createSheetDocument('Test', 1, 1, [
      {
        id: 'A1',
        kind: 'input',
        source: '1'.repeat(4 * 1024 * 1024),
        enabled: true,
        trigger: 'auto',
      },
    ]);
    const pending = service.serialize(doc);
    FileWorker.instances[0].reply({ id: 1, error: 'Invalid source' });
    await expect(pending).rejects.toThrow('Invalid source');
    expect(FileWorker.instances[0].terminate).toHaveBeenCalledTimes(1);
    service.ngOnDestroy();
  });

  it('serializes on its own worker with no execution kernel or saved outputs', async () => {
    const service = new WorkbookSourceService();
    const document = createSheetDocument(
      'Offline',
      2,
      2,
      [],
      [],
      undefined,
      {},
      [],
      {
        savedAt: '2026-10-19',
        cells: [],
        dependencies: {},
      },
      { kernel: 'local' },
    );
    const pending = service.serialize(document);
    const worker = FileWorker.instances[0];
    expect(worker.url.pathname).toMatch(/workbook-source.worker.js$/);
    expect(worker.messages[0].document).toEqual({ ...document, snapshot: undefined });
    worker.reply({ id: 1, result: { source: '# Python generated', problems: [] } });
    await expect(pending).resolves.toEqual({ source: '# Python generated', problems: [] });
    service.ngOnDestroy();
  });

  it('keeps validation errors separate from transport failures and correlates replies', async () => {
    const service = new WorkbookSourceService();
    const doc = createSheetDocument('Test', 1, 1, []);
    const first = service.serialize(doc);
    const second = service.serialize(doc);
    const worker = FileWorker.instances[0];
    worker.reply({ id: 2, result: { source: '', problems: ['Cell A1: invalid code'] } });
    worker.reply({ id: 1, result: { source: 'valid', problems: [] } });
    await expect(second).resolves.toEqual({ source: '', problems: ['Cell A1: invalid code'] });
    await expect(first).resolves.toEqual({ source: 'valid', problems: [] });
    const unavailable = service.serialize(doc);
    worker.reply({ id: 3, error: 'Download failed' });
    await expect(unavailable).rejects.toThrow('Download failed');
    service.ngOnDestroy();
  });

  it('rejects outstanding saves on worker failure and starts a fresh worker for retry', async () => {
    const service = new WorkbookSourceService();
    const doc = createSheetDocument('Test', 1, 1, []);
    const pending = service.serialize(doc);
    FileWorker.instances[0].onerror?.({ message: 'Worker stopped' });
    await expect(pending).rejects.toThrow('Worker stopped');
    expect(FileWorker.instances[0].terminate).toHaveBeenCalled();
    const retry = service.serialize(doc);
    // Late events from the terminated worker must not cancel the retry.
    FileWorker.instances[0].onerror?.({ message: 'Old worker stopped again' });
    FileWorker.instances[1].reply({ id: 2, result: { source: 'retried', problems: [] } });
    await expect(retry).resolves.toEqual({ source: 'retried', problems: [] });
    service.ngOnDestroy();
  });
});

it('replaces an unresponsive serializer so saving can be retried without restarting the app', async () => {
  vi.useFakeTimers(); FileWorker.instances = []; vi.stubGlobal('Worker', FileWorker);
  const service = new WorkbookSourceService();
  try {
    const doc = createSheetDocument('Retry', 1, 1, []);
    const pending = service.serialize(doc);
    const failed = expect(pending).rejects.toThrow('restarting the app is not required');
    await vi.advanceTimersByTimeAsync(120000);
    await failed;
    expect(FileWorker.instances[0].terminate).toHaveBeenCalledOnce();
    expect(service.memoryDiagnostics()).toMatchObject({active: false, pendingRequests: 0});
    const retry = service.serialize(doc);
    FileWorker.instances[0].reply({id: 2, result: {source: 'stale', problems: []}});
    FileWorker.instances[1].reply({id: 2, result: {source: 'retried', problems: []}});
    await expect(retry).resolves.toMatchObject({source: 'retried'});
  } finally { service.ngOnDestroy(); vi.useRealTimers(); vi.unstubAllGlobals(); }
});
