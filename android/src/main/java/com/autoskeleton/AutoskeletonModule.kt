package com.autoskeleton

import android.view.View
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.bridge.WritableArray
import com.facebook.react.uimanager.UIManagerHelper
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Plain-Kotlin mirror of `AutoskeletonGetShapesConfig`
 *  (`src/native/NativeAutoskeleton.ts`) — the codegen'd param arrives as a
 *  `ReadableMap` (verified against the ACTUAL generated
 *  `NativeAutoskeletonSpec.java`: `getShapes(double, String, ReadableMap)`,
 *  not a typed struct — Android's TurboModule codegen does not generate
 *  typed structs for object params the way iOS's ObjC++ codegen does).
 *  Decoded into this plain data class immediately so `computeWireArray`
 *  stays JVM-only and directly unit-testable, matching this file's own
 *  established convention (`DoubleArray` over `WritableArray` for the same
 *  reason). */
internal data class AutoskeletonGetShapesConfig(
  val defaultRadius: Float,
  val budgetMs: Double,
  val maxShapes: Int,
  val collectDebugSidecars: Boolean,
)

/** All four fields are non-optional on the TS side (`sensor.ts` always
 *  builds a complete object from the caller's real `SensorOptions`), so a
 *  direct read is correct — a missing/mistyped key is a genuine contract
 *  violation, not a value this function should silently paper over. */
internal fun ReadableMap.toGetShapesConfig(): AutoskeletonGetShapesConfig =
  AutoskeletonGetShapesConfig(
    defaultRadius = getDouble("defaultRadius").toFloat(),
    budgetMs = getDouble("budgetMs"),
    maxShapes = getDouble("maxShapes").toInt(),
    collectDebugSidecars = getBoolean("collectDebugSidecars"),
  )

/** Package-visible seam (same DI pattern as `AutoskeletonTracing`/
 *  `AutoskeletonWarningEmitter`): resolves a `View` by React tag, or `null`
 *  when the tag is unknown / not yet mounted. Production uses the PUBLIC
 *  `UIManagerHelper` API (the same pattern other third-party RN modules use
 *  for synchronous view resolution by tag, e.g. react-native-view-shot).
 *  Robolectric cannot run a real Fabric `UIManager`, so tests inject a
 *  fake that resolves directly against a view they built and laid out
 *  themselves — exactly like `SyntheticHierarchyBuilder`-style tests
 *  elsewhere in this module already do for `AutoskeletonSensor` itself. */
fun interface AutoskeletonViewResolver {
  fun resolve(reactTag: Int): View?
}

class AutoskeletonSystemViewResolver(private val reactContext: ReactApplicationContext) : AutoskeletonViewResolver {
  override fun resolve(reactTag: Int): View? =
    UIManagerHelper.getUIManagerForReactTag(reactContext, reactTag)?.resolveView(reactTag)
}

/** Visual-paint-gate remediation: `getShapes()` is a SYNCHRONOUS Turbo
 *  Module method (ADR-1), invoked on the JS thread. Fabric's
 *  `FabricUIManager.resolveView(reactTag)` soft-asserts
 *  ("Expected to run on UI thread!") and — confirmed empirically on a real
 *  device via `PaintGateInstrumentedTest`, not merely suspected — returns
 *  `null` when called off the UI thread; every JVM/Robolectric test in
 *  `AutoskeletonModuleTest` was green throughout Phase 5 without ever
 *  catching this because `AutoskeletonViewResolver` is a FAKE there
 *  (Robolectric cannot run a real Fabric `UIManager`, so nothing ever
 *  exercised this thread boundary until this end-to-end gate). Same DI seam
 *  pattern as `AutoskeletonViewResolver`/`AutoskeletonTracing`: production
 *  hops to the UI thread and blocks the calling (JS) thread until the view
 *  resolves — the standard pattern synchronous native-view-reading Turbo
 *  Modules use (e.g. `react-native-view-shot`) — with a bounded timeout so
 *  a stuck UI thread degrades to `null` (same "unresolved tag" contract
 *  `Sensor.measure` already documents) instead of hanging the JS thread
 *  forever. */
interface AutoskeletonUiThreadDispatcher {
  /** Runs `block` guaranteed on the UI thread and returns its result,
   *  blocking the caller. Returns `null` if `block` itself returns `null`
   *  OR if the UI thread never became available within `timeoutMs`. */
  fun <T> runAndWait(timeoutMs: Long, block: () -> T): T?
}

object AutoskeletonSystemUiThreadDispatcher : AutoskeletonUiThreadDispatcher {
  override fun <T> runAndWait(timeoutMs: Long, block: () -> T): T? {
    if (UiThreadUtil.isOnUiThread()) {
      return block()
    }
    var result: T? = null
    val latch = CountDownLatch(1)
    UiThreadUtil.runOnUiThread {
      try {
        result = block()
      } finally {
        latch.countDown()
      }
    }
    latch.await(timeoutMs, TimeUnit.MILLISECONDS)
    return result
  }
}

// Task 5.1 (tasks.md Phase 5) / plan.md ADR-1: the codegen'd Turbo Module
// implementation. `getShapes` resolves the `View` identified by `reactTag`
// (via `AutoskeletonViewResolver`) and calls straight into the EXISTING
// `AutoskeletonSensor.measure()` (task 4.1) — this class owns none of the
// traversal logic itself — encoding the result as the flat wire layout
// `[VERSION, x,y,w,h,r] x N` (plan.md §4.1).
//
// Density normalization happens HERE, exactly where `AutoskeletonTypes.kt`'s
// own `AutoskeletonShapeInfo` doc comment says it belongs ("a bridge-layer
// concern — task 5.1's getShapes Turbo Module — deliberately NOT performed
// here [in AutoskeletonShapeInfo]"): raw view-pixel geometry is divided by
// `resources.displayMetrics.density` so the wire is in density-independent
// points, comparable across platforms and directly usable by the
// golden-parity tests (plan.md §4.1 "Units").
//
// ADR-9: the native shape cache is written HERE (native writes data only
// for a traversal JS requested — this call IS that request) and evicted
// only via `evictShapes`, which JS calls from `store.invalidate()`.
//
// Phase-5-remediation (post-7.2 gap closure): `getShapes` used to hardcode
// `AutoskeletonSensorOptions.defaults` (`budgetMs`/`maxShapes`/
// `defaultRadius` all compiled constants) regardless of what a consumer
// configured via `SkeletonProvider`/per-instance props — REQ-OBS-BUDGET-1's
// "budgets MUST be configurable" was structurally unmet on this path, and
// `SkeletonProvider.defaultRadius` (verified the PRIMARY mechanism for
// rounded Android content — RN's real `CompositeBackgroundDrawable` never
// reports a radius via the public `getOutline()` API, so R1 never resolves
// a rounded view and every one falls to R3) never reached native either.
// `config` (`AutoskeletonGetShapesConfig`, decoded from the codegen'd
// `ReadableMap` above) now threads all four scalars into the REAL
// `AutoskeletonSensorOptions` used by this call — verified end-to-end by
// `AutoskeletonModuleTest`'s new config-threading cases, which assert the
// resulting WIRE geometry actually changes (`maxShapes` truncates the
// shape count; `defaultRadius` changes the emitted `r` for an
// R3-fallback shape), not merely that `computeWireArray`'s signature
// accepts the parameter.
//
// The former constructor-injected `radiusResolver` DI seam is removed:
// grepping this repo confirmed it was NEVER exercised in production
// (`AutoskeletonPackage.kt` always calls `AutoskeletonModule(reactContext)`)
// and never overridden by any test either, so it was dead complexity that
// additionally kept the R3 fallback radius permanently pinned to a
// compile-time `0f` regardless of `AutoskeletonSensorOptions.defaultRadius`
// — the exact disconnect this task closes. `refine()`'s already-established
// pattern (`AutoskeletonSensor.kt`: `AutoskeletonPublicApiRadiusResolver(options.defaultRadius)`)
// is now mirrored here instead: the resolver is constructed FRESH per call
// from the real per-call `config.defaultRadius`.
class AutoskeletonModule(
  reactContext: ReactApplicationContext,
  private val sensor: AutoskeletonSensor = AutoskeletonSensor(),
  private val viewResolver: AutoskeletonViewResolver = AutoskeletonSystemViewResolver(reactContext),
  private val shapeCache: AutoskeletonNativeShapeCache = AutoskeletonNativeShapeCache,
  private val uiThreadDispatcher: AutoskeletonUiThreadDispatcher = AutoskeletonSystemUiThreadDispatcher,
) : NativeAutoskeletonSpec(reactContext) {

  /** The entire measure + encode + cache-write pipeline, as a PURE function
   *  returning a plain `DoubleArray` — deliberately separated from
   *  `getShapes()`'s `WritableArray`/`Arguments.createArray()` marshaling
   *  below. `Arguments.createArray()` returns a JNI-backed
   *  `WritableNativeArray` in production; Robolectric has no native
   *  library loader for it, so keeping this logic JVM-only (no
   *  `WritableArray` anywhere in this function) is what makes it directly
   *  unit-testable — `AutoskeletonModuleTest` exercises this function
   *  through the real `AutoskeletonSensor`/`AutoskeletonPublicApiRadiusResolver`
   *  against real, laid-out `View`s. Returns `null` for the same reasons
   *  `Sensor.measure` does (unresolved tag, target not laid out yet).
   *
   *  `getShapes()` runs on the JS thread, but `viewResolver.resolve()` must
   *  run on the UI thread (see `AutoskeletonUiThreadDispatcher`'s doc
   *  comment) — `uiThreadDispatcher.runAndWait` provides that hop, is a
   *  no-op fast path when already on the UI thread (the common case in
   *  `AutoskeletonModuleTest`, which never dispatches), and bounds the
   *  wait so a stuck UI thread degrades to `null` instead of hanging the
   *  JS thread forever. */
  internal fun computeWireArray(reactTag: Double, cacheKey: String, config: AutoskeletonGetShapesConfig): DoubleArray? =
    uiThreadDispatcher.runAndWait(UI_THREAD_DISPATCH_TIMEOUT_MS) {
      val view = viewResolver.resolve(reactTag.toInt()) ?: return@runAndWait null
      val density = view.resources?.displayMetrics?.density?.takeIf { it > 0f } ?: 1f

      val measured = sensor.measure(
        view,
        AutoskeletonSensorOptions.defaults.copy(
          hints = AutoskeletonEmptyHintRegistry(),
          radiusResolver = AutoskeletonPublicApiRadiusResolver(defaultRadius = config.defaultRadius),
          budgetMs = config.budgetMs,
          maxShapes = config.maxShapes,
          defaultRadius = config.defaultRadius,
          collectDebugSidecars = config.collectDebugSidecars,
        ),
      ) ?: return@runAndWait null

      val wire = encodeWireArray(measured.shapes, density)
      shapeCache.set(cacheKey, wire)
      wire
    }

  override fun getShapes(reactTag: Double, cacheKey: String, config: ReadableMap): WritableArray {
    val result = Arguments.createArray()
    val wire = computeWireArray(reactTag, cacheKey, config.toGetShapesConfig()) ?: return result
    for (value in wire) {
      result.pushDouble(value)
    }
    return result
  }

  override fun evictShapes(cacheKeys: ReadableArray) {
    val keys = (0 until cacheKeys.size()).mapNotNull { cacheKeys.getString(it) }
    shapeCache.evict(keys)
  }

  companion object {
    const val NAME = NativeAutoskeletonSpec.NAME

    /** Generous relative to the 2ms traversal budget (ADR-1 scopes that
     *  budget to serialization/traversal cost, not this thread hop), but
     *  bounded: a UI thread genuinely stuck for 200ms is already failing
     *  its own frame budget many times over, so waiting longer would only
     *  hold the JS thread hostage for no additional benefit. */
    internal const val UI_THREAD_DISPATCH_TIMEOUT_MS = 200L

    /** Pure wire encoder: `[VERSION, x,y,w,h,r] x N`, every geometry value
     *  divided by `density` (plan.md §4.1 "Units"). Decoupled from
     *  `AutoskeletonSensor`/`View`/Robolectric entirely so the density
     *  arithmetic itself is directly, reliably unit-testable. */
    internal fun encodeWireArray(shapes: List<AutoskeletonShapeInfo>, density: Float): DoubleArray {
      val wire = DoubleArray(1 + shapes.size * 5)
      wire[0] = 1.0 // WIRE_VERSION
      shapes.forEachIndexed { i, shape ->
        val offset = 1 + i * 5
        wire[offset] = (shape.x / density).toDouble()
        wire[offset + 1] = (shape.y / density).toDouble()
        wire[offset + 2] = (shape.w / density).toDouble()
        wire[offset + 3] = (shape.h / density).toDouble()
        wire[offset + 4] = (shape.r / density).toDouble()
      }
      return wire
    }
  }
}
