import { vi } from 'vitest';
import { Debouncer } from './debouncer';
import { liveUpdateTiming } from './widget-config';

describe('Debouncer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('runs once after a quiet period with the latest value', () => {
    const calls: number[] = [];
    const debouncer = new Debouncer<number>((value) => calls.push(value), 150, 400);
    debouncer.call(1);
    debouncer.call(2);
    vi.advanceTimersByTime(149);
    expect(calls).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(calls).toEqual([2]);
  });

  it('still runs at least every maxWait while calls keep coming', () => {
    const calls: number[] = [];
    const debouncer = new Debouncer<number>((value) => calls.push(value), 150, 400);
    for (let step = 0; step < 20; step++) {
      debouncer.call(step);
      vi.advanceTimersByTime(50); // a drag: a new value every 50 ms, never quiet
    }
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls.length).toBeLessThanOrEqual(3);
  });

  it('flushes the pending value immediately', () => {
    const calls: number[] = [];
    const debouncer = new Debouncer<number>((value) => calls.push(value));
    debouncer.call(7);
    debouncer.flush();
    debouncer.flush();
    expect(calls).toEqual([7]);
  });

  it('uses the timing of each call, and runs at once with a wait of 0', () => {
    const calls: number[] = [];
    const debouncer = new Debouncer<number>((value) => calls.push(value));
    debouncer.call(1, { wait: 0, maxWait: 400 });
    expect(calls).toEqual([1]);
    debouncer.call(2, { wait: 1000, maxWait: 1000 });
    vi.advanceTimersByTime(999);
    expect(calls).toEqual([1]);
    vi.advanceTimersByTime(1);
    expect(calls).toEqual([1, 2]);
  });
});

describe('liveUpdateTiming', () => {
  it('follows a slider by default and text or number fields only with a debounce', () => {
    expect(liveUpdateTiming('range', undefined)).toEqual({ wait: 150, maxWait: 400 });
    expect(liveUpdateTiming('range', 0)).toEqual({ wait: 0, maxWait: 400 });
    expect(liveUpdateTiming('text', undefined)).toBeNull();
    expect(liveUpdateTiming('text', 300)).toEqual({ wait: 300, maxWait: 400 });
    expect(liveUpdateTiming('number', 2000)).toEqual({ wait: 2000, maxWait: 2000 });
    expect(liveUpdateTiming('checkbox', 0)).toBeNull();
  });
});
