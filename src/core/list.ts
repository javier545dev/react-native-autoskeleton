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

import type { ShapeCacheKey } from './cache-key';
import type { ShapeInfo } from './types';

/** A never-seen cell geometry is measured from exactly one template cell, at
 *  most once (per successful measurement), ever — tracked per COMPOSITE
 *  CACHE KEY so N cells binding concurrently never each schedule their own
 *  traversal (RISK-3's explicit assertion: "the traversal counter stays
 *  flat"): concurrent siblings of one list share one cache key, so RISK-3's
 *  guarantee is exactly preserved.
 *
 *  Adversarial-review defect (2026-08-29): this was keyed by `itemType`
 *  while the cache it guards is keyed by the full composite key, so one
 *  `'measured'` mark suppressed measurement for EVERY other cache key
 *  sharing that itemType. Two reachable consequences, both permanent for the
 *  app session: (1) two lists with the same `itemType` but different
 *  `skeletonKey` — the public `useSkeletonCell` API allows exactly this —
 *  where the second never measures; (2) far more common, ANY change to a
 *  dimension of the cache key (a rotation crossing a `bucketWidth`, a font-
 *  scale change, an RTL flip) produces a cache MISS whose measurement the
 *  itemType-keyed `'measured'` mark then blocks, pinning that list to
 *  `FallbackSkeletonBlock` forever in the new configuration.
 *
 *  Keying by the composite key cannot cost extra traversals: a distinct
 *  cache key is by definition distinct geometry that needs its own
 *  measurement anyway, and the shared mark was never preventing a
 *  traversal — it was preventing the CORRECT one. `ShapeCacheKey` is
 *  branded, so passing a bare `itemType` here is now a compile error rather
 *  than a silent behavioural bug.
 *  Re-measurement after cache eviction is a deliberate v1 non-goal,
 *  mirroring the LRU-eviction ASSUMPTION in plan.md §3.3 — `reset()` exists
 *  for tests and explicit invalidation only.
 *
 *  `'failed'` (adversarial-review defect, 2026-08-28): a DISTINCT terminal
 *  outcome from `'measured'` for the "gave up" paths (template never laid
 *  out; RAF retries exhausted with no native result) — a failed attempt
 *  must never masquerade as a successful one, or the itemType gets marked
 *  "done" with nothing ever written to the cache, permanently blocking any
 *  future retry (even by a different, valid cell instance). Bounded, not
 *  silently retried forever: see `MAX_MEASUREMENT_ATTEMPTS`. */
export type TemplateMeasurementState = 'idle' | 'scheduled' | 'measured' | 'failed';

/** Ceiling on how many times a single `itemType` may re-attempt its
 *  one-time template measurement after a `'failed'` outcome
 *  (adversarial-review defect, 2026-08-28). Bounded deliberately: an
 *  itemType whose `renderTemplate` deterministically produces zero-size
 *  content (or whose native view genuinely never mounts) would otherwise
 *  retry on every single bind, forever — a silent hot-loop, not a fix. Once
 *  exhausted, the itemType stays `'failed'` and `decideCellBind` never
 *  schedules it again for the rest of the app session (mirrors the
 *  existing "at most once, ever" contract `'measured'` already has) — an
 *  OBSERVABLE ceiling (`attemptsFor`), not a silently-decided one. 3 is
 *  generous relative to `MAX_LAYOUT_WAIT_FRAMES`'s own already-bounded
 *  per-attempt RAF retry budget (`useTemplateMeasurement.ts`): each of the
 *  3 attempts gets its own full frame-wait budget, so a transient timing
 *  gap gets several independent chances before the itemType gives up for
 *  good. */
export const MAX_MEASUREMENT_ATTEMPTS = 3;

export interface TemplateRegistry {
  stateFor(cacheKey: ShapeCacheKey): TemplateMeasurementState;
  /** Number of `markFailed` calls recorded for this `itemType` so far
   *  (`0` for an itemType that has never failed). Pure observability seam
   *  (mirrors `TraversalCounter`'s established pattern) so the
   *  `MAX_MEASUREMENT_ATTEMPTS` ceiling is inspectable, never silent. */
  attemptsFor(cacheKey: ShapeCacheKey): number;
  markScheduled(cacheKey: ShapeCacheKey): void;
  markMeasured(cacheKey: ShapeCacheKey): void;
  /** Records a "gave up" outcome — DISTINCT from `markMeasured`, never
   *  writes/implies a cache entry exists. Increments `attemptsFor`.
   *  Adversarial-review defect, 2026-08-28: the give-up branches used to
   *  call `markMeasured` with nothing cached, permanently poisoning the
   *  itemType. */
  markFailed(cacheKey: ShapeCacheKey): void;
  /** Releases a `'scheduled'` claim back to `'idle'` WITHOUT touching
   *  `attemptsFor` — the measurement was neither a success nor a failure,
   *  it simply never got to run (the claiming cell was recycled to a
   *  different itemType, or genuinely unmounted, before its deferred
   *  measurement resolved). No-op for any other state (`'idle'`,
   *  `'measured'`, `'failed'`): never un-measures a real success, and a
   *  failed itemType's bounded retry already goes through `markScheduled`
   *  directly. Adversarial-review defect, 2026-08-28: this method did not
   *  exist at all — a cancelled/recycled measurement had NO way to release
   *  its claim, permanently stranding that itemType at `'scheduled'` for
   *  the rest of the app session. */
  releaseClaim(cacheKey: ShapeCacheKey): void;
  /** Reverts a single `itemType` (or, with no argument, every `itemType`)
   *  back to `'idle'`, ALSO clearing its `attemptsFor` count. Test seam and
   *  explicit-invalidation seam — unlike `releaseClaim`, this is a hard
   *  reset, not a production cancellation signal. */
  reset(cacheKey?: ShapeCacheKey): void;
}

export function createTemplateRegistry(): TemplateRegistry {
  const state = new Map<string, TemplateMeasurementState>();
  const attempts = new Map<string, number>();
  return {
    stateFor(cacheKey) {
      return state.get(cacheKey) ?? 'idle';
    },
    attemptsFor(cacheKey) {
      return attempts.get(cacheKey) ?? 0;
    },
    markScheduled(cacheKey) {
      state.set(cacheKey, 'scheduled');
    },
    markMeasured(cacheKey) {
      state.set(cacheKey, 'measured');
    },
    markFailed(cacheKey) {
      state.set(cacheKey, 'failed');
      attempts.set(cacheKey, (attempts.get(cacheKey) ?? 0) + 1);
    },
    releaseClaim(cacheKey) {
      if (state.get(cacheKey) === 'scheduled') {
        state.set(cacheKey, 'idle');
      }
    },
    reset(cacheKey) {
      if (cacheKey === undefined) {
        state.clear();
        attempts.clear();
      } else {
        state.delete(cacheKey);
        attempts.delete(cacheKey);
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
 *  bind's composite cache key is already cached, that KEY's current
 *  template-measurement state, and how many times it has already failed
 *  (`registry.attemptsFor`), decide whether THIS bind may schedule the
 *  deferred template measurement for that key.
 *
 *  `'idle'` always schedules (the first-ever attempt). `'failed'` schedules
 *  again ONLY while `failedAttempts < MAX_MEASUREMENT_ATTEMPTS` — a bounded
 *  retry, never a silent infinite loop (adversarial-review defect,
 *  2026-08-28: see `MAX_MEASUREMENT_ATTEMPTS`'s own doc comment). Once
 *  exhausted, a `'failed'` key behaves exactly like `'measured'`: never
 *  scheduled again. */
export function decideCellBind(
  cacheHit: boolean,
  templateState: TemplateMeasurementState,
  failedAttempts: number,
): CellBindDecision {
  if (cacheHit) {
    return { shouldScheduleTemplateMeasurement: false };
  }
  if (templateState === 'idle') {
    return { shouldScheduleTemplateMeasurement: true };
  }
  if (templateState === 'failed' && failedAttempts < MAX_MEASUREMENT_ATTEMPTS) {
    return { shouldScheduleTemplateMeasurement: true };
  }
  return { shouldScheduleTemplateMeasurement: false };
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
