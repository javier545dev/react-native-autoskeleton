// src/core/refresh-gate.ts
//
// Task 6.5 (tasks.md Phase 6) / REQ-PTR-1: the pure predicate deciding
// whether a loading cycle's handoff/metrics lifecycle should run at all.
// Both `native/AutoSkeleton.tsx` and `web/AutoSkeleton.tsx` already compute
// `skeletonSuppressed` (REQ-PTR-1's stale-while-revalidate default), but
// prior to this task `useHandoffAndMetrics` in BOTH files ignored it
// entirely: it unconditionally called `controller.requestHandoff()` and
// unconditionally fired `onMetrics` once `controller.settled` resolved.
// Since a suppressed cycle never shows a skeleton, `onMetrics` firing for
// it is a real defect — an observable "skeleton-to-content lifecycle" event
// for a lifecycle that never visually occurred (REQ-PTR-1's own scenario:
// "existing content remains visible (no skeleton overlay)"). This predicate
// is the single, testable source of truth both platforms now defer to.

/** `skeletonSuppressed` is decided once per cycle (see both `AutoSkeleton`
 *  components' `cycleRef` construction) from `everShownContent &&
 *  !skeletonOnRefresh`. When true, the skeleton never rendered for this
 *  cycle, so there is no handoff to run and no metrics event to emit. */
export function shouldRunHandoffCycle(skeletonSuppressed: boolean): boolean {
  return !skeletonSuppressed;
}
