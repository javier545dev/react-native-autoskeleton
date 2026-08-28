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
    expect(shouldRunHandoffCycle(true)).toBe(false);
  });

  it('is true when the skeleton was NOT suppressed (cold load, or explicit skeletonOnRefresh opt-out)', () => {
    expect(shouldRunHandoffCycle(false)).toBe(true);
  });
});
