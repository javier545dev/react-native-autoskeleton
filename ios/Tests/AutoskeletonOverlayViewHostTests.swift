@testable import Autoskeleton
import QuartzCore
import UIKit
import XCTest

/// Task 5.8 (tasks.md Phase 5, task 5.7 follow-up) / plan.md ADR-5, ADR-9:
/// `AutoskeletonOverlayViewHost` is the Swift-testable business logic behind
/// the iOS `RCTViewComponentView` overlay subclass (`AutoskeletonOverlayView.mm`,
/// deliberately kept as thin ObjC++ glue with nothing else to unit test — the
/// same split `AutoskeletonModuleBridge`/`Autoskeleton.mm` already
/// established for the Turbo Module side). It reads shape geometry from
/// `AutoskeletonNativeShapeCache` by `cacheKey` (ADR-9: native holds shape
/// DATA, JS holds POLICY) — never from props — and hosts
/// `AutoskeletonRendererTier1` (task 3.2), the SAME renderer already covered
/// by `AutoskeletonRendererTier1Tests`. This proves the WIRING reaches that
/// renderer's `mount()`/`update()`; pixel-level proof is the real-device
/// `PaintGateUITests.testSkeletonPaintsOverDetectedShapes` assertion.
///
/// Mirrors `AutoskeletonOverlayViewTest.kt` (Android) case-by-case, with ONE
/// deliberate, documented divergence: this decoder must NOT scale wire
/// geometry by any density/scale factor, because the iOS wire is ALREADY in
/// points (`AutoskeletonModuleBridge.swift`'s own header comment) and UIKit
/// draws in points — `testDecodeWireShapesPreservesEveryGeometryComponentAtFullFidelity`
/// is the test that would catch an accidental copy of Android's `* density`
/// step.
final class AutoskeletonOverlayViewHostTests: XCTestCase {
    private func freshCache() -> AutoskeletonNativeShapeCache {
        AutoskeletonNativeShapeCache()
    }

    private func wireFor(_ shapes: [[Double]]) -> [Double] {
        var out: [Double] = [1] // WIRE_VERSION
        for shape in shapes { out.append(contentsOf: shape) }
        return out
    }

    private func sizedSurface() -> UIView {
        UIView(frame: CGRect(x: 0, y: 0, width: 300, height: 200))
    }

    private func makeHost(cache: AutoskeletonNativeShapeCache) -> AutoskeletonOverlayViewHost {
        AutoskeletonOverlayViewHost(
            renderer: AutoskeletonRendererTier1(),
            shapeCache: cache,
            clock: AutoskeletonShimmerClock(ticking: AutoskeletonNoOpTicking())
        )
    }

    // MARK: - decodeWireShapes: points, no density scaling (trap #3)

    func testDecodeWireShapesPreservesEveryGeometryComponentAtFullFidelity() {
        let wire = wireFor([[1, 2, 3, 4, 5], [10, 20, 30, 40, 0]])
        let shapes = AutoskeletonOverlayViewHost.decodeWireShapes(wire)

        XCTAssertEqual(shapes.count, 2)
        XCTAssertEqual(shapes[0].x, 1)
        XCTAssertEqual(shapes[0].y, 2)
        XCTAssertEqual(shapes[0].w, 3)
        XCTAssertEqual(shapes[0].h, 4)
        XCTAssertEqual(shapes[0].r, 5)
        XCTAssertEqual(shapes[1].x, 10)
    }

    func testDecodeWireShapesReturnsEmptyForAnEmptyWireArray() {
        XCTAssertTrue(AutoskeletonOverlayViewHost.decodeWireShapes([]).isEmpty)
    }

    // MARK: - parseColor

    func testParseColorParsesAValidHexColor() {
        let color = AutoskeletonOverlayViewHost.parseColor("#e2e2e2", default: .black)
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        XCTAssertTrue(color.getRed(&r, green: &g, blue: &b, alpha: &a))
        XCTAssertEqual(r, 226.0 / 255.0, accuracy: 0.001)
        XCTAssertEqual(g, 226.0 / 255.0, accuracy: 0.001)
        XCTAssertEqual(b, 226.0 / 255.0, accuracy: 0.001)
    }

    func testParseColorFallsBackSafelyOnAnInvalidColor() {
        let color = AutoskeletonOverlayViewHost.parseColor("not-a-color", default: .white)
        XCTAssertEqual(color, .white)
    }

    // MARK: - mountOrUpdate

    /// G.18 restructured the renderer's mounted tree: `surface.layer`'s single
    /// sublayer is now the STATIONARY container that owns the mask and the
    /// opaque base fill, and the `CAGradientLayer` the sweep animates is that
    /// container's sublayer. These host tests care about the shimmer animation,
    /// so they look the gradient up by role rather than by position.
    private func shimmerGradient(in surface: UIView) -> CAGradientLayer {
        let container = try! XCTUnwrap(surface.layer.sublayers?.first, "the renderer must mount exactly one root layer")
        let gradients = (container.sublayers ?? []).compactMap { $0 as? CAGradientLayer }
        XCTAssertEqual(gradients.count, 1, "exactly one gradient band must be mounted")
        return try! XCTUnwrap(gradients.first)
    }

    func testMountsTheTier1RendererOnceCacheKeyIsSetAndTheSurfaceIsSized() {
        let cache = freshCache()
        cache.set("k1", wireFor([[0, 0, 50, 50, 4]]))
        let host = makeHost(cache: cache)
        let surface = sizedSurface()

        host.mountOrUpdate(
            cacheKey: "k1", baseColor: "#e2e2e2", highlightColor: "#f5f5f5",
            defaultRadius: 4, speedMs: 1400, animation: "shimmer",
            reducedMotion: false, debugOverlay: false, surface: surface
        )

        XCTAssertEqual(surface.layer.sublayers?.count, 1)
        // G.18: the root sublayer is the stationary masked container, and the
        // animated gradient band lives inside it — never the other way round.
        let container = try! XCTUnwrap(surface.layer.sublayers?.first)
        XCTAssertFalse(container is CAGradientLayer, "the mask's owner must not be the layer the sweep animates")
        XCTAssertNotNil(container.mask, "the container must own the mask")
        XCTAssertTrue(shimmerGradient(in: surface).superlayer === container)
    }

    func testNeverMountsWhenTheCacheHasNoEntryForTheGivenKey() {
        let host = makeHost(cache: freshCache())
        let surface = sizedSurface()

        host.mountOrUpdate(
            cacheKey: "missing-key", baseColor: "#e2e2e2", highlightColor: "#f5f5f5",
            defaultRadius: 4, speedMs: 1400, animation: "shimmer",
            reducedMotion: false, debugOverlay: false, surface: surface
        )

        XCTAssertNil(surface.layer.sublayers)
    }

    func testNeverMountsWhenTheSurfaceHasNoSizeYet() {
        let cache = freshCache()
        cache.set("k1", wireFor([[0, 0, 50, 50, 4]]))
        let host = makeHost(cache: cache)
        let unsizedSurface = UIView(frame: .zero)

        host.mountOrUpdate(
            cacheKey: "k1", baseColor: "#e2e2e2", highlightColor: "#f5f5f5",
            defaultRadius: 4, speedMs: 1400, animation: "shimmer",
            reducedMotion: false, debugOverlay: false, surface: unsizedSurface
        )

        XCTAssertNil(unsizedSurface.layer.sublayers)
    }

    func testUpdatesShapesInPlaceWithoutRemountingWhenTheSameCacheKeyIsReSet() {
        let cache = freshCache()
        cache.set("k1", wireFor([[0, 0, 50, 50, 4]]))
        let host = makeHost(cache: cache)
        let surface = sizedSurface()

        host.mountOrUpdate(
            cacheKey: "k1", baseColor: "#e2e2e2", highlightColor: "#f5f5f5",
            defaultRadius: 4, speedMs: 1400, animation: "shimmer",
            reducedMotion: false, debugOverlay: false, surface: surface
        )
        let gradientLayer = shimmerGradient(in: surface)
        let beginTimeBefore = try! XCTUnwrap(
            gradientLayer.animation(forKey: AutoskeletonRendererTier1.Handle.shimmerAnimationKey)
        ).beginTime

        // Re-setting the SAME cacheKey with fresh data (e.g. a refine() landing
        // a second, more accurate snapshot) must update in place, never restart
        // the shimmer phase by remounting.
        cache.set("k1", wireFor([[0, 0, 80, 80, 8]]))
        host.mountOrUpdate(
            cacheKey: "k1", baseColor: "#e2e2e2", highlightColor: "#f5f5f5",
            defaultRadius: 4, speedMs: 1400, animation: "shimmer",
            reducedMotion: false, debugOverlay: false, surface: surface
        )

        XCTAssertEqual(surface.layer.sublayers?.count, 1)
        XCTAssertTrue(shimmerGradient(in: surface) === gradientLayer)
        let beginTimeAfter = try! XCTUnwrap(
            gradientLayer.animation(forKey: AutoskeletonRendererTier1.Handle.shimmerAnimationKey)
        ).beginTime
        XCTAssertEqual(beginTimeBefore, beginTimeAfter, "must not restart the shimmer phase on an in-place update")
    }

    func testDestroyRemovesTheMountedOverlayLayer() {
        let cache = freshCache()
        cache.set("k1", wireFor([[0, 0, 50, 50, 4]]))
        let host = makeHost(cache: cache)
        let surface = sizedSurface()

        host.mountOrUpdate(
            cacheKey: "k1", baseColor: "#e2e2e2", highlightColor: "#f5f5f5",
            defaultRadius: 4, speedMs: 1400, animation: "shimmer",
            reducedMotion: false, debugOverlay: false, surface: surface
        )
        XCTAssertEqual(surface.layer.sublayers?.count, 1)

        host.destroy()

        // `CALayer.sublayers` is `nil`, not an empty array, once the last
        // sublayer is removed — asserting `?.count ?? 0` avoids a false
        // failure on that documented CoreAnimation behavior.
        XCTAssertEqual(surface.layer.sublayers?.count ?? 0, 0)
    }

    func testParsesHexColorPropsAndFallsBackSafelyOnAnInvalidColorWithoutCrashing() {
        let cache = freshCache()
        cache.set("k1", wireFor([[0, 0, 50, 50, 4]]))
        let host = makeHost(cache: cache)
        let surface = sizedSurface()

        // Must not crash even with an invalid color string (defensive default).
        host.mountOrUpdate(
            cacheKey: "k1", baseColor: "not-a-color", highlightColor: "#f5f5f5",
            defaultRadius: 4, speedMs: 1400, animation: "shimmer",
            reducedMotion: false, debugOverlay: false, surface: surface
        )

        XCTAssertEqual(surface.layer.sublayers?.count, 1)
    }

    func testReducedMotionForwardsToThePulseAnimationInsteadOfShimmer() {
        let cache = freshCache()
        cache.set("k1", wireFor([[0, 0, 50, 50, 4]]))
        let host = makeHost(cache: cache)
        let surface = sizedSurface()

        host.mountOrUpdate(
            cacheKey: "k1", baseColor: "#e2e2e2", highlightColor: "#f5f5f5",
            defaultRadius: 4, speedMs: 1400, animation: "shimmer",
            reducedMotion: true, debugOverlay: false, surface: surface
        )

        let gradientLayer = shimmerGradient(in: surface)
        XCTAssertNil(gradientLayer.animation(forKey: AutoskeletonRendererTier1.Handle.shimmerAnimationKey))
        XCTAssertNotNil(gradientLayer.animation(forKey: "autoskeleton.pulse"))
    }

    // WAS `testAnimationNoneDegradesToPulseJustLikeReducedMotion`, asserting
    // `XCTAssertNotNil(gradientLayer.animation(forKey: "autoskeleton.pulse"))`
    // for `animation: "none"`. It passed because the code did the wrong thing:
    // `reducedMotion || animation == "none"` routed the one value meaning "do
    // not animate" straight into the reduced-motion pulse. A test can only
    // pin behaviour it can also reject, and this one could not.
    func testAnimationNoneRunsNoAnimationAtAll() {
        let cache = freshCache()
        cache.set("k1", wireFor([[0, 0, 50, 50, 4]]))
        let host = makeHost(cache: cache)
        let surface = sizedSurface()

        host.mountOrUpdate(
            cacheKey: "k1", baseColor: "#e2e2e2", highlightColor: "#f5f5f5",
            defaultRadius: 4, speedMs: 1400, animation: "none",
            reducedMotion: false, debugOverlay: false, surface: surface
        )

        let gradientLayer = shimmerGradient(in: surface)
        XCTAssertNil(gradientLayer.animation(forKey: AutoskeletonRendererTier1.Handle.shimmerAnimationKey))
        XCTAssertNil(gradientLayer.animation(forKey: "autoskeleton.pulse"))
    }

    func testAnExplicitPulseIsAPulseEvenWithThePreferenceOff() {
        let cache = freshCache()
        cache.set("k1", wireFor([[0, 0, 50, 50, 4]]))
        let host = makeHost(cache: cache)
        let surface = sizedSurface()

        host.mountOrUpdate(
            cacheKey: "k1", baseColor: "#e2e2e2", highlightColor: "#f5f5f5",
            defaultRadius: 4, speedMs: 1400, animation: "pulse",
            reducedMotion: false, debugOverlay: false, surface: surface
        )

        let gradientLayer = shimmerGradient(in: surface)
        XCTAssertNil(gradientLayer.animation(forKey: AutoskeletonRendererTier1.Handle.shimmerAnimationKey))
        XCTAssertNotNil(gradientLayer.animation(forKey: "autoskeleton.pulse"))
    }

    func testSpeedMsFlowsThroughToTheSharedClockPeriodAndTheShimmerDuration() {
        let cache = freshCache()
        cache.set("k1", wireFor([[0, 0, 50, 50, 4]]))
        let host = makeHost(cache: cache)
        let surface = sizedSurface()

        host.mountOrUpdate(
            cacheKey: "k1", baseColor: "#e2e2e2", highlightColor: "#f5f5f5",
            defaultRadius: 4, speedMs: 999, animation: "shimmer",
            reducedMotion: false, debugOverlay: false, surface: surface
        )

        let gradientLayer = shimmerGradient(in: surface)
        let shimmer = try! XCTUnwrap(
            gradientLayer.animation(forKey: AutoskeletonRendererTier1.Handle.shimmerAnimationKey) as? CABasicAnimation
        )
        XCTAssertEqual(shimmer.duration, 0.999, accuracy: 0.0001)
    }
}
