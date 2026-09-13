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

/** There are two ways for a cycle to have no lifecycle worth reporting, and
 *  both are decided once per cycle, at cycle start (see both `AutoSkeleton`
 *  components' `cycleRef` construction).
 *
 *  `skeletonSuppressed` — `everShownContent && !skeletonOnRefresh`, REQ-PTR-1's
 *  stale-while-revalidate default. The skeleton never rendered, so there is no
 *  handoff to run and no metrics event to emit.
 *
 *  `startedLoading` — whether the cycle began in a loading state at all. Cycle
 *  0 is created on the very first render whatever `isLoading` says, so
 *  `<AutoSkeleton skeletonOnRefresh isLoading={false}>` used to open a cycle
 *  for a load that never happened: `everShownContent` initialises to
 *  `!isLoading` (true), and `skeletonSuppressed` is false because the consumer
 *  opted into skeletons on refresh, so the one-argument version of this gate
 *  said "run". The result was a skeleton painted over fully-rendered content,
 *  that content hidden from assistive technology while it was up, and an
 *  `onMetrics` event for a load that never occurred.
 *
 *  The second parameter has no default on purpose: adding one would have let
 *  the two call sites keep their old behaviour silently, which is the failure
 *  mode this gate exists to make impossible. */
export function shouldRunHandoffCycle(skeletonSuppressed: boolean, startedLoading: boolean): boolean {
  return !skeletonSuppressed && startedLoading;
}
