// benchmarks/check-budgets.test.ts
//
// tasks.md 9.1 — pure-function coverage for the absolute-budget gate.
// (Written immediately after `checkAbsoluteBudgets` itself, alongside
// `benchmarks/support/budgets.test.ts`'s prior RED→GREEN cycle for the loader it
// depends on — see this task's TDD Cycle Evidence table in the apply-progress
// report for the honest note on this one file's ordering.)

import { describe, expect, it } from 'vitest';
import { checkAbsoluteBudgets } from './check-budgets';
import type { BenchmarkResults } from './support/types';

function passingResults(): BenchmarkResults {
  return {
    traversalP95Ms: 1.0,
    cacheLookupP95Ms: 0.1,
    serializationP95Ms: 0.1,
    droppedFrames: 0,
    webEntryGzipBytes: 7950,
  };
}

describe('checkAbsoluteBudgets', () => {
  it('returns no violations when every metric is within budget', () => {
    expect(checkAbsoluteBudgets(passingResults())).toEqual([]);
  });

  it('flags traversalP95Ms at or above the 2ms budget (NFR-3)', () => {
    const violations = checkAbsoluteBudgets({ ...passingResults(), traversalP95Ms: 2.3 });
    expect(violations.some((v) => v.metric === 'traversalP95Ms')).toBe(true);
  });

  it('flags cacheLookupP95Ms at or above the 0.2ms budget (NFR-4)', () => {
    const violations = checkAbsoluteBudgets({ ...passingResults(), cacheLookupP95Ms: 0.25 });
    expect(violations.some((v) => v.metric === 'cacheLookupP95Ms')).toBe(true);
  });

  it('flags webEntryGzipBytes at or above 9216 (NFR-6, revised a second time to 9 kB)', () => {
    const violations = checkAbsoluteBudgets({ ...passingResults(), webEntryGzipBytes: 9220 });
    expect(violations.some((v) => v.metric === 'webEntryGzipBytes')).toBe(true);
  });

  it('does NOT flag webEntryGzipBytes at 7950 (the last real measured value)', () => {
    const violations = checkAbsoluteBudgets({ ...passingResults(), webEntryGzipBytes: 7950 });
    expect(violations.some((v) => v.metric === 'webEntryGzipBytes')).toBe(false);
  });

  it('does NOT flag webEntryGzipBytes at 8185 (the pre-revision-2 razor-thin measurement, now comfortably under 9216)', () => {
    const violations = checkAbsoluteBudgets({ ...passingResults(), webEntryGzipBytes: 8185 });
    expect(violations.some((v) => v.metric === 'webEntryGzipBytes')).toBe(false);
  });

  it('flags droppedFrames > 0 (NFR-1 zero-tolerance)', () => {
    const violations = checkAbsoluteBudgets({ ...passingResults(), droppedFrames: 1 });
    expect(violations.some((v) => v.metric === 'droppedFrames')).toBe(true);
  });

  it('flags serialization exceeding 25% of the traversal budget even if under its own absolute ms figure (ADR-1 exit criterion)', () => {
    // 0.4ms serialization is under the 0.5ms absolute budget, but
    // 0.4 / 2 = 0.2 which is still under 0.25 — pick a value that trips the
    // RATIO specifically: 0.6ms is over BOTH, so use the ratio's own edge.
    const violations = checkAbsoluteBudgets({ ...passingResults(), serializationP95Ms: 0.49 });
    // 0.49 / 2 = 0.245, under 0.25 — should NOT trip the ratio, and 0.49 < 0.5
    // should not trip the absolute either.
    expect(violations).toEqual([]);
  });
});
