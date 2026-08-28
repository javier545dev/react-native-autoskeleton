package com.autoskeleton

import android.util.Log

// Task G.3 (tasks.md, observability gap closure, post-Phase-4) / spec.md
// REQ-OBS-BUDGET-1/2: dev-only budget and radius-fallback warnings for Android.
// Mirrors `src/core/metrics.ts`'s `checkBudgets`/`emitBudgetWarnings`/
// `checkRadiusFallback`/`emitRadiusFallbackWarning` semantics and thresholds
// EXACTLY (2ms traversal budget, 60-shape cap, 30% radius-fallback share, `>`
// never `>=`) — a warning that fires at a different threshold per platform is
// worse than no warning at all.
//
// Same injectable-seam pattern as `AutoskeletonTracing`: production code depends
// on `AutoskeletonWarningEmitter`, tests inject a recording double instead of
// asserting against real `Log.w` output (which Robolectric does not capture for
// inspection any more reliably than it does `Trace` section names).

/** NFR-3 / REQ-OBS-BUDGET-1: native traversal budget in milliseconds, p95 —
 *  matches `DEFAULT_BUDGET_MS` in `src/core/metrics.ts` and
 *  `AutoskeletonSensorOptions.budgetMs`'s own default. */
const val AUTOSKELETON_DEFAULT_BUDGET_MS = 2.0

/** REQ-OBS-BUDGET-1: default shape-count budget per screen — matches
 *  `DEFAULT_MAX_SHAPES` in `src/core/metrics.ts` and
 *  `AutoskeletonSensorOptions.maxShapes`'s own default. */
const val AUTOSKELETON_DEFAULT_MAX_SHAPES = 60

/** REQ-OBS-BUDGET-2: default share of a screen's shapes allowed to resolve
 *  their corner radius through the least-informed `default` rung before a dev
 *  warning fires. Matches `DEFAULT_RADIUS_FALLBACK_SHARE` in
 *  `src/core/metrics.ts` (ADR-2/RISK-1's documented 30% figure). */
const val AUTOSKELETON_DEFAULT_RADIUS_FALLBACK_SHARE = 0.3f

/** REQ-OBS-BUDGET-1 scenario: "traversal exceeds the default time budget" —
 *  cites the measured time, the budget, and an actionable suggestion. Mirrors
 *  `formatBudgetWarning` in `src/core/metrics.ts`. */
fun autoskeletonFormatBudgetWarning(measuredMs: Double, budgetMs: Double): String =
    "[autoskeleton] traversal took ${measuredMs}ms, exceeding the configured ${budgetMs}ms " +
        "budget. Consider reducing subtree depth or wrapping expensive branches in " +
        "<AutoSkeleton.Ignore>."

/** REQ-OBS-BUDGET-1 scenario: "shape count exceeds the default budget" —
 *  mirrors `formatShapeCapWarning` in `src/core/metrics.ts`. */
fun autoskeletonFormatShapeCapWarning(measuredCount: Int, maxShapes: Int): String =
    "[autoskeleton] detected $measuredCount shapes, exceeding the configured " +
        "$maxShapes-shape budget. Consider <AutoSkeleton.Ignore> on decorative subtrees, or " +
        "raise maxShapes via SkeletonProvider."

/** REQ-OBS-BUDGET-2 scenario: "radius fallback exceeds the configured share" —
 *  cites the measured count/percentage, the configured threshold, and the
 *  actionable remedy. Mirrors `formatRadiusFallbackWarning` in
 *  `src/core/metrics.ts`. */
fun autoskeletonFormatRadiusFallbackWarning(
    defaultCount: Int,
    totalCount: Int,
    share: Float,
    threshold: Float,
): String {
    val sharePct = Math.round(share * 100)
    val thresholdPct = Math.round(threshold * 100)
    return "[autoskeleton] $defaultCount/$totalCount shapes ($sharePct%) resolved their corner " +
        "radius through the 'default' fallback rung, exceeding the configured $thresholdPct% " +
        "threshold. Supply a radius hint on the affected views, or set " +
        "SkeletonProvider.defaultRadius to match your design."
}

data class AutoskeletonBudgetCheckResult(
    val budgetExceeded: Boolean,
    val shapeCapExceeded: Boolean,
    /** Actionable dev-build warning strings; empty when nothing was exceeded. */
    val warnings: List<String>,
)

/** Evaluates a completed traversal against the configured budgets and builds
 *  the actionable warning strings for whichever budget was exceeded. Does not
 *  itself decide whether to log — see [autoskeletonEmitWarnings]. Mirrors
 *  `checkBudgets` in `src/core/metrics.ts`. */
fun autoskeletonCheckBudgets(
    traversalMs: Double,
    shapeCount: Int,
    budgetMs: Double = AUTOSKELETON_DEFAULT_BUDGET_MS,
    maxShapes: Int = AUTOSKELETON_DEFAULT_MAX_SHAPES,
): AutoskeletonBudgetCheckResult {
    val budgetExceeded = traversalMs > budgetMs
    val shapeCapExceeded = shapeCount > maxShapes

    val warnings = mutableListOf<String>()
    if (budgetExceeded) {
        warnings.add(autoskeletonFormatBudgetWarning(traversalMs, budgetMs))
    }
    if (shapeCapExceeded) {
        warnings.add(autoskeletonFormatShapeCapWarning(shapeCount, maxShapes))
    }

    return AutoskeletonBudgetCheckResult(budgetExceeded, shapeCapExceeded, warnings)
}

data class AutoskeletonRadiusFallbackCheckResult(
    val shareExceeded: Boolean,
    val defaultCount: Int,
    val totalCount: Int,
    /** `defaultCount / totalCount`, or `0` when `totalCount` is `0`. */
    val share: Float,
    /** Actionable dev-build warning strings; empty when the share was at or
     *  below the threshold, or when there were no shapes to tally. */
    val warnings: List<String>,
)

/** Evaluates a completed traversal's per-shape radius sources against the
 *  configured fallback-share threshold and builds the actionable warning when
 *  exceeded. Does not itself decide whether to log — see
 *  [autoskeletonEmitWarnings]. Mirrors `checkRadiusFallback` in
 *  `src/core/metrics.ts` (same `>` not `>=` semantics: exactly-at-threshold
 *  does NOT fire). */
fun autoskeletonCheckRadiusFallback(
    radiusSources: List<AutoskeletonRadiusSource>,
    threshold: Float = AUTOSKELETON_DEFAULT_RADIUS_FALLBACK_SHARE,
): AutoskeletonRadiusFallbackCheckResult {
    val totalCount = radiusSources.size
    val defaultCount = radiusSources.count { it == AutoskeletonRadiusSource.DEFAULT }
    val share = if (totalCount == 0) 0f else defaultCount.toFloat() / totalCount
    val shareExceeded = totalCount > 0 && share > threshold

    val warnings = if (shareExceeded) {
        listOf(autoskeletonFormatRadiusFallbackWarning(defaultCount, totalCount, share, threshold))
    } else {
        emptyList()
    }

    return AutoskeletonRadiusFallbackCheckResult(shareExceeded, defaultCount, totalCount, share, warnings)
}

/** Test/telemetry seam for warning delivery — same rationale as
 *  `AutoskeletonTracing`: `Log.w` is a fire-and-forget system call with
 *  nothing to assert on directly from a test, so production code depends on
 *  this interface and tests inject a recording double instead. */
interface AutoskeletonWarningEmitter {
    fun warn(message: String)
}

private const val AUTOSKELETON_LOG_TAG = "Autoskeleton"

/** Production implementation: a real `Log.w` call, dev-gated by the caller
 *  (mirrors `emitBudgetWarnings`/`emitRadiusFallbackWarning`'s web contract:
 *  "kept as a caller responsibility so this module stays a pure function over
 *  its inputs"). */
class AutoskeletonSystemWarningEmitter : AutoskeletonWarningEmitter {
    override fun warn(message: String) {
        Log.w(AUTOSKELETON_LOG_TAG, message)
    }
}

/** Test double: records every warning, in order, so a test can assert the
 *  real measurement path actually emitted one — not just that a formatter
 *  produced the right string in isolation. */
class AutoskeletonRecordingWarningEmitter : AutoskeletonWarningEmitter {
    val warnings = mutableListOf<String>()

    override fun warn(message: String) {
        warnings.add(message)
    }
}

/** Emits every warning via [emitter]. Mirrors `emitWarnings`/
 *  `emitBudgetWarnings`/`emitRadiusFallbackWarning` in `src/core/metrics.ts`. */
fun autoskeletonEmitWarnings(warnings: List<String>, emitter: AutoskeletonWarningEmitter) {
    for (warning in warnings) {
        emitter.warn(warning)
    }
}
