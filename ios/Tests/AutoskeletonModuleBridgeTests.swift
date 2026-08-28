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

    // MARK: - AutoskeletonModuleBridge

    func testComputeWireArrayReturnsNilWhenViewIsNotLaidOutYet() {
        let bridge = AutoskeletonModuleBridge(sensor: AutoskeletonSensor(), shapeCache: freshCache())
        let view = UIView(frame: .zero)
        XCTAssertNil(bridge.computeWireArray(view: view, cacheKey: "k"))
    }

    func testComputeWireArrayReturnsTheFlatWireArrayFromARealTraversal() throws {
        let fixture = try SyntheticHierarchyBuilder.loadFixture(named: "nested-offsets")
        let (_, root) = SyntheticHierarchyBuilder.build(fixture)
        let cache = freshCache()
        let bridge = AutoskeletonModuleBridge(sensor: AutoskeletonSensor(), shapeCache: cache)

        let result = bridge.computeWireArray(view: root, cacheKey: "cache-key-1")

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

        let result = bridge.computeWireArray(view: root, cacheKey: "cache-key-2")
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
        XCTAssertEqual(bridge.getShapes(view: nil, cacheKey: "k"), [])
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
