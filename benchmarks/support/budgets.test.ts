// benchmarks/support/budgets.test.ts — RED first (tasks.md 9.1).

import { describe, expect, it } from 'vitest';
import { loadBudgets } from './budgets';

describe('loadBudgets', () => {
  it('loads benchmarks/budgets.json and exposes each numeric budget value', () => {
    const budgets = loadBudgets();
    expect(budgets.traversalP95Ms).toBe(2);
    expect(budgets.cacheLookupP95Ms).toBe(0.2);
    expect(budgets.serializationP95Ms).toBe(0.5);
    expect(budgets.serializationRatioOfTraversalBudget).toBe(0.25);
    expect(budgets.droppedFramesPerScroll).toBe(0);
    expect(budgets.webEntryGzipBytes).toBe(9216);
    expect(budgets.maxRegressionRatio).toBe(1.5);
    expect(budgets.nativeHeapGrowthBytesRecycleStress).toBe(12582912);
  });

  it('the web entry gzip budget matches test/packaging/web-bundle.test.ts exactly (no silent divergence)', () => {
    // Regression guard for the exact defect the spec.md NFR-6 revision could
    // reintroduce: two independent hard-coded 9 kB constants that drift.
    const budgets = loadBudgets();
    expect(budgets.webEntryGzipBytes).toBe(9 * 1024);
  });
});
