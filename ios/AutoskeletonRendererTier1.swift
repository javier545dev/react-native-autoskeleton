import QuartzCore
import UIKit

// Task 3.2 (tasks.md Phase 3) / plan.md §3.5, brief §4 "Renderers > Default":
// the iOS tier-1 (zero-dependency) `Renderer` implementation. ONE `CAShapeLayer`
// masked with the combined rounded-rect path of every detected shape, plus a
// `CAGradientLayer` band swept across it. The shimmer is a single
// `CABasicAnimation` configured once at mount, with a `beginTime` derived from the
// shared `AutoskeletonShimmerClock`'s absolute origin (ADR-8) — NOT anything ticked
// per frame from JS or even from native Swift code. This is what makes NFR-2
// (shimmer keeps animating while the JS thread is blocked ≥500 ms) true by
// construction: CoreAnimation animations run on the render server, decoupled from
// both the JS thread and the main run loop, once added to the layer tree.
struct AutoskeletonSkeletonTheme {
    let baseColor: CGColor
    let highlightColor: CGColor
    let defaultRadius: CGFloat
    let speedMs: Double
}

protocol AutoskeletonRendererHandle: AnyObject {
    /// Geometry-only update. MUST NOT restart the shimmer phase and MUST NOT
    /// allocate per frame — only the mask path is recomputed and reassigned,
    /// plus a resync of the gradient layer to the surface's CURRENT bounds
    /// (see `Handle.syncGradientGeometry`), which is a no-op at an unchanged
    /// size and never restarts the phase for a height-only change.
    func update(shapes: [AutoskeletonShapeInfo])
    func setReducedMotion(_ reducedMotion: Bool)
    func destroy()
}

final class AutoskeletonRendererTier1 {
    static let kind = "native"
    let supportsRadius = true

    private let tracing: AutoskeletonTracing

    init(tracing: AutoskeletonTracing = AutoskeletonSignpostTracing()) {
        self.tracing = tracing
    }

    func isAvailable() -> Bool { true }

    /// Combines every shape's rounded rect into one union `CGPath`, in the same
    /// coordinate space the shapes were measured in. Pure and independently
    /// testable — task 3.2's DoD requires asserting this geometry directly rather
    /// than only through a mounted layer.
    static func unionPath(for shapes: [AutoskeletonShapeInfo]) -> CGPath {
        let path = CGMutablePath()
        for shape in shapes {
            let rect = CGRect(x: shape.x, y: shape.y, width: shape.w, height: shape.h)
            let radius = min(shape.r, min(shape.w, shape.h) / 2)
            if radius > 0 {
                path.addRoundedRect(in: rect, cornerWidth: radius, cornerHeight: radius)
            } else {
                path.addRect(rect)
            }
        }
        return path
    }

    @discardableResult
    func mount(
        on surface: UIView,
        shapes: [AutoskeletonShapeInfo],
        theme: AutoskeletonSkeletonTheme,
        clock: AutoskeletonShimmerClock,
        reducedMotion: Bool
    ) -> AutoskeletonRendererHandle {
        let token = tracing.begin("AutoskeletonRendererMount")

        let maskLayer = CAShapeLayer()
        maskLayer.path = Self.unionPath(for: shapes)

        let gradientLayer = CAGradientLayer()
        gradientLayer.frame = surface.bounds
        gradientLayer.mask = maskLayer
        configureGradientColors(gradientLayer, theme: theme)
        surface.layer.addSublayer(gradientLayer)

        let handle = Handle(surface: surface, maskLayer: maskLayer, gradientLayer: gradientLayer, theme: theme, clock: clock)
        handle.setReducedMotion(reducedMotion)

        tracing.end("AutoskeletonRendererMount", token: token)
        return handle
    }

    private func configureGradientColors(_ layer: CAGradientLayer, theme: AutoskeletonSkeletonTheme) {
        layer.colors = [theme.baseColor, theme.highlightColor, theme.baseColor]
        layer.locations = [0, 0.5, 1]
        layer.startPoint = CGPoint(x: 0, y: 0.5)
        layer.endPoint = CGPoint(x: 1, y: 0.5)
    }

    /// The mounted handle. A plain class (not a struct) because `RendererHandle`'s
    /// contract is reference/lifecycle-based (`destroy()`).
    final class Handle: AutoskeletonRendererHandle {
        static let shimmerAnimationKey = "autoskeleton.shimmer"
        private static let pulseAnimationKey = "autoskeleton.pulse"

        private weak var surface: UIView?
        private let maskLayer: CAShapeLayer
        private let gradientLayer: CAGradientLayer
        private let theme: AutoskeletonSkeletonTheme
        private let clock: AutoskeletonShimmerClock
        /// The motion mode currently applied, so a geometry resync can
        /// re-derive the width-dependent sweep without asking the caller.
        private var reducedMotion = false

        init(surface: UIView, maskLayer: CAShapeLayer, gradientLayer: CAGradientLayer, theme: AutoskeletonSkeletonTheme, clock: AutoskeletonShimmerClock) {
            self.surface = surface
            self.maskLayer = maskLayer
            self.gradientLayer = gradientLayer
            self.theme = theme
            self.clock = clock
        }

        func update(shapes: [AutoskeletonShapeInfo]) {
            syncGradientGeometry()
            // Geometry only — reassigning `path` does NOT touch the running
            // shimmer animation (a separate animation on `gradientLayer`, not on
            // `maskLayer`), so the phase never restarts on a data update.
            maskLayer.path = AutoskeletonRendererTier1.unionPath(for: shapes)
        }

        /// Adversarial-review defect (2026-08-29), the iOS sibling of Android's
        /// never-rebuilt `LinearGradient` — found by grepping the CLASS, not the
        /// instance. `mount` set `gradientLayer.frame = surface.bounds` exactly
        /// once and nothing ever resynced it: a raw sublayer has no
        /// autoresizing, `update(shapes:)` touched only the mask path, and the
        /// sweep's `-width ... +width` span was captured from
        /// `gradientLayer.bounds.width` when the animation was added. A resized
        /// surface therefore swept a mount-time-sized band over a
        /// correctly-updated mask for the rest of its life.
        ///
        /// Reachable on the same path as Android's: `AutoskeletonOverlayViewHost
        /// .mountOrUpdate` runs from the layout-metrics site, but the composite
        /// cache key embeds `bucketWidth(windowWidth)`, so a resize inside a
        /// stable window keeps the key and takes the in-place update branch.
        ///
        /// The animation is re-applied ONLY when the WIDTH actually changed —
        /// the sole dimension the sweep depends on — so a list growing
        /// vertically resizes the layer and allocates nothing else, mirroring
        /// Android's `shaderWidth` geometry key. Re-applying is phase-preserving
        /// by construction: `applyShimmer`'s `beginTime` is derived from the
        /// shared `AutoskeletonShimmerClock`'s absolute origin (ADR-8), not from
        /// the moment it happens to run.
        private func syncGradientGeometry() {
            guard let bounds = surface?.bounds, bounds != gradientLayer.frame else { return }
            let widthChanged = bounds.width != gradientLayer.bounds.width
            gradientLayer.frame = bounds
            guard widthChanged, !reducedMotion else { return }
            gradientLayer.removeAnimation(forKey: Self.shimmerAnimationKey)
            applyShimmer()
        }

        func setReducedMotion(_ reducedMotion: Bool) {
            self.reducedMotion = reducedMotion
            gradientLayer.removeAnimation(forKey: Self.shimmerAnimationKey)
            gradientLayer.removeAnimation(forKey: Self.pulseAnimationKey)
            if reducedMotion {
                applyPulse()
            } else {
                applyShimmer()
            }
        }

        func destroy() {
            gradientLayer.removeFromSuperlayer()
        }

        /// REQ-A11Y-3 / NFR-1 default path: one `CABasicAnimation` translating the
        /// gradient band across the mask, `beginTime` derived from the shared
        /// clock's absolute origin (ADR-8) so every instance stays in phase and no
        /// per-frame tick is required to keep it running.
        private func applyShimmer() {
            let width = gradientLayer.bounds.width > 0 ? gradientLayer.bounds.width : (surface?.bounds.width ?? 0)
            let animation = CABasicAnimation(keyPath: "transform.translation.x")
            animation.fromValue = -width
            animation.toValue = width
            animation.duration = clock.periodMs / 1000
            animation.repeatCount = .infinity
            animation.isRemovedOnCompletion = false
            animation.fillMode = .forwards
            let nowMs = Date().timeIntervalSince1970 * 1000
            let offsetSeconds = clock.phaseOffsetMs(now: nowMs) / 1000
            animation.beginTime = CACurrentMediaTime() + offsetSeconds
            gradientLayer.add(animation, forKey: Self.shimmerAnimationKey)
        }

        /// REQ-A11Y-3 reduced-motion degradation: a slow opacity pulse — explicitly
        /// NOT a `transform`-based sweep (ADR-6's ban applies to the shimmer path;
        /// reduced motion must not reintroduce directional movement at all).
        private func applyPulse() {
            let animation = CABasicAnimation(keyPath: "opacity")
            animation.fromValue = 0.6
            animation.toValue = 1.0
            animation.duration = max(clock.periodMs / 1000, 1.0)
            animation.autoreverses = true
            animation.repeatCount = .infinity
            gradientLayer.add(animation, forKey: Self.pulseAnimationKey)
        }
    }
}
