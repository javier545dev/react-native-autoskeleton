// src/core/list.ts
//
// Phase 6 (tasks.md 6.1-6.4): the platform-agnostic POLICY layer behind
// virtualized-list skeletons (ADR-13 "zero traversal on bind, ever";
// RISK-3). Mirrors ADR-9's split ("native holds shape DATA, JS holds
// POLICY"): this module owns the DECISION of whether a bind should ever
// reach a sensor at all. `src/native/list/*` is a thin React wrapper around
// these pure functions — the wrapper is what native E2E proves; this module
// is what Vitest proves, deterministically, with no React/RN runtime
// required (ADR-4: `src/core/` has zero platform imports).

import type { ShapeInfo } from './types';

/** A never-seen `itemType` is measured from exactly one template cell, at
 *  most once, ever — tracked per `itemType` so N cells binding concurrently
 *  never each schedule their own traversal (RISK-3's explicit assertion:
 *  "the traversal counter stays flat"). Re-measurement after cache eviction
 *  is a deliberate v1 non-goal, mirroring the LRU-eviction ASSUMPTION in
 *  plan.md §3.3 — `reset()` exists for tests and explicit invalidation only. */
export type TemplateMeasurementState = 'idle' | 'scheduled' | 'measured';

export interface TemplateRegistry {
  stateFor(itemType: string): TemplateMeasurementState;
  markScheduled(itemType: string): void;
  markMeasured(itemType: string): void;
  /** Reverts a single `itemType` (or, with no argument, every `itemType`)
   *  back to `'idle'`. Test seam and explicit-invalidation seam. */
  reset(itemType?: string): void;
}

export function createTemplateRegistry(): TemplateRegistry {
  const state = new Map<string, TemplateMeasurementState>();
  return {
    stateFor(itemType) {
      return state.get(itemType) ?? 'idle';
    },
    markScheduled(itemType) {
      state.set(itemType, 'scheduled');
    },
    markMeasured(itemType) {
      state.set(itemType, 'measured');
    },
    reset(itemType) {
      if (itemType === undefined) {
        state.clear();
      } else {
        state.delete(itemType);
      }
    },
  };
}

export interface CellBindDecision {
  /** The ONLY decision this module ever hands back that can lead to a
   *  traversal — and even then only a DEFERRED one (the caller schedules it
   *  via `runAfterInteractions`, never runs it synchronously). There is no
   *  return shape meaning "traverse now": a bind's only synchronous action
   *  is always a cache read. */
  readonly shouldScheduleTemplateMeasurement: boolean;
}

/** REQ-LIST-CELL-1 / ADR-13's direct decision function: given whether this
 *  bind's composite cache key is already cached, and the itemType's current
 *  template-measurement state, decide whether THIS bind may schedule the
 *  itemType's one-time deferred template measurement. */
export function decideCellBind(
  cacheHit: boolean,
  templateState: TemplateMeasurementState,
): CellBindDecision {
  return { shouldScheduleTemplateMeasurement: !cacheHit && templateState === 'idle' };
}

export interface TraversalCounter {
  readonly count: number;
  increment(): void;
  reset(): void;
}

/** Dev-only observability seam (mirrors `AutoskeletonWarningEmitter`'s
 *  established injectable-seam pattern, tasks.md G.3): counts ONLY
 *  traversals that actually executed via a deferred template measurement —
 *  never incremented from a bind call. Native E2E reads this via a
 *  queryable on-screen node (see `examples/bare-rn`); Vitest exercises it
 *  directly. */
export function createTraversalCounter(): TraversalCounter {
  let count = 0;
  return {
    get count() {
      return count;
    },
    increment() {
      count += 1;
    },
    reset() {
      count = 0;
    },
  };
}

/** REQ-LIST-EMPTY-1/REQ-LIST-PAGE-1: N synthetic rows are always N repeated
 *  renders of the SAME single-cell snapshot (every row of a given
 *  `itemType` shares one shape) — never N independent traversals. Pure,
 *  order-stable key builder shared by `SkeletonList` and
 *  `SkeletonListFooter` (React `key` prop stability across re-renders). */
export function buildSyntheticRowKeys(estimatedCount: number, prefix: string): readonly string[] {
  const n = Math.max(0, Math.trunc(estimatedCount));
  return Array.from({ length: n }, (_, i) => `${prefix}-${i}`);
}

/** REQ-LIST-CELL-1's fallback path: a deterministic, generic two-line-card
 *  shape set rendered the INSTANT an `itemType` is unseen, so a bind never
 *  waits on measurement to render something (immediate fallback, never a
 *  blank frame). Not derived from any real traversal — deliberately
 *  generic, mirroring ADR-12's "neutral, deterministic block" strategy for
 *  an uncaptured SSR key. Distinguishable from a real measured snapshot by
 *  construction (`isFallback` on the hook/component result), never dressed
 *  up to look like real data. */
export const FALLBACK_CELL_SHAPES: readonly ShapeInfo[] = [
  { x: 0, y: 0, w: 48, h: 48, r: 24, source: 'container' },
  { x: 60, y: 4, w: 180, h: 14, r: 4, source: 'synthetic-line' },
  { x: 60, y: 26, w: 120, h: 14, r: 4, source: 'synthetic-line' },
];
