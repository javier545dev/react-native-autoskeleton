@testable import Autoskeleton
import QuartzCore
import UIKit
import XCTest

/// Task 3.2 (tasks.md Phase 3) / plan.md §3.5, §7: `AutoskeletonRendererTier1`
/// tests — mask-path geometry, the "no per-frame JS/JSI call" proxy (signpost
/// count), the NFR-2 blocked-thread-resilience proxy, and reduced-motion
/// degradation.
final class AutoskeletonRendererTier1Tests: XCTestCase {
    private func makeTheme() -> AutoskeletonSkeletonTheme {
        AutoskeletonSkeletonTheme(
            baseColor: UIColor(white: 0.9, alpha: 1).cgColor,
            highlightColor: UIColor(white: 0.98, alpha: 1).cgColor,
            defaultRadius: 4,
            speedMs: 1500
        )
    }

    private func makeSurface() -> UIView {
        UIView(frame: CGRect(x: 0, y: 0, width: 300, height: 200))
    }

    // MARK: - Mask-path geometry

    func testUnionPathContainsEachShapeAndExcludesGaps() {
        let shapes = [
            AutoskeletonShapeInfo(x: 0, y: 0, w: 50, h: 20, r: 0, source: .text, radiusSource: .measured),
            AutoskeletonShapeInfo(x: 100, y: 100, w: 40, h: 40, r: 0, source: .image, radiusSource: .measured),
        ]
        let path = AutoskeletonRendererTier1.unionPath(for: shapes)

        XCTAssertTrue(path.contains(CGPoint(x: 25, y: 10)), "must contain a point inside shape 0")
        XCTAssertTrue(path.contains(CGPoint(x: 120, y: 120)), "must contain a point inside shape 1")
        XCTAssertFalse(path.contains(CGPoint(x: 75, y: 75)), "must NOT contain a point in the gap between shapes")

        // The overall bounding box matches the union's true bounding box.
        let box = path.boundingBoxOfPath
        XCTAssertEqual(box.minX, 0, accuracy: 0.5)
        XCTAssertEqual(box.minY, 0, accuracy: 0.5)
        XCTAssertEqual(box.maxX, 140, accuracy: 0.5)
        XCTAssertEqual(box.maxY, 140, accuracy: 0.5)
    }

    func testUnionPathClampsRadiusToHalfTheShorterSide() {
        // r=999 on a 20x10 rect must not crash CGPath — clamped to half the
        // shorter side (5), matching how a real rounded rect degrades gracefully.
        let shapes = [
            AutoskeletonShapeInfo(x: 0, y: 0, w: 20, h: 10, r: 999, source: .container, radiusSource: .measured),
        ]
        let path = AutoskeletonRendererTier1.unionPath(for: shapes)
        XCTAssertFalse(path.isEmpty)
    }

    // MARK: - REQ-OBS-PROFILE-1: mount is signposted once, not per frame

    func testMountEmitsExactlyOneSignpostBeginEndPair() {
        let tracing = AutoskeletonRecordingTracing()
        let renderer = AutoskeletonRendererTier1(tracing: tracing)
        let surface = makeSurface()
        let clock = AutoskeletonShimmerClock(ticking: AutoskeletonNoOpTicking())

        _ = renderer.mount(
            on: surface,
            shapes: [AutoskeletonShapeInfo(x: 0, y: 0, w: 50, h: 20, r: 0, source: .text, radiusSource: .measured)],
            theme: makeTheme(),
            clock: clock,
            reducedMotion: false
        )

        XCTAssertEqual(tracing.events, [
            .begin("AutoskeletonRendererMount"),
            .end("AutoskeletonRendererMount"),
        ])
    }

    // MARK: - Shimmer is CoreAnimation-driven, not per-frame ticked

    func testShimmerIsAddedAsASingleRepeatingCAAnimation() {
        let renderer = AutoskeletonRendererTier1()
        let surface = makeSurface()
        let clock = AutoskeletonShimmerClock(ticking: AutoskeletonNoOpTicking())

        let handle = renderer.mount(
            on: surface,
            shapes: [AutoskeletonShapeInfo(x: 0, y: 0, w: 50, h: 20, r: 0, source: .text, radiusSource: .measured)],
            theme: makeTheme(),
            clock: clock,
            reducedMotion: false
        )

        let gradientLayer = try! XCTUnwrap(surface.layer.sublayers?.first as? CAGradientLayer)
        let animation = try! XCTUnwrap(gradientLayer.animation(forKey: AutoskeletonRendererTier1.Handle.shimmerAnimationKey) as? CABasicAnimation)
        XCTAssertEqual(animation.keyPath, "transform.translation.x")
        XCTAssertEqual(animation.repeatCount, .infinity)
        _ = handle
    }

    // MARK: - NFR-2 proxy: blocking a background queue does not affect animation timing

    func testAnimationTimingUnaffectedByABlockedBackgroundQueue() {
        let renderer = AutoskeletonRendererTier1()
        let surface = makeSurface()
        let clock = AutoskeletonShimmerClock(ticking: AutoskeletonNoOpTicking())

        _ = renderer.mount(
            on: surface,
            shapes: [AutoskeletonShapeInfo(x: 0, y: 0, w: 50, h: 20, r: 0, source: .text, radiusSource: .measured)],
            theme: makeTheme(),
            clock: clock,
            reducedMotion: false
        )
        let gradientLayer = try! XCTUnwrap(surface.layer.sublayers?.first as? CAGradientLayer)
        let before = try! XCTUnwrap(gradientLayer.animation(forKey: AutoskeletonRendererTier1.Handle.shimmerAnimationKey) as? CABasicAnimation)
        let beginTimeBefore = before.beginTime
        let durationBefore = before.duration

        // Simulates a synchronously blocked "JS thread": a background queue that
        // does not return for >= 500 ms. The animation lives on the render server
        // via CoreAnimation, entirely decoupled from this queue and from the main
        // run loop, so its configured timing must be completely unaffected.
        let expectation = expectation(description: "background block finished")
        let blockedQueue = DispatchQueue(label: "autoskeleton.test.blocked-queue")
        blockedQueue.async {
            Thread.sleep(forTimeInterval: 0.5)
            expectation.fulfill()
        }
        wait(for: [expectation], timeout: 2.0)

        let after = try! XCTUnwrap(gradientLayer.animation(forKey: AutoskeletonRendererTier1.Handle.shimmerAnimationKey) as? CABasicAnimation)
        XCTAssertEqual(after.beginTime, beginTimeBefore, "beginTime must not shift due to a blocked background queue")
        XCTAssertEqual(after.duration, durationBefore)
    }

    // MARK: - update(shapes:) must not restart the shimmer phase

    func testUpdateDoesNotRestartTheShimmerAnimation() {
        let renderer = AutoskeletonRendererTier1()
        let surface = makeSurface()
        let clock = AutoskeletonShimmerClock(ticking: AutoskeletonNoOpTicking())

        let handle = renderer.mount(
            on: surface,
            shapes: [AutoskeletonShapeInfo(x: 0, y: 0, w: 50, h: 20, r: 0, source: .text, radiusSource: .measured)],
            theme: makeTheme(),
            clock: clock,
            reducedMotion: false
        )
        let gradientLayer = try! XCTUnwrap(surface.layer.sublayers?.first as? CAGradientLayer)
        let beginTimeBefore = try! XCTUnwrap(gradientLayer.animation(forKey: AutoskeletonRendererTier1.Handle.shimmerAnimationKey)).beginTime

        handle.update(shapes: [
            AutoskeletonShapeInfo(x: 0, y: 0, w: 80, h: 30, r: 4, source: .text, radiusSource: .measured),
        ])

        let beginTimeAfter = try! XCTUnwrap(gradientLayer.animation(forKey: AutoskeletonRendererTier1.Handle.shimmerAnimationKey)).beginTime
        XCTAssertEqual(beginTimeBefore, beginTimeAfter, "a geometry-only update must not restart the shimmer phase")

        // But the mask path itself DID change to the new geometry.
        let maskLayer = try! XCTUnwrap(gradientLayer.mask as? CAShapeLayer)
        let path = try! XCTUnwrap(maskLayer.path)
        XCTAssertTrue(path.contains(CGPoint(x: 40, y: 15)))
    }

    // MARK: - REQ-A11Y-3: reduced motion degrades to pulse, not a transform sweep

    func testReducedMotionAppliesPulseNotShimmer() {
        let renderer = AutoskeletonRendererTier1()
        let surface = makeSurface()
        let clock = AutoskeletonShimmerClock(ticking: AutoskeletonNoOpTicking())

        _ = renderer.mount(
            on: surface,
            shapes: [AutoskeletonShapeInfo(x: 0, y: 0, w: 50, h: 20, r: 0, source: .text, radiusSource: .measured)],
            theme: makeTheme(),
            clock: clock,
            reducedMotion: true
        )
        let gradientLayer = try! XCTUnwrap(surface.layer.sublayers?.first as? CAGradientLayer)

        XCTAssertNil(gradientLayer.animation(forKey: AutoskeletonRendererTier1.Handle.shimmerAnimationKey))
        let pulse = try! XCTUnwrap(gradientLayer.animation(forKey: "autoskeleton.pulse") as? CABasicAnimation)
        XCTAssertEqual(pulse.keyPath, "opacity", "reduced motion must never apply a transform-based sweep")
    }
}

/// Test-only no-op ticker: the renderer tests never need `subscribe()`'s dev/test
/// tick path, and a real `CADisplayLink` requires a live run loop pump XCTest does
/// not provide deterministically.
final class AutoskeletonNoOpTicking: AutoskeletonClockTicking {
    func start(target: Any, selector: Selector) {}
    func stop() {}
}
