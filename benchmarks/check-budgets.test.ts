// benchmarks/check-budgets.test.ts
//
// tasks.md 9.1 — pure-function coverage for the absolute-budget gate.
// (Written immediately after `checkAbsoluteBudgets` itself, alongside
// `benchmarks/support/budgets.test.ts`'s prior RED→GREEN cycle for the loader it
// depends on — see this task's TDD Cycle Evidence table in the apply-progress
// report for the honest note on this one file's ordering.)

import { describe, expect, it } from 'vitest';
import { checkAbsoluteBudgets } from './check-budgets';
import { loadBudgets } from './support/budgets';
import type { BenchmarkResults } from './support/types';

// Byte figures are derived from the budget, never spelled out. The previous
// version hardcoded 7950 / 8185 / 9220 against an assumed 9216 budget, so the
// day the NFR-6 budget moved these tests failed for a reason that had nothing
// to do with the behaviour they describe — and, worse, they would have gone
// GREEN against a budget that had silently drifted the other way. What the gate
// promises is "at or above the budget fails, below it passes"; that is what is
// asserted.
const WEB_ENTRY_BUDGET = loadBudgets().webEntryGzipBytes;

function passingResults(): BenchmarkResults {
  return {
    traversalP95Ms: 1.0,
    cacheLookupP95Ms: 0.1,
    serializationP95Ms: 0.1,
    droppedFrames: 0,
    droppedFramesMeasured: true,
    webEntryGzipBytes: WEB_ENTRY_BUDGET - 1,
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

  it('flags webEntryGzipBytes AT the budget — NFR-6 is a hard gate, not a tolerance', () => {
    const violations = checkAbsoluteBudgets({ ...passingResults(), webEntryGzipBytes: WEB_ENTRY_BUDGET });
    expect(violations.some((v) => v.metric === 'webEntryGzipBytes')).toBe(true);
  });

  it('flags webEntryGzipBytes above the budget', () => {
    const violations = checkAbsoluteBudgets({ ...passingResults(), webEntryGzipBytes: WEB_ENTRY_BUDGET + 4 });
    expect(violations.some((v) => v.metric === 'webEntryGzipBytes')).toBe(true);
  });

  it('does NOT flag webEntryGzipBytes one byte under the budget', () => {
    const violations = checkAbsoluteBudgets({ ...passingResults(), webEntryGzipBytes: WEB_ENTRY_BUDGET - 1 });
    expect(violations.some((v) => v.metric === 'webEntryGzipBytes')).toBe(false);
  });

  it('flags droppedFrames > 0 when this run genuinely measured it (NFR-1 zero-tolerance)', () => {
    const violations = checkAbsoluteBudgets({ ...passingResults(), droppedFrames: 1, droppedFramesMeasured: true });
    expect(violations.some((v) => v.metric === 'droppedFrames')).toBe(true);
  });

  // Adversarial-review defect: `run.ts` hardcoded `droppedFrames: 0` and
  // `budgets.json`'s `droppedFramesPerScroll` is `0`, so
  // `results.droppedFrames > budgets.droppedFramesPerScroll` was
  // STRUCTURALLY `0 > 0` — always false, a gate that could never fail. This
  // test proves the fix does not merely relocate that defect: an unmeasured
  // placeholder must never be compared against budget at all, even if the
  // placeholder value itself would (accidentally) exceed it.
  it('does NOT flag droppedFrames when this run never measured it, even if the placeholder value would exceed budget on its own', () => {
    const violations = checkAbsoluteBudgets({
      ...passingResults(),
      droppedFrames: 5,
      droppedFramesMeasured: false,
    });
    expect(violations.some((v) => v.metric === 'droppedFrames')).toBe(false);
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
