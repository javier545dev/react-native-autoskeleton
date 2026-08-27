import QuartzCore
import UIKit

// Task 3.1 (tasks.md Phase 3) / plan.md §3.4, §7.1 / brief §4 "Layout sensor": the
// iOS `Sensor` implementation. Traverses the real, laid-out `UIView` tree
// post-Yoga via `convert(rect:to:)`, classifies leaves by Fabric component-view
// class, applies the container rule, honors `Ignore` via `accessibilityIdentifier`,
// synthesizes collapsed-text line rects (reusing `AutoskeletonLines.swift`, itself a
// port of `src/core/lines.ts`), and exposes `observe()` for the REQ-NAV-1
// invalidation channel (orientation / Dynamic Type font scale).
//
// Radius resolution is deliberately simple relative to Android's ADR-2 ladder:
// `layer.cornerRadius` is a fully public API on every `UIView`, so iOS never needs a
// degradation rung — every shape's `radiusSource` is `.measured` (brief §4:
// "Radius from `layer.cornerRadius`"; plan.md ADR-2: "iOS is exact").
//
// Collapsed-text detection is a stated design decision, not a silent one:
// `RCTParagraphComponentView.attributedText` is a read-only property backed by
// Fabric's C++ `ParagraphState`, with no public line-height accessor for genuinely
// empty text — unlike the DOM sensor, which always has `getComputedStyle().fontSize`
// even for an empty element. This sensor therefore treats a text leaf as collapsed
// purely geometrically — `frame.height < options.defaultLineHeight` — matching
// spec.md's literal wording ("if a text node measures less than one line"), and
// leans on the existing `HintRegistry.lines(for:)` channel for the synthesized line
// count, exactly as the TS contract already provides.
final class AutoskeletonSensor {
    private let tracing: AutoskeletonTracing
    private let warnings: AutoskeletonWarningEmitter

    init(tracing: AutoskeletonTracing = AutoskeletonSignpostTracing(), warnings: AutoskeletonWarningEmitter = AutoskeletonSystemWarningEmitter()) {
        self.tracing = tracing
        self.warnings = warnings
    }

    /// COLD PATH. Synchronous. Returns `nil` when `root` has zero size (not laid out
    /// yet) — mirrors `Sensor.measure`'s "target is not laid out yet" contract.
    ///
    /// Task G.3 (tasks.md, observability gap closure, post-Phase-4) / spec.md
    /// REQ-OBS-BUDGET-1/2: `measure()` is the REAL traversal path on iOS — dev
    /// warnings are emitted from here, gated by `#if DEBUG` (the same
    /// compile-time mechanism established for `AutoskeletonDebugOverlay`, task
    /// 3.3), not merely produced by a formatter unit-tested in isolation.
    func measure(root: UIView, options: AutoskeletonSensorOptions = .defaults) -> AutoskeletonSensorResult? {
        guard root.bounds.width > 0, root.bounds.height > 0 else {
            return nil
        }

        let token = tracing.begin("AutoskeletonTraversal")
        let startedAt = CACurrentMediaTime()
        let ctx = AutoskeletonTraversalContext(options: options, startedAt: startedAt)
        let shapes = traverse(root, root: root, ctx: ctx)
        let traversalMs = (CACurrentMediaTime() - startedAt) * 1000
        tracing.end("AutoskeletonTraversal", token: token)

        #if DEBUG
        emitDevWarnings(shapes: shapes, traversalMs: traversalMs, degraded: ctx.degraded, options: options)
        #endif

        return AutoskeletonSensorResult(
            shapes: shapes,
            traversalMs: traversalMs,
            degraded: Array(ctx.degraded)
        )
    }

    #if DEBUG
    /// REQ-OBS-BUDGET-1/2, dev-only. `AutoskeletonTraversalContext.reserveCapacity`
    /// truncates AT `maxShapes`, so a completed traversal's own `shapes.count`
    /// can never literally exceed `maxShapes` — the real `.shapeCapReached`
    /// degradation flag (set exactly when a shape beyond the cap was genuinely
    /// rejected) is the authoritative trigger instead, feeding a
    /// `maxShapes + 1` lower-bound count — a real, honest "at least" fact
    /// derived from the real rejection, not fabricated data. Exactly mirrors
    /// the web (G.1/G.2) and Android (G.3) wiring.
    private func emitDevWarnings(
        shapes: [AutoskeletonShapeInfo],
        traversalMs: Double,
        degraded: Set<AutoskeletonDegradationFlag>,
        options: AutoskeletonSensorOptions
    ) {
        let shapeCountForBudgetCheck = degraded.contains(.shapeCapReached) ? options.maxShapes + 1 : shapes.count
        autoskeletonEmitWarnings(
            autoskeletonCheckBudgets(
                traversalMs: traversalMs,
                shapeCount: shapeCountForBudgetCheck,
                budgetMs: options.budgetMs,
                maxShapes: options.maxShapes
            ).warnings,
            to: warnings
        )
        autoskeletonEmitWarnings(
            autoskeletonCheckRadiusFallback(
                radiusSources: shapes.map(\.radiusSource),
                threshold: options.radiusFallbackShare
            ).warnings,
            to: warnings
        )
    }
    #endif

    /// Orientation / Dynamic Type (font scale) invalidation channel (REQ-NAV-1).
    /// RTL is intentionally NOT observed here: iOS does not re-run the app in a new
    /// writing direction at runtime without a full relaunch (`UIView.appearance()`
    /// semantic content changes take effect on next launch, not live), so there is
    /// no live RTL notification to subscribe to on this platform — this is a real
    /// platform constraint, not a gap, and the composite cache key (plan.md ADR-10)
    /// still participates in `direction`, it is just never invalidated mid-session.
    func observe(target: UIView, onInvalidate: @escaping (AutoskeletonInvalidationReason) -> Void) -> () -> Void {
        let center = NotificationCenter.default
        let orientationToken = center.addObserver(
            forName: UIDevice.orientationDidChangeNotification,
            object: nil,
            queue: .main
        ) { _ in
            onInvalidate(.orientation)
        }
        let contentSizeToken = center.addObserver(
            forName: UIContentSizeCategory.didChangeNotification,
            object: nil,
            queue: .main
        ) { _ in
            onInvalidate(.fontScale)
        }
        return {
            center.removeObserver(orientationToken)
            center.removeObserver(contentSizeToken)
        }
    }

    // MARK: - Traversal

    private func traverse(_ view: UIView, root: UIView, ctx: AutoskeletonTraversalContext) -> [AutoskeletonShapeInfo] {
        if ctx.truncated {
            return []
        }
        if let nodeId = view.accessibilityIdentifier, ctx.options.hints.isIgnored(nodeId) {
            return []
        }
        // A hidden/transparent view contributes no visible pixels, so it must not
        // contribute a skeleton shape either — this also keeps incidental UIKit
        // implementation-detail subviews (e.g. `UIScrollView`'s indicator views,
        // which start hidden/zero-alpha) out of the traversal without the sensor
        // needing to know their (private) class names.
        if view.isHidden || view.alpha <= 0.01 {
            return []
        }
        if ctx.overBudget() {
            return []
        }

        if let leafSource = Self.hardLeafSource(for: view) {
            return leafShapes(for: view, root: root, source: leafSource, ctx: ctx)
        }

        var collected: [AutoskeletonShapeInfo] = []
        for subview in view.subviews {
            if ctx.truncated {
                break
            }
            collected.append(contentsOf: traverse(subview, root: root, ctx: ctx))
        }

        if !collected.isEmpty {
            return collected
        }

        if Self.hasNonTransparentBackground(view) {
            return leafShapes(for: view, root: root, source: .container, ctx: ctx)
        }

        return []
    }

    /// Classifies the three Fabric leaf component-view classes named in brief §4,
    /// via `AutoskeletonReactViewClassifier` (see that file for why a plain `is`
    /// check / `import React` cannot be used from this framework-product pod
    /// target). Deliberately NOT recursive past a hard leaf: `RCTImageComponentView`'s
    /// internal `_imageView` subview is an implementation detail, not a separate
    /// skeleton shape.
    private static func hardLeafSource(for view: UIView) -> AutoskeletonShapeSource? {
        if AutoskeletonReactViewClassifier.isParagraphComponentView(view) {
            return .text
        }
        if AutoskeletonReactViewClassifier.isImageComponentView(view) {
            return .image
        }
        if AutoskeletonReactViewClassifier.isTextInputComponentView(view) {
            return .input
        }
        return nil
    }

    private static func hasNonTransparentBackground(_ view: UIView) -> Bool {
        guard let color = view.backgroundColor else {
            return false
        }
        var alpha: CGFloat = 0
        color.getRed(nil, green: nil, blue: nil, alpha: &alpha)
        return alpha > 0
    }

    private func leafShapes(
        for view: UIView,
        root: UIView,
        source: AutoskeletonShapeSource,
        ctx: AutoskeletonTraversalContext
    ) -> [AutoskeletonShapeInfo] {
        let frame = view.convert(view.bounds, to: root)
        guard frame.width > 0, frame.height > 0 else {
            return []
        }
        let nodeId = view.accessibilityIdentifier
        let radius = view.layer.cornerRadius

        if source == .text, frame.height < ctx.options.defaultLineHeight {
            let lineCount = nodeId.flatMap { ctx.options.hints.lines(for: $0) }
            let lines = autoskeletonSynthesizeLines(
                AutoskeletonSynthesizeLinesOptions(
                    x: frame.minX,
                    y: frame.minY,
                    w: frame.width,
                    h: frame.height,
                    lineHeight: ctx.options.defaultLineHeight,
                    lines: lineCount
                )
            )
            guard ctx.reserveCapacity(lines.count) else {
                return []
            }
            return lines
        }

        guard ctx.reserveCapacity(1) else {
            return []
        }
        let shape = AutoskeletonShapeInfo(
            x: frame.minX,
            y: frame.minY,
            w: frame.width,
            h: frame.height,
            r: radius,
            source: source,
            radiusSource: .measured
        )
        return [shape]
    }
}

/// Reference-type traversal state, mirroring `dom-sensor.ts`'s `TraversalContext` —
/// a class here (not a struct) so budget/cap bookkeeping is shared across the whole
/// recursive traversal without threading `inout` through every call.
final class AutoskeletonTraversalContext {
    let options: AutoskeletonSensorOptions
    let startedAt: CFTimeInterval
    private(set) var shapeCount = 0
    private(set) var truncated = false
    private(set) var degraded: Set<AutoskeletonDegradationFlag> = []

    init(options: AutoskeletonSensorOptions, startedAt: CFTimeInterval) {
        self.options = options
        self.startedAt = startedAt
    }

    /// Soft budget check (NFR-3 local guard), mirroring `dom-sensor.ts`'s
    /// `overBudget`: called before descending into each node.
    func overBudget() -> Bool {
        if truncated {
            return true
        }
        let elapsedMs = (CACurrentMediaTime() - startedAt) * 1000
        if elapsedMs > options.budgetMs {
            truncated = true
            degraded.insert(.budgetExceeded)
            return true
        }
        return false
    }

    /// Reserves capacity for `count` more shapes against `maxShapes`. Returns
    /// `false` (and truncates the whole traversal) if the cap would be exceeded.
    func reserveCapacity(_ count: Int) -> Bool {
        if truncated {
            return false
        }
        if shapeCount + count > options.maxShapes {
            truncated = true
            degraded.insert(.shapeCapReached)
            return false
        }
        shapeCount += count
        return true
    }
}
