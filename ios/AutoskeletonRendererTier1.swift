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

    /// The RESOLVED presentation — `"shimmer"`, `"pulse"` or `"none"`, already
    /// reconciled with the platform preference by
    /// `AutoskeletonOverlayViewHost.effectiveAnimation` (the Swift mirror of
    /// `src/core/animation.ts`).
    ///
    /// This replaced `setReducedMotion(_: Bool)`. A boolean cannot carry three
    /// kinds, and collapsing them produced two opposite defects at once:
    /// `"pulse"` fell through to the travelling shimmer because it was not
    /// "reduced", and `"none"` was routed INTO the reduced-motion pulse — an
    /// animation, for the value that means "do not animate".
    func setAnimation(_ animation: String)

    /// The writing direction the shapes were measured for — `"ltr"` or
    /// `"rtl"`, forwarded from the SAME value `<AutoSkeleton>` put into the
    /// composite shape cache key (`src/core/cache-key.ts`), never re-read from
    /// `effectiveUserInterfaceLayoutDirection` here. The key already stores a
    /// separate snapshot per direction; a renderer that asked UIKit instead
    /// could answer differently from the key it is painting (a per-view
    /// `semanticContentAttribute` moves one and not the other), and the
    /// failure mode of that disagreement is a snapshot captured for one
    /// direction swept with the other's highlight.
    func setDirection(_ direction: String)

    /// A palette delivered while the overlay is already mounted — the
    /// dark-mode toggle case.
    ///
    /// `composeCacheKey` (`src/core/cache-key.ts`) carries no theme segment,
    /// deliberately, because geometry does not depend on colour. So a palette
    /// change never invalidates the key, never takes the remount path, and
    /// without this would simply never be applied: the skeleton keeps painting
    /// the previous palette until it happens to unmount.
    ///
    /// MUST NOT restart the shimmer phase — a colour change is not a new
    /// animation. The implementation therefore never touches the
    /// `CABasicAnimation` (which would recompute `beginTime`), only the two
    /// layer properties that carry colour.
    func setTheme(_ theme: AutoskeletonSkeletonTheme)
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
        animation: String,
        direction: String = AutoskeletonOverlayViewHost.directionLtr
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
        handle.setDirection(direction)
        handle.setAnimation(animation)

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
        private var theme: AutoskeletonSkeletonTheme
        private let clock: AutoskeletonShimmerClock
        /// The resolved kind currently applied, so a geometry resync can
        /// re-derive the width-dependent sweep (or the width-dependent parked
        /// position) without asking the caller.
        private var animation = AutoskeletonOverlayViewHost.animationShimmer
        /// The resolved writing direction currently applied. `"ltr"` by
        /// default, which is the direction every sweep travelled before this
        /// property existed — so an unset direction is byte-identical to the
        /// previous behaviour rather than merely close to it.
        private var direction = AutoskeletonOverlayViewHost.directionLtr

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
        /// Applies a post-mount palette in place.
        ///
        /// Wrapped in `withoutImplicitAnimations` for the same reason every
        /// other layer mutation here is: a bare `CALayer` property assignment
        /// outside a view's animation block gets CoreAnimation's default
        /// implicit 0.25s cross-fade, so a dark-mode toggle would visibly
        /// dissolve rather than switch. The shimmer's own `CABasicAnimation` is
        /// deliberately untouched, which is what preserves the phase.
        func setTheme(_ next: AutoskeletonSkeletonTheme) {
            guard next.baseColor != theme.baseColor || next.highlightColor != theme.highlightColor else {
                theme = next
                return
            }
            theme = next
            withoutImplicitAnimations {
                containerLayer.backgroundColor = next.baseColor
                gradientLayer.colors = [next.baseColor, next.highlightColor, next.baseColor]
            }
        }

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
            // A resize changes BOTH the sweep's span and the pulse's parked
            // position (`width / 2`), so both kinds have to be re-derived —
            // this used to bail out for anything but the shimmer, which was
            // harmless only because the parked position did not exist yet.
            guard widthChanged else { return }
            applyCurrentAnimation()
        }

        func setAnimation(_ animation: String) {
            self.animation = animation
            applyCurrentAnimation()
        }

        /// Re-applies the current kind so the sweep picks up the new travel
        /// direction. Guarded on an ACTUAL change for the same reason
        /// `AutoskeletonOverlayViewHost` guards `setAnimation`:
        /// `applyCurrentAnimation` removes and re-adds the `CABasicAnimation`,
        /// recomputing `beginTime`, so calling it on every prop delivery would
        /// restart the phase on every update. A no-op call must stay a no-op.
        func setDirection(_ direction: String) {
            let normalized = AutoskeletonOverlayViewHost.normalizedDirection(direction)
            guard normalized != self.direction else { return }
            self.direction = normalized
            applyCurrentAnimation()
        }

        /// The single place any kind is applied, so switching between them can
        /// never leave two animations on the layer or a stale transform behind.
        private func applyCurrentAnimation() {
            gradientLayer.removeAnimation(forKey: Self.shimmerAnimationKey)
            gradientLayer.removeAnimation(forKey: Self.pulseAnimationKey)
            switch animation {
            case AutoskeletonOverlayViewHost.animationNone:
                // The highlight is hidden outright rather than parked and left
                // opaque: 'none' means no highlight and no motion, matching the
                // web renderer's `.askl-anim-none .askl-shimmer-layer{opacity:0}`
                // exactly. The container keeps its opaque base fill, so the
                // skeleton still COVERS — "do not animate" is not "do not paint".
                withoutImplicitAnimations {
                    gradientLayer.opacity = 0
                    gradientLayer.transform = CATransform3DIdentity
                }
            case AutoskeletonOverlayViewHost.animationPulse:
                applyPulse()
            default:
                withoutImplicitAnimations {
                    gradientLayer.opacity = 1
                    gradientLayer.transform = CATransform3DIdentity
                }
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
            // RTL sweeps the SAME span the other way — `+width -> -width`
            // instead of `-width -> +width`. Nothing else changes: the band's
            // colour stops are `[base, highlight, base]` at `[0, 0.5, 1]`,
            // symmetric about its own centre, so reversing the translation is
            // the whole flip. Android negates the identical term in its
            // `onDraw` phase math and tier-2 multiplies by `travelSignFor`'s
            // -1 in Skia, because a sweep that flips on two of the three
            // renderers is worse than one that never flips at all.
            //
            // PHASE IS UNTOUCHED. `beginTime` below is still derived from the
            // shared `AutoskeletonShimmerClock`'s absolute origin (ADR-8), so
            // every instance on the screen remains on one wave; direction
            // changes WHERE the band is at a given phase, never WHEN the phase
            // is. Prior art for the flip itself: SkeletonView (iOS) selects
            // `isRTL ? .rightLeft : .leftRight` for exactly this reason.
            let travelsRightToLeft = direction == AutoskeletonOverlayViewHost.directionRtl
            animation.fromValue = travelsRightToLeft ? width : -width
            animation.toValue = travelsRightToLeft ? -width : width
            animation.duration = clock.periodMs / 1000
            animation.repeatCount = .infinity
            animation.isRemovedOnCompletion = false
            animation.fillMode = .forwards
            let nowMs = Date().timeIntervalSince1970 * 1000
            let offsetSeconds = clock.phaseOffsetMs(now: nowMs) / 1000
            animation.beginTime = CACurrentMediaTime() + offsetSeconds
            gradientLayer.add(animation, forKey: Self.shimmerAnimationKey)
        }

        /// `core/animation.ts`'s `'pulse'`: an opacity breath, explicitly NOT a
        /// `transform`-based sweep (ADR-6's ban applies to the shimmer path;
        /// the pulse must not reintroduce directional movement at all).
        ///
        /// The pulse is applied to the GRADIENT, never to the container: the
        /// container carries the opaque base fill, so pulsing it would make the
        /// skeleton itself semi-transparent and let the real content bleed
        /// through at the trough. The skeleton stays FULLY COVERING; only the
        /// highlight's intensity breathes.
        ///
        /// Two things here are shared contract rather than local taste:
        ///
        ///  - The band is PARKED at the container's centre. Left at the identity
        ///    transform it sits at the container's LEFT EDGE, because
        ///    `gradientFrame(for:)` hangs it a full width to the left — a
        ///    position nobody chose, and the same class of accident as Android's
        ///    gradient freezing wherever its frame loop happened to stop.
        ///  - One full breath per CLOCK PERIOD, so a half-period leg with
        ///    `autoreverses`. It used to be `max(periodMs / 1000, 1.0)` seconds
        ///    PER LEG, i.e. a full cycle of at least two seconds that ignored
        ///    the shared period entirely — the web renderer's `askl-pulse` ran
        ///    one full breath per `--askl-speed` all along, so the two platforms
        ///    were breathing at different rates for the same `theme.speedMs`.
        private func applyPulse() {
            let width = containerLayer.bounds.width > 0 ? containerLayer.bounds.width : (surface?.bounds.width ?? 0)
            withoutImplicitAnimations {
                gradientLayer.opacity = 1
                gradientLayer.transform = CATransform3DMakeTranslation(width / 2, 0, 0)
            }
            let pulse = CABasicAnimation(keyPath: "opacity")
            pulse.fromValue = AutoskeletonOverlayViewHost.pulseMinOpacity
            pulse.toValue = 1.0
            pulse.duration = clock.periodMs / 2000
            pulse.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            pulse.autoreverses = true
            pulse.repeatCount = .infinity
            gradientLayer.add(pulse, forKey: Self.pulseAnimationKey)
        }
    }
}
