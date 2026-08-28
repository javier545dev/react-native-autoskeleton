import CoreGraphics

// Task 3.1 (tasks.md Phase 3) / plan.md §3.1, §3.4: Swift mirror of the TypeScript
// primitives in `src/core/types.ts` and the `Sensor<TTarget>` contract in
// `src/core/contracts.ts`. Kept structurally identical (same field names, same
// enumerated cases) so the debug overlay badges and any future cross-platform
// comparison tooling read the same vocabulary on iOS as on web/Android.

/// Debug/telemetry classification. NEVER travels on the hot wire — mirrors
/// `ShapeSource` in `src/core/types.ts`.
enum AutoskeletonShapeSource: String {
    case text
    case image
    case input
    case background
    case syntheticLine = "synthetic-line"
    case container
}

/// Where a shape's corner radius actually came from. iOS always resolves this via
/// the public `layer.cornerRadius` API (no degradation ladder is needed on this
/// platform — that is an Android-only concern, ADR-2), so in practice iOS only ever
/// reports `.measured`, but the full enum is kept for parity with the shared
/// `RadiusSource` union and the debug overlay's rung badge (task 3.3).
enum AutoskeletonRadiusSource: String {
    case measured
    case outline
    case rasterProbe = "raster-probe"
    case hint
    case defaultValue = "default"
}

/// Mirrors `DegradationFlag` in `src/core/types.ts`. Only the flags an iOS sensor
/// can actually raise are meaningful here; the type stays a `String` rawValue enum
/// so cross-platform telemetry payloads share one vocabulary.
enum AutoskeletonDegradationFlag: String {
    case radiusUnavailable = "radius-unavailable"
    case radiusProbeFailed = "radius-probe-failed"
    case leafClassUnmatched = "leaf-class-unmatched"
    case budgetExceeded = "budget-exceeded"
    case shapeCapReached = "shape-cap-reached"
    case clientrectsEmpty = "clientrects-empty"
    case snapshotVersionMismatch = "snapshot-version-mismatch"
    case nativeModuleUnavailable = "native-module-unavailable"
}

/// One placeholder rectangle in the root/wrapper coordinate space, in points.
/// Mirrors `ShapeInfo` in `src/core/types.ts`.
struct AutoskeletonShapeInfo: Equatable {
    let x: CGFloat
    let y: CGFloat
    let w: CGFloat
    let h: CGFloat
    let r: CGFloat
    let source: AutoskeletonShapeSource
    let radiusSource: AutoskeletonRadiusSource
}

/// Mirrors `HintRegistry` in `src/core/contracts.ts`. `nodeId` is the view's
/// `accessibilityIdentifier` — the public channel plan.md §4 names for both the
/// `Ignore` marker and typed hints on iOS.
protocol AutoskeletonHintRegistry {
    func lines(for nodeId: String) -> Int?
    func radius(for nodeId: String) -> CGFloat?
    func isIgnored(_ nodeId: String) -> Bool
}

/// A `HintRegistry` with nothing configured — every lookup misses. The production
/// default until Phase 5 wires a real typed-prop-backed registry through the bridge.
struct AutoskeletonEmptyHintRegistry: AutoskeletonHintRegistry {
    func lines(for nodeId: String) -> Int? { nil }
    func radius(for nodeId: String) -> CGFloat? { nil }
    func isIgnored(_ nodeId: String) -> Bool { false }
}

/// Mirrors `SensorOptions` in `src/core/contracts.ts`, plus one iOS-specific
/// addition: `defaultLineHeight`. The TS contract does not need this because a real
/// browser always exposes a font's resolved line-height via `getComputedStyle` even
/// for empty content (`src/web/dom-sensor.ts`'s `parseLineHeight`); iOS's
/// `RCTParagraphComponentView.attributedText` is a Fabric-state-backed, read-only
/// property that carries no accessible line-height metric for genuinely empty text,
/// so the collapsed-text path needs an explicit fallback. Documented as a stated
/// deviation, not a silent one.
struct AutoskeletonSensorOptions {
    let hints: AutoskeletonHintRegistry
    let budgetMs: Double
    let maxShapes: Int
    let defaultRadius: CGFloat
    let defaultLineHeight: CGFloat
    let collectDebugSidecars: Bool
    /// REQ-OBS-BUDGET-2: mirrors `SkeletonProvider.radiusFallbackShare` on web —
    /// see `AutoskeletonObservability.swift`. `var` (not `let`) is load-bearing
    /// here: Swift's synthesized memberwise initializer only accepts an
    /// argument for a stored property with an inline default value when that
    /// property is mutable — a `let` with an inline default is baked in and
    /// excluded from the initializer's parameter list entirely. `var` keeps
    /// every existing call site compiling unchanged (the default still
    /// applies) while allowing tests to override it.
    var radiusFallbackShare: Double = autoskeletonDefaultRadiusFallbackShare

    static let defaults = AutoskeletonSensorOptions(
        hints: AutoskeletonEmptyHintRegistry(),
        budgetMs: 2,
        maxShapes: 60,
        defaultRadius: 0,
        defaultLineHeight: 20,
        collectDebugSidecars: true
    )
}

/// Plain-Swift mirror of `AutoskeletonGetShapesConfig`
/// (`src/native/NativeAutoskeleton.ts`) — the codegen'd param arrives as the
/// C++ struct `JS::NativeAutoskeleton::AutoskeletonGetShapesConfig` (verified
/// against the actual generated `AutoskeletonSpec.h`), visible only to
/// Objective-C++, so `Autoskeleton.mm` decodes it into four primitive
/// scalars at the ObjC++/Swift boundary; `AutoskeletonModuleBridge` collects
/// them back into this struct so `computeWireArray` and its tests stay
/// pure Swift. See `AutoskeletonModuleBridge.getShapes(reactTag:cacheKey:
/// defaultRadius:budgetMs:maxShapes:collectDebugSidecars:resolveView:)`'s
/// doc comment for the full rationale.
struct AutoskeletonGetShapesConfig {
    let defaultRadius: CGFloat
    let budgetMs: Double
    let maxShapes: Int
    let collectDebugSidecars: Bool
}

/// Mirrors `SensorResult` in `src/core/contracts.ts`.
struct AutoskeletonSensorResult {
    let shapes: [AutoskeletonShapeInfo]
    let traversalMs: Double
    let degraded: [AutoskeletonDegradationFlag]
}

/// Mirrors `InvalidationReason` in `src/core/contracts.ts`.
enum AutoskeletonInvalidationReason: String {
    case resize
    case mutation
    case fontScale = "font-scale"
    case direction
    case orientation
    case manual
}
