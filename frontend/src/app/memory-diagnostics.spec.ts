import { PerformanceDiagnostics } from './performance-diagnostics';

describe('memory diagnostic recording', () => {
  afterEach(() => vi.useRealTimers());

  it('samples on export without starting recording and tolerates unavailable metrics', async () => {
    const diagnostics = new PerformanceDiagnostics();
    const probe = vi.fn(async () => ({
      frontend: { kernel: { usage: null } },
    }));
    diagnostics.setMemoryProbe(probe);
    const report = JSON.parse(await diagnostics.report({}));
    expect(probe).toHaveBeenCalledTimes(1);
    expect(report.memory.samples[0].reason).toBe('export');
    expect(report.memory.samples[0].data.frontend.kernel.usage).toBeNull();
    expect(diagnostics.enabled()).toBe(false);
    diagnostics.stop();
  });

  it('bounds the memory history and stops periodic work when recording stops', async () => {
    vi.useFakeTimers();
    const diagnostics = new PerformanceDiagnostics();
    const probe = vi.fn(async () => ({ rssBytes: 1234 }));
    diagnostics.setMemoryProbe(probe);
    diagnostics.start();
    await vi.advanceTimersByTimeAsync(125 * 5000);
    const report = JSON.parse(await diagnostics.report({}));
    expect(report.memory.samples).toHaveLength(120);
    diagnostics.stop();
    const count = probe.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10000);
    expect(probe).toHaveBeenCalledTimes(count);
  });

  it('does not append late responses from a stopped recording', async () => {
    const diagnostics = new PerformanceDiagnostics();
    let release!: (value: unknown) => void;
    diagnostics.setMemoryProbe(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    diagnostics.start();
    diagnostics.stop();
    release({ rssBytes: 99 });
    await Promise.resolve();
    await Promise.resolve();
    diagnostics.setMemoryProbe(null);
    const report = JSON.parse(await diagnostics.report({}));
    expect(report.memory.samples).toEqual([]);
  });

  it('bounds a stalled sampler so diagnostic export remains available', async () => {
    vi.useFakeTimers();
    const diagnostics = new PerformanceDiagnostics();
    diagnostics.setMemoryProbe(() => new Promise(() => {}));
    const pending = diagnostics.report({});
    await vi.advanceTimersByTimeAsync(3501);
    const report = JSON.parse(await pending);
    expect(report.memory.samples[0].data.unavailable).toContain('timed out');
    diagnostics.stop();
  });
});
