package com.autoskeleton

import android.view.View

// Task 4.1 (tasks.md Phase 4) / plan.md §3.1, §3.4: Kotlin mirror of the TypeScript
// primitives in `src/core/types.ts` and the `Sensor<TTarget>` contract in
// `src/core/contracts.ts`. Kept structurally identical to `ios/AutoskeletonTypes.swift`
// (same field names, same enumerated cases) so the debug overlay badges and any
// future cross-platform comparison tooling read the same vocabulary on Android as
// on iOS/web.

/** Debug/telemetry classification. NEVER travels on the hot wire — mirrors
 *  `ShapeSource` in `src/core/types.ts`. */
enum class AutoskeletonShapeSource(val wireValue: String) {
    TEXT("text"),
    IMAGE("image"),
    INPUT("input"),
    BACKGROUND("background"),
    SYNTHETIC_LINE("synthetic-line"),
    CONTAINER("container"),
}

/** Where a shape's corner radius actually came from — ADR-2's four-rung public-API
 *  degradation ladder (Android-only; iOS resolves this trivially via
 *  `layer.cornerRadius`). Mirrors `RadiusSource` in `src/core/types.ts`. */
enum class AutoskeletonRadiusSource(val wireValue: String) {
    MEASURED("measured"),
    OUTLINE("outline"),
    RASTER_PROBE("raster-probe"),
    HINT("hint"),
    DEFAULT("default"),
}

/** Mirrors `DegradationFlag` in `src/core/types.ts`. Only the flags an Android
 *  sensor/resolver can actually raise are meaningful here, but the full vocabulary
 *  is kept for parity with the shared cross-platform telemetry payload. */
enum class AutoskeletonDegradationFlag(val wireValue: String) {
    RADIUS_UNAVAILABLE("radius-unavailable"),
    RADIUS_PROBE_FAILED("radius-probe-failed"),
    LEAF_CLASS_UNMATCHED("leaf-class-unmatched"),
    BUDGET_EXCEEDED("budget-exceeded"),
    SHAPE_CAP_REACHED("shape-cap-reached"),
    CLIENTRECTS_EMPTY("clientrects-empty"),
    SNAPSHOT_VERSION_MISMATCH("snapshot-version-mismatch"),
    NATIVE_MODULE_UNAVAILABLE("native-module-unavailable"),
}

/** One placeholder rectangle in the root/wrapper coordinate space, in raw view
 *  pixels (the coordinate system `offsetDescendantRectToMyCoords` operates in).
 *  Density normalization to the wire's "density-independent points" unit
 *  (plan.md §4.1: "Android divides by density before writing") is a bridge-layer
 *  concern — task 5.1's `getShapes` Turbo Module — deliberately NOT performed here,
 *  exactly mirroring how the iOS sensor's `AutoskeletonShapeInfo` emits raw
 *  `convert(rect:to:)` points with no separate wire-encoding step either. Mirrors
 *  `ShapeInfo` in `src/core/types.ts`. */
data class AutoskeletonShapeInfo(
    val x: Float,
    val y: Float,
    val w: Float,
    val h: Float,
    val r: Float,
    val source: AutoskeletonShapeSource,
    val radiusSource: AutoskeletonRadiusSource,
)

/** Mirrors `HintRegistry` in `src/core/contracts.ts`. `nodeId` is the view's
 *  `nativeID` (read back via `view.getTag(com.facebook.react.R.id.view_tag_native_id)`
 *  — the same public tag `BaseViewManager.setNativeId` writes) — the public channel
 *  plan.md §4 names for both the `Ignore` marker and typed hints on Android. */
interface AutoskeletonHintRegistry {
    fun lines(nodeId: String): Int?
    fun radius(nodeId: String): Float?
    fun isIgnored(nodeId: String): Boolean
}

/** A `HintRegistry` with nothing configured — every lookup misses. The production
 *  default until Phase 5 wires a real typed-prop-backed registry through the
 *  bridge. */
class AutoskeletonEmptyHintRegistry : AutoskeletonHintRegistry {
    override fun lines(nodeId: String): Int? = null
    override fun radius(nodeId: String): Float? = null
    override fun isIgnored(nodeId: String): Boolean = false
}

/** The result of resolving one shape's corner radius. `degraded` is non-null only
 *  when the resolution itself is a degradation the caller must record in
 *  `SensorResult.degraded` (ADR-2: "every failure mode here is silent" — so a
 *  resolver's degradation can never be dropped silently by its caller either). */
data class AutoskeletonRadiusResolution(
    val radius: Float,
    val source: AutoskeletonRadiusSource,
    val degraded: AutoskeletonDegradationFlag? = null,
)

/** Task 4.2's ADR-2 ladder plugs in here (`AutoskeletonPublicApiRadiusResolver`,
 *  `AutoskeletonRadiusResolver.kt`). `AutoskeletonNoRadiusResolver` is the default
 *  until then — used by task 4.1's own tests, which are about traversal
 *  correctness, not radius resolution — and deliberately reports the honest
 *  degraded default (`r=0`, `source=DEFAULT`, no flag) rather than guessing a
 *  radius task 4.1 has no mechanism to measure. */
interface AutoskeletonRadiusResolver {
    fun resolve(view: View, hints: AutoskeletonHintRegistry, nodeId: String?): AutoskeletonRadiusResolution
}

object AutoskeletonNoRadiusResolver : AutoskeletonRadiusResolver {
    override fun resolve(view: View, hints: AutoskeletonHintRegistry, nodeId: String?) =
        AutoskeletonRadiusResolution(radius = 0f, source = AutoskeletonRadiusSource.DEFAULT)
}

/** Mirrors `SensorOptions` in `src/core/contracts.ts`, plus two Android-specific
 *  additions: `defaultLineHeight` (same rationale as iOS: a synthetic/uninitialized
 *  `ReactTextView` carries no reliably empty-safe line-height accessor either, so
 *  collapse detection stays geometric — `frame.height < defaultLineHeight`) and
 *  `radiusResolver` (ADR-2's pluggable ladder; absent from the TS/iOS contracts
 *  because neither needs a degradation ladder at all). */
data class AutoskeletonSensorOptions(
    val hints: AutoskeletonHintRegistry = AutoskeletonEmptyHintRegistry(),
    val budgetMs: Double = 2.0,
    val maxShapes: Int = 60,
    val defaultRadius: Float = 0f,
    val defaultLineHeight: Float = 20f,
    val collectDebugSidecars: Boolean = true,
    val radiusResolver: AutoskeletonRadiusResolver = AutoskeletonNoRadiusResolver,
) {
    companion object {
        val defaults = AutoskeletonSensorOptions()
    }
}

/** Mirrors `SensorResult` in `src/core/contracts.ts`. */
data class AutoskeletonSensorResult(
    val shapes: List<AutoskeletonShapeInfo>,
    val traversalMs: Double,
    val degraded: List<AutoskeletonDegradationFlag>,
)

/** Mirrors `InvalidationReason` in `src/core/contracts.ts`. */
enum class AutoskeletonInvalidationReason(val wireValue: String) {
    RESIZE("resize"),
    MUTATION("mutation"),
    FONT_SCALE("font-scale"),
    DIRECTION("direction"),
    ORIENTATION("orientation"),
    MANUAL("manual"),
}
