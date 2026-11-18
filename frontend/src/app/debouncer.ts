/**
 * Trailing debounce with a maximum wait: `call()` runs `fn` once things go quiet for
 * `wait` ms, but at least every `maxWait` ms while calls keep coming — so dragging a
 * slider recalculates a few times per second instead of on every pixel, and still shows
 * live results. `flush()` runs a pending call now (e.g. when the slider is released).
 * A call may bring its own timing (a widget's `debounce`); a wait of 0 runs at once.
 */
export class Debouncer<T> {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private firstPendingAt: number | null = null;
  private pending: { value: T } | null = null;

  constructor(
    private readonly fn: (value: T) => void,
    private readonly wait = 150,
    private readonly maxWait = 400,
  ) {}

  call(value: T, timing: { wait: number; maxWait: number } = { wait: this.wait, maxWait: this.maxWait }): void {
    const now = Date.now();
    this.pending = { value };
    if (timing.wait <= 0) {
      this.flush();
      return;
    }
    this.firstPendingAt ??= now;
    if (this.timer !== null) clearTimeout(this.timer);
    const untilMax = this.firstPendingAt + timing.maxWait - now;
    this.timer = setTimeout(() => this.flush(), Math.max(0, Math.min(timing.wait, untilMax)));
  }

  flush(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.firstPendingAt = null;
    const pending = this.pending;
    this.pending = null;
    if (pending !== null) this.fn(pending.value);
  }

  cancel(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.firstPendingAt = null;
    this.pending = null;
  }
}
