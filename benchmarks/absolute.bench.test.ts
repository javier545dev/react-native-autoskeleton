// benchmarks/absolute.bench.test.ts
//
// tasks.md 9.1 — the "pinned-image absolute assertion" half of the DoD,
// proven as a real, currently-passing test in THIS environment (which is
// itself one pinned dev-machine image for this session — the genuine CI
// equivalent, `.github/workflows/benchmarks.yml`'s `benchmarks-absolute`
// job, runs the identical two-step invocation on its own pinned runner
// image). REQ-OBS-CI-1's two scenarios ("traversal regression fails CI",
// "frame-drop regression fails CI") are proven at the unit level in
// `check-budgets.test.ts`/`compare.test.ts`; THIS file proves the real
// end-to-end measurement stays inside every budget right now.
//
// Run in isolation: `npm run bench`.

import { describe, expect, it } from 'vitest';
import { checkAbsoluteBudgets } from './check-budgets';
import { loadBudgets } from './support/budgets';
import { runAllBenchmarks } from './run';

describe('CI benchmark suite — pinned-image absolute assertion (REQ-OBS-CI-1)', () => {
  it(
    'every measured metric from a real run stays within its spec.md §3 / ADR-1 budget',
    async () => {
      const results = await runAllBenchmarks();
      const budgets = loadBudgets();
      const violations = checkAbsoluteBudgets(results);

      // eslint-disable-next-line no-console
      console.log('[benchmarks] measured', results, 'budgets', budgets);

      expect(
        violations,
        `Budget violation(s): ${violations.map((v) => `${v.metric}=${v.measured} (budget ${v.budget})`).join(', ')}`,
      ).toEqual([]);
    },
    60_000,
  );

  it(
    'serialization is reported as a separate line item from traversal (ADR-1 requirement)',
    async () => {
      const results = await runAllBenchmarks();
      // Distinctness proof, not just "both present": these must be two
      // independently-measured numbers, not one value duplicated under two
      // keys — the whole point of ADR-1's "reports serialization separately
      // so the trigger is observable".
      expect(results.serializationP95Ms).not.toBe(results.traversalP95Ms);
      expect(typeof results.serializationP95Ms).toBe('number');
      expect(typeof results.traversalP95Ms).toBe('number');
    },
    60_000,
  );

  // Adversarial-review defect: `run.ts` hardcoded `droppedFrames: 0` and
  // `budgets.json`'s `droppedFramesPerScroll` is `0`, so
  // `checkAbsoluteBudgets`'s `results.droppedFrames > budgets
  // .droppedFramesPerScroll` was STRUCTURALLY `0 > 0` — always false. The
  // ONLY prior test coverage of this comparison (`check-budgets.test.ts`'s
  // "flags droppedFrames > 0") exercised `checkAbsoluteBudgets` in
  // isolation against a hand-built object, never the REAL
  // `run.ts` -> `check-budgets.ts` pipeline — so it gave false confidence
  // that the gate itself could fail. These two tests exercise the real
  // pipeline: `runAllBenchmarks()` for real (real Node/Playwright
  // measurements for every other metric), with a genuine droppedFrames
  // measurement injected through the same seam a real CI job would use.
  describe('frame-drop gate — proven capable of failing through the REAL run.ts -> check-budgets.ts pipeline', () => {
    it(
      'flags droppedFrames when this run genuinely measured a value over budget',
      async () => {
        const budgets = loadBudgets();
        const overBudget = budgets.droppedFramesPerScroll + 1;

        const results = await runAllBenchmarks({ measuredDroppedFrames: overBudget });
        expect(results.droppedFramesMeasured).toBe(true);
        expect(results.droppedFrames).toBe(overBudget);

        const violations = checkAbsoluteBudgets(results);
        const droppedFramesViolation = violations.find((v) => v.metric === 'droppedFrames');
        expect(
          droppedFramesViolation,
          'the frame-drop gate did not fire for a genuine over-budget measurement — it is still incapable of failing',
        ).toBeDefined();
        expect(droppedFramesViolation).toMatchObject({ measured: overBudget, budget: budgets.droppedFramesPerScroll });
      },
      60_000,
    );

    it(
      'does NOT evaluate droppedFrames against budget when this run never measured it (honest skip, not a silent placeholder pass)',
      async () => {
        const results = await runAllBenchmarks();
        expect(results.droppedFramesMeasured).toBe(false);

        const violations = checkAbsoluteBudgets(results);
        expect(violations.some((v) => v.metric === 'droppedFrames')).toBe(false);
      },
      60_000,
    );
  });
});
