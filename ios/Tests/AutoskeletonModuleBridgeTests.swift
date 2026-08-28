@testable import Autoskeleton
import UIKit
import XCTest

/// Task 5.1/5.2 (tasks.md Phase 5) / plan.md ADR-1, ADR-9: `AutoskeletonModuleBridge`'s
/// measure+encode+cache pipeline and `AutoskeletonNativeShapeCache`'s get/set/
/// evict semantics — pure Swift-to-Swift, no ObjC boundary (see
/// `Autoskeleton.mm`'s header comment for why the ObjC++ `getShapes`/
/// `evictShapes` glue itself is NOT yet wired to this bridge).
final class AutoskeletonModuleBridgeTests: XCTestCase {
    private func freshCache() -> AutoskeletonNativeShapeCache {
        let cache = AutoskeletonNativeShapeCache()
        return cache
    }

    /// Mirrors `.defaults` exactly, as an explicit `AutoskeletonGetShapesConfig`
    /// — the "nothing configured" baseline most tests below use so only the
    /// field under test diverges.
    private let defaultConfig = AutoskeletonGetShapesConfig(
        defaultRadius: 0,
        budgetMs: 2,
        maxShapes: 60,
        collectDebugSidecars: true
    )

    // MARK: - AutoskeletonModuleBridge

    func testComputeWireArrayReturnsNilWhenViewIsNotLaidOutYet() {
        let bridge = AutoskeletonModuleBridge(sensor: AutoskeletonSensor(), shapeCache: freshCache())
        let view = UIView(frame: .zero)
        XCTAssertNil(bridge.computeWireArray(view: view, cacheKey: "k", config: defaultConfig))
    }

    func testComputeWireArrayReturnsTheFlatWireArrayFromARealTraversal() throws {
        let fixture = try SyntheticHierarchyBuilder.loadFixture(named: "nested-offsets")
        let (_, root) = SyntheticHierarchyBuilder.build(fixture)
        let cache = freshCache()
        let bridge = AutoskeletonModuleBridge(sensor: AutoskeletonSensor(), shapeCache: cache)

        let result = bridge.computeWireArray(view: root, cacheKey: "cache-key-1", config: defaultConfig)

        XCTAssertNotNil(result)
        XCTAssertGreaterThanOrEqual(result!.count, 6, "expected at least a VERSION slot + one shape")
        XCTAssertEqual(result![0], 1, "WIRE_VERSION")
        XCTAssertEqual((result!.count - 1) % 5, 0)
    }

    func testComputeWireArrayWritesTheSameWireArrayIntoTheNativeShapeCache() throws {
        let fixture = try SyntheticHierarchyBuilder.loadFixture(named: "nested-offsets")
        let (_, root) = SyntheticHierarchyBuilder.build(fixture)
        let cache = freshCache()
        let bridge = AutoskeletonModuleBridge(sensor: AutoskeletonSensor(), shapeCache: cache)

        let result = bridge.computeWireArray(view: root, cacheKey: "cache-key-2", config: defaultConfig)
        let cached = cache.get("cache-key-2")

        XCTAssertNotNil(result)
        XCTAssertEqual(result, cached)
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
        let bridge = AutoskeletonModuleBridge(sensor: AutoskeletonSensor(), shapeCache: freshCache())
        XCTAssertEqual(
            bridge.getShapes(view: nil, cacheKey: "k", defaultRadius: 0, budgetMs: 2, maxShapes: 60, collectDebugSidecars: true),
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
        let bridge = AutoskeletonModuleBridge(sensor: AutoskeletonSensor(), shapeCache: freshCache())

        let untruncated = try XCTUnwrap(bridge.computeWireArray(view: root, cacheKey: "untruncated", config: defaultConfig))
        let untruncatedShapeCount = (untruncated.count - 1) / 5
        XCTAssertGreaterThan(untruncatedShapeCount, 1, "fixture must produce >1 shape for this test to prove anything")

        let tightenedConfig = AutoskeletonGetShapesConfig(
            defaultRadius: defaultConfig.defaultRadius,
            budgetMs: defaultConfig.budgetMs,
            maxShapes: 1,
            collectDebugSidecars: defaultConfig.collectDebugSidecars
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
        let bridge = AutoskeletonModuleBridge(sensor: AutoskeletonSensor(), shapeCache: freshCache())
        let config = AutoskeletonGetShapesConfig(
            defaultRadius: defaultConfig.defaultRadius,
            budgetMs: -1,
            maxShapes: defaultConfig.maxShapes,
            collectDebugSidecars: defaultConfig.collectDebugSidecars
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
        let bridge = AutoskeletonModuleBridge(sensor: AutoskeletonSensor(), shapeCache: freshCache())

        let withZero = try XCTUnwrap(
            bridge.computeWireArray(
                view: view, cacheKey: "r0",
                config: AutoskeletonGetShapesConfig(defaultRadius: 0, budgetMs: 2, maxShapes: 60, collectDebugSidecars: true)
            )
        )
        let withNinetyNine = try XCTUnwrap(
            bridge.computeWireArray(
                view: view, cacheKey: "r99",
                config: AutoskeletonGetShapesConfig(defaultRadius: 99, budgetMs: 2, maxShapes: 60, collectDebugSidecars: true)
            )
        )

        XCTAssertEqual(withZero[5], 12, "real layer.cornerRadius, not config.defaultRadius")
        XCTAssertEqual(withNinetyNine[5], 12, "real layer.cornerRadius, not config.defaultRadius")
    }

    // MARK: - AutoskeletonNativeShapeCache

    func testCacheGetReturnsNilForAnUnknownKey() {
        XCTAssertNil(freshCache().get("missing"))
    }

    func testCacheSetThenGetRoundTripsTheExactWireArray() {
        let cache = freshCache()
        let wire: [Double] = [1, 10, 20, 30, 40, 4]
        cache.set("k", wire)
        XCTAssertEqual(cache.get("k"), wire)
    }

    func testCacheEvictRemovesOnlyTheRequestedKeys() {
        let cache = freshCache()
        cache.set("a", [1])
        cache.set("b", [1])
        cache.set("c", [1])

        cache.evict(["a", "c"])

        XCTAssertNil(cache.get("a"))
        XCTAssertEqual(cache.count, 1)
        XCTAssertNil(cache.get("c"))
    }

    func testCacheEvictOfAnUnknownKeyIsANoOp() {
        let cache = freshCache()
        cache.set("a", [1])
        cache.evict(["does-not-exist"])
        XCTAssertEqual(cache.count, 1)
    }
}
