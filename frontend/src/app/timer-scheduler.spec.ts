import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TimerScheduler, timerSummary } from './timer-scheduler';
import { TimerInfo } from './sheet.types';

function timer(cellId: string, nextInSeconds: number): TimerInfo {
  return { cellId, label: 'every 5 s', lastAt: '2026-10-02T09:00:00', nextAt: '2026-10-02T09:00:05', nextInSeconds };
}

describe('TimerScheduler', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fires each clock when it is due', () => {
    const fired: string[] = [];
    const scheduler = new TimerScheduler((cellId) => fired.push(cellId));
    scheduler.schedule([timer('A1', 5), timer('B1', 10)]);
    vi.advanceTimersByTime(4999);
    expect(fired).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(fired).toEqual(['A1']);
    vi.advanceTimersByTime(5000);
    expect(fired).toEqual(['A1', 'B1']);
  });

  it('replaces earlier schedules and can be cancelled', () => {
    const fired: string[] = [];
    const scheduler = new TimerScheduler((cellId) => fired.push(cellId));
    scheduler.schedule([timer('A1', 5)]);
    scheduler.schedule([timer('A1', 20)]);
    vi.advanceTimersByTime(10_000);
    expect(fired).toEqual([]);
    scheduler.cancel();
    vi.advanceTimersByTime(60_000);
    expect(fired).toEqual([]);
  });

  it('does not schedule a clock again while its tick is running', () => {
    const fired: string[] = [];
    const scheduler = new TimerScheduler((cellId) => fired.push(cellId));
    scheduler.schedule([timer('A1', 1)]);
    vi.advanceTimersByTime(1000);
    // Another evaluation finishes first and still reports the clock as overdue.
    scheduler.schedule([timer('A1', 0)]);
    vi.advanceTimersByTime(1000);
    expect(fired).toEqual(['A1']);
    scheduler.settled('A1');
    scheduler.schedule([timer('A1', 1)]);
    vi.advanceTimersByTime(1000);
    expect(fired).toEqual(['A1', 'A1']);
  });

  it('skips waits longer than setTimeout supports', () => {
    const fired: string[] = [];
    const scheduler = new TimerScheduler((cellId) => fired.push(cellId));
    scheduler.schedule([timer('A1', 40 * 24 * 3600)]);
    vi.runAllTimers();
    expect(fired).toEqual([]);
  });
});

describe('timerSummary', () => {
  it('shows the time today and the date otherwise', () => {
    expect(timerSummary(timer('A1', 5), new Date(2026, 9, 2, 9, 0))).toBe('every 5 s · next 09:00:05');
    expect(timerSummary(timer('A1', 5), new Date(2026, 9, 1, 9, 0))).toBe(
      'every 5 s · next 2026-10-02 09:00:05',
    );
  });
});
