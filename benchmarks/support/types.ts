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
  /** Dropped-frame count over the 50-cell scroll benchmark (NFR-1). */
  readonly droppedFrames: number;
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
