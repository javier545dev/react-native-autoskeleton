@testable import Autoskeleton
import UIKit
import XCTest

/// Task 3.3 (tasks.md Phase 3) / spec.md REQ-OBS-OVERLAY-1: `AutoskeletonDebugOverlay`
/// tests. The "stripped from release" half of this task's DoD is proven by a real
/// Release-configuration build + binary symbol check, NOT by an XCTest case — test
/// schemes always build Debug, so a test asserting "the type doesn't exist" would be
/// vacuous by construction. See the Phase 3 apply-progress notes for that command
/// and its result.
final class AutoskeletonDebugOverlayTests: XCTestCase {
    private func makeShapes() -> [AutoskeletonShapeInfo] {
        [
            AutoskeletonShapeInfo(x: 0, y: 0, w: 50, h: 20, r: 0, source: .text, radiusSource: .measured),
            AutoskeletonShapeInfo(x: 60, y: 0, w: 40, h: 40, r: 8, source: .image, radiusSource: .measured),
            AutoskeletonShapeInfo(x: 0, y: 50, w: 200, h: 20, r: 0, source: .syntheticLine, radiusSource: .measured),
        ]
    }

    func testAvailableInDebugTestBuilds() {
        // Test schemes always build Debug, so this doubles as a smoke check that
        // the compile-time flag responds correctly to configuration.
        XCTAssertTrue(AutoskeletonDebugOverlayAvailability.isAvailable)
    }

    func testMountDrawsOneOutlineAndOneBadgePerShape() {
        let overlay = AutoskeletonDebugOverlay()
        let surface = UIView(frame: CGRect(x: 0, y: 0, width: 300, height: 200))

        overlay.mount(on: surface, shapes: makeShapes(), cacheHit: false)

        XCTAssertEqual(overlay.shapeCount, 3, "REQ-OBS-OVERLAY-1: one outline per detected shape")
        XCTAssertEqual(overlay.badges.count, 3)
        XCTAssertEqual(overlay.badges.map(\.index), [0, 1, 2])
        XCTAssertEqual(overlay.badges.map(\.source), [.text, .image, .syntheticLine])
        XCTAssertTrue(overlay.badges.allSatisfy { $0.cacheHit == false }, "MISS badge for a cold traversal")
    }

    func testMountReportsCacheHitBadge() {
        let overlay = AutoskeletonDebugOverlay()
        let surface = UIView(frame: CGRect(x: 0, y: 0, width: 300, height: 200))

        overlay.mount(on: surface, shapes: makeShapes(), cacheHit: true)

        XCTAssertTrue(overlay.badges.allSatisfy { $0.cacheHit == true }, "HIT badge for a warm/cached traversal")
    }

    func testReMountingClearsPreviousOutlines() {
        let overlay = AutoskeletonDebugOverlay()
        let surface = UIView(frame: CGRect(x: 0, y: 0, width: 300, height: 200))

        overlay.mount(on: surface, shapes: makeShapes(), cacheHit: false)
        XCTAssertEqual(overlay.shapeCount, 3)

        // A "missed node" (spec §2.3): a re-render with fewer detected shapes must
        // not leave the PREVIOUS render's outlines dangling on screen — that would
        // hide the exact diagnostic signal REQ-OBS-OVERLAY-1 depends on.
        overlay.mount(on: surface, shapes: [makeShapes()[0]], cacheHit: false)
        XCTAssertEqual(overlay.shapeCount, 1)
        XCTAssertEqual(surface.layer.sublayers?.count, 2, "1 outline layer + 1 badge layer, nothing stale")
    }

    func testClearRemovesAllOverlayLayers() {
        let overlay = AutoskeletonDebugOverlay()
        let surface = UIView(frame: CGRect(x: 0, y: 0, width: 300, height: 200))
        overlay.mount(on: surface, shapes: makeShapes(), cacheHit: false)

        overlay.clear()

        XCTAssertEqual(overlay.shapeCount, 0)
        XCTAssertEqual(overlay.badges.count, 0)
        XCTAssertEqual(surface.layer.sublayers?.count ?? 0, 0)
    }
}
