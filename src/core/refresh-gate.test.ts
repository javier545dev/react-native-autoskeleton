// src/core/refresh-gate.test.ts
//
// Task 6.5 (tasks.md Phase 6) — REQ-PTR-1's observability half. RED-first:
// this is the pure predicate behind the fix for a real, pre-existing bug
// found while implementing 6.5 (present in BOTH `native/AutoSkeleton.tsx`
// and `web/AutoSkeleton.tsx` since Phase 2/5): `useHandoffAndMetrics`
// unconditionally called `controller.requestHandoff()` and unconditionally
// fired `onMetrics` once `controller.settled` resolved, with NO check for
// `skeletonSuppressed` — so a suppressed (stale-while-revalidate) pull-to-
// refresh cycle, which never shows a skeleton at all, still fired
// `onMetrics` exactly as if a real skeleton-to-content lifecycle had
// occurred. This is the exact "formatter tested in isolation but never
// gated on the real condition" shape spec.md's REQ-OBS-BUDGET-1 amendment
// already warns about, applied to a NON-call assertion this time.

import { describe, expect, it } from 'vitest';
import { shouldRunHandoffCycle } from './refresh-gate';

describe('shouldRunHandoffCycle — REQ-PTR-1 onMetrics non-call gate', () => {
  it('is false when the skeleton was suppressed for this cycle (default stale-while-revalidate)', () => {
    expect(shouldRunHandoffCycle(true, true)).toBe(false);
  });

  it('is true when the skeleton was NOT suppressed (cold load, or explicit skeletonOnRefresh opt-out)', () => {
    expect(shouldRunHandoffCycle(false, true)).toBe(true);
  });
});

// A SECOND way to have no lifecycle worth reporting, and the gate above did
// not cover it: a cycle that was never a loading state in the first place.
//
// `<AutoSkeleton skeletonOnRefresh isLoading={false}>` mounts straight into
// cycle 0. `everShownContent` initialises to `!isLoading`, so it starts true,
// and `skeletonSuppressed` is `everShownContent && skeletonOnRefresh !== true`
// — false, because the consumer opted into skeletons on refresh. The old
// one-argument gate therefore said "run", and a component that never loaded
// anything painted a skeleton over fully-rendered content, hid that content
// from assistive technology while it was up, and reported an `onMetrics`
// event for a load that never happened.
//
// That is the same class of defect this file was created for — "an observable
// skeleton-to-content lifecycle event for a lifecycle that never visually
// occurred" — reached from the other side: the original fix gated the
// SUPPRESSED path, and this one gates the NEVER-WAS-LOADING path.
describe('shouldRunHandoffCycle — a cycle that never started loading', () => {
  it('is false when the cycle did not begin in a loading state, even with skeletons opted in', () => {
    expect(shouldRunHandoffCycle(false, false)).toBe(false);
  });

  it('is still true for a real cold load', () => {
    expect(shouldRunHandoffCycle(false, true)).toBe(true);
  });

  it('stays false for a suppressed cycle regardless of how it started', () => {
    expect(shouldRunHandoffCycle(true, true)).toBe(false);
    expect(shouldRunHandoffCycle(true, false)).toBe(false);
  });
});
