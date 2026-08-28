import UIKit

// Task 3.4 (tasks.md Phase 3) / spec.md §1.10 REQ-A11Y-1/2/3: native accessibility
// primitives. These are the tested, reusable native surface — wiring them into the
// full public `<AutoSkeleton>` component happens in Phase 5 (task 5.5), which is
// why this file exposes small, composable functions rather than a component.
//
// Both the announcer and the reduce-motion provider are injectable seams (the same
// pattern `AutoskeletonTracing` uses for `os_signpost`): `UIAccessibility.post` is a
// fire-and-forget system call with no return value to assert on, and
// `UIAccessibility.isReduceMotionEnabled` reflects a live device/simulator setting
// XCTest cannot flip deterministically — so production code depends on protocols,
// and tests inject recording/fake doubles instead of touching real system state.

protocol AutoskeletonAccessibilityAnnouncing {
    func announce(_ message: String)
}

/// Production implementation: REQ-A11Y-2's actual system call.
final class AutoskeletonSystemAccessibilityAnnouncing: AutoskeletonAccessibilityAnnouncing {
    func announce(_ message: String) {
        UIAccessibility.post(notification: .announcement, argument: message)
    }
}

protocol AutoskeletonReduceMotionProviding {
    var isReduceMotionEnabled: Bool { get }
}

/// Production implementation: reads the live system setting.
final class AutoskeletonSystemReduceMotionProviding: AutoskeletonReduceMotionProviding {
    var isReduceMotionEnabled: Bool { UIAccessibility.isReduceMotionEnabled }
}

enum AutoskeletonAccessibility {
    static let defaultLoadingAnnouncement = "Loading"

    /// REQ-A11Y-1: hides the real content subtree from assistive technology while
    /// `isLoading`. `accessibilityElementsHidden` is Apple's documented mechanism
    /// for excluding an ENTIRE subtree from the accessibility tree — distinct from
    /// `isAccessibilityElement`, which only affects the receiving view itself, not
    /// its descendants.
    static func setLoading(_ isLoading: Bool, on realContentRoot: UIView) {
        realContentRoot.accessibilityElementsHidden = isLoading
    }

    /// REQ-A11Y-2: announces the loading state to screen readers once, when it
    /// begins (called by the future `<AutoSkeleton>` wiring exactly once per
    /// `isLoading: false -> true` transition, not on every re-render).
    static func announceLoading(
        message: String = defaultLoadingAnnouncement,
        using announcer: AutoskeletonAccessibilityAnnouncing = AutoskeletonSystemAccessibilityAnnouncing()
    ) {
        announcer.announce(message)
    }

    /// REQ-A11Y-3: resolves whether the tier-1 shimmer must degrade to a pulse/
    /// static presentation. Callers pass this straight into
    /// `AutoskeletonRendererTier1.mount(reducedMotion:)`.
    static func shouldDegradeAnimation(
        using provider: AutoskeletonReduceMotionProviding = AutoskeletonSystemReduceMotionProviding()
    ) -> Bool {
        provider.isReduceMotionEnabled
    }
}
