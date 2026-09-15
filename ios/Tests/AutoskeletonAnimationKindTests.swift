import XCTest
import UIKit
@testable import Autoskeleton

/// The `animation` prop is public API, and tier-1 used to collapse it into a
/// single boolean: `reducedMotion || animation == "none"`.
///
/// Two defects fell out of that one line, in opposite directions:
///
///  - `"pulse"` is NOT in the predicate, so an explicit `animation="pulse"`
///    with the platform preference off played the full travelling shimmer.
///  - `"none"` IS in the predicate, and the predicate's true branch is the
///    reduced-motion PULSE — so the one value meaning "do not animate" was the
///    one value that got an animation it never asked for. That behaviour even
///    had a test asserting it, named
///    `testAnimationNoneDegradesToPulseJustLikeReducedMotion`.
///
/// This table is the Swift mirror of `src/core/animation.ts`'s
/// `effectiveAnimation`, pinned against the same cases its Vitest table drives
/// and the Kotlin mirror's `AutoskeletonAnimationKindTest`.
final class AutoskeletonAnimationKindTests: XCTestCase {

    // MARK: - the shared table

    func testEffectiveAnimationMatchesTheSharedTable() {
        XCTAssertEqual(AutoskeletonOverlayViewHost.effectiveAnimation("shimmer", reducedMotion: false), "shimmer")
        XCTAssertEqual(AutoskeletonOverlayViewHost.effectiveAnimation("pulse", reducedMotion: false), "pulse")
        XCTAssertEqual(AutoskeletonOverlayViewHost.effectiveAnimation("none", reducedMotion: false), "none")
        XCTAssertEqual(AutoskeletonOverlayViewHost.effectiveAnimation("shimmer", reducedMotion: true), "pulse")
        XCTAssertEqual(AutoskeletonOverlayViewHost.effectiveAnimation("pulse", reducedMotion: true), "pulse")
        // The whole point: reduce-motion must never turn "none" into a pulse.
        XCTAssertEqual(AutoskeletonOverlayViewHost.effectiveAnimation("none", reducedMotion: true), "none")
    }

    func testEffectiveAnimationIsIdempotent() {
        for kind in ["shimmer", "pulse", "none"] {
            for reduced in [false, true] {
                let once = AutoskeletonOverlayViewHost.effectiveAnimation(kind, reducedMotion: reduced)
                XCTAssertEqual(AutoskeletonOverlayViewHost.effectiveAnimation(once, reducedMotion: reduced), once)
            }
        }
    }

    func testAnUnknownKindFallsBackToShimmerRatherThanSilentlyDisablingTheSkeleton() {
        XCTAssertEqual(AutoskeletonOverlayViewHost.effectiveAnimation("", reducedMotion: false), "shimmer")
        XCTAssertEqual(AutoskeletonOverlayViewHost.effectiveAnimation("sparkle", reducedMotion: false), "shimmer")
    }

    // MARK: - what each kind actually does to the layers

    private func makeSurface() -> UIView {
        let surface = UIView(frame: CGRect(x: 0, y: 0, width: 200, height: 100))
        surface.layoutIfNeeded()
        return surface
    }

    private func makeTheme() -> AutoskeletonSkeletonTheme {
        AutoskeletonSkeletonTheme(
            baseColor: UIColor.lightGray.cgColor,
            highlightColor: UIColor.white.cgColor,
            defaultRadius: 4,
            speedMs: 1400
        )
    }

    @discardableResult
    private func mount(_ animation: String, on surface: UIView) -> AutoskeletonRendererHandle {
        AutoskeletonRendererTier1().mount(
            on: surface,
            shapes: [AutoskeletonShapeInfo(x: 0, y: 0, w: 50, h: 20, r: 0, source: .text, radiusSource: .measured)],
            theme: makeTheme(),
            clock: AutoskeletonShimmerClock(ticking: AutoskeletonNoOpTicking()),
            animation: animation
        )
    }

    private func gradient(in surface: UIView) -> CAGradientLayer {
        let container = surface.layer.sublayers!.compactMap { $0 as? CALayer }.first!
        return container.sublayers!.compactMap { $0 as? CAGradientLayer }.first!
    }

    private func container(in surface: UIView) -> CALayer {
        surface.layer.sublayers!.first!
    }

    func testExplicitPulseIsAPulse_notTheTravellingShimmer() {
        // The headline tier-1 defect: `"pulse"` was absent from the predicate,
        // so asking for a pulse got the full sweep on both platforms.
        let surface = makeSurface()
        mount("pulse", on: surface)
        let g = gradient(in: surface)
        XCTAssertNil(g.animation(forKey: AutoskeletonRendererTier1.Handle.shimmerAnimationKey))
        let pulse = try! XCTUnwrap(g.animation(forKey: "autoskeleton.pulse") as? CABasicAnimation)
        XCTAssertEqual(pulse.keyPath, "opacity")
    }

    func testAnimationNoneAnimatesNothingAtAll() {
        // WAS `testAnimationNoneDegradesToPulseJustLikeReducedMotion`, which
        // asserted the opposite and passed because the code did the wrong
        // thing. "Do not animate" cannot mean "run an opacity animation".
        let surface = makeSurface()
        mount("none", on: surface)
        let g = gradient(in: surface)
        XCTAssertNil(g.animation(forKey: AutoskeletonRendererTier1.Handle.shimmerAnimationKey))
        XCTAssertNil(g.animation(forKey: "autoskeleton.pulse"), "'none' must not run an animation")
    }

    func testAnimationNoneStillCoversTheContentBeneathIt() {
        // "Do not animate" must never become "do not paint": the base fill is
        // the whole reason a skeleton hides anything.
        let surface = makeSurface()
        mount("none", on: surface)
        XCTAssertEqual(container(in: surface).opacity, 1)
        XCTAssertNotNil(container(in: surface).backgroundColor)
        XCTAssertEqual(gradient(in: surface).opacity, 0, "'none' shows no highlight at all")
    }

    func testThePulseParksTheHighlightAtTheContainerCentre() {
        // The named resting position from `core/animation.ts`, shared by all
        // four renderers. Left to itself the gradient's identity transform puts
        // the highlight at the container's LEFT EDGE, because the band hangs a
        // full width to the left — a position nobody chose.
        let surface = makeSurface()
        mount("pulse", on: surface)
        let g = gradient(in: surface)
        XCTAssertEqual(g.transform.m41, surface.bounds.width / 2, accuracy: 0.001)
    }

    func testThePulseBreathesTheHighlightOnlyAndNeverTheBaseFill() {
        let surface = makeSurface()
        let clock = AutoskeletonShimmerClock(ticking: AutoskeletonNoOpTicking())
        AutoskeletonRendererTier1().mount(
            on: surface,
            shapes: [AutoskeletonShapeInfo(x: 0, y: 0, w: 50, h: 20, r: 0, source: .text, radiusSource: .measured)],
            theme: makeTheme(),
            clock: clock,
            animation: "pulse"
        )
        let pulse = try! XCTUnwrap(gradient(in: surface).animation(forKey: "autoskeleton.pulse") as? CABasicAnimation)
        XCTAssertEqual(pulse.fromValue as? Double, 0.6, "must match PULSE_MIN_OPACITY in core/animation.ts")
        XCTAssertEqual(pulse.toValue as? Double, 1.0)
        XCTAssertTrue(pulse.autoreverses)
        // ONE full breath per SHARED CLOCK period — read from the clock rather
        // than restated, because "the same period as everything else on screen"
        // is the actual contract (ADR-8) and a literal here would silently stop
        // tracking it. Two auto-reversing legs make one period, which is what
        // `@keyframes askl-pulse` does over one `--askl-speed` on the web.
        XCTAssertEqual(pulse.duration, clock.periodMs / 2000, accuracy: 0.0001)
        XCTAssertNil(container(in: surface).animation(forKey: "autoskeleton.pulse"),
                     "the opaque base must never pulse — the content would read through at the trough")
        XCTAssertEqual(container(in: surface).opacity, 1)
    }

    func testSwitchingKindsLeavesExactlyOneAnimationRunning() {
        let surface = makeSurface()
        let handle = mount("shimmer", on: surface)
        let g = gradient(in: surface)
        XCTAssertNotNil(g.animation(forKey: AutoskeletonRendererTier1.Handle.shimmerAnimationKey))

        handle.setAnimation("pulse")
        XCTAssertNil(g.animation(forKey: AutoskeletonRendererTier1.Handle.shimmerAnimationKey))
        XCTAssertNotNil(g.animation(forKey: "autoskeleton.pulse"))

        handle.setAnimation("none")
        XCTAssertNil(g.animation(forKey: AutoskeletonRendererTier1.Handle.shimmerAnimationKey))
        XCTAssertNil(g.animation(forKey: "autoskeleton.pulse"))

        handle.setAnimation("shimmer")
        XCTAssertNotNil(g.animation(forKey: AutoskeletonRendererTier1.Handle.shimmerAnimationKey))
        XCTAssertNil(g.animation(forKey: "autoskeleton.pulse"))
        XCTAssertEqual(g.opacity, 1, "returning to shimmer must restore a fully visible highlight")
    }
}
