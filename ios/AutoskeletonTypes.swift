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

/// `<AutoSkeleton.Ignore>` bug fix (`src/native/Ignore.tsx`): sentinel
/// `accessibilityIdentifier` value the JS `Ignore` component clones onto its
/// single child (via the `testID` prop — VERIFIED, not assumed, by reading
/// `RCTViewComponentView.mm`'s `testId` prop-diffing branch: `testID` reaches
/// `accessibilityIdentifier` on iOS, while `nativeID` reaches an unrelated
/// `.nativeId` category property this sensor never reads), recognized
/// DIRECTLY by `AutoskeletonSensor`'s traversal — BEFORE consulting
/// `AutoskeletonHintRegistry` — so it works with today's production
/// `AutoskeletonEmptyHintRegistry` and needs no bridge/registry wiring.
/// Structurally the same `marker || registry` shape as `src/web/dom-sensor.ts`'s
/// `isIgnored()` (`el.hasAttribute(IGNORE_ATTRIBUTE) || hints.isIgnored(...)`).
/// Mirrored verbatim in `src/native/Ignore.tsx` (`AUTOSKELETON_IGNORE_MARKER_ID`)
/// and `AutoskeletonTypes.kt` (`AUTOSKELETON_IGNORE_MARKER_NATIVE_ID`) — the
/// same deliberate-duplication convention this codebase already uses for
/// `skeletonBaseColor` in the on-device paint-gate tests, so a drift between
/// platforms is a loud test failure, never a silent divergence.
let autoskeletonIgnoreMarkerNativeId = "__autoskeleton-ignore__"

/// Mirrors `HintRegistry` in `src/core/contracts.ts`. `nodeId` is the view's
/// `accessibilityIdentifier` — the public channel plan.md §4 names for both the
/// `Ignore` marker and typed hints on iOS.
protocol AutoskeletonHintRegistry {
    func lines(for nodeId: String) -> Int?
    func radius(for nodeId: String) -> CGFloat?
    func isIgnored(_ nodeId: String) -> Bool
}

/// A `HintRegistry` with nothing configured — every lookup misses. Used by
/// tests and as a documented degenerate case; production now uses
/// `AutoskeletonMapHintRegistry` (below), built from the bridge's marshaled
/// `AutoskeletonHintEntry` list.
struct AutoskeletonEmptyHintRegistry: AutoskeletonHintRegistry {
    func lines(for nodeId: String) -> Int? { nil }
    func radius(for nodeId: String) -> CGFloat? { nil }
    func isIgnored(_ nodeId: String) -> Bool { false }
}

/// Plain-Swift mirror of one `AutoskeletonHintEntry`
/// (`src/native/NativeAutoskeleton.ts`) — the typed-hint channel's marshaled
/// DATA crossing the Turbo Module boundary (never `HintRegistry`'s
/// functions, which cannot cross it at all). `lines`/`radius` are already
/// decoded from the wire's `0`/`-1` "no override" sentinels back to `nil`
/// by `AutoskeletonModuleBridge`'s dictionary-decoding step, so `nil` here
/// always means "genuinely no hint for this field".
struct AutoskeletonHintEntry {
    let nodeId: String
    let lines: Int?
    let radius: CGFloat?

    /// Decodes ONE marshaled dictionary (`Autoskeleton.mm` builds one per
    /// `config.hints()` `LazyVector` element — `@objc`-bridgeable
    /// `NSDictionary<NSString, NSObject>` is the chosen crossing shape,
    /// since a Swift STRUCT cannot itself be `@objc` and therefore cannot
    /// cross the ObjC++/Swift boundary directly). Applies the SAME
    /// `lines: 0` / `radius: -1` "no override" sentinel convention
    /// `NativeAutoskeleton.ts` and Android's `toHintEntries()` already
    /// document — decoded back to `nil` here, never left as a
    /// misleading "real" `0`/`-1` value.
    static func decode(_ dict: [String: Any]) -> AutoskeletonHintEntry? {
        guard let nodeId = dict["nodeId"] as? String else {
            return nil
        }
        let lines = (dict["lines"] as? NSNumber)?.intValue ?? 0
        let radius = (dict["radius"] as? NSNumber)?.doubleValue ?? -1
        return AutoskeletonHintEntry(
            nodeId: nodeId,
            lines: lines == 0 ? nil : lines,
            radius: radius == -1 ? nil : CGFloat(radius)
        )
    }
}

/// Typed-hint channel (plan.md ADR-2 R0 on Android; a deliberate OVERRIDE of
/// `layer.cornerRadius` on iOS — see `AutoskeletonSensor.swift`'s
/// `leafShapes(for:root:source:ctx:)`). The real registry built from
/// `AutoskeletonHintEntry` entries that crossed the Turbo Module boundary —
/// the production default `AutoskeletonModuleBridge.computeWireArray` now
/// passes instead of `AutoskeletonEmptyHintRegistry`. `isIgnored` stays
/// always `false`: `<AutoSkeleton.Ignore>` uses its own self-sufficient
/// `autoskeletonIgnoreMarkerNativeId` marker channel, checked directly by
/// `AutoskeletonSensor.traverse()` before this registry is ever consulted —
/// the same deliberate split `core/hint-registry.ts`'s `createHintRegistry`
/// makes on the JS side and Android's `AutoskeletonMapHintRegistry` makes.
struct AutoskeletonMapHintRegistry: AutoskeletonHintRegistry {
    private let linesByNodeId: [String: Int]
    private let radiusByNodeId: [String: CGFloat]

    init(_ entries: [AutoskeletonHintEntry]) {
        var lines: [String: Int] = [:]
        var radius: [String: CGFloat] = [:]
        for entry in entries {
            if let l = entry.lines {
                lines[entry.nodeId] = l
            }
            if let r = entry.radius {
                radius[entry.nodeId] = r
            }
        }
        self.linesByNodeId = lines
        self.radiusByNodeId = radius
    }

    func lines(for nodeId: String) -> Int? { linesByNodeId[nodeId] }
    func radius(for nodeId: String) -> CGFloat? { radiusByNodeId[nodeId] }
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
/// Objective-C++, so `Autoskeleton.mm` decodes it into primitive scalars
/// (plus an `NSArray<NSDictionary>` for `hints`, the typed-hint channel's
/// marshaled entries) at the ObjC++/Swift boundary;
/// `AutoskeletonModuleBridge` collects them back into this struct so
/// `computeWireArray` and its tests stay pure Swift. See
/// `AutoskeletonModuleBridge.getShapes(reactTag:cacheKey:defaultRadius:
/// budgetMs:maxShapes:collectDebugSidecars:hints:resolveView:)`'s doc
/// comment for the full rationale.
struct AutoskeletonGetShapesConfig {
    let defaultRadius: CGFloat
    let budgetMs: Double
    let maxShapes: Int
    let collectDebugSidecars: Bool
    let hints: [AutoskeletonHintEntry]
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
