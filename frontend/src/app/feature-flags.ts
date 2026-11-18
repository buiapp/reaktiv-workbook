/** Developer opt-ins, read once per window. No workbook or device preference is changed. */
export function updateTracingEnabled(search = globalThis.location?.search ?? ''): boolean {
  return new URLSearchParams(search).get('experimentalUpdateTracing') === '1';
}
