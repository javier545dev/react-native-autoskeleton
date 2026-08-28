// benchmarks/support/percentiles.test.ts
//
// tasks.md 9.1 — RED first. Pure percentile math backing every benchmark's
// p95 figure (NFR-3/NFR-4, ADR-1's serialization exit criterion). No timing,
// no I/O: deterministic input arrays only, so this is genuinely unit-testable
// without a browser or a device.

import { describe, expect, it } from 'vitest';
import { mean, percentile } from './percentiles';

describe('percentile', () => {
  it('returns the exact value for a single-sample array', () => {
    expect(percentile([1.5], 95)).toBe(1.5);
  });

  it('computes p50 (median) on an odd-length sorted array', () => {
    expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3);
  });

  it('computes p95 on a 100-sample uniform array as the 95th value', () => {
    const samples = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
    // Nearest-rank method: p95 of 100 ascending integers 1..100 is the 95th value.
    expect(percentile(samples, 95)).toBe(95);
  });

  it('does not mutate the input array', () => {
    const samples = [5, 1, 3, 2, 4];
    const copy = [...samples];
    percentile(samples, 95);
    expect(samples).toEqual(copy);
  });

  it('sorts unsorted input before computing the percentile', () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
  });

  it('throws on an empty array rather than returning a misleading number', () => {
    expect(() => percentile([], 95)).toThrow();
  });

  it('throws on an out-of-range percentile', () => {
    expect(() => percentile([1, 2, 3], 0)).toThrow();
    expect(() => percentile([1, 2, 3], 101)).toThrow();
  });
});

describe('mean', () => {
  it('computes the arithmetic mean', () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
  });

  it('throws on an empty array', () => {
    expect(() => mean([])).toThrow();
  });
});
