// benchmarks/support/compare.ts
//
// tasks.md 9.1 — "same-CI-job baseline-vs-candidate ratio comparison". Pure
// function: two `BenchmarkResults` objects in, a verdict out. The CI-level
// concern of actually PRODUCING those two objects (checking out a baseline
// ref, running the benchmark suite twice in one job) lives in
// `.github/workflows/benchmarks.yml` — this module only owns the comparison
// math, which is what makes it unit-testable without a second git worktree.

import type { BenchmarkResults, CompareVerdict, RegressionViolation } from './types';

const METRICS: readonly (keyof BenchmarkResults)[] = [
  'traversalP95Ms',
  'cacheLookupP95Ms',
  'serializationP95Ms',
  'droppedFrames',
  'webEntryGzipBytes',
];

export function compareResults(
  baseline: BenchmarkResults,
  candidate: BenchmarkResults,
  maxRegressionRatio: number,
): CompareVerdict {
  const violations: RegressionViolation[] = [];

  for (const metric of METRICS) {
    const baseValue = baseline[metric];
    const candValue = candidate[metric];

    if (baseValue === 0) {
      // A zero baseline (e.g. droppedFrames: 0) makes a ratio meaningless —
      // any positive candidate value is treated as an unconditional
      // regression rather than silently passing via "n / 0".
      if (candValue > 0) {
        violations.push({
          metric,
          baseline: baseValue,
          candidate: candValue,
          ratio: Number.POSITIVE_INFINITY,
          maxRatio: maxRegressionRatio,
        });
      }
      continue;
    }

    const ratio = candValue / baseValue;
    if (ratio > maxRegressionRatio) {
      violations.push({ metric, baseline: baseValue, candidate: candValue, ratio, maxRatio: maxRegressionRatio });
    }
  }

  return { regressed: violations.length > 0, violations };
}
