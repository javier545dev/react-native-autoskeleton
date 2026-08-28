#!/usr/bin/env node
// benchmarks/compare-cli.ts
//
// tasks.md 9.1 — "same-CI-job baseline-vs-candidate ratio comparison". Reads
// two `BenchmarkResults` JSON files (produced by running `benchmarks/run.ts`
// against two different checkouts IN THE SAME CI JOB — see
// `.github/workflows/benchmarks.yml`) and fails (non-zero exit) if any
// metric's ratio exceeds `benchmarks/budgets.json`'s `maxRegressionRatio`.
//
// Usage: npx tsx benchmarks/compare-cli.ts baseline.json candidate.json

import { readFileSync } from 'node:fs';
import { loadBudgets } from './support/budgets';
import { compareResults } from './support/compare';
import type { BenchmarkResults } from './support/types';

function main(): void {
  const [, , baselinePath, candidatePath] = process.argv;
  if (!baselinePath || !candidatePath) {
    // eslint-disable-next-line no-console
    console.error('Usage: compare-cli.ts <baseline.json> <candidate.json>');
    process.exit(2);
  }
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as BenchmarkResults;
  const candidate = JSON.parse(readFileSync(candidatePath, 'utf8')) as BenchmarkResults;
  const budgets = loadBudgets();

  const verdict = compareResults(baseline, candidate, budgets.maxRegressionRatio);
  if (!verdict.regressed) {
    // eslint-disable-next-line no-console
    console.log(`No regression: ${candidatePath} vs ${baselinePath} (max ratio ${budgets.maxRegressionRatio}x).`);
    return;
  }
  // eslint-disable-next-line no-console
  console.error(`Regression detected: ${candidatePath} vs ${baselinePath}`);
  for (const v of verdict.violations) {
    // eslint-disable-next-line no-console
    console.error(
      `  ${v.metric}: baseline=${v.baseline}, candidate=${v.candidate}, ratio=${v.ratio.toFixed(3)}x ` +
        `(max ${v.maxRatio}x)`,
    );
  }
  process.exitCode = 1;
}

if (require.main === module) {
  main();
}
