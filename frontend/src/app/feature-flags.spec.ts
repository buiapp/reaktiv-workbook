import { updateTracingEnabled } from './feature-flags';

it('requires an explicit developer opt-in for update tracing', () => {
  expect(updateTracingEnabled('')).toBe(false);
  expect(updateTracingEnabled('?experimentalUpdateTracing=0')).toBe(false);
  expect(updateTracingEnabled('?experimentalUpdateTracing=true')).toBe(false);
  expect(updateTracingEnabled('?experimentalUpdateTracing=1')).toBe(true);
});
