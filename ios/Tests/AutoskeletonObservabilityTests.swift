@testable import Autoskeleton
import XCTest

/// Task G.3 (tasks.md, observability gap closure, post-Phase-4) / spec.md
/// REQ-OBS-BUDGET-1/2: pure-function layer tests for `autoskeletonCheckBudgets`/
/// `autoskeletonCheckRadiusFallback` and their formatters — mirrors
/// `metrics.test.ts`'s coverage of `checkBudgets`/`checkRadiusFallback`
/// one-to-one so all three platforms' threshold semantics stay provably
/// identical.
///
/// This file does NOT prove emission from a real traversal — that is
/// `AutoskeletonSensorObservabilityTests`'s job (the in-context requirement
/// per G.3's brief). This file proves the pure threshold/formatting logic
/// those checks depend on, and is ALSO the only layer that can exercise
/// `checkRadiusFallback`'s positive-fire branch on iOS at all, since
/// `AutoskeletonSensor.swift` never produces `.defaultValue` from a real
/// `UIView` traversal (see `AutoskeletonObservability.swift`'s class doc).
final class AutoskeletonObservabilityTests: XCTestCase {

    // MARK: - checkBudgets

    func testBudgetsWithinBoundsProduceNoWarnings() {
        let result = autoskeletonCheckBudgets(traversalMs: 1, shapeCount: 10, budgetMs: 2, maxShapes: 60)
        XCTAssertFalse(result.budgetExceeded)
        XCTAssertFalse(result.shapeCapExceeded)
        XCTAssertTrue(result.warnings.isEmpty)
    }

    func testTimeBudgetExceededProducesActionableWarning() {
        let result = autoskeletonCheckBudgets(traversalMs: 3.4, shapeCount: 10, budgetMs: 2, maxShapes: 60)
        XCTAssertTrue(result.budgetExceeded)
        XCTAssertEqual(result.warnings.count, 1)
        XCTAssertTrue(result.warnings[0].contains("3.4"))
        XCTAssertTrue(result.warnings[0].contains("2.0"))
        XCTAssertTrue(result.warnings[0].contains("AutoSkeleton.Ignore"))
    }

    func testShapeCapExceededProducesActionableWarning() {
        let result = autoskeletonCheckBudgets(traversalMs: 1, shapeCount: 61, budgetMs: 2, maxShapes: 60)
        XCTAssertTrue(result.shapeCapExceeded)
        XCTAssertEqual(result.warnings.count, 1)
        XCTAssertTrue(result.warnings[0].contains("61"))
        XCTAssertTrue(result.warnings[0].contains("60"))
        XCTAssertTrue(result.warnings[0].contains("SkeletonProvider"))
    }

    func testBothBudgetsExceededProduceTwoWarnings() {
        let result = autoskeletonCheckBudgets(traversalMs: 3.4, shapeCount: 61, budgetMs: 2, maxShapes: 60)
        XCTAssertEqual(result.warnings.count, 2)
    }

    // MARK: - checkRadiusFallback

    func testRadiusFallbackDefaultThresholdMatchesWebConstant() {
        XCTAssertEqual(autoskeletonDefaultRadiusFallbackShare, 0.3)
    }

    func testRadiusFallbackShareExceedingThresholdFires() {
        // 18/20 = 90%, exceeds default 30% threshold — mirrors metrics.test.ts's
        // case, and is the ONLY layer on iOS that can exercise this branch at
        // all (see this file's class doc).
        let sources = Array(repeating: AutoskeletonRadiusSource.defaultValue, count: 18) +
            Array(repeating: AutoskeletonRadiusSource.measured, count: 2)
        let result = autoskeletonCheckRadiusFallback(radiusSources: sources, threshold: autoskeletonDefaultRadiusFallbackShare)
        XCTAssertTrue(result.shareExceeded)
        XCTAssertEqual(result.defaultCount, 18)
        XCTAssertEqual(result.totalCount, 20)
        XCTAssertEqual(result.warnings.count, 1)
        XCTAssertTrue(result.warnings[0].contains("18/20"))
        XCTAssertTrue(result.warnings[0].contains("90%"))
        XCTAssertTrue(result.warnings[0].contains("30%"))
        XCTAssertTrue(result.warnings[0].contains("radius"))
        XCTAssertTrue(result.warnings[0].contains("SkeletonProvider.defaultRadius"))
    }

    func testRadiusFallbackShareExactlyAtThresholdDoesNotFire() {
        // 6/20 = 30% exactly — spec.md REQ-OBS-BUDGET-2 uses `>` not `>=`.
        let sources = Array(repeating: AutoskeletonRadiusSource.defaultValue, count: 6) +
            Array(repeating: AutoskeletonRadiusSource.measured, count: 14)
        let result = autoskeletonCheckRadiusFallback(radiusSources: sources, threshold: autoskeletonDefaultRadiusFallbackShare)
        XCTAssertFalse(result.shareExceeded)
        XCTAssertTrue(result.warnings.isEmpty)
    }

    func testRadiusFallbackWithNoShapesDoesNotFire() {
        let result = autoskeletonCheckRadiusFallback(radiusSources: [], threshold: autoskeletonDefaultRadiusFallbackShare)
        XCTAssertFalse(result.shareExceeded)
        XCTAssertEqual(result.totalCount, 0)
        XCTAssertEqual(result.share, 0)
        XCTAssertTrue(result.warnings.isEmpty)
    }

    // MARK: - emission seam

    func testEmitWarningsForwardsEveryWarningToTheEmitter() {
        let emitter = AutoskeletonRecordingWarningEmitter()
        autoskeletonEmitWarnings(["first", "second"], to: emitter)
        XCTAssertEqual(emitter.warnings, ["first", "second"])
    }

    func testEmitWarningsForwardsNothingWhenListIsEmpty() {
        let emitter = AutoskeletonRecordingWarningEmitter()
        autoskeletonEmitWarnings([], to: emitter)
        XCTAssertTrue(emitter.warnings.isEmpty)
    }
}
