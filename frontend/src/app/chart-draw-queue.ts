/** Share the main thread between charts; never queue historical specs or values. */
let tail: Promise<unknown> = Promise.resolve();
export function scheduleChartDraw(run: () => Promise<void>): Promise<void> {
  const next = tail.then(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))).then(run);
  tail = next.catch(() => {});
  return next;
}
