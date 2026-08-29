#!/usr/bin/env node
// benchmarks/run.ts
//
// tasks.md 9.1 — CI benchmark suite entrypoint. Runs every benchmark this
// environment can genuinely execute (core Node-side + web/Playwright) and
// writes ONE `BenchmarkResults` JSON object to stdout (or `--out <file>`).
//
// Usage:
//   npx tsx benchmarks/run.ts                       # print JSON to stdout
//   npx tsx benchmarks/run.ts --out results/x.json   # write to a file
//
// This is the script `.github/workflows/benchmarks.yml` (task 9.1/9.2) runs
// TWICE in one job — once against the baseline ref, once against the
// candidate ref — so `benchmarks/support/compare.ts` can apply the ratio gate.
// It is also what `benchmarks/absolute.bench.test.ts` calls once, in this
// environment, to prove the absolute-budget assertion for real.

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { benchmarkCacheLookup, benchmarkSerialization } from './support/core-benchmarks';
import type { BenchmarkResults } from './support/types';
import { benchmarkWebSensorTraversal, measureWebEntryGzip } from './support/web-benchmarks';

const REFERENCE_SHAPE_COUNT = 60; // spec.md NFR-3/NFR-4: budgets are stated at <=60 shapes.
const ITERATIONS = 500;

export interface RunAllBenchmarksOptions {
  /** Adversarial-review fix (droppedFrames "0 > 0, can never fail" gate):
   *  this Node/Playwright-only script has no live device to measure real
   *  dropped frames against (see the honest scope note below), so by
   *  default `droppedFrames`/`droppedFramesMeasured` stay an explicit
   *  UNMEASURED placeholder that `check-budgets.ts` refuses to compare
   *  against budget at all — never a silent `0` that happens to equal the
   *  budget. This option is a dependency-injection seam, not a production
   *  CI input path: it exists so a test can exercise the REAL
   *  `runAllBenchmarks()` -> `checkAbsoluteBudgets()` pipeline with a
   *  genuine measurement and prove the gate can fail, without fabricating
   *  an on-device measurement inside a Node script. Wiring a real
   *  cross-job CI handoff from `PaintGateListFrameDropsInstrumentedTest.kt`
   *  into this field remains open (see this file's own header note) —
   *  deliberately not built this session (no live CI runner available to
   *  verify cross-job artifact plumbing against).
   */
  readonly measuredDroppedFrames?: number;
}

export async function runAllBenchmarks(options: RunAllBenchmarksOptions = {}): Promise<BenchmarkResults> {
  const cacheLookup = benchmarkCacheLookup({ shapeCount: REFERENCE_SHAPE_COUNT, iterations: ITERATIONS });
  const serialization = benchmarkSerialization({ shapeCount: REFERENCE_SHAPE_COUNT, iterations: ITERATIONS });
  const webTraversal = await benchmarkWebSensorTraversal({ shapeCount: REFERENCE_SHAPE_COUNT, iterations: 100 });
  const gzip = await measureWebEntryGzip();
  const droppedFramesMeasured = options.measuredDroppedFrames !== undefined;

  return {
    // Honest scope note (tasks.md 9.1 DoD / apply-progress report): this
    // environment has no live native Turbo Module to call `getShapes`
    // against, so `traversalP95Ms` here is the WEB DOM sensor's p95 — the
    // one traversal path genuinely executable headlessly. A real CI runner
    // with an Android emulator / iOS simulator should additionally report a
    // native traversalP95Ms (see the authored-but-unexecuted native jobs in
    // `.github/workflows/benchmarks.yml`).
    traversalP95Ms: webTraversal.p95Ms,
    cacheLookupP95Ms: cacheLookup.p95Ms,
    serializationP95Ms: serialization.p95Ms,
    // Honest scope note, REVISED (adversarial-review fix): no dropped-frame
    // measurement runs in THIS script by default — see the Android
    // instrumented frame-drop test (task 9.1's native line item,
    // `PaintGateListFrameDropsInstrumentedTest.kt`) for the one genuinely
    // on-device measurement this session took, run separately (androidTest,
    // not Node/Playwright), gated independently by its own hard assertion.
    // Previously this `0` was compared directly against
    // `budgets.json`'s `droppedFramesPerScroll` (also `0`) by
    // `check-budgets.ts`, making that comparison STRUCTURALLY `0 > 0` —
    // always false, a gate that could never fail. `droppedFramesMeasured`
    // now makes the "not measured" state explicit and loud:
    // `check-budgets.ts` refuses to evaluate `droppedFrames` against budget
    // unless this is `true`.
    droppedFrames: options.measuredDroppedFrames ?? 0,
    droppedFramesMeasured,
    webEntryGzipBytes: gzip.gzipBytes,
  };
}

async function main(): Promise<void> {
  const results = await runAllBenchmarks();
  const outFlagIndex = process.argv.indexOf('--out');
  const json = JSON.stringify(results, null, 2);
  if (outFlagIndex !== -1 && process.argv[outFlagIndex + 1]) {
    const outPath = path.resolve(process.argv[outFlagIndex + 1]!);
    writeFileSync(outPath, json + '\n');
    // eslint-disable-next-line no-console
    console.log(`Wrote benchmark results to ${outPath}`);
  } else {
    // eslint-disable-next-line no-console
    console.log(json);
  }
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exitCode = 1;
  });
}
