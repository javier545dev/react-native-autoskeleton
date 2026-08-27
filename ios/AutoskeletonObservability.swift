import Foundation
import os

// Task G.3 (tasks.md, observability gap closure, post-Phase-4) / spec.md
// REQ-OBS-BUDGET-1/2: dev-only budget and radius-fallback warnings for iOS.
// Mirrors `src/core/metrics.ts`'s `checkBudgets`/`emitBudgetWarnings`/
// `checkRadiusFallback`/`emitRadiusFallbackWarning` semantics and thresholds
// EXACTLY (2ms traversal budget, 60-shape cap, 30% radius-fallback share, `>`
// never `>=`) — a warning that fires at a different threshold per platform is
// worse than no warning at all.
//
// Same injectable-seam pattern as `AutoskeletonTracing`: production code
// depends on `AutoskeletonWarningEmitter`, tests inject a recording double
// instead of asserting against real `os_log` output.
//
// **iOS radius-fallback finding, verified (not assumed) against
// `AutoskeletonSensor.swift`**: `radiusSource` is unconditionally `.measured`
// in `leafShapes` — iOS resolves every shape's radius via the fully public
// `layer.cornerRadius`, which always returns a concrete `CGFloat` (0 when
// unset, never "unknown"). There is NO code path in this sensor that ever
// assigns `.defaultValue`. The positive-fire branch of
// `autoskeletonCheckRadiusFallback` is therefore provably UNREACHABLE via any
// real `UIView` traversal on this platform — not merely rare, as the prior
// unverified note in tasks.md speculated. Wiring `checkRadiusFallback` into
// `measure()` here is DEFENSIVE, matching ADR-2's mandate that "iOS reports
// the same histogram so consumers see Android degradation instead of
// guessing" — the positive-fire branch is validated at THIS pure-function
// layer (`AutoskeletonObservabilityTests.swift`), the only layer capable of
// exercising it on iOS.

/// NFR-3 / REQ-OBS-BUDGET-1: native traversal budget in milliseconds, p95 —
/// matches `DEFAULT_BUDGET_MS` in `src/core/metrics.ts` and
/// `AutoskeletonSensorOptions.defaults.budgetMs`.
let autoskeletonDefaultBudgetMs: Double = 2

/// REQ-OBS-BUDGET-1: default shape-count budget per screen — matches
/// `DEFAULT_MAX_SHAPES` in `src/core/metrics.ts` and
/// `AutoskeletonSensorOptions.defaults.maxShapes`.
let autoskeletonDefaultMaxShapes = 60

/// REQ-OBS-BUDGET-2: default share of a screen's shapes allowed to resolve
/// their corner radius through the least-informed `default` rung before a dev
/// warning fires. Matches `DEFAULT_RADIUS_FALLBACK_SHARE` in
/// `src/core/metrics.ts` (ADR-2/RISK-1's documented 30% figure).
let autoskeletonDefaultRadiusFallbackShare: Double = 0.3

/// REQ-OBS-BUDGET-1 scenario: "traversal exceeds the default time budget" —
/// cites the measured time, the budget, and an actionable suggestion. Mirrors
/// `formatBudgetWarning` in `src/core/metrics.ts`.
func autoskeletonFormatBudgetWarning(measuredMs: Double, budgetMs: Double) -> String {
    "[autoskeleton] traversal took \(measuredMs)ms, exceeding the configured \(budgetMs)ms " +
        "budget. Consider reducing subtree depth or wrapping expensive branches in " +
        "<AutoSkeleton.Ignore>."
}

/// REQ-OBS-BUDGET-1 scenario: "shape count exceeds the default budget" —
/// mirrors `formatShapeCapWarning` in `src/core/metrics.ts`.
func autoskeletonFormatShapeCapWarning(measuredCount: Int, maxShapes: Int) -> String {
    "[autoskeleton] detected \(measuredCount) shapes, exceeding the configured " +
        "\(maxShapes)-shape budget. Consider <AutoSkeleton.Ignore> on decorative subtrees, or " +
        "raise maxShapes via SkeletonProvider."
}

/// REQ-OBS-BUDGET-2 scenario: "radius fallback exceeds the configured share"
/// — cites the measured count/percentage, the configured threshold, and the
/// actionable remedy. Mirrors `formatRadiusFallbackWarning` in
/// `src/core/metrics.ts`.
func autoskeletonFormatRadiusFallbackWarning(
    defaultCount: Int,
    totalCount: Int,
    share: Double,
    threshold: Double
) -> String {
    let sharePct = Int((share * 100).rounded())
    let thresholdPct = Int((threshold * 100).rounded())
    return "[autoskeleton] \(defaultCount)/\(totalCount) shapes (\(sharePct)%) resolved their corner " +
        "radius through the 'default' fallback rung, exceeding the configured \(thresholdPct)% " +
        "threshold. Supply a radius hint on the affected views, or set " +
        "SkeletonProvider.defaultRadius to match your design."
}

struct AutoskeletonBudgetCheckResult {
    let budgetExceeded: Bool
    let shapeCapExceeded: Bool
    /// Actionable dev-build warning strings; empty when nothing was exceeded.
    let warnings: [String]
}

/// Evaluates a completed traversal against the configured budgets and builds
/// the actionable warning strings for whichever budget was exceeded. Does not
/// itself decide whether to log — see `autoskeletonEmitWarnings`. Mirrors
/// `checkBudgets` in `src/core/metrics.ts`.
func autoskeletonCheckBudgets(
    traversalMs: Double,
    shapeCount: Int,
    budgetMs: Double = autoskeletonDefaultBudgetMs,
    maxShapes: Int = autoskeletonDefaultMaxShapes
) -> AutoskeletonBudgetCheckResult {
    let budgetExceeded = traversalMs > budgetMs
    let shapeCapExceeded = shapeCount > maxShapes

    var warnings: [String] = []
    if budgetExceeded {
        warnings.append(autoskeletonFormatBudgetWarning(measuredMs: traversalMs, budgetMs: budgetMs))
    }
    if shapeCapExceeded {
        warnings.append(autoskeletonFormatShapeCapWarning(measuredCount: shapeCount, maxShapes: maxShapes))
    }

    return AutoskeletonBudgetCheckResult(budgetExceeded: budgetExceeded, shapeCapExceeded: shapeCapExceeded, warnings: warnings)
}

struct AutoskeletonRadiusFallbackCheckResult {
    let shareExceeded: Bool
    let defaultCount: Int
    let totalCount: Int
    /// `defaultCount / totalCount`, or `0` when `totalCount` is `0`.
    let share: Double
    /// Actionable dev-build warning strings; empty when the share was at or
    /// below the threshold, or when there were no shapes to tally.
    let warnings: [String]
}

/// Evaluates a completed traversal's per-shape radius sources against the
/// configured fallback-share threshold and builds the actionable warning when
/// exceeded. Does not itself decide whether to log — see
/// `autoskeletonEmitWarnings`. Mirrors `checkRadiusFallback` in
/// `src/core/metrics.ts` (same `>` not `>=` semantics: exactly-at-threshold
/// does NOT fire).
func autoskeletonCheckRadiusFallback(
    radiusSources: [AutoskeletonRadiusSource],
    threshold: Double = autoskeletonDefaultRadiusFallbackShare
) -> AutoskeletonRadiusFallbackCheckResult {
    let totalCount = radiusSources.count
    let defaultCount = radiusSources.filter { $0 == .defaultValue }.count
    let share = totalCount == 0 ? 0 : Double(defaultCount) / Double(totalCount)
    let shareExceeded = totalCount > 0 && share > threshold

    let warnings = shareExceeded
        ? [autoskeletonFormatRadiusFallbackWarning(defaultCount: defaultCount, totalCount: totalCount, share: share, threshold: threshold)]
        : []

    return AutoskeletonRadiusFallbackCheckResult(
        shareExceeded: shareExceeded,
        defaultCount: defaultCount,
        totalCount: totalCount,
        share: share,
        warnings: warnings
    )
}

/// Test/telemetry seam for warning delivery — same rationale as
/// `AutoskeletonTracing`: `os_log` has no public way to assert "this exact
/// message was logged" from XCTest, so production code depends on this
/// protocol and tests inject a recording double instead.
protocol AutoskeletonWarningEmitter {
    func warn(_ message: String)
}

/// Production implementation: a real `Logger` warning on a dedicated `OSLog`
/// subsystem/category, same pattern as `AutoskeletonSignpostTracing`.
final class AutoskeletonSystemWarningEmitter: AutoskeletonWarningEmitter {
    private let logger: Logger

    init(subsystem: String = "com.autoskeleton", category: String = "AutoskeletonSensor") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    func warn(_ message: String) {
        logger.warning("\(message, privacy: .public)")
    }
}

/// Test double: records every warning, in order, so a test can assert the
/// real measurement path actually emitted one — not just that a formatter
/// produced the right string in isolation.
final class AutoskeletonRecordingWarningEmitter: AutoskeletonWarningEmitter {
    private(set) var warnings: [String] = []

    func warn(_ message: String) {
        warnings.append(message)
    }
}

/// Emits every warning via `emitter`. Mirrors `emitWarnings`/
/// `emitBudgetWarnings`/`emitRadiusFallbackWarning` in `src/core/metrics.ts`.
func autoskeletonEmitWarnings(_ warnings: [String], to emitter: AutoskeletonWarningEmitter) {
    for warning in warnings {
        emitter.warn(warning)
    }
}
