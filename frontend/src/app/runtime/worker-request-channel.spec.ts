import { vi } from 'vitest';
import { PerformanceDiagnostics } from '../performance-diagnostics';
import type { RuntimeRequest, RuntimeResponse } from '../sheet.types';
import { WorkerRequestChannel } from './worker-request-channel';

class TestWorker {
  static instances: TestWorker[] = [];
  onmessage?: (event: { data: RuntimeResponse }) => void;
  onerror?: (event: ErrorEvent) => void;
  onmessageerror?: () => void;
  readonly postMessage = vi.fn<(request: RuntimeRequest) => void>();
  readonly terminate = vi.fn();
  constructor() {
    TestWorker.instances.push(this);
  }
}

describe('WorkerRequestChannel', () => {
  beforeEach(() => {
    TestWorker.instances = [];
    vi.stubGlobal('Worker', TestWorker);
  });
  afterEach(() => vi.unstubAllGlobals());

  function channel() {
    const events = { event: vi.fn(), result: vi.fn(), refused: vi.fn(), failed: vi.fn() };
    const channel = new WorkerRequestChannel(new PerformanceDiagnostics(), events);
    channel.start();
    return { channel, events, worker: TestWorker.instances[0] };
  }

  it('correlates replies and streams progress independently of request completion', async () => {
    const { channel: transport, events, worker } = channel();
    const first = transport.request('console'),
      second = transport.request('initialize');
    const [a, b] = worker.postMessage.mock.calls.map(([request]) => request);
    worker.onmessage!({ data: { type: 'progress', event: 'start', cellId: 'A1' } });
    expect(events.event).toHaveBeenCalledOnce();
    expect(transport.pendingCount).toBe(2);
    worker.onmessage!({ data: { id: b.id, type: 'result' } });
    await expect(second).resolves.toBeUndefined();
    worker.onmessage!({ data: { id: a.id, type: 'error', message: 'bad console code' } });
    await expect(first).rejects.toThrow('bad console code');
    expect(events.refused).toHaveBeenCalledWith('console', expect.any(Error));
    expect(transport.pendingCount).toBe(0);
    transport.terminate();
  });

  it('cleans up unsendable requests and isolates events from a retired worker', async () => {
    const { channel: transport, events, worker } = channel();
    worker.postMessage.mockImplementation(() => {
      throw new DOMException('cannot clone', 'DataCloneError');
    });
    await expect(transport.request('console')).rejects.toThrow('cannot clone');
    expect(transport.pendingCount).toBe(0);
    transport.start();
    expect(worker.terminate).toHaveBeenCalledOnce();
    worker.onmessage!({ data: { type: 'status', message: 'stale' } });
    worker.onerror!(new ErrorEvent('error', { message: 'stale failure' }));
    expect(events.event).not.toHaveBeenCalled();
    expect(events.failed).not.toHaveBeenCalled();
    transport.terminate();
  });

  it('rejects all pending work on shutdown', async () => {
    const { channel: transport } = channel();
    const pending = transport.request('apply');
    transport.terminate();
    await expect(pending).rejects.toThrow('Python worker closed');
    expect(transport.active).toBe(false);
    expect(transport.pendingCount).toBe(0);
  });
});
