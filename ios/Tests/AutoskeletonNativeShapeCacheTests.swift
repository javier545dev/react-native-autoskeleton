@testable import Autoskeleton
import XCTest

/// The unbounded-growth defect, and its bound. `AutoskeletonNativeShapeCacheTest.kt`
/// carries the same cases.
///
/// This cache is a shared singleton, and its header used to claim it was
/// "Evicted ONLY when JS explicitly requests it via `evictShapes` (mirroring
/// `store.invalidate(...)` -> native `evict(keys)`)". That wiring does not
/// exist: `evictNativeShapes` in `src/native/wire-bridge.ts` has no call site
/// anywhere in `src/`, and `store.invalidate()` is never called either. So
/// nothing ever removed an entry, and every distinct `cacheKey` added one more
/// wire array that outlived the view it described, for the life of the process.
final class AutoskeletonNativeShapeCacheTests: XCTestCase {
    private let cache = AutoskeletonNativeShapeCache.shared

    override func setUp() {
        super.setUp()
        cache.clear()
    }

    func testNeverGrowsPastItsBound() {
        for i in 0..<(AutoskeletonNativeShapeCache.maxEntries + 50) {
            cache.set("k\(i)", [Double(i)])
        }
        XCTAssertEqual(cache.count, AutoskeletonNativeShapeCache.maxEntries)
        // The oldest went first, the newest is still there.
        XCTAssertNil(cache.get("k0"))
        let newest = AutoskeletonNativeShapeCache.maxEntries + 49
        XCTAssertEqual(cache.get("k\(newest)"), [Double(newest)])
    }

    /// Least-recently-USED, not merely least-recently-inserted. The entry the
    /// overlay is actively painting from is read on every frame, so a
    /// pure-insertion-order bound would evict exactly the entry still in use
    /// on a screen that keeps measuring new keys.
    func testReadingAnEntryProtectsItFromEviction() {
        for i in 0..<AutoskeletonNativeShapeCache.maxEntries {
            cache.set("k\(i)", [Double(i)])
        }
        _ = cache.get("k0") // touch the oldest
        cache.set("overflow", [-1])

        XCTAssertEqual(cache.get("k0"), [0])
        XCTAssertNil(cache.get("k1")) // the new oldest went instead
    }

    /// Anti-vacuity: every assertion above would hold for a cache that evicted
    /// on every write. An ordinary working set must survive intact.
    func testAnOrdinaryWorkingSetIsNeverEvicted() {
        for i in 0..<10 {
            cache.set("k\(i)", [Double(i)])
        }
        XCTAssertEqual(cache.count, 10)
        for i in 0..<10 {
            XCTAssertEqual(cache.get("k\(i)"), [Double(i)])
        }
    }

    /// The usage order must not outlive the entries it orders, or an evicted
    /// key would keep occupying a slot in the bound.
    func testEvictAlsoDropsTheUsageOrderEntry() {
        cache.set("a", [1])
        cache.set("b", [2])
        cache.evict(["a"])
        XCTAssertNil(cache.get("a"))
        XCTAssertEqual(cache.count, 1)
        cache.set("a", [3])
        XCTAssertEqual(cache.count, 2)
    }
}
