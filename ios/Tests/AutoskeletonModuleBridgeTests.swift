@testable import Autoskeleton
import UIKit
import XCTest

/// Task 5.1 (tasks.md Phase 5) / plan.md ADR-1: `AutoskeletonModuleBridge`'s
/// measure+encode pipeline — pure Swift-to-Swift, no ObjC boundary (see
/// `Autoskeleton.mm`'s header comment for why the ObjC++ `getShapes` glue
/// itself is NOT yet wired to this bridge).
///
/// This used to also cover the native shape cache's get/set/evict semantics.
/// That cache is gone: the overlay takes its geometry as a `shapes` prop, so
/// the buffer `computeWireArray` returns is the only copy there is.
final class AutoskeletonModuleBridgeTests: XCTestCase {

    /// Mirrors `.defaults` exactly, as an explicit `AutoskeletonGetShapesConfig`
    /// — the "nothing configured" baseline most tests below use so only the
    /// field under test diverges.
    private let defaultConfig = AutoskeletonGetShapesConfig(
        defaultRadius: 0,
        budgetMs: 2,
        maxShapes: 60,
        collectDebugSidecars: true,
        hints: []
    )

    // MARK: - AutoskeletonModuleBridge

    func testComputeWireArrayReturnsNilWhenViewIsNotLaidOutYet() {
        let bridge = AutoskeletonModuleBridge(sensor: AutoskeletonSensor())
        let view = UIView(frame: .zero)
        XCTAssertNil(bridge.computeWireArray(view: view, cacheKey: "k", config: defaultConfig))
    }

    func testComputeWireArrayReturnsTheFlatWireArrayFromARealTraversal() throws {
        let fixture = try SyntheticHierarchyBuilder.loadFixture(named: "nested-offsets")
        let (_, root) = SyntheticHierarchyBuilder.build(fixture)
        let bridge = AutoskeletonModuleBridge(sensor: AutoskeletonSensor())

        let result = bridge.computeWireArray(view: root, cacheKey: "cache-key-1", config: defaultConfig)

        XCTAssertNotNil(result)
        XCTAssertGreaterThanOrEqual(result!.count, 6, "expected at least a VERSION slot + one shape")
        XCTAssertEqual(result![0], 1, "WIRE_VERSION")
        XCTAssertEqual((result!.count - 1) % 5, 0)
    }


    func testEncodeWireArrayIsPureAndNeedsNoViewOrSensor() {
        let shapes = [
            AutoskeletonShapeInfo(
                x: 10, y: 20, w: 100, h: 100, r: 8,
                source: .container, radiusSource: .measured
            ),
        ]
        let wire = AutoskeletonModuleBridge.encodeWireArray(shapes)
        XCTAssertEqual(wire, [1, 10, 20, 100, 100, 8])
    }

    func testGetShapesReturnsAnEmptyArrayForANilView() {
        let bridge = AutoskeletonModuleBridge(sensor: AutoskeletonSensor())
        XCTAssertEqual(
            bridge.getShapes(
                view: nil, cacheKey: "k", defaultRadius: 0, budgetMs: 2, maxShapes: 60,
                collectDebugSidecars: true, hints: []
            ),
            []
        )
    }

    // MARK: - Phase-5-remediation (post-7.2 gap closure): config actually
    // arrives at the real `sensor.measure()` options, proven by the wire
    // GEOMETRY changing, not merely that the signature accepts a config.

    func testComputeWireArrayTruncatesTheShapeCountWhenMaxShapesIsTightened() throws {
        // "ignore-subtree" is the shared fixture (`test/fixtures/hierarchies`)
        // Android's equivalent case also uses — a real, laid-out multi-leaf
        // tree, needed to prove truncation actually happened rather than a
        // fixture that only ever had one shape to begin with.
        let fixture = try SyntheticHierarchyBuilder.loadFixture(named: "ignore-subtree")
        let (_, root) = SyntheticHierarchyBuilder.build(fixture)
        let bridge = AutoskeletonModuleBridge(sensor: AutoskeletonSensor())

        let untruncated = try XCTUnwrap(bridge.computeWireArray(view: root, cacheKey: "untruncated", config: defaultConfig))
        let untruncatedShapeCount = (untruncated.count - 1) / 5
        XCTAssertGreaterThan(untruncatedShapeCount, 1, "fixture must produce >1 shape for this test to prove anything")

        let tightenedConfig = AutoskeletonGetShapesConfig(
            defaultRadius: defaultConfig.defaultRadius,
            budgetMs: defaultConfig.budgetMs,
            maxShapes: 1,
            collectDebugSidecars: defaultConfig.collectDebugSidecars,
            hints: defaultConfig.hints
        )
        let tightened = try XCTUnwrap(bridge.computeWireArray(view: root, cacheKey: "truncated", config: tightenedConfig))

        XCTAssertEqual(tightened[0], 1, "WIRE_VERSION untouched")
        XCTAssertEqual(tightened.count, 6, "maxShapes=1 must truncate to exactly one shape (6 slots total)")
    }

    func testComputeWireArrayThreadsBudgetMsIntoTheRealSensorOptions() throws {
        // budgetMs = -1 is a deterministic real trigger (any real
        // traversalMs >= 0 exceeds -1) — same technique
        // `AutoskeletonSensorObservabilityTests` already uses. Only reachable
        // if `config.budgetMs` genuinely replaced the compiled
        // `AutoskeletonSensorOptions.defaults.budgetMs` (2) used before this
        // task — the traversal truncates to ZERO shapes before any shape is
        // ever reserved.
        let fixture = try SyntheticHierarchyBuilder.loadFixture(named: "nested-offsets")
        let (_, root) = SyntheticHierarchyBuilder.build(fixture)
        let bridge = AutoskeletonModuleBridge(sensor: AutoskeletonSensor())
        let config = AutoskeletonGetShapesConfig(
            defaultRadius: defaultConfig.defaultRadius,
            budgetMs: -1,
            maxShapes: defaultConfig.maxShapes,
            collectDebugSidecars: defaultConfig.collectDebugSidecars,
            hints: defaultConfig.hints
        )

        let result = try XCTUnwrap(bridge.computeWireArray(view: root, cacheKey: "budget", config: config))

        XCTAssertEqual(result.count, 1, "VERSION slot only — zero shapes survived the budget")
        XCTAssertEqual(result[0], 1)
    }

    /// `defaultRadius` is threaded into the real `AutoskeletonSensorOptions`
    /// (not dropped) but is architecturally INERT on iOS today —
    /// `AutoskeletonSensor.swift`'s `leafShapes(for:root:source:ctx:)` always
    /// resolves a shape's radius via the public `view.layer.cornerRadius`
    /// directly, with no fallback rung (unlike Android's ADR-2 ladder). This
    /// test documents that fact as a passing assertion rather than silently:
    /// two wildly different `defaultRadius` values against a view with a
    /// REAL, non-default `cornerRadius` must both report the view's actual
    /// radius, proving `defaultRadius` cannot override real geometry here.
    func testComputeWireArrayAcceptsDefaultRadiusWithoutAffectingRealCornerRadiusOnIOS() throws {
        let view = UIView(frame: CGRect(x: 0, y: 0, width: 40, height: 40))
        view.backgroundColor = .red
        view.layer.cornerRadius = 12
        let bridge = AutoskeletonModuleBridge(sensor: AutoskeletonSensor())

        let withZero = try XCTUnwrap(
            bridge.computeWireArray(
                view: view, cacheKey: "r0",
                config: AutoskeletonGetShapesConfig(defaultRadius: 0, budgetMs: 2, maxShapes: 60, collectDebugSidecars: true, hints: [])
            )
        )
        let withNinetyNine = try XCTUnwrap(
            bridge.computeWireArray(
                view: view, cacheKey: "r99",
                config: AutoskeletonGetShapesConfig(defaultRadius: 99, budgetMs: 2, maxShapes: 60, collectDebugSidecars: true, hints: [])
            )
        )

        XCTAssertEqual(withZero[5], 12, "real layer.cornerRadius, not config.defaultRadius")
        XCTAssertEqual(withNinetyNine[5], 12, "real layer.cornerRadius, not config.defaultRadius")
    }

    // MARK: - Typed-hint channel (radius OVERRIDE, a deliberate iOS-specific
    // design decision — see `AutoskeletonSensor.swift`'s
    // `leafShapes(for:root:source:ctx:)` doc comment): a registered `radius`
    // hint entry now OVERRIDES `layer.cornerRadius` on iOS, unlike
    // `defaultRadius` above (which the previous test proves has no effect).

    func testComputeWireArrayAppliesARegisteredRadiusHintOverridingLayerCornerRadius() throws {
        let view = UIView(frame: CGRect(x: 0, y: 0, width: 40, height: 40))
        view.accessibilityIdentifier = "card"
        view.backgroundColor = .red
        view.layer.cornerRadius = 12
        let bridge = AutoskeletonModuleBridge(sensor: AutoskeletonSensor())
        let config = AutoskeletonGetShapesConfig(
            defaultRadius: 0, budgetMs: 2, maxShapes: 60, collectDebugSidecars: true,
            hints: [AutoskeletonHintEntry(nodeId: "card", lines: nil, radius: 20)]
        )

        let result = try XCTUnwrap(bridge.computeWireArray(view: view, cacheKey: "hinted", config: config))

        XCTAssertEqual(result[5], 20, "hinted radius overrides the real layer.cornerRadius (12)")
    }

    func testComputeWireArrayIgnoresAHintRegisteredUnderADifferentAccessibilityIdentifier() throws {
        let view = UIView(frame: CGRect(x: 0, y: 0, width: 40, height: 40))
        view.accessibilityIdentifier = "card"
        view.backgroundColor = .red
        view.layer.cornerRadius = 12
        let bridge = AutoskeletonModuleBridge(sensor: AutoskeletonSensor())
        let config = AutoskeletonGetShapesConfig(
            defaultRadius: 0, budgetMs: 2, maxShapes: 60, collectDebugSidecars: true,
            hints: [AutoskeletonHintEntry(nodeId: "unrelated", lines: nil, radius: 20)]
        )

        let result = try XCTUnwrap(bridge.computeWireArray(view: view, cacheKey: "unhinted", config: config))

        XCTAssertEqual(result[5], 12, "no matching hint -> real layer.cornerRadius stands")
    }

    // MARK: - Adversarial-review defect (2026-08-28): a timed-out `getShapes`
    // used to abandon its main-thread work rather than cancel it, and that
    // abandoned work went on to write into the SHARED native shape cache
    // after the caller had already given up -- on a recycled list, that
    // `cacheKey` may by then belong to a different row.

    func testComputeWireArrayDoesNotWriteToTheCacheWhenIsCancelledReturnsTrue() throws {
        let fixture = try SyntheticHierarchyBuilder.loadFixture(named: "nested-offsets")
        let (_, root) = SyntheticHierarchyBuilder.build(fixture)
        let bridge = AutoskeletonModuleBridge(sensor: AutoskeletonSensor())

        // The traversal itself still runs (it cannot be stopped mid-flight
        // either -- see `AutoskeletonSystemUiThreadDispatcher`'s own doc
        // comment), but a caller that has already given up must not be
        // handed a result. Before the native cache was removed this guard
        // also protected a shared write; now the return value is the whole
        // observable, which is what this asserts.
        let result = bridge.computeWireArray(
            view: root, cacheKey: "recycled-cache-key", config: defaultConfig, isCancelled: { true }
        )

        XCTAssertNil(result, "a cancelled computation must not hand back a result")
    }
}
