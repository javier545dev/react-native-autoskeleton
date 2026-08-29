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

    // G.18 restructured the mounted tree from ONE `CAGradientLayer` (which
    // carried the mask AND the sweep, the defect) into a stationary container
    // that owns the mask plus an opaque base fill, with the gradient translating
    // inside it. These accessors find each layer by ROLE rather than by sublayer
    // index, so a further structural change does not silently turn an assertion
    // vacuous — an absent layer is a hard `XCTUnwrap` failure, never a skip.

    /// The stationary layer that owns the mask and the base fill.
    private func container(in surface: UIView) -> CALayer {
        try! XCTUnwrap(surface.layer.sublayers?.first, "the renderer must mount exactly one root layer")
    }

    /// The only layer the sweep is allowed to move.
    private func gradient(in surface: UIView) -> CAGradientLayer {
        let gradients = allLayers(from: surface.layer).compactMap { $0 as? CAGradientLayer }
        XCTAssertEqual(gradients.count, 1, "exactly one gradient band must be mounted")
        return try! XCTUnwrap(gradients.first)
    }

    /// The mask defining the covered region.
    private func mask(in surface: UIView) -> CAShapeLayer {
        try! XCTUnwrap(maskCarrier(in: surface)?.mask, "no mask layer in the mounted tree")
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

        let gradientLayer = gradient(in: surface)
        let animation = try! XCTUnwrap(gradientLayer.animation(forKey: AutoskeletonRendererTier1.Handle.shimmerAnimationKey) as? CABasicAnimation)
        XCTAssertEqual(animation.keyPath, "transform.translation.x")
        XCTAssertEqual(animation.repeatCount, .infinity)

        // G.18: the sweep must be on the gradient and NOWHERE ELSE. The mask's
        // owner carrying it is precisely the defect — a masked layer transforms
        // its own mask, so the skeleton would travel with the highlight.
        XCTAssertNil(
            container(in: surface).animation(forKey: AutoskeletonRendererTier1.Handle.shimmerAnimationKey),
            "the layer that owns the mask must never carry the sweep"
        )
        XCTAssertNil(mask(in: surface).superlayer?.animation(forKey: AutoskeletonRendererTier1.Handle.shimmerAnimationKey))
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
        let gradientLayer = gradient(in: surface)
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
        let gradientLayer = gradient(in: surface)
        let beginTimeBefore = try! XCTUnwrap(gradientLayer.animation(forKey: AutoskeletonRendererTier1.Handle.shimmerAnimationKey)).beginTime

        handle.update(shapes: [
            AutoskeletonShapeInfo(x: 0, y: 0, w: 80, h: 30, r: 4, source: .text, radiusSource: .measured),
        ])

        let beginTimeAfter = try! XCTUnwrap(gradientLayer.animation(forKey: AutoskeletonRendererTier1.Handle.shimmerAnimationKey)).beginTime
        XCTAssertEqual(beginTimeBefore, beginTimeAfter, "a geometry-only update must not restart the shimmer phase")

        // But the mask path itself DID change to the new geometry.
        let path = try! XCTUnwrap(mask(in: surface).path)
        XCTAssertTrue(path.contains(CGPoint(x: 40, y: 15)))
    }

    // MARK: - the gradient tracks a REAL surface resize (Android's sibling defect)

    // Adversarial-review defect (2026-08-29), found by grepping the CLASS of
    // Android's never-rebuilt `LinearGradient` rather than its instance.
    // `mount` sets `gradientLayer.frame = surface.bounds` exactly once and
    // NOTHING ever resyncs it: `update(shapes:)` touches only the mask path,
    // and the sweep's `fromValue`/`toValue` (`-width ... +width`) are captured
    // from `gradientLayer.bounds.width` at the instant the animation is added.
    // A resized surface therefore keeps a band sized for the mount-time width
    // forever, sweeping the wrong span over a correctly-updated mask.
    //
    // Reachable on exactly the same path as Android's: `mountOrUpdate` is
    // called from the layout-metrics site, but the composite cache key embeds
    // `bucketWidth(windowWidth)`, so a resize inside a stable window keeps the
    // key and takes the in-place `existingHandle.update(shapes:)` branch.
    func testUpdateResyncsTheGradientToAResizedSurface() {
        let renderer = AutoskeletonRendererTier1()
        let surface = makeSurface() // 300 x 200
        let clock = AutoskeletonShimmerClock(ticking: AutoskeletonNoOpTicking())

        let handle = renderer.mount(
            on: surface,
            shapes: [AutoskeletonShapeInfo(x: 0, y: 0, w: 50, h: 20, r: 0, source: .text, radiusSource: .measured)],
            theme: makeTheme(),
            clock: clock,
            reducedMotion: false
        )
        let gradientLayer = gradient(in: surface)
        // G.18: the CONTAINER is the layer sized to the surface; the gradient is
        // deliberately twice as wide so the sweep never uncovers the shape.
        XCTAssertEqual(container(in: surface).bounds.width, 300)
        XCTAssertEqual(gradientLayer.bounds.width, 600)
        XCTAssertEqual(gradientLayer.frame.minX, -300, "the band must hang one full width to the left at rest")
        let before = try! XCTUnwrap(
            gradientLayer.animation(forKey: AutoskeletonRendererTier1.Handle.shimmerAnimationKey) as? CABasicAnimation
        )
        XCTAssertEqual(before.toValue as? CGFloat, 300)

        surface.frame = CGRect(x: 0, y: 0, width: 600, height: 200)
        handle.update(shapes: [AutoskeletonShapeInfo(x: 0, y: 0, w: 80, h: 30, r: 4, source: .text, radiusSource: .measured)])

        XCTAssertEqual(container(in: surface).bounds.width, 600, "the container must cover the resized surface, not the mount-time one")
        XCTAssertEqual(gradientLayer.bounds.width, 1200, "the band must be re-laid out to twice the NEW width")
        XCTAssertEqual(gradientLayer.frame.minX, -600, "the band's rest offset must track the NEW width")
        let after = try! XCTUnwrap(
            gradientLayer.animation(forKey: AutoskeletonRendererTier1.Handle.shimmerAnimationKey) as? CABasicAnimation
        )
        XCTAssertEqual(after.fromValue as? CGFloat, -600, "the sweep must span the NEW width")
        XCTAssertEqual(after.toValue as? CGFloat, 600, "the sweep must span the NEW width")
    }

    func testAHeightOnlyResizeDoesNotRestartTheShimmer() {
        // The bound on the fix, mirroring Android's `aHeightOnlyResizeDoesNot
        // RebuildTheShader`: the sweep is a function of WIDTH alone, so a list
        // growing vertically must resize the layer without restarting the
        // animation. Verified non-vacuous by planting a resync that re-applies
        // on any bounds change.
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
        let gradientLayer = gradient(in: surface)
        let beginTimeBefore = try! XCTUnwrap(
            gradientLayer.animation(forKey: AutoskeletonRendererTier1.Handle.shimmerAnimationKey)
        ).beginTime

        surface.frame = CGRect(x: 0, y: 0, width: 300, height: 900)
        handle.update(shapes: [AutoskeletonShapeInfo(x: 0, y: 0, w: 50, h: 20, r: 0, source: .text, radiusSource: .measured)])

        XCTAssertEqual(container(in: surface).bounds.height, 900, "the container must still track the new height")
        XCTAssertEqual(gradientLayer.bounds.height, 900, "the band must still track the new height")
        let beginTimeAfter = try! XCTUnwrap(
            gradientLayer.animation(forKey: AutoskeletonRendererTier1.Handle.shimmerAnimationKey)
        ).beginTime
        XCTAssertEqual(beginTimeBefore, beginTimeAfter, "a height-only resize must not restart the shimmer phase")
    }

    // MARK: - G.18: the covered region must be STATIONARY across the whole cycle

    // Every gate that existed before this one samples a SINGLE frame (or polls
    // until ONE frame satisfies it), so a shimmer that translates the WRONG
    // thing still passes: at some instant the skeleton happens to sit over the
    // probe point. These two tests sample ACROSS one full period instead, which
    // is the only sampling regime that can see the difference between "a
    // highlight sweeps through a stationary skeleton" and "the whole skeleton
    // slides across the screen".
    //
    // They are written against the LAYER TREE generically — "the layer that
    // carries the shimmer animation" and "the layer that carries the mask" are
    // both discovered by walking the tree, never assumed to be a particular
    // sublayer index — so they assert the BEHAVIOUR (what moves) rather than
    // any one structure, and would keep their meaning under a different fix.
    //
    // Freezing the phase by assigning the model `transform` is the faithful
    // stand-in for the running animation: `applyShimmer` animates exactly
    // `transform.translation.x` on that same layer, from `-width` to `+width`,
    // so the values sampled below are precisely the values CoreAnimation
    // interpolates through on the render server.

    /// Every layer in `root`'s subtree, depth-first. Mask layers are not in
    /// `sublayers`, so they are deliberately not walked as painters.
    private func allLayers(from root: CALayer) -> [CALayer] {
        var out: [CALayer] = [root]
        for sublayer in root.sublayers ?? [] {
            out.append(contentsOf: allLayers(from: sublayer))
        }
        return out
    }

    /// The layer the shimmer sweep is actually animating — discovered, not assumed.
    private func shimmerCarrier(in surface: UIView) -> CALayer? {
        allLayers(from: surface.layer).first {
            $0.animation(forKey: AutoskeletonRendererTier1.Handle.shimmerAnimationKey) != nil
        }
    }

    /// The layer whose `mask` defines the covered region — discovered, not assumed.
    private func maskCarrier(in surface: UIView) -> (owner: CALayer, mask: CAShapeLayer)? {
        for layer in allLayers(from: surface.layer) {
            if let mask = layer.mask as? CAShapeLayer {
                return (layer, mask)
            }
        }
        return nil
    }

    /// Pins the shimmer to one phase of its cycle by writing the exact property
    /// `applyShimmer`'s `CABasicAnimation` interpolates.
    private func freezeShimmer(_ surface: UIView, atTranslation tx: CGFloat) {
        guard let carrier = shimmerCarrier(in: surface) else {
            XCTFail("FIXTURE FAILURE: no layer in the tree carries the shimmer animation")
            return
        }
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        carrier.transform = CATransform3DMakeTranslation(tx, 0, 0)
        CATransaction.commit()
    }

    /// The mask's bounding box expressed in the SURFACE's coordinate space, with
    /// the full ancestor transform chain (including the frozen sweep) applied.
    /// This is literally "where on screen the skeleton currently covers".
    private func coveredBoundingBox(in surface: UIView) -> CGRect? {
        guard let (owner, mask) = maskCarrier(in: surface), let path = mask.path else { return nil }
        return owner.convert(path.boundingBoxOfPath, to: surface.layer)
    }

    /// True when `point` (in surface space) currently falls inside the mask.
    private func isCovered(_ surface: UIView, _ point: CGPoint) -> Bool {
        guard let (owner, mask) = maskCarrier(in: surface), let path = mask.path else { return false }
        return path.contains(surface.layer.convert(point, to: owner))
    }

    /// True when some layer that paints FULLY OPAQUELY spans `point` (in surface
    /// space) at the current phase. A `CAGradientLayer` whose every stop is
    /// opaque paints its whole frame opaque; so does any layer with an opaque
    /// `backgroundColor`. This is what "no content shows through" means.
    private func isOpaquelyPainted(_ surface: UIView, _ point: CGPoint) -> Bool {
        for layer in allLayers(from: surface.layer) where layer !== surface.layer {
            guard paintsOpaquely(layer) else { continue }
            if layer.bounds.contains(surface.layer.convert(point, to: layer)) { return true }
        }
        return false
    }

    private func paintsOpaquely(_ layer: CALayer) -> Bool {
        if let gradient = layer as? CAGradientLayer, let colors = gradient.colors as? [CGColor], !colors.isEmpty {
            return colors.allSatisfy { $0.alpha >= 1 }
        }
        if let background = layer.backgroundColor { return background.alpha >= 1 }
        return false
    }

    /// The translations the sweep passes through over one whole period, sampled
    /// evenly — `applyShimmer` runs `-width ... +width`.
    private func sweepTranslations(width: CGFloat, samples: Int = 16) -> [CGFloat] {
        (0..<samples).map { -width + (2 * width) * CGFloat($0) / CGFloat(samples) }
    }

    func testCoveredRegionDoesNotMoveAcrossTheWholeShimmerCycle() {
        let renderer = AutoskeletonRendererTier1()
        let surface = makeSurface() // 300 x 200
        let clock = AutoskeletonShimmerClock(ticking: AutoskeletonNoOpTicking())

        _ = renderer.mount(
            on: surface,
            shapes: [AutoskeletonShapeInfo(x: 20, y: 20, w: 120, h: 40, r: 8, source: .text, radiusSource: .measured)],
            theme: makeTheme(),
            clock: clock,
            reducedMotion: false
        )

        let reference = try! XCTUnwrap(coveredBoundingBox(in: surface), "FIXTURE FAILURE: no mask in the layer tree")
        XCTAssertEqual(reference.minX, 20, accuracy: 0.5, "FIXTURE FAILURE: the covered box must start at the shape")

        for tx in sweepTranslations(width: surface.bounds.width) {
            freezeShimmer(surface, atTranslation: tx)
            let box = try! XCTUnwrap(coveredBoundingBox(in: surface))
            XCTAssertEqual(
                box.minX, reference.minX, accuracy: 0.5,
                "The skeleton's covered region MOVED at sweep translation \(tx): it starts at " +
                    "\(box.minX) instead of \(reference.minX). Only the highlight may travel — " +
                    "the covered region must be stationary, or the skeleton stops covering the " +
                    "content it exists to cover."
            )
            XCTAssertEqual(box.maxX, reference.maxX, accuracy: 0.5, "the covered region's right edge moved at translation \(tx)")
        }
    }

    func testAPointOverContentStaysCoveredAndOpaqueAcrossTheWholeShimmerCycle() {
        let renderer = AutoskeletonRendererTier1()
        let surface = makeSurface() // 300 x 200
        let clock = AutoskeletonShimmerClock(ticking: AutoskeletonNoOpTicking())

        _ = renderer.mount(
            on: surface,
            shapes: [AutoskeletonShapeInfo(x: 20, y: 20, w: 120, h: 40, r: 8, source: .text, radiusSource: .measured)],
            theme: makeTheme(),
            clock: clock,
            reducedMotion: false
        )

        // The centre of the detected shape — the analogue of the on-device
        // gate's `paint-gate-image` centre pixel.
        let probe = CGPoint(x: 80, y: 40)
        XCTAssertTrue(isCovered(surface, probe), "FIXTURE FAILURE: the probe must start inside the mask")

        for tx in sweepTranslations(width: surface.bounds.width) {
            freezeShimmer(surface, atTranslation: tx)
            XCTAssertTrue(
                isCovered(surface, probe),
                "At sweep translation \(tx) the probe point \(probe) — the centre of a detected " +
                    "shape — is no longer inside the skeleton's mask. The mask is travelling with " +
                    "the sweep, so the real content is exposed for part of every cycle."
            )
            XCTAssertTrue(
                isOpaquelyPainted(surface, probe),
                "At sweep translation \(tx) nothing opaque is painted over \(probe). The base " +
                    "colour must cover the whole shape for the ENTIRE cycle — a gap at the " +
                    "sweep's extremes is exactly what lets the real content show through."
            )
        }
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
        let gradientLayer = gradient(in: surface)

        XCTAssertNil(gradientLayer.animation(forKey: AutoskeletonRendererTier1.Handle.shimmerAnimationKey))
        let pulse = try! XCTUnwrap(gradientLayer.animation(forKey: "autoskeleton.pulse") as? CABasicAnimation)
        XCTAssertEqual(pulse.keyPath, "opacity", "reduced motion must never apply a transform-based sweep")

        // G.18: reduced motion must still be a STATIC, FULLY COVERING skeleton.
        // The pulse is on the gradient only — the container keeps the opaque
        // base fill under it, so the trough of the pulse can never let the real
        // content bleed through, and no layer is transformed at all.
        let containerLayer = container(in: surface)
        XCTAssertNil(containerLayer.animation(forKey: "autoskeleton.pulse"), "the base fill must never pulse")
        XCTAssertNil(containerLayer.animation(forKey: AutoskeletonRendererTier1.Handle.shimmerAnimationKey))
        XCTAssertEqual(containerLayer.opacity, 1, "the base fill must stay fully opaque under reduced motion")
        XCTAssertTrue(paintsOpaquely(containerLayer), "the container must paint an opaque base colour")
        XCTAssertTrue(isCovered(surface, CGPoint(x: 25, y: 10)), "the shape must still be covered")
        XCTAssertTrue(isOpaquelyPainted(surface, CGPoint(x: 25, y: 10)), "the shape must still be opaque")
    }
}

/// Test-only no-op ticker: the renderer tests never need `subscribe()`'s dev/test
/// tick path, and a real `CADisplayLink` requires a live run loop pump XCTest does
/// not provide deterministically.
final class AutoskeletonNoOpTicking: AutoskeletonClockTicking {
    func start(target: Any, selector: Selector) {}
    func stop() {}
}
