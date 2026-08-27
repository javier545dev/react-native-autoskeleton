@testable import Autoskeleton
import UIKit
import XCTest

/// Task G.3 (tasks.md, observability gap closure, post-Phase-4) / spec.md
/// REQ-OBS-BUDGET-1/2: proves the dev warnings actually fire from
/// `AutoskeletonSensor.measure()` — the REAL traversal path — not merely from
/// a formatter called in isolation (`AutoskeletonObservabilityTests`'s job).
/// This is the exact acceptance criterion the brief states explicitly: "Drive
/// the real sensor through a real traversal that trips the threshold, and
/// assert the warning actually surfaces."
///
/// Dev-gate: `AutoskeletonSensor.measure()` wraps warning emission in
/// `#if DEBUG`, the same compile-time mechanism established for
/// `AutoskeletonDebugOverlay` (task 3.3). XCTest targets always build Debug
/// (documented on `AutoskeletonDebugOverlayAvailability`), so this suite
/// exercises the gated code directly; a Release-configuration build simply
/// never calls into it — see this task's apply-progress notes for why a
/// runtime toggle equivalent to Android's `FLAG_DEBUGGABLE` check is neither
/// available nor needed here.
final class AutoskeletonSensorObservabilityTests: XCTestCase {

    // MARK: - REQ-OBS-BUDGET-1: time budget

    func testTimeBudgetExceededEmitsWarningFromRealTraversal() throws {
        let fixture = try SyntheticHierarchyBuilder.loadFixture(named: "nested-offsets")
        let (_, root) = SyntheticHierarchyBuilder.build(fixture)
        let emitter = AutoskeletonRecordingWarningEmitter()
        let sensor = AutoskeletonSensor(warnings: emitter)

        // budgetMs = -1 is a deterministic real trigger (any real traversalMs
        // >= 0 exceeds -1) — same technique as the web wiring (G.1), avoids a
        // flaky positive-time-budget assertion depending on device speed.
        let options = AutoskeletonSensorOptions(
            hints: AutoskeletonEmptyHintRegistry(),
            budgetMs: -1,
            maxShapes: 60,
            defaultRadius: 0,
            defaultLineHeight: 20,
            collectDebugSidecars: true
        )
        _ = sensor.measure(root: root, options: options)

        XCTAssertTrue(
            emitter.warnings.contains { $0.contains("traversal took") },
            "expected a time-budget warning citing 'traversal took', got: \(emitter.warnings)"
        )
    }

    // MARK: - REQ-OBS-BUDGET-1: shape cap

    func testShapeCapExceededEmitsWarningFromRealTraversal() throws {
        let fixture = try SyntheticHierarchyBuilder.loadFixture(named: "ignore-subtree")
        let (_, root) = SyntheticHierarchyBuilder.build(fixture)
        let emitter = AutoskeletonRecordingWarningEmitter()
        let sensor = AutoskeletonSensor(warnings: emitter)

        let options = AutoskeletonSensorOptions(
            hints: AutoskeletonEmptyHintRegistry(),
            budgetMs: 1000,
            maxShapes: 1,
            defaultRadius: 0,
            defaultLineHeight: 20,
            collectDebugSidecars: true
        )
        let result = try XCTUnwrap(sensor.measure(root: root, options: options))
        XCTAssertTrue(result.degraded.contains(.shapeCapReached))

        XCTAssertTrue(
            emitter.warnings.contains { $0.contains("2 shapes") && $0.contains("1-shape budget") },
            "expected a shape-cap warning citing '2 shapes' (maxShapes+1, the honest lower " +
                "bound derived from the real shape-cap-reached flag) and the configured cap, " +
                "got: \(emitter.warnings)"
        )
    }

    // MARK: - REQ-OBS-BUDGET-2: defensive wiring stays silent on a real traversal
    //
    // iOS never assigns `.defaultValue` from any real UIView traversal (see
    // `AutoskeletonObservability.swift`'s class doc) — the positive-fire branch
    // is validated at the pure-function layer instead
    // (`AutoskeletonObservabilityTests`). This test proves the real wiring
    // stays silent against real traversal data even at the most aggressive
    // possible threshold, mirroring the equivalent web G.2 Playwright case.

    func testRadiusFallbackStaysSilentOnRealTraversalEvenAtZeroThreshold() throws {
        let fixture = try SyntheticHierarchyBuilder.loadFixture(named: "container-rule-no-leaves")
        let (_, root) = SyntheticHierarchyBuilder.build(fixture)
        let emitter = AutoskeletonRecordingWarningEmitter()
        let sensor = AutoskeletonSensor(warnings: emitter)

        let options = AutoskeletonSensorOptions(
            hints: AutoskeletonEmptyHintRegistry(),
            budgetMs: 1000,
            maxShapes: 60,
            defaultRadius: 0,
            defaultLineHeight: 20,
            collectDebugSidecars: true,
            radiusFallbackShare: 0
        )
        let result = try XCTUnwrap(sensor.measure(root: root, options: options))
        XCTAssertTrue(result.shapes.allSatisfy { $0.radiusSource == .measured })
        XCTAssertTrue(emitter.warnings.isEmpty)
    }

    // MARK: - no false positive: real traversal within every budget stays silent

    func testNoWarningsWhenEveryBudgetIsRespected() throws {
        let fixture = try SyntheticHierarchyBuilder.loadFixture(named: "nested-offsets")
        let (_, root) = SyntheticHierarchyBuilder.build(fixture)
        let emitter = AutoskeletonRecordingWarningEmitter()
        let sensor = AutoskeletonSensor(warnings: emitter)

        let options = AutoskeletonSensorOptions(
            hints: AutoskeletonEmptyHintRegistry(),
            budgetMs: 1000,
            maxShapes: 60,
            defaultRadius: 0,
            defaultLineHeight: 20,
            collectDebugSidecars: true
        )
        _ = try XCTUnwrap(sensor.measure(root: root, options: options))
        XCTAssertTrue(emitter.warnings.isEmpty)
    }
}
