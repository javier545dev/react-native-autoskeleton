// src/core/metrics.ts
//
// plan.md §2 module layout: budget checks, dev warnings, and `onMetrics`
// assembly. `assembleMetrics` (task 1.8) composes the full `SkeletonMetrics`
// payload from a `SensorResult`, the cache-hit/ttfs/handoff inputs, and the
// executing platform/renderer — this task IS the metrics-assembly module,
// covering REQ-OBS-METRICS-1's cold-load and hot-load scenarios.
//
// Observability: this module IS REQ-OBS-BUDGET-1's deliverable — it emits the
// dev-only budget warnings, not just types describing them.
// Performance: the budget constants below are the NFR-3 threshold (2 ms) and
// the shape cap (60), matching spec §3 exactly, both configurable per
// `SensorOptions.budgetMs`/`maxShapes`. `assembleMetrics` itself is pure
// composition — N/A for performance.

import type { SensorResult } from './contracts';
import type {
  DegradationFlag,
  HandoffReason,
  Platform,
  RadiusSource,
  RadiusSourceHistogram,
  RendererKind,
  SkeletonMetrics,
} from './types';
import { RADIUS_SOURCES, WIRE_HEADER_SLOTS, WIRE_STRIDE } from './types';

/** NFR-3: native traversal budget in milliseconds, p95. */
export const DEFAULT_BUDGET_MS = 2;
/** REQ-OBS-BUDGET-1: default shape-count budget per screen. */
export const DEFAULT_MAX_SHAPES = 60;

export interface BudgetOptions {
  readonly budgetMs?: number;
  readonly maxShapes?: number;
}

export interface BudgetCheckResult {
  readonly budgetExceeded: boolean;
  readonly shapeCapExceeded: boolean;
  /** Actionable dev-build warning strings; empty when nothing was exceeded. */
  readonly warnings: readonly string[];
}

/** REQ-OBS-BUDGET-1 scenario: "traversal exceeds the default time budget" —
 *  the message cites the measured time, the budget, and an actionable
 *  suggestion (reduce subtree depth, or use `<AutoSkeleton.Ignore>`). */
export function formatBudgetWarning(measuredMs: number, budgetMs: number): string {
  return (
    `[autoskeleton] traversal took ${measuredMs}ms, exceeding the configured ${budgetMs}ms ` +
    'budget. Consider reducing subtree depth or wrapping expensive branches in ' +
    '<AutoSkeleton.Ignore>.'
  );
}

/** REQ-OBS-BUDGET-1 scenario: "shape count exceeds the default budget" — the
 *  message cites the measured count, the budget, and an actionable
 *  suggestion. */
export function formatShapeCapWarning(measuredCount: number, maxShapes: number): string {
  return (
    `[autoskeleton] detected ${measuredCount} shapes, exceeding the configured ` +
    `${maxShapes}-shape budget. Consider <AutoSkeleton.Ignore> on decorative subtrees, or ` +
    'raise maxShapes via SkeletonProvider.'
  );
}

/** Evaluates a completed traversal against the configured budgets and builds
 *  the actionable warning strings for whichever budget was exceeded. Does
 *  not itself decide whether to log — see `emitBudgetWarnings`. */
export function checkBudgets(
  traversalMs: number,
  shapeCount: number,
  options: BudgetOptions = {},
): BudgetCheckResult {
  const budgetMs = options.budgetMs ?? DEFAULT_BUDGET_MS;
  const maxShapes = options.maxShapes ?? DEFAULT_MAX_SHAPES;
  const budgetExceeded = traversalMs > budgetMs;
  const shapeCapExceeded = shapeCount > maxShapes;

  const warnings: string[] = [];
  if (budgetExceeded) {
    warnings.push(formatBudgetWarning(traversalMs, budgetMs));
  }
  if (shapeCapExceeded) {
    warnings.push(formatShapeCapWarning(shapeCount, maxShapes));
  }

  return { budgetExceeded, shapeCapExceeded, warnings };
}

/** Emits every warning via `console.warn`. Callers gate this to dev builds
 *  only (`__DEV__`/`NODE_ENV !== 'production'`) — kept as a caller
 *  responsibility so this module stays a pure function over its inputs and
 *  is trivially testable without mocking a global dev flag. */
export function emitBudgetWarnings(result: BudgetCheckResult): void {
  for (const warning of result.warnings) {
    console.warn(warning);
  }
}

function buildRadiusSourceHistogram(radiusSources: Uint8Array | undefined): RadiusSourceHistogram {
  const histogram: Record<RadiusSource, number> = {
    measured: 0,
    outline: 0,
    'raster-probe': 0,
    hint: 0,
    default: 0,
  };
  if (radiusSources === undefined) {
    return histogram;
  }
  for (const code of radiusSources) {
    const source = RADIUS_SOURCES[code];
    if (source !== undefined) {
      histogram[source] += 1;
    }
  }
  return histogram;
}

function mergeDegraded(
  ...flagLists: readonly (readonly DegradationFlag[])[]
): readonly DegradationFlag[] {
  return Array.from(new Set(flagLists.flat()));
}

export interface AssembleMetricsHandoffInput {
  readonly displayDurationMs: number;
  readonly handoffMs: number;
  readonly handoffReason: HandoffReason;
}

export interface AssembleMetricsInput {
  readonly sensorResult: SensorResult;
  readonly cacheHit: boolean;
  readonly ttfsMs: number;
  readonly handoff: AssembleMetricsHandoffInput;
  readonly platform: Platform;
  readonly renderer: RendererKind;
}

/** Composes the full `onMetrics` payload from every contributing core
 *  module's output. `shapeCount` is derived from the snapshot's wire data
 *  (never a separately-tracked count — a redundant count is a second source
 *  of truth per plan.md §4.2). `radiusSourceHistogram` is tallied from the
 *  dev sidecar when present, or zeroed out when absent (production builds,
 *  or a sensor that ran with `collectDebugSidecars: false`). */
export function assembleMetrics(input: AssembleMetricsInput): SkeletonMetrics {
  const { snapshot, traversalMs, degraded: sensorDegraded } = input.sensorResult;
  const shapeCount = (snapshot.data.length - WIRE_HEADER_SLOTS) / WIRE_STRIDE;

  return {
    traversalMs,
    shapeCount,
    cacheHit: input.cacheHit,
    ttfsMs: input.ttfsMs,
    displayDurationMs: input.handoff.displayDurationMs,
    handoffMs: input.handoff.handoffMs,
    handoffReason: input.handoff.handoffReason,
    platform: input.platform,
    renderer: input.renderer,
    radiusSourceHistogram: buildRadiusSourceHistogram(snapshot.radiusSources),
    degraded: mergeDegraded(sensorDegraded, snapshot.degraded),
    cacheKey: snapshot.key,
  };
}
