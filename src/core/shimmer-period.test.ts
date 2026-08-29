// src/core/shimmer-period.test.ts
//
// ADR-8 arbitration unit tests. See `shimmer-period.ts`'s header for the
// decision itself; this file pins the behaviour so it stops being
// undefined-and-re-litigated:
//
//   1. the FIRST period that reaches a mounted skeleton is adopted;
//   2. every later request for a DIFFERENT period gets the adopted one back
//      (one clock, one period — ADR-8's in-phase guarantee is not negotiable);
//   3. a rejected request is never silent: a dev-build `console.warn` names
//      the ignored value, the value actually in effect, and the way out.
//
// Warn-once granularity is per DISTINCT rejected value (not per call and not
// once globally), matching `src/native/Hint.tsx`'s own once-per-distinct-pair
// latch: a second, different bad value is a second, different mistake and
// deserves its own line.

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import {
  __resetSharedShimmerPeriodForTests,
  formatSharedShimmerPeriodConflictWarning,
  resolveSharedShimmerPeriodMs,
} from './shimmer-period';

describe('resolveSharedShimmerPeriodMs (ADR-8: one clock, one period)', () => {
  let warnSpy: MockInstance<(...args: unknown[]) => void>;

  beforeEach(() => {
    __resetSharedShimmerPeriodForTests();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined) as unknown as MockInstance<
      (...args: unknown[]) => void
    >;
  });

  afterEach(() => {
    warnSpy.mockRestore();
    __resetSharedShimmerPeriodForTests();
  });

  it('adopts the first requested period and returns it unchanged', () => {
    expect(resolveSharedShimmerPeriodMs(600)).toBe(600);
    expect(warnSpy).toHaveBeenCalledTimes(0);
  });

  it('returns the adopted period for a repeated identical request, with no warning', () => {
    resolveSharedShimmerPeriodMs(600);
    expect(resolveSharedShimmerPeriodMs(600)).toBe(600);
    expect(resolveSharedShimmerPeriodMs(600)).toBe(600);
    expect(warnSpy).toHaveBeenCalledTimes(0);
  });

  it('returns the ADOPTED period — never the requested one — for a conflicting second theme', () => {
    expect(resolveSharedShimmerPeriodMs(600)).toBe(600);
    expect(resolveSharedShimmerPeriodMs(900)).toBe(600);
  });

  it('warns exactly once for a conflicting request, naming the ignored and the effective value', () => {
    resolveSharedShimmerPeriodMs(600);
    resolveSharedShimmerPeriodMs(900);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = String(warnSpy.mock.calls[0]?.[0]);
    expect(message).toContain('900');
    expect(message).toContain('600');
    expect(message).toContain('speedMs');
  });

  it('does not warn again for the SAME rejected value on every subsequent mount', () => {
    resolveSharedShimmerPeriodMs(600);
    resolveSharedShimmerPeriodMs(900);
    resolveSharedShimmerPeriodMs(900);
    resolveSharedShimmerPeriodMs(900);

    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('warns once per DISTINCT rejected value — a second wrong value is a second mistake', () => {
    resolveSharedShimmerPeriodMs(600);
    resolveSharedShimmerPeriodMs(900);
    resolveSharedShimmerPeriodMs(1200);

    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain('900');
    expect(String(warnSpy.mock.calls[1]?.[0])).toContain('1200');
  });

  it('still arbitrates in a production build, but stays silent there', () => {
    const previous = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'production';
    try {
      expect(resolveSharedShimmerPeriodMs(600)).toBe(600);
      expect(resolveSharedShimmerPeriodMs(900)).toBe(600);
      expect(warnSpy).toHaveBeenCalledTimes(0);
    } finally {
      if (previous === undefined) {
        delete process.env['NODE_ENV'];
      } else {
        process.env['NODE_ENV'] = previous;
      }
    }
  });

  it('is reset by the test seam so adoption never leaks between suites', () => {
    resolveSharedShimmerPeriodMs(600);
    __resetSharedShimmerPeriodForTests();
    expect(resolveSharedShimmerPeriodMs(900)).toBe(900);
    expect(warnSpy).toHaveBeenCalledTimes(0);
  });
});

describe('formatSharedShimmerPeriodConflictWarning (pure formatter)', () => {
  it('names both values, the ADR-8 reason, and an actionable way out', () => {
    const message = formatSharedShimmerPeriodConflictWarning(900, 600);

    expect(message).toContain('[autoskeleton]');
    expect(message).toContain('900');
    expect(message).toContain('600');
    expect(message).toContain('speedMs');
    // The whole point of the message: say WHY it was ignored, not just that
    // it was.
    expect(message.toLowerCase()).toContain('shared');
  });

  it('is pure — the same inputs always produce the same string, with no emission', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      expect(formatSharedShimmerPeriodConflictWarning(900, 600)).toBe(
        formatSharedShimmerPeriodConflictWarning(900, 600),
      );
      expect(warnSpy).toHaveBeenCalledTimes(0);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
