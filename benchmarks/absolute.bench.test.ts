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
});
