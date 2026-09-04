// src/native/tier2/shimmerOrigin.ts
//
// ADR-8 ("one clock, phase derived from an absolute origin — never from JS
// ticks") for the tier-2 renderer.
//
// WHY THIS FILE EXISTS AT ALL. Tier-1 joins the wave by reading the NATIVE
// `AutoskeletonShimmerClock`'s `startedAt` and handing CoreAnimation /
// Choreographer a negative start offset (`ios/AutoskeletonRendererTier1.swift`
// `applyShimmer()`: `animation.beginTime = CACurrentMediaTime() +
// clock.phaseOffsetMs(now:) / 1000`). Tier-2 runs entirely in JS/Reanimated and
// has NO route to that value — `src/native/NativeAutoskeleton.ts`'s whole
// TurboModule surface is `getShapes` and `evictShapes`; `startedAt` is never
// exposed. Until it is, tier-2 can only share an origin with OTHER TIER-2
// instances, which is what this module provides. The cross-tier gap is real,
// is NOT closed by this file, and is documented in the task report rather than
// papered over.
//
// The origin is module scope on purpose — that is precisely what makes it
// shared. Every `<AutoSkeleton>` rendered through the tier-2 overlay in one JS
// context reads the same `TIER2_SHIMMER_ORIGIN_MS`, so a skeleton that mounts
// 900 ms after another one starts its sweep 900 ms INTO the cycle rather than
// at zero. Same mechanism as `core/shimmer-period.ts`'s module-scope adopted
// period, and same reason.

/** Epoch-ms origin of the tier-2 shimmer wave, fixed for the life of the JS
 *  context. Captured at module evaluation, which is the earliest moment any
 *  tier-2 instance can possibly exist. */
export const TIER2_SHIMMER_ORIGIN_MS = Date.now();

/** Normalized phase in `[0, 1)` of the shared tier-2 wave at `nowMs`.
 *
 *  Pure and total: mirrors `AutoskeletonShimmerClock.phaseAt` (Swift) and
 *  `createShimmerClock().phaseAt` (`src/web/css-renderer.ts`) exactly,
 *  including the double-modulo that keeps a negative elapsed time (a clock
 *  that moved backwards) inside the range instead of producing a negative
 *  phase. A non-positive `periodMs` has no wave to be in phase with, so it
 *  degenerates to 0 rather than dividing by zero. */
export function tier2PhaseAt(nowMs: number, periodMs: number, originMs: number = TIER2_SHIMMER_ORIGIN_MS): number {
  if (!(periodMs > 0)) {
    return 0;
  }
  const elapsed = nowMs - originMs;
  const wrapped = ((elapsed % periodMs) + periodMs) % periodMs;
  return wrapped / periodMs;
}
