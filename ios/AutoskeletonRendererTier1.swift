import QuartzCore
import UIKit

// Task 3.2 (tasks.md Phase 3) / plan.md §3.5, brief §4 "Renderers > Default":
// the iOS tier-1 (zero-dependency) `Renderer` implementation. The shimmer is a
// single `CABasicAnimation` configured once at mount, with a `beginTime` derived
// from the shared `AutoskeletonShimmerClock`'s absolute origin (ADR-8) — NOT
// anything ticked per frame from JS or even from native Swift code. This is what
// makes NFR-2 (shimmer keeps animating while the JS thread is blocked ≥500 ms)
// true by construction: CoreAnimation animations run on the render server,
// decoupled from both the JS thread and the main run loop, once added to the
// layer tree.
//
// LAYER STRUCTURE — G.18, and the whole reason this file has three layers
// instead of two:
//
//     surface.layer
//     └─ containerLayer   frame = surface.bounds
//        ├─ mask = maskLayer (CAShapeLayer, the union of every shape)  STATIONARY
//        ├─ backgroundColor = theme.baseColor                          STATIONARY
//        └─ gradientLayer   frame = (-width, 0, 2*width, height)       TRANSLATES
//
// A `CALayer`'s `mask` is positioned in THAT LAYER's own coordinate space, so a
// transform applied to the masked layer transforms its mask along with it. This
// renderer used to attach the mask directly to the `CAGradientLayer` it also
// animated `transform.translation.x` on, which meant the sweep dragged the
// skeleton's covered region across the screen from `-width` to `+width` — for
// most of every cycle the skeleton was not over the content it exists to cover,
// and the real content showed through. The mask therefore has to live on a layer
// that never moves, with the gradient translating INSIDE it.
//
// The base fill on the container is the second half of the same defect and is
// not decorative: the gradient spans `2*width` and slides through `±width`, so
// at the extremes of the sweep it covers none of `0..width`. Android never had
// this problem because its `LinearGradient` uses `Shader.TileMode.CLAMP`, whose
// edge colour IS `baseColor` and therefore extends opaquely forever in both
// directions; `CAGradientLayer` paints nothing outside its own bounds, so the
// container's `backgroundColor` is how iOS reproduces that clamp. Between them
// the two guarantee the mask's whole area is opaque at every phase, which is the
// property `Shader.TileMode.CLAMP` gives Android for free.
//
// This mirrors Android's semantics exactly, on purpose (see
// `android/src/main/java/com/autoskeleton/AutoskeletonRendererTier1.kt`): a fixed
// `canvas.clipPath(maskPath)` over a full-bounds `drawRect`, with only the
// SHADER translated by `Matrix.setTranslate` — the drawing surface never moves.
// The gradient's rest span (`-width … +width`) and the sweep's range
// (`-width … +width`) are the same two numbers Android uses for its shader stops
// and its `translateX`, so both platforms put the highlight in the same place at
// the same phase.
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

        // The stationary half of the structure: it owns the mask AND the opaque
        // base fill, so the covered region is exactly the union path at every
        // phase and is opaque at every phase.
        let containerLayer = CALayer()
        containerLayer.frame = surface.bounds
        containerLayer.backgroundColor = theme.baseColor
        containerLayer.mask = maskLayer

        // The moving half: nothing but the highlight band. It is the only layer
        // the sweep ever touches.
        let gradientLayer = CAGradientLayer()
        gradientLayer.frame = Self.gradientFrame(for: surface.bounds)
        configureGradientColors(gradientLayer, theme: theme)
        containerLayer.addSublayer(gradientLayer)

        surface.layer.addSublayer(containerLayer)

        let handle = Handle(
            surface: surface,
            containerLayer: containerLayer,
            maskLayer: maskLayer,
            gradientLayer: gradientLayer,
            theme: theme,
            clock: clock
        )
        handle.setReducedMotion(reducedMotion)

        tracing.end("AutoskeletonRendererMount", token: token)
        return handle
    }

    /// The gradient's rest geometry: twice the surface's width, hanging one full
    /// width to the LEFT of the container's origin, so that translating it
    /// through `-width … +width` sweeps the highlight (its midpoint) across
    /// `-width … +width` in container coordinates — the identical span
    /// Android's `LinearGradient(-width, 0, +width, 0)` occupies before
    /// `Matrix.setTranslate` moves it.
    static func gradientFrame(for bounds: CGRect) -> CGRect {
        CGRect(x: -bounds.width, y: 0, width: bounds.width * 2, height: bounds.height)
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
        /// The stationary layer that owns the mask and the base fill. Nothing
        /// ever animates this one — that is the entire point of it existing.
        private let containerLayer: CALayer
        private let maskLayer: CAShapeLayer
        private let gradientLayer: CAGradientLayer
        private let theme: AutoskeletonSkeletonTheme
        private let clock: AutoskeletonShimmerClock
        /// The motion mode currently applied, so a geometry resync can
        /// re-derive the width-dependent sweep without asking the caller.
        private var reducedMotion = false

        init(
            surface: UIView,
            containerLayer: CALayer,
            maskLayer: CAShapeLayer,
            gradientLayer: CAGradientLayer,
            theme: AutoskeletonSkeletonTheme,
            clock: AutoskeletonShimmerClock
        ) {
            self.surface = surface
            self.containerLayer = containerLayer
            self.maskLayer = maskLayer
            self.gradientLayer = gradientLayer
            self.theme = theme
            self.clock = clock
        }

        func update(shapes: [AutoskeletonShapeInfo]) {
            syncGradientGeometry()
            // Geometry only — reassigning `path` does NOT touch the running
            // shimmer animation (a separate animation on `gradientLayer`, not on
            // `maskLayer` or `containerLayer`), so the phase never restarts on a
            // data update.
            //
            // `CAShapeLayer.path` is an animatable property, so a bare
            // assignment gets CoreAnimation's default 0.25 s implicit
            // `CABasicAnimation` and the covered region MORPHS towards the new
            // geometry instead of being it. That is a smaller sibling of the
            // defect this file's header describes — the covered region moving
            // when only the highlight is allowed to — so the assignment is made
            // inside a transaction with actions disabled. Allocation-free
            // (`CATransaction` is a thread-local stack, not an object), and only
            // ever reached on a real shape update, never per frame.
            withoutImplicitAnimations {
                maskLayer.path = AutoskeletonRendererTier1.unionPath(for: shapes)
            }
        }

        /// Applies `body` with CoreAnimation's implicit animations suppressed.
        private func withoutImplicitAnimations(_ body: () -> Void) {
            CATransaction.begin()
            CATransaction.setDisableActions(true)
            body()
            CATransaction.commit()
        }

        /// Adversarial-review defect (2026-08-29), the iOS sibling of Android's
        /// never-rebuilt `LinearGradient` — found by grepping the CLASS, not the
        /// instance. `mount` sized the shimmer layers to `surface.bounds` exactly
        /// once and nothing ever resynced them: a raw sublayer has no
        /// autoresizing, `update(shapes:)` touched only the mask path, and the
        /// sweep's `-width ... +width` span was captured from the layer's
        /// `bounds.width` when the animation was added. A resized surface
        /// therefore swept a mount-time-sized band over a correctly-updated mask
        /// for the rest of its life.
        ///
        /// G.18 kept this behaviour and moved it onto the new structure: the
        /// stationary `containerLayer` is the geometry KEY (it is the layer whose
        /// bounds equal the surface's), and the `gradientLayer` is re-laid out
        /// from it through `gradientFrame(for:)`.
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
            guard let bounds = surface?.bounds, bounds != containerLayer.frame else { return }
            let widthChanged = bounds.width != containerLayer.bounds.width
            withoutImplicitAnimations {
                containerLayer.frame = bounds
                gradientLayer.frame = AutoskeletonRendererTier1.gradientFrame(for: bounds)
            }
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
            // Removing the container removes the gradient with it — the gradient
            // is its sublayer, and the mask is its `mask`.
            containerLayer.removeFromSuperlayer()
        }

        /// REQ-A11Y-3 / NFR-1 default path: one `CABasicAnimation` translating the
        /// gradient band THROUGH the stationary masked container, `beginTime`
        /// derived from the shared clock's absolute origin (ADR-8) so every
        /// instance stays in phase and no per-frame tick is required to keep it
        /// running. `gradientLayer` is deliberately the only layer this touches:
        /// translating the mask's owner is exactly the G.18 defect.
        private func applyShimmer() {
            let width = containerLayer.bounds.width > 0 ? containerLayer.bounds.width : (surface?.bounds.width ?? 0)
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
        ///
        /// The pulse is applied to the GRADIENT, never to the container: the
        /// container carries the opaque base fill, so pulsing it would make the
        /// skeleton itself semi-transparent and let the real content bleed
        /// through at the trough. Reduced motion must still be a static, FULLY
        /// COVERING skeleton; only the highlight's intensity breathes.
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
