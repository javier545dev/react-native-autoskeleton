#!/usr/bin/env node
// benchmarks/check-budgets.ts
//
// tasks.md 9.1 — "pinned-image absolute assertion". Reads a `BenchmarkResults`
// JSON file (produced by `benchmarks/run.ts`) and fails (non-zero exit) if
// any metric exceeds its absolute budget in `benchmarks/budgets.json`,
// citing baseline/measured/exceeded-budget per REQ-OBS-CI-1's scenario
// shape. This is the check that is meaningful on a SINGLE pinned CI image —
// no second commit/checkout required, unlike `benchmarks/compare-cli.ts`'s
// ratio gate.
//
// Usage: npx tsx benchmarks/check-budgets.ts benchmarks/results/candidate.json

import { readFileSync } from 'node:fs';
import { loadBudgets } from './support/budgets';
import type { BenchmarkResults } from './support/types';

interface AbsoluteViolation {
  readonly metric: string;
  readonly measured: number;
  readonly budget: number;
}

export function checkAbsoluteBudgets(results: BenchmarkResults): readonly AbsoluteViolation[] {
  const budgets = loadBudgets();
  const violations: AbsoluteViolation[] = [];

  if (results.traversalP95Ms >= budgets.traversalP95Ms) {
    violations.push({ metric: 'traversalP95Ms', measured: results.traversalP95Ms, budget: budgets.traversalP95Ms });
  }
  if (results.cacheLookupP95Ms >= budgets.cacheLookupP95Ms) {
    violations.push({
      metric: 'cacheLookupP95Ms',
      measured: results.cacheLookupP95Ms,
      budget: budgets.cacheLookupP95Ms,
    });
  }
  // ADR-1 exit criterion: reported as its OWN line item, both as an absolute
  // ms figure AND as a ratio of the traversal budget — either exceeding
  // reopens the ADR per plan.md §6.
  if (results.serializationP95Ms >= budgets.serializationP95Ms) {
    violations.push({
      metric: 'serializationP95Ms',
      measured: results.serializationP95Ms,
      budget: budgets.serializationP95Ms,
    });
  }
  const serializationRatio = results.serializationP95Ms / budgets.traversalP95Ms;
  if (serializationRatio >= budgets.serializationRatioOfTraversalBudget) {
    violations.push({
      metric: 'serializationRatioOfTraversalBudget',
      measured: serializationRatio,
      budget: budgets.serializationRatioOfTraversalBudget,
    });
  }
  if (results.droppedFrames > budgets.droppedFramesPerScroll) {
    violations.push({
      metric: 'droppedFrames',
      measured: results.droppedFrames,
      budget: budgets.droppedFramesPerScroll,
    });
  }
  if (results.webEntryGzipBytes >= budgets.webEntryGzipBytes) {
    violations.push({
      metric: 'webEntryGzipBytes',
      measured: results.webEntryGzipBytes,
      budget: budgets.webEntryGzipBytes,
    });
  }

  return violations;
}

function main(): void {
  const [, , resultsPath] = process.argv;
  if (!resultsPath) {
    // eslint-disable-next-line no-console
    console.error('Usage: check-budgets.ts <results.json>');
    process.exit(2);
  }
  const results = JSON.parse(readFileSync(resultsPath, 'utf8')) as BenchmarkResults;
  const violations = checkAbsoluteBudgets(results);
  if (violations.length === 0) {
    // eslint-disable-next-line no-console
    console.log(`All budgets satisfied (${resultsPath}).`);
    return;
  }
  // eslint-disable-next-line no-console
  console.error(`Budget violations in ${resultsPath}:`);
  for (const v of violations) {
    // eslint-disable-next-line no-console
    console.error(`  ${v.metric}: measured=${v.measured}, budget=${v.budget} (exceeded)`);
  }
  process.exitCode = 1;
}

if (require.main === module) {
  main();
}
