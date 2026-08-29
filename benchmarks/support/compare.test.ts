// benchmarks/support/compare.test.ts — RED first (tasks.md 9.1).
//
// The "same-CI-job baseline-vs-candidate RATIO comparison" half of 9.1's DoD.
// This module is deliberately pure (two plain results objects in, a verdict
// out) so the regression-detection LOGIC is genuinely unit-testable without
// running two full benchmark passes across two checked-out commits — that
// two-commit wiring is a CI-workflow concern (`.github/workflows/`), proven
// separately and honestly flagged as authored-but-unexecuted in this
// environment (no CI runner here). What CAN be proven here, and is: given
// two real results, does the ratio math correctly flag a regression?

import { describe, expect, it } from 'vitest';
import { compareResults } from './compare';
import type { BenchmarkResults } from './types';

function results(overrides: Partial<BenchmarkResults> = {}): BenchmarkResults {
  return {
    traversalP95Ms: 1.5,
    cacheLookupP95Ms: 0.1,
    serializationP95Ms: 0.3,
    droppedFrames: 0,
    droppedFramesMeasured: true,
    webEntryGzipBytes: 7950,
    ...overrides,
  };
}

describe('compareResults (ratio regression gate)', () => {
  it('passes when candidate is faster than or equal to baseline on every metric', () => {
    const verdict = compareResults(results(), results(), 1.5);
    expect(verdict.regressed).toBe(false);
    expect(verdict.violations).toEqual([]);
  });

  it('passes when candidate is slower but within the max regression ratio', () => {
    const baseline = results({ traversalP95Ms: 1.0 });
    const candidate = results({ traversalP95Ms: 1.4 }); // 1.4x, under 1.5x
    const verdict = compareResults(baseline, candidate, 1.5);
    expect(verdict.regressed).toBe(false);
  });

  it('fails when candidate exceeds the max regression ratio on traversalP95Ms', () => {
    const baseline = results({ traversalP95Ms: 1.0 });
    const candidate = results({ traversalP95Ms: 1.6 }); // 1.6x, over 1.5x
    const verdict = compareResults(baseline, candidate, 1.5);
    expect(verdict.regressed).toBe(true);
    expect(verdict.violations).toHaveLength(1);
    expect(verdict.violations[0]).toMatchObject({
      metric: 'traversalP95Ms',
      baseline: 1.0,
      candidate: 1.6,
    });
  });

  it('reports every metric that regressed, not just the first', () => {
    const baseline = results({ traversalP95Ms: 1.0, cacheLookupP95Ms: 0.1 });
    const candidate = results({ traversalP95Ms: 2.0, cacheLookupP95Ms: 0.3 });
    const verdict = compareResults(baseline, candidate, 1.5);
    expect(verdict.violations.map((v) => v.metric).sort()).toEqual(['cacheLookupP95Ms', 'traversalP95Ms']);
  });

  it('treats a zero baseline as an automatic pass for that metric (cannot divide by zero meaningfully) unless the candidate itself is non-zero and exceeds a small absolute floor', () => {
    const baseline = results({ droppedFrames: 0 });
    const candidateOk = results({ droppedFrames: 0 });
    expect(compareResults(baseline, candidateOk, 1.5).regressed).toBe(false);

    const candidateRegressed = results({ droppedFrames: 3 });
    const verdict = compareResults(baseline, candidateRegressed, 1.5);
    expect(verdict.regressed).toBe(true);
    expect(verdict.violations.map((v) => v.metric)).toContain('droppedFrames');
  });

  it('cites baseline, candidate and the exceeded ratio in each violation (REQ-OBS-CI-1 scenario shape)', () => {
    const baseline = results({ traversalP95Ms: 1.6 });
    const candidate = results({ traversalP95Ms: 3.0 });
    const verdict = compareResults(baseline, candidate, 1.5);
    const violation = verdict.violations.find((v) => v.metric === 'traversalP95Ms');
    expect(violation).toMatchObject({ baseline: 1.6, candidate: 3.0 });
    expect(violation!.ratio).toBeCloseTo(3.0 / 1.6, 5);
  });
});
