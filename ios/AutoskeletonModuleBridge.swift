import Foundation
import UIKit

// Task 5.1 (tasks.md Phase 5) / plan.md ADR-1: the Swift half of the
// codegen'd Turbo Module `getShapes`/`evictShapes` implementation.
// `Autoskeleton.mm` (the ObjC++ class satisfying `getTurboModule:`, which
// must stay Objective-C++ since that factory method returns a C++
// `std::shared_ptr`) imports the CocoaPods-generated `Autoskeleton-Swift.h`
// umbrella header and delegates the actual `getShapes`/`evictShapes` body
// to this `@objc`-exposed class, so the real logic — resolving the view,
// calling the EXISTING `AutoskeletonSensor.measure()` (task 3.1), encoding
// the wire array, writing `AutoskeletonNativeShapeCache` (task 5.2) — is
// ordinary, directly-Swift-testable code, not ObjC++.
//
// Unlike Android, iOS needs NO density-normalization step here: UIKit's
// entire coordinate system (`UIView.frame`, `convert(rect:to:)`,
// `layer.cornerRadius`) is already expressed in points, not raw pixels —
// plan.md §4.1 "Units" only calls out Android's raw-pixel-to-dp division
// as a bridge-layer concern; iOS's own `AutoskeletonSensor` output is
// already in the wire's density-independent unit.
//
// Visual-paint-gate remediation — the ACTUAL Swift/ObjC++ interop root
// cause (superseding the earlier session's "reproducible Xcode New Build
// System issue" theory, which this session's investigation disproved by
// direct inspection): `@objc` alone is NOT sufficient for a symbol to
// appear in the generated `Autoskeleton-Swift.h`. On this project's Swift
// 6.3.3 toolchain, only `public`/`open` declarations are emitted into that
// header — confirmed empirically with a minimal isolated probe class:
// `@objc(...) internal final class` (Swift's default access level, what
// this class used to be) produced ZERO lines in the generated header;
// changing only the access level to `public`, nothing else, produced the
// exact expected declaration. This holds regardless of `DEFINES_MODULE`
// or static-library-vs-framework pod linkage (both were tested and ruled
// out first, per the "exhaust configuration" instruction, before this was
// found). `public` here is therefore required, not a style preference.
@objc(AutoskeletonModuleBridge)
public final class AutoskeletonModuleBridge: NSObject {
    private let sensor: AutoskeletonSensor
    private let shapeCache: AutoskeletonNativeShapeCache
    private let uiThreadDispatcher: AutoskeletonUiThreadDispatching

    @objc override public init() {
        self.sensor = AutoskeletonSensor()
        self.shapeCache = AutoskeletonNativeShapeCache.shared
        self.uiThreadDispatcher = AutoskeletonSystemUiThreadDispatcher()
        super.init()
    }

    init(
        sensor: AutoskeletonSensor,
        shapeCache: AutoskeletonNativeShapeCache,
        uiThreadDispatcher: AutoskeletonUiThreadDispatching = AutoskeletonSystemUiThreadDispatcher()
    ) {
        self.sensor = sensor
        self.shapeCache = shapeCache
        self.uiThreadDispatcher = uiThreadDispatcher
        super.init()
    }

    /// Pure wire encoder: `[VERSION, x,y,w,h,r] x N` (plan.md §4.1).
    /// Decoupled from `AutoskeletonSensor`/`UIView` entirely so it is
    /// directly unit-testable with hand-built shapes.
    static func encodeWireArray(_ shapes: [AutoskeletonShapeInfo]) -> [Double] {
        var wire = [Double](repeating: 0, count: 1 + shapes.count * 5)
        wire[0] = 1 // WIRE_VERSION
        for (i, shape) in shapes.enumerated() {
            let offset = 1 + i * 5
            wire[offset] = Double(shape.x)
            wire[offset + 1] = Double(shape.y)
            wire[offset + 2] = Double(shape.w)
            wire[offset + 3] = Double(shape.h)
            wire[offset + 4] = Double(shape.r)
        }
        return wire
    }

    /// The measure + encode + cache-write pipeline, given an already-
    /// resolved `UIView` (view resolution itself — `viewRegistry_DEPRECATED`
    /// access — stays in `Autoskeleton.mm`/the `@objc` entry point below,
    /// since `RCTViewRegistry` is an ObjC type most naturally driven from
    /// the module's own ObjC++ side). Returns `nil` when `view` has no
    /// laid-out size yet, mirroring `Sensor.measure`'s contract.
    ///
    /// Phase-5-remediation (post-7.2 gap closure): `config` used to be
    /// hardcoded to `.defaults` here regardless of what a consumer
    /// configured via `SkeletonProvider`/per-instance props — every real
    /// traversal ran against compiled `budgetMs`/`maxShapes`/`defaultRadius`
    /// constants. `defaultRadius` is architecturally inert on iOS today
    /// (`leafShapes(for:root:source:ctx:)` in `AutoskeletonSensor.swift`
    /// always resolves via `view.layer.cornerRadius` directly — no
    /// degradation ladder/fallback rung exists on this platform), so it is
    /// threaded through anyway for honesty end-to-end, but `budgetMs`/
    /// `maxShapes` are the fields with an observable effect here (a
    /// tightened `maxShapes` visibly truncates the emitted shape count via
    /// `AutoskeletonTraversalContext.reserveCapacity`).
    /// - Parameter isCancelled: adversarial-review defect (2026-08-28):
    ///   defaults to `{ false }` for every direct caller (this file's own
    ///   pre-existing call sites, and every test that predates the defect
    ///   fix). The dispatched `getShapes(reactTag:...)` entry point below
    ///   supplies a real one — see `AutoskeletonUiThreadDispatcher.swift`'s
    ///   header comment for the full defect writeup. Checked as LATE as
    ///   possible, right before the one observable side effect
    ///   (`shapeCache.set`): the traversal itself still runs (it cannot be
    ///   stopped mid-flight either), but a cancelled caller must never have
    ///   its abandoned work retroactively poison the SHARED cache under a
    ///   `cacheKey` that, on a recycled list, may by then belong to a
    ///   different row.
    func computeWireArray(
        view: UIView,
        cacheKey: String,
        config: AutoskeletonGetShapesConfig,
        isCancelled: () -> Bool = { false }
    ) -> [Double]? {
        let options = AutoskeletonSensorOptions(
            hints: AutoskeletonMapHintRegistry(config.hints),
            budgetMs: config.budgetMs,
            maxShapes: config.maxShapes,
            defaultRadius: config.defaultRadius,
            defaultLineHeight: AutoskeletonSensorOptions.defaults.defaultLineHeight,
            collectDebugSidecars: config.collectDebugSidecars
        )
        guard let measured = sensor.measure(root: view, options: options) else {
            return nil
        }
        let wire = Self.encodeWireArray(measured.shapes)
        guard !isCancelled() else {
            return nil
        }
        shapeCache.set(cacheKey, wire)
        return wire
    }

    @objc public func getShapes(
        view: UIView?,
        cacheKey: String,
        defaultRadius: Double,
        budgetMs: Double,
        maxShapes: Double,
        collectDebugSidecars: Bool,
        hints: [[String: Any]],
        isCancelled: () -> Bool = { false }
    ) -> [NSNumber] {
        let config = AutoskeletonGetShapesConfig(
            defaultRadius: CGFloat(defaultRadius),
            budgetMs: budgetMs,
            maxShapes: Int(maxShapes),
            collectDebugSidecars: collectDebugSidecars,
            hints: hints.compactMap(AutoskeletonHintEntry.decode)
        )
        guard let view = view,
              let wire = computeWireArray(view: view, cacheKey: cacheKey, config: config, isCancelled: isCancelled)
        else {
            return []
        }
        return wire.map { NSNumber(value: $0) }
    }

    @objc public func evictShapes(_ cacheKeys: [String]) {
        shapeCache.evict(cacheKeys)
    }

    /// `Autoskeleton.mm`-facing entry point: `getShapes()` is a SYNCHRONOUS
    /// Turbo Module method invoked on the JS thread, but resolving a
    /// `UIView` (`resolveView`, a block wrapping `Autoskeleton.mm`'s own
    /// `self.viewRegistry_DEPRECATED viewForReactTag:` — kept in
    /// Objective-C++ rather than exposing `RCTViewRegistry` to Swift, which
    /// would need an additional cross-pod Swift module import) and reading
    /// UIKit geometry both require the main thread. Everything from
    /// resolution through `getShapes(view:cacheKey:defaultRadius:budgetMs:
    /// maxShapes:collectDebugSidecars:)` runs as ONE unit inside
    /// `uiThreadDispatcher.runAndWait`, mirroring
    /// `AutoskeletonModule.computeWireArray`'s dispatch on Android.
    ///
    /// Config arrives as four primitive scalars, not the codegen'd
    /// `JS::NativeAutoskeleton::AutoskeletonGetShapesConfig` C++ struct
    /// itself — that struct is only visible to Objective-C++ (`Autoskeleton.mm`
    /// decodes it there via `config.defaultRadius()` etc., verified against
    /// the actual generated `AutoskeletonSpec.h`), not to Swift, which has
    /// no C++ interop configured in this pod. Flattening to primitives at
    /// this exact boundary keeps the ObjC++ file thin (pure decode + hop)
    /// and everything else Swift-testable, matching this file's own
    /// established `reactTag`/`cacheKey` convention.
    @objc public func getShapes(
        reactTag: NSNumber,
        cacheKey: String,
        defaultRadius: Double,
        budgetMs: Double,
        maxShapes: Double,
        collectDebugSidecars: Bool,
        hints: [[String: Any]],
        resolveView: @escaping (NSNumber) -> UIView?
    ) -> [NSNumber] {
        let result: [NSNumber]? = uiThreadDispatcher.runAndWait(timeoutMs: 200) { [weak self] isCancelled in
            guard let self = self else { return [] }
            return self.getShapes(
                view: resolveView(reactTag),
                cacheKey: cacheKey,
                defaultRadius: defaultRadius,
                budgetMs: budgetMs,
                maxShapes: maxShapes,
                collectDebugSidecars: collectDebugSidecars,
                hints: hints,
                isCancelled: isCancelled
            )
        }
        return result ?? []
    }

    /// Same dispatch rationale as `getShapes(reactTag:cacheKey:resolveView:)`
    /// — `evictShapes` only touches `AutoskeletonNativeShapeCache` (not
    /// UIKit), but is kept on the same dispatch path for consistency and so
    /// eviction can never reorder ahead of an in-flight `getShapes` write
    /// dispatched moments earlier.
    @objc public func evictShapesDispatched(_ cacheKeys: [String]) {
        _ = uiThreadDispatcher.runAndWait(timeoutMs: 200) { [weak self] (_: () -> Bool) -> Bool? in
            self?.evictShapes(cacheKeys)
            return true
        }
    }
}
