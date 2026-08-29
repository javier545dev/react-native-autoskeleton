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
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

/** Plain-Kotlin mirror of one `AutoskeletonHintEntry`
 *  (`src/native/NativeAutoskeleton.ts`) — the typed-hint channel's marshaled
 *  DATA (never the `HintRegistry` functions themselves, which cannot cross
 *  a Turbo Module boundary). `lines`/`radius` are already decoded from the
 *  wire's `0`/`-1` "no override" sentinels back to `null` by
 *  `ReadableArray.toHintEntries()` below, so `null` here always means
 *  "genuinely no hint for this field", never a sentinel leaking through.
 *  NOT `internal`: `AutoskeletonMapHintRegistry` (`AutoskeletonTypes.kt`) is
 *  public and takes a `List<AutoskeletonHintEntry>` in its own public
 *  constructor, so this type must be at least as visible (Kotlin forbids a
 *  public API exposing an internal type). */
data class AutoskeletonHintEntry(
  val nodeId: String,
  val lines: Int?,
  val radius: Float?,
)

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
  /** Typed-hint channel. Defaults to empty so every EXISTING call site
   *  (tests included) that predates this field stays valid — unlike the TS
   *  wire type, this internal, already-decoded config class has no bridge
   *  boundary to keep honest about "always present", so a default is safe
   *  here. */
  val hints: List<AutoskeletonHintEntry> = emptyList(),
)

/** The four scalar fields are non-optional on the TS side (`sensor.ts`
 *  always builds a complete object from the caller's real
 *  `SensorOptions`), so a direct read is correct — a missing/mistyped key
 *  is a genuine contract violation, not a value this function should
 *  silently paper over. `hints` defaults to empty when the key is absent
 *  (an older JS bundle without this field, or a hand-built test map) rather
 *  than throwing — a genuinely absent hints channel is not a contract
 *  violation the way a missing scalar would be. */
internal fun ReadableMap.toGetShapesConfig(): AutoskeletonGetShapesConfig =
  AutoskeletonGetShapesConfig(
    defaultRadius = getDouble("defaultRadius").toFloat(),
    budgetMs = getDouble("budgetMs"),
    maxShapes = getDouble("maxShapes").toInt(),
    collectDebugSidecars = getBoolean("collectDebugSidecars"),
    hints = getArray("hints")?.toHintEntries() ?: emptyList(),
  )

/** Decodes the wire's `lines: 0` / `radius: -1` "no override" sentinels
 *  (`NativeAutoskeleton.ts`'s documented convention) back to `null`. */
private fun ReadableArray.toHintEntries(): List<AutoskeletonHintEntry> =
  (0 until size()).map { i ->
    val entry = requireNotNull(getMap(i)) { "hints[$i] must be a map" }
    val lines = entry.getDouble("lines").toInt()
    val radius = entry.getDouble("radius").toFloat()
    AutoskeletonHintEntry(
      nodeId = requireNotNull(entry.getString("nodeId")) { "hints[$i].nodeId must be a string" },
      lines = lines.takeIf { it != 0 },
      radius = radius.takeIf { it != -1f },
    )
  }

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
 *  forever.
 *
 *  Adversarial-review defect (2026-08-28), THREE distinct problems fixed
 *  together:
 *  1. `latch.await(...)`'s `Boolean` return value (completed vs timed out)
 *     used to be discarded entirely — the caller had no way to distinguish
 *     the two outcomes. Now used directly to decide the return value.
 *  2. The Runnable posted to `UiThreadUtil.runOnUiThread` is NEVER
 *     cancellable once posted (Android exposes no handle for it) — it
 *     keeps running after the caller times out and moves on. `block` used
 *     to run to completion regardless, including its own shared-state
 *     writes (`AutoskeletonModule.computeWireArray`'s `shapeCache.set`),
 *     writing stale geometry into the shared cache for a `cacheKey` that,
 *     on a recycled list, may by then belong to a different row. Since the
 *     Runnable itself cannot be forcibly cancelled, `block` now receives a
 *     cooperative `isCancelled: () -> Boolean` check it MUST consult before
 *     any observable side effect — see `computeWireArray`'s own guard.
 *  3. `result` was a plain, non-`@Volatile` `var` written on the UI thread
 *     and read on the calling thread with NO visibility guarantee under the
 *     Java Memory Model — a genuine data race, independent of the timeout
 *     bug. Replaced with `AtomicReference`/`AtomicBoolean`, which establish
 *     the required happens-before relationship for both the result and the
 *     cancellation flag. */
interface AutoskeletonUiThreadDispatcher {
  /** Runs `block` guaranteed on the UI thread and returns its result,
   *  blocking the caller. `block` receives an `isCancelled` check it can
   *  consult (typically right before any shared-state write) to detect
   *  that its caller already gave up. Returns `null` if `block` itself
   *  returns `null` OR if the UI thread never became available within
   *  `timeoutMs`. */
  fun <T> runAndWait(timeoutMs: Long, block: (isCancelled: () -> Boolean) -> T): T?
}

object AutoskeletonSystemUiThreadDispatcher : AutoskeletonUiThreadDispatcher {
  override fun <T> runAndWait(timeoutMs: Long, block: (isCancelled: () -> Boolean) -> T): T? {
    if (UiThreadUtil.isOnUiThread()) {
      return block { false }
    }
    val result = AtomicReference<T?>(null)
    val timedOut = AtomicBoolean(false)
    val latch = CountDownLatch(1)
    UiThreadUtil.runOnUiThread {
      try {
        result.set(block { timedOut.get() })
      } finally {
        latch.countDown()
      }
    }
    val completedInTime = latch.await(timeoutMs, TimeUnit.MILLISECONDS)
    if (!completedInTime) {
      timedOut.set(true)
      return null
    }
    return result.get()
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
   *  JS thread forever.
   *
   *  Adversarial-review defect (2026-08-28): the `shapeCache.set` write
   *  below is the USER-VISIBLE half of the timeout defect — a timed-out
   *  caller already moved on, but the posted UI-thread Runnable itself
   *  cannot be cancelled (Android exposes no handle for that), so it used
   *  to keep running and write stale geometry into the SHARED cache under
   *  `cacheKey`, which on a recycled list may by then belong to a
   *  completely different row. The traversal itself still runs (it cannot
   *  be stopped mid-flight either), but the observable side effect — the
   *  cache write — is now guarded by `isCancelled()`, checked as late as
   *  possible, right before the mutation. */
  internal fun computeWireArray(reactTag: Double, cacheKey: String, config: AutoskeletonGetShapesConfig): DoubleArray? =
    uiThreadDispatcher.runAndWait(UI_THREAD_DISPATCH_TIMEOUT_MS) { isCancelled ->
      val view = viewResolver.resolve(reactTag.toInt()) ?: return@runAndWait null
      val density = view.resources?.displayMetrics?.density?.takeIf { it > 0f } ?: 1f

      val measured = sensor.measure(
        view,
        AutoskeletonSensorOptions.defaults.copy(
          hints = AutoskeletonMapHintRegistry(config.hints),
          radiusResolver = AutoskeletonPublicApiRadiusResolver(defaultRadius = config.defaultRadius),
          budgetMs = config.budgetMs,
          maxShapes = config.maxShapes,
          defaultRadius = config.defaultRadius,
          collectDebugSidecars = config.collectDebugSidecars,
        ),
      ) ?: return@runAndWait null

      val wire = encodeWireArray(measured.shapes, density)
      if (isCancelled()) {
        // The caller already gave up waiting -- do not retroactively
        // poison the shared cache with geometry nobody will read via this
        // call, and which may now belong to a different recycled row.
        return@runAndWait null
      }
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
