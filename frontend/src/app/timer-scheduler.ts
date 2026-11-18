/**
 * Fires clock cells (`every(...)` / `at(...)`) when they
 * are due. The Python engine only reports *when* each clock ticks next (`GraphResult.timers`);
 * this schedules the tick and the app asks the engine to run it.
 */
import { TimerInfo } from './sheet.types';

/** setTimeout cannot wait longer than this (~24.8 days); longer waits are not scheduled. */
const MAX_DELAY_MS = 2 ** 31 - 1;

export class TimerScheduler {
  private readonly handles = new Map<string, ReturnType<typeof setTimeout>>();
  /** Clocks whose tick is running: not scheduled again until `settled`. */
  private readonly ticking = new Set<string>();

  constructor(private readonly fire: (cellId: string) => void) {}

  /** Replace all scheduled ticks with those of the latest evaluation. */
  schedule(timers: readonly TimerInfo[]): void {
    this.cancel();
    for (const timer of timers) {
      if (this.ticking.has(timer.cellId)) continue;
      const delay = Math.max(0, timer.nextInSeconds * 1000);
      if (delay > MAX_DELAY_MS) continue;
      this.handles.set(
        timer.cellId,
        setTimeout(() => {
          this.handles.delete(timer.cellId);
          this.ticking.add(timer.cellId);
          this.fire(timer.cellId);
        }, delay),
      );
    }
  }

  /** The tick of this clock finished (successfully or not). */
  settled(cellId: string): void {
    this.ticking.delete(cellId);
  }

  cancel(): void {
    for (const handle of this.handles.values()) clearTimeout(handle);
    this.handles.clear();
  }
}

/** "every 5 min · next 09:05:00" (with the date when the next tick is not today). */
export function timerSummary(timer: TimerInfo, today = new Date()): string {
  const [date, time = ''] = timer.nextAt.split('T');
  const local = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return `${timer.label} · next ${date === local ? time : `${date} ${time}`}`;
}
