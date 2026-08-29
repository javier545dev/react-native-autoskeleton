// src/core/shimmer-period.ts
//
// ADR-8 says ONE shared shimmer clock, phase derived from a single absolute
// origin, so every skeleton and every list cell shimmers in phase with zero
// cross-instance coordination. `SkeletonTheme.speedMs` — the clock's PERIOD —
// is nevertheless per-`SkeletonProvider`, and a screen may mount two
// `<AutoSkeleton>` trees under two different themes. ADR-8 never said what
// happens then, and each of the three surfaces answered differently:
//
//   * iOS   — `AutoskeletonOverlayViewHost.mountOrUpdate` called
//             `clock.setPeriod(speedMs)` on every fresh mount (last writer
//             wins), but `AutoskeletonRendererTier1.applyShimmer` had already
//             baked `clock.periodMs` into a `CABasicAnimation.duration` at ITS
//             mount. Already-running skeletons kept the old period, new ones
//             got the new one: two periods on screen at once, permanently
//             drifting apart — the exact thing ADR-8 exists to prevent.
//   * Android — same last-writer-wins `setPeriod`, but the draw pass reads
//             `clock.phaseAt(now)` live every frame, so a retune changed the
//             period AND discontinuously jumped the phase of every skeleton
//             already on screen.
//   * Web   — `theme.speedMs` reached nothing at all. The module-scope
//             `sharedClock` was built with `createShimmerClock()`'s 1400 ms
//             default, `setPeriod` was never called from any web code path,
//             and the renderer writes `--askl-speed` from `clock.periodMs`.
//             Every `speedMs` a web consumer ever set was silently discarded.
//
// RESOLUTION (uniform on all three surfaces): the FIRST period that reaches a
// mounted skeleton is adopted for the life of the JS context. Every later
// request for a DIFFERENT period returns the adopted one and is reported once
// on dev builds. Rationale:
//
//   * It keeps ADR-8's guarantee literally true — one clock, one period, no
//     phase discontinuity ever, no two-periods-on-screen drift.
//   * It is the only option with no visible artefact: retuning a live clock
//     (Android's behaviour) jumps every skeleton on screen at the moment an
//     unrelated subtree happens to mount.
//   * It is honest — a value that cannot be honoured produces a warning
//     naming the ignored value, the effective one, and the way out.
//
// This arbiter runs in JS, UPSTREAM of all three renderers, which is what
// makes the behaviour identical across them rather than three near-misses:
// the native `speedMs` prop carries the already-arbitrated value, so the
// Swift/Kotlin clocks never see a conflicting period at all. Their own
// `setPeriod` is deliberately left last-writer-wins — after a Fast Refresh
// the JS arbiter resets while the native clock singleton survives, and only
// a permissive native `setPeriod` lets the new JS-side period take effect.
//
// The trade-off the maintainer may want to revisit is recorded in the task
// log: the alternative is one clock PER DISTINCT PERIOD, which honours every
// `speedMs` at the cost of dropping cross-theme phase alignment (and ADR-8's
// "one clock" wording).
//
// Observability: the dev warning below IS the observability deliverable —
// this failure mode was silent by construction on all three platforms.
// Performance: pure module-scope arithmetic, never on a per-frame path.

/** The adopted shared period, or `undefined` before the first skeleton
 *  mounts. Module scope, exactly like the clocks themselves. */
let adoptedPeriodMs: number | undefined;

/** Rejected values already reported, so a re-render storm cannot turn one
 *  mistake into a console flood. Warn-once granularity is per DISTINCT
 *  rejected value — a second, different bad value is a second, different
 *  mistake — matching `src/native/Hint.tsx`'s once-per-distinct-pair latch. */
const reportedRejections = new Set<number>();

/** Pure formatter, unit-testable with no environment dependency — the
 *  `formatXWarning` / emit split `core/metrics.ts` and
 *  `web/ssr/uncaptured-warning.ts` already established. */
export function formatSharedShimmerPeriodConflictWarning(requestedMs: number, adoptedMs: number): string {
  return (
    `[autoskeleton] A SkeletonTheme asked for speedMs=${requestedMs}, but the shared shimmer ` +
    `clock is already running at ${adoptedMs}ms and was NOT retuned. ADR-8 gives every skeleton ` +
    'ONE clock so they shimmer in phase, so the first period to reach a mounted skeleton wins. ' +
    `Use the same speedMs everywhere, or drop it and accept ${adoptedMs}ms.`
  );
}

/** Returns the shared shimmer period actually in effect, adopting
 *  `requestedMs` if nothing has been adopted yet. On dev builds, a request
 *  that cannot be honoured is reported once.
 *
 *  Idempotent and side-effect-free apart from that first adoption and the
 *  one-shot warning, so it is safe to call from a render body (React strict
 *  mode's double render produces the same value and no second warning). */
export function resolveSharedShimmerPeriodMs(requestedMs: number): number {
  if (adoptedPeriodMs === undefined) {
    adoptedPeriodMs = requestedMs;
    return requestedMs;
  }
  // `process.env.NODE_ENV` is read FIRST, bare, and without a `typeof process`
  // guard ON PURPOSE — that exact shape is what a real consumer's bundler
  // (Vite/webpack/Metro all substitute the literal) folds to `false`, letting
  // the whole branch AND the ~380-character warning string above be
  // dead-code-eliminated from a production web bundle. Measured: keeping the
  // `typeof process !== 'undefined' &&` form used by
  // `web/ssr/uncaptured-warning.ts` defeats the fold and costs 234 B of
  // NFR-6's remaining 425 B of headroom for prose no production consumer can
  // ever see. `web/AutoSkeleton.tsx`'s own `devWarningsEnabled()` already
  // relies on the same bare form, so the web entry already requires the
  // define; on native, Metro's babel transform provides it.
  if (
    process.env['NODE_ENV'] !== 'production' &&
    requestedMs !== adoptedPeriodMs &&
    !reportedRejections.has(requestedMs)
  ) {
    reportedRejections.add(requestedMs);
    console.warn(formatSharedShimmerPeriodConflictWarning(requestedMs, adoptedPeriodMs));
  }
  return adoptedPeriodMs;
}

/** TEST SEAM ONLY. Adoption is module-scope process state by design (that is
 *  what makes it shared); tests need a way back to "nothing adopted yet"
 *  without reloading the module graph. */
export function __resetSharedShimmerPeriodForTests(): void {
  adoptedPeriodMs = undefined;
  reportedRejections.clear();
}
