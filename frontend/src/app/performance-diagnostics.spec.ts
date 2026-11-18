import { PerformanceDiagnostics } from './performance-diagnostics';
import { WorkerRequestChannel } from './runtime/worker-request-channel';
import { RuntimeService } from './runtime.service';
import type { RuntimeRequest, RuntimeResponse } from './sheet.types';

describe('performance diagnostics', () => {
  let diagnostics: PerformanceDiagnostics;
  beforeEach(() => {
    diagnostics = new PerformanceDiagnostics();
  });
  afterEach(() => {
    diagnostics.stop();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  it('is opt-in, bounded and prevents late timings leaking into a new recording', () => {
    diagnostics.record('ignored', 1);
    expect(JSON.stringify(diagnostics.snapshot())).not.toContain('ignored');
    diagnostics.start();
    const late = diagnostics.begin('previous recording');
    diagnostics.stop();
    diagnostics.start();
    late();
    for (let i = 0; i < 450; i++) diagnostics.record('test', i % 10, { count: i });
    const snapshot = diagnostics.snapshot() as {
      entries: { operation: string; metrics: { count: number } }[];
    };
    expect(snapshot.entries).toHaveLength(400);
    expect(snapshot.entries[0].metrics.count).toBe(50);
    expect(snapshot.entries.some((e) => e.operation === 'previous recording')).toBe(false);
  });
  it('records worker round trips with queue and execution timing without keeping payloads', async () => {
    let sent: RuntimeRequest | undefined;
    let reply: ((event: { data: RuntimeResponse }) => void) | undefined;
    class Worker {
      onmessage?: (event: { data: RuntimeResponse }) => void;
      postMessage(request: RuntimeRequest): void {
        sent = request;
        reply = this.onmessage;
      }
      terminate(): void {}
    }
    vi.stubGlobal('Worker', Worker);
    const channel = new WorkerRequestChannel(diagnostics, {
      event: () => {},
      result: () => {},
      refused: () => {},
      failed: () => {},
    });
    channel.start();
    diagnostics.start();
    const result = channel.request('move-cells');
    expect(sent?.diagnostics).toBe(true);
    reply!({
      data: { id: sent!.id, type: 'result', result: [], timings: { queueMs: 15, executionMs: 80 } },
    });
    await expect(result).resolves.toEqual([]);
    channel.terminate();
    const text = JSON.stringify(diagnostics.snapshot());
    expect(text).toContain('worker.move-cells');
    expect(text).toContain('"queueMs":15');
    expect(text).toContain('"executionMs":80');
  });
  it('times real HTTP encoding and parsing without retaining source or values', async () => {
    const fetch = globalThis.fetch;
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            cells: [],
            dependencies: {},
            effects: [],
            logs: [],
            changed: [],
            rebuilt: false,
            updateMode: 'incremental',
          }),
        ),
    );
    try {
      const runtime = new RuntimeService(diagnostics);
      await runtime.configureKernel('remote', 'http://localhost:8765', [], {});
      diagnostics.start();
      await runtime.apply([
        { id: 'A1', kind: 'input', source: '"secret_source_123"', enabled: true, trigger: 'auto' },
      ]);
      const snapshot = JSON.stringify(diagnostics.snapshot());
      expect(snapshot).toContain('http.encode');
      expect(snapshot).toContain('http.parse');
      expect(snapshot).toContain('requestChars');
      expect(snapshot).not.toContain('secret_source_123');
      expect(snapshot).not.toContain('http://localhost');
    } finally {
      globalThis.fetch = fetch;
    }
  });
});
