// benchmarks/support/types.ts — shared shape for a single benchmark run's results.
//
// One flat object per run (baseline OR candidate). `benchmarks/run.ts` writes
// this shape to `benchmarks/results/*.json`; `benchmarks/support/compare.ts`
// reads two of them.

export interface BenchmarkResults {
  /** Native/DOM traversal p95, ms, at the 60-shape reference screen (NFR-3). */
  readonly traversalP95Ms: number;
  /** Synchronous ShapeStore.get() p95, ms (NFR-4). */
  readonly cacheLookupP95Ms: number;
  /** JS-side wire encode p95, ms — reported SEPARATELY per ADR-1's exit
   *  criterion, never folded into traversalP95Ms. */
  readonly serializationP95Ms: number;
  /** Dropped-frame count over the 50-cell scroll benchmark (NFR-1). Honest
   *  ONLY when `droppedFramesMeasured` is true — this Node/Playwright-only
   *  script cannot measure real dropped frames (see `run.ts`'s own scope
   *  note), so this stays an unmeasured `0` placeholder, never compared
   *  against budget, until a genuine measurement is supplied. */
  readonly droppedFrames: number;
  /** Whether `droppedFrames` above is a genuine measurement taken by THIS
   *  run, vs. an unmeasured placeholder. `check-budgets.ts`'s absolute
   *  budget gate MUST NOT evaluate `droppedFrames` against
   *  `droppedFramesPerScroll` unless this is `true` — comparing an
   *  unmeasured placeholder against budget is exactly the "0 > 0, always
   *  false" defect this field exists to prevent. The authoritative
   *  measurement is `PaintGateListFrameDropsInstrumentedTest.kt`, run
   *  on-device in a separate Android-emulator CI job; it does not currently
   *  feed its result back into this JSON pipeline (see that job's own
   *  gate, which is independently real and can independently fail). */
  readonly droppedFramesMeasured: boolean;
  /** Gzip size, bytes, of the web entry consumer bundle (NFR-6). */
  readonly webEntryGzipBytes: number;
}

export interface RegressionViolation {
  readonly metric: keyof BenchmarkResults;
  readonly baseline: number;
  readonly candidate: number;
  readonly ratio: number;
  readonly maxRatio: number;
}

export interface CompareVerdict {
  readonly regressed: boolean;
  readonly violations: readonly RegressionViolation[];
}
