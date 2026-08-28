// benchmarks/support/core-benchmarks.test.ts — RED first (tasks.md 9.1).
//
// Real measurement functions produce real wall-clock numbers, which cannot
// be asserted against a fixed expected value (that would be either flaky or
// meaningless). What IS meaningfully testable ahead of implementation: the
// STRUCTURE of what these functions produce — sample count, that p95 is
// derived from real recorded samples (>= median), and that the cache-lookup
// benchmark is actually exercising a cache HIT (not silently timing a miss,
// which would be a fast-for-the-wrong-reason bug).

import { describe, expect, it } from 'vitest';
import { benchmarkCacheLookup, benchmarkSerialization } from './core-benchmarks';

describe('benchmarkCacheLookup', () => {
  it('runs the requested number of samples against a real cache HIT', () => {
    const result = benchmarkCacheLookup({ shapeCount: 60, iterations: 500 });
    expect(result.samples).toHaveLength(500);
    expect(result.hit).toBe(true);
  });

  it('every sample is a non-negative duration in milliseconds', () => {
    const result = benchmarkCacheLookup({ shapeCount: 60, iterations: 200 });
    for (const s of result.samples) {
      expect(s).toBeGreaterThanOrEqual(0);
    }
  });

  it('p95 is derived from the real samples (>= the sample median)', () => {
    const result = benchmarkCacheLookup({ shapeCount: 60, iterations: 500 });
    const sorted = [...result.samples].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    expect(result.p95Ms).toBeGreaterThanOrEqual(median);
  });
});

describe('benchmarkSerialization', () => {
  it('runs the requested number of samples encoding a real N-shape wire buffer', () => {
    const result = benchmarkSerialization({ shapeCount: 60, iterations: 300 });
    expect(result.samples).toHaveLength(300);
    expect(result.shapeCount).toBe(60);
  });

  it('the encoded buffer genuinely round-trips through decodeWire back to shapeCount shapes', () => {
    const result = benchmarkSerialization({ shapeCount: 30, iterations: 5 });
    expect(result.decodedShapeCount).toBe(30);
  });

  it('p95 is derived from the real samples (>= the sample median)', () => {
    const result = benchmarkSerialization({ shapeCount: 60, iterations: 300 });
    const sorted = [...result.samples].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    expect(result.p95Ms).toBeGreaterThanOrEqual(median);
  });
});
