import UIKit

// Task 5.8 (tasks.md Phase 5, task 5.7 follow-up) / plan.md ADR-5, ADR-9: the
// iOS counterpart of Android's `AutoskeletonOverlayView.kt` — the real
// native draw surface Fabric mounts for "AutoskeletonOverlayView" (the
// codegen'd component `src/native/AutoskeletonOverlayNativeComponent.ts`
// registers). Before this file, iOS had NO host at all for the tier-1
// renderer: `AutoskeletonRendererTier1` (task 3.2) existed and was fully
// tested in isolation, but nothing ever called its `mount(on:...)`, so
// Fabric's `RCTComponentViewFactory` fell through to
// `RCTUnimplementedViewComponentView` — RN's own "Unimplemented component"
// placeholder — which is exactly what `PaintGateUITests` proved on-device
// (see the apply-progress note for the captured-screenshot evidence).
//
// This is a thin host, kept deliberately dumb: it reads shape geometry from
// `AutoskeletonNativeShapeCache` by `cacheKey` (ADR-9 — native holds shape
// DATA, JS holds POLICY; the native `getShapes()` Turbo Module call already
// wrote this cache entry before `cacheKey` is ever set as a prop) and hosts
// the EXISTING, already-tested `AutoskeletonRendererTier1` — no new drawing
// logic, only the wiring `AutoskeletonRendererTier1Tests` already proves
// correct in isolation.
//
// Split from the `RCTViewComponentView` subclass (`AutoskeletonOverlayView.h`/
// `.mm`) for the SAME reason `AutoskeletonModuleBridge` was split from
// `Autoskeleton.mm`: an ObjC++ Fabric component view overriding
// `updateProps:oldProps:`/`updateLayoutMetrics:oldLayoutMetrics:` (both take
// C++ `facebook::react` types Swift cannot see) has nothing left to unit
// test once it is reduced to "extract plain values from C++ props, forward
// them to Swift" — every actual behavioural decision (mount vs. no-op,
// update-in-place vs. remount, color parsing, reduced-motion degradation)
// lives here, in ordinary Swift, directly testable by
// `AutoskeletonOverlayViewHostTests` with a plain `UIView` surface and no
// Fabric/ObjC++ boundary at all.
//
// DELIBERATE DIVERGENCE FROM ANDROID — trap already paid for by an earlier
// session, restated here so it is never re-introduced: Android's
// `AutoskeletonOverlayView.decodeWireShapes` multiplies every wire geometry
// value by `resources.displayMetrics.density`, because `Canvas` draws in
// raw pixels while the wire format is density-normalized points. UIKit and
// CoreGraphics work in POINTS throughout — `UIView.frame`,
// `CAShapeLayer.path`, `CAGradientLayer.frame` — and the wire this file
// reads is ALREADY in that same unit: `AutoskeletonModuleBridge.swift`'s own
// header comment states "iOS needs NO density-normalization step here...
// iOS's own `AutoskeletonSensor` output is already in the wire's
// density-independent unit", confirmed by reading that file (the actual
// wire producer) before writing this decoder, not assumed from Android's
// shape. Applying Android's `* density` multiplier here would be wrong by
// exactly the screen scale factor — `testDecodeWireShapesPreservesEveryGeometryComponentAtFullFidelity`
// in the test file is the regression guard against ever copying that step.
//
// ADR-8's shared-clock requirement applies identically to iOS: ONE
// `AutoskeletonShimmerClock`, created once at file-load time (module scope),
// mirrors Android's `sharedShimmerClock` top-level `val` and
// `src/web/AutoSkeleton.tsx`'s module-scope `sharedClock`. A per-instance
// clock would restart `startedAt` at "now" on every remount, breaking phase
// convergence across overlay instances — the exact defect Android's own
// comment on this same line documents, and the reason the default
// `AutoskeletonOverlayViewHost.init()` below reads this shared instance
// rather than constructing a fresh one per view.
private let sharedShimmerClock = AutoskeletonShimmerClock()

// Visual-paint-gate remediation, restated for this file (the SAME finding
// `AutoskeletonModuleBridge.swift` documents for its own `@objc` surface):
// on this project's Swift 6.3.3 toolchain, `@objc` ALONE does not export a
// symbol into the generated `Autoskeleton-Swift.h` — only `public`/`open`
// declarations are emitted. Every member `AutoskeletonOverlayView.mm` calls
// (the initializer, `mountOrUpdate(...)`, `destroy()`) is therefore marked
// `public`, verified empirically after writing this file by grepping the
// generated header for the exact symbol (see this session's apply-progress
// report), not assumed from the doc comment alone.
@objc(AutoskeletonOverlayViewHost)
public final class AutoskeletonOverlayViewHost: NSObject {
    private let renderer: AutoskeletonRendererTier1
    private let shapeCache: AutoskeletonNativeShapeCache
    private let clock: AutoskeletonShimmerClock

    private var handle: AutoskeletonRendererHandle?
    private var mountedCacheKey: String?
    private var mountedAnimation: String?
    private var mountedDirection: String?

    /// The writing direction most recently delivered by
    /// `AutoskeletonOverlayView.mm`, defaulting to `"ltr"` — which is what
    /// every overlay swept before this property existed, so a host that is
    /// never told is byte-identical to the old behaviour.
    ///
    /// It is a separate `@objc` setter rather than another `mountOrUpdate`
    /// parameter on purpose: `mountOrUpdate`'s selector is already the
    /// ObjC-visible contract `AutoskeletonOverlayView.mm` calls, and widening
    /// it would break every existing Swift call site in
    /// `AutoskeletonOverlayViewHostTests` for a value none of them care about.
    /// It also mirrors Android, where `writingDirection` arrives through its
    /// own prop setter on `AutoskeletonOverlayView.kt`.
    private var direction = AutoskeletonOverlayViewHost.directionLtr

    @objc override public init() {
        renderer = AutoskeletonRendererTier1()
        shapeCache = AutoskeletonNativeShapeCache.shared
        clock = sharedShimmerClock
        super.init()
    }

    /// Test-only seam — mirrors `AutoskeletonModuleBridge`'s own dual-initializer
    /// split. Never called from `AutoskeletonOverlayView.mm`, so it stays
    /// Swift-internal (default access) and never needs `@objc`/`public`.
    init(
        renderer: AutoskeletonRendererTier1,
        shapeCache: AutoskeletonNativeShapeCache,
        clock: AutoskeletonShimmerClock
    ) {
        self.renderer = renderer
        self.shapeCache = shapeCache
        self.clock = clock
        super.init()
    }

    /// Mounts on first opportunity (sized + a cache hit for `cacheKey`),
    /// updates shapes in place when the SAME `cacheKey` is re-set with
    /// fresher data (e.g. an ADR-2-parity `refine()` landing a second, more
    /// accurate snapshot) — critically, an in-place update never restarts
    /// the shimmer phase (mirrors `AutoskeletonRendererTier1`'s own
    /// contract, proven by `AutoskeletonRendererTier1Tests`) — and remounts
    /// only when the key genuinely changes. A cache miss, or a surface with
    /// no size yet, is a safe no-op: either nothing was ever traversed for
    /// this key (or it was evicted), or Fabric has not applied layout
    /// metrics yet — there is nothing to draw in either case.
    ///
    /// Called from TWO sites in `AutoskeletonOverlayView.mm`, mirroring
    /// Android's `AutoskeletonOverlayView.kt` calling `mountOrUpdate()` from
    /// both its `cacheKey` prop setter AND `onSizeChanged`: Fabric applies
    /// props before layout metrics are known on first mount (mounting order
    /// is create -> update props -> update state -> update layout metrics),
    /// so a cache HIT that arrives before the view has a non-zero size must
    /// be retried once layout metrics land, exactly like Android's own
    /// second call site exists for the mirror-image reason (a resize after
    /// the key was already set).
    @objc public func mountOrUpdate(
        cacheKey: String,
        baseColor: String,
        highlightColor: String,
        defaultRadius: Double,
        speedMs: Double,
        animation: String,
        reducedMotion: Bool,
        debugOverlay: Bool,
        surface: UIView
    ) {
        guard surface.bounds.width > 0, surface.bounds.height > 0 else { return }
        guard let wire = shapeCache.get(cacheKey) else { return }
        let shapes = Self.decodeWireShapes(wire)

        let resolvedAnimation = Self.effectiveAnimation(animation, reducedMotion: reducedMotion)

        if let existingHandle = handle, mountedCacheKey == cacheKey {
            // Geometry-only, mirroring `AutoskeletonRendererTier1.Handle.update`'s
            // own "must not restart the shimmer phase" contract
            // (`AutoskeletonRendererTier1Tests.testUpdateDoesNotRestartTheShimmerAnimation`).
            // `setAnimation` REMOVES and re-applies the animation
            // (`AutoskeletonRendererTier1.swift`'s `Handle.applyCurrentAnimation`),
            // recomputing `beginTime` from `CACurrentMediaTime()` at the
            // moment it runs — calling it unconditionally on every same-key
            // update (e.g. a `refine()` shape-only refresh) would silently
            // restart the phase on every single call, defeating the same
            // guarantee `update(shapes:)` exists to preserve. Only forward
            // the motion state when it actually changed since the last
            // mount/update — Android has no equivalent redundant-call risk
            // here because its `animation`/`reducedMotion` prop setters are
            // separate call sites from `mountOrUpdate()`; this guard is
            // this file's own necessary substitute for that decoupling,
            // since Fabric delivers every prop together in one
            // `updateProps:oldProps:` call.
            existingHandle.update(shapes: shapes)
            // Same "only when it actually changed" discipline as the animation
            // above, and for the identical reason: `Handle.setDirection`
            // re-applies the `CABasicAnimation`, which recomputes `beginTime`.
            // In practice this branch never fires — `direction` is part of the
            // composite cache key, so a direction change arrives as a NEW key
            // and takes the remount path below — but the guard is what makes
            // that a property of this code rather than of the key format.
            if mountedDirection != direction {
                existingHandle.setDirection(direction)
                mountedDirection = direction
            }
            if mountedAnimation != resolvedAnimation {
                existingHandle.setAnimation(resolvedAnimation)
                mountedAnimation = resolvedAnimation
            }
            return
        }

        handle?.destroy()
        let theme = AutoskeletonSkeletonTheme(
            baseColor: Self.parseColor(baseColor, default: .lightGray).cgColor,
            highlightColor: Self.parseColor(highlightColor, default: .white).cgColor,
            defaultRadius: CGFloat(defaultRadius),
            speedMs: speedMs
        )
        clock.setPeriod(speedMs)
        handle = renderer.mount(
            on: surface,
            shapes: shapes,
            theme: theme,
            clock: clock,
            animation: resolvedAnimation,
            direction: direction
        )
        mountedCacheKey = cacheKey
        mountedAnimation = resolvedAnimation
        mountedDirection = direction
    }

    /// The writing direction the snapshot behind `cacheKey` was measured for,
    /// forwarded verbatim from the `writingDirection` prop — which carries the
    /// exact value `<AutoSkeleton>` put into that cache key.
    ///
    /// Fabric delivers every prop in one `updateProps:oldProps:` call, and
    /// `AutoskeletonOverlayView.mm` calls this immediately BEFORE
    /// `mountOrUpdate(...)`, so a mount always sees the direction belonging to
    /// the key it is about to mount. `layoutSubviews`' later `mountOrUpdate`
    /// call needs no companion call: the value is stored here, not passed
    /// through.
    @objc public func setDirection(_ direction: String) {
        self.direction = Self.normalizedDirection(direction)
    }

    /// Removes the mounted overlay, if any. Called from
    /// `AutoskeletonOverlayView.mm`'s `prepareForRecycle` — Fabric view
    /// recycling/unmount must not leak the tier-1 draw pass's `CAAnimation`.
    @objc public func destroy() {
        handle?.destroy()
        handle = nil
        mountedCacheKey = nil
        mountedAnimation = nil
        mountedDirection = nil
    }

    // MARK: - the shared `animation` vocabulary

    static let animationShimmer = "shimmer"
    static let animationPulse = "pulse"
    static let animationNone = "none"

    // MARK: - the shared `writingDirection` vocabulary

    /// Mirrors `Direction` in `src/core/types.ts` — the same two strings the
    /// composite cache key carries in its `direction` segment.
    static let directionLtr = "ltr"
    static let directionRtl = "rtl"

    /// Anything that is not exactly `"rtl"` is `"ltr"`.
    ///
    /// Same fallback shape, and same reasoning, as `effectiveAnimation`'s
    /// "an unrecognised kind falls back to `shimmer`": a prop typo must
    /// degrade to the overwhelmingly common case and to the behaviour that
    /// predates the prop, never to the exotic one. `WithDefault<..., 'ltr'>`
    /// in the codegen spec already makes an OMITTED prop `"ltr"`; this covers
    /// the value actually being wrong.
    static func normalizedDirection(_ direction: String) -> String {
        direction == directionRtl ? directionRtl : directionLtr
    }

    /// The pulse's trough. Mirrors `PULSE_MIN_OPACITY` in `src/core/animation.ts`.
    static let pulseMinOpacity = 0.6

    /// The Swift mirror of `src/core/animation.ts`'s `effectiveAnimation`,
    /// pinned against the same table by `AutoskeletonAnimationKindTests` and by
    /// the Kotlin mirror's `AutoskeletonAnimationKindTest`. Swift cannot import
    /// the TypeScript one, so the table is the contract and all three sides are
    /// tested against it.
    ///
    /// It replaces `reducedMotion || animation == "none"`, which was wrong in
    /// both directions at once: `"pulse"` was absent from the predicate, so an
    /// explicit pulse played the full travelling shimmer; and `"none"` was
    /// present, so the value meaning "do not animate" was routed into the
    /// reduced-motion PULSE.
    ///
    /// Reduce-motion only ever REMOVES motion. An unrecognised kind falls back
    /// to `"shimmer"` rather than to `"none"`: a prop typo must not silently
    /// disable a skeleton's animation with no diagnostic.
    static func effectiveAnimation(_ animation: String, reducedMotion: Bool) -> String {
        let requested: String
        switch animation {
        case animationPulse: requested = animationPulse
        case animationNone: requested = animationNone
        default: requested = animationShimmer
        }
        return (!reducedMotion || requested == animationNone) ? requested : animationPulse
    }

    /// Pure: `[VERSION, x,y,w,h,r] x N`, already density-independent POINTS
    /// on iOS (see this file's header comment) -> shape rectangles in the
    /// SAME coordinate space `AutoskeletonRendererTier1.unionPath` expects
    /// — NO scaling applied, unlike Android's decoder.
    /// `source`/`radiusSource` never travel on the wire (dev-only sidecars,
    /// a separate channel) and are irrelevant to `unionPath`, which only
    /// reads `x/y/w/h/r` — CONTAINER/DEFAULT are honest placeholders, not
    /// guesses about provenance this decoder cannot know.
    static func decodeWireShapes(_ wire: [Double]) -> [AutoskeletonShapeInfo] {
        guard !wire.isEmpty else { return [] }
        let shapeCount = (wire.count - 1) / 5
        var shapes: [AutoskeletonShapeInfo] = []
        shapes.reserveCapacity(shapeCount)
        for i in 0..<shapeCount {
            let offset = 1 + i * 5
            shapes.append(
                AutoskeletonShapeInfo(
                    x: CGFloat(wire[offset]),
                    y: CGFloat(wire[offset + 1]),
                    w: CGFloat(wire[offset + 2]),
                    h: CGFloat(wire[offset + 3]),
                    r: CGFloat(wire[offset + 4]),
                    source: .container,
                    radiusSource: .defaultValue
                )
            )
        }
        return shapes
    }

    /// `#rrggbb` -> `UIColor`, falling back defensively (never throws/crashes)
    /// on anything malformed — mirrors Android's `parseColorOrDefault`.
    static func parseColor(_ hex: String, default fallback: UIColor) -> UIColor {
        var hexString = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if hexString.hasPrefix("#") {
            hexString.removeFirst()
        }
        guard hexString.count == 6, let value = UInt32(hexString, radix: 16) else {
            return fallback
        }
        let r = CGFloat((value >> 16) & 0xFF) / 255
        let g = CGFloat((value >> 8) & 0xFF) / 255
        let b = CGFloat(value & 0xFF) / 255
        return UIColor(red: r, green: g, blue: b, alpha: 1)
    }
}
