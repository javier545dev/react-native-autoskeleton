@testable import Autoskeleton
import UIKit
import XCTest

/// Task 3.4 (tasks.md Phase 3) / spec.md §1.10: `AutoskeletonAccessibility` tests
/// (REQ-A11Y-1/2/3).
final class AutoskeletonAccessibilityTests: XCTestCase {
    private final class RecordingAnnouncer: AutoskeletonAccessibilityAnnouncing {
        private(set) var announcements: [String] = []
        func announce(_ message: String) {
            announcements.append(message)
        }
    }

    private struct FakeReduceMotionProviding: AutoskeletonReduceMotionProviding {
        let isReduceMotionEnabled: Bool
    }

    // MARK: - REQ-A11Y-1: real content excluded from the accessibility tree while loading

    func testSetLoadingTrueHidesRealContentFromAccessibility() {
        let content = UIView()
        AutoskeletonAccessibility.setLoading(true, on: content)
        XCTAssertTrue(content.accessibilityElementsHidden)
    }

    func testSetLoadingFalseRestoresRealContentToAccessibility() {
        let content = UIView()
        AutoskeletonAccessibility.setLoading(true, on: content)
        AutoskeletonAccessibility.setLoading(false, on: content)
        XCTAssertFalse(content.accessibilityElementsHidden)
    }

    // MARK: - REQ-A11Y-2: loading state announced to screen readers

    func testAnnounceLoadingPostsTheDefaultMessage() {
        let announcer = RecordingAnnouncer()
        AutoskeletonAccessibility.announceLoading(using: announcer)
        XCTAssertEqual(announcer.announcements, ["Loading"])
    }

    func testAnnounceLoadingHonorsACustomMessage() {
        let announcer = RecordingAnnouncer()
        AutoskeletonAccessibility.announceLoading(message: "Loading your profile", using: announcer)
        XCTAssertEqual(announcer.announcements, ["Loading your profile"])
    }

    // MARK: - REQ-A11Y-3: reduce-motion resolution

    func testShouldDegradeAnimationReflectsReduceMotionEnabled() {
        XCTAssertTrue(AutoskeletonAccessibility.shouldDegradeAnimation(using: FakeReduceMotionProviding(isReduceMotionEnabled: true)))
        XCTAssertFalse(AutoskeletonAccessibility.shouldDegradeAnimation(using: FakeReduceMotionProviding(isReduceMotionEnabled: false)))
    }

    // MARK: - REQ-A11Y-3 end to end: reduce-motion resolution actually degrades the renderer

    func testReduceMotionResolutionDegradesRendererToPulseNotShimmer() {
        let renderer = AutoskeletonRendererTier1()
        let surface = UIView(frame: CGRect(x: 0, y: 0, width: 300, height: 200))
        let clock = AutoskeletonShimmerClock(ticking: AutoskeletonNoOpTicking())
        let reducedMotion = AutoskeletonAccessibility.shouldDegradeAnimation(
            using: FakeReduceMotionProviding(isReduceMotionEnabled: true)
        )

        _ = renderer.mount(
            on: surface,
            shapes: [AutoskeletonShapeInfo(x: 0, y: 0, w: 50, h: 20, r: 0, source: .text, radiusSource: .measured)],
            theme: AutoskeletonSkeletonTheme(
                baseColor: UIColor.systemGray5.cgColor,
                highlightColor: UIColor.systemGray4.cgColor,
                defaultRadius: 4,
                speedMs: 1500
            ),
            clock: clock,
            reducedMotion: reducedMotion
        )

        let gradientLayer = try! XCTUnwrap(surface.layer.sublayers?.first as? CAGradientLayer)
        XCTAssertNil(gradientLayer.animation(forKey: AutoskeletonRendererTier1.Handle.shimmerAnimationKey))
        let pulse = try! XCTUnwrap(gradientLayer.animation(forKey: "autoskeleton.pulse") as? CABasicAnimation)
        XCTAssertEqual(pulse.keyPath, "opacity", "reduce-motion must never leave a transform-based sweep running")
    }
}
