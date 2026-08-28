// benchmarks/support/percentiles.ts
//
// tasks.md 9.1 — pure percentile/mean math shared by every benchmark. Uses
// the nearest-rank method (simple, deterministic, matches how the budgets in
// spec.md §3 are phrased: "p95 < X ms").

export function percentile(samples: readonly number[], p: number): number {
  if (samples.length === 0) {
    throw new Error('percentile() requires at least one sample');
  }
  if (p <= 0 || p > 100) {
    throw new Error(`percentile() requires 0 < p <= 100, got ${p}`);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  const index = Math.min(sorted.length, Math.max(1, rank)) - 1;
  return sorted[index]!;
}

export function mean(samples: readonly number[]): number {
  if (samples.length === 0) {
    throw new Error('mean() requires at least one sample');
  }
  return samples.reduce((sum, v) => sum + v, 0) / samples.length;
}
