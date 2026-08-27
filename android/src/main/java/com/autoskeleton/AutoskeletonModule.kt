package com.autoskeleton

import android.view.View
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.WritableArray
import com.facebook.react.uimanager.UIManagerHelper

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
class AutoskeletonModule(
  reactContext: ReactApplicationContext,
  private val sensor: AutoskeletonSensor = AutoskeletonSensor(),
  private val radiusResolver: AutoskeletonRadiusResolver = AutoskeletonPublicApiRadiusResolver(),
  private val viewResolver: AutoskeletonViewResolver = AutoskeletonSystemViewResolver(reactContext),
  private val shapeCache: AutoskeletonNativeShapeCache = AutoskeletonNativeShapeCache,
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
   *  `Sensor.measure` does (unresolved tag, target not laid out yet). */
  internal fun computeWireArray(reactTag: Double, cacheKey: String): DoubleArray? {
    val view = viewResolver.resolve(reactTag.toInt()) ?: return null
    val density = view.resources?.displayMetrics?.density?.takeIf { it > 0f } ?: 1f

    val measured = sensor.measure(
      view,
      AutoskeletonSensorOptions.defaults.copy(
        hints = AutoskeletonEmptyHintRegistry(),
        radiusResolver = radiusResolver,
        collectDebugSidecars = false,
      ),
    ) ?: return null

    val wire = encodeWireArray(measured.shapes, density)
    shapeCache.set(cacheKey, wire)
    return wire
  }

  override fun getShapes(reactTag: Double, cacheKey: String): WritableArray {
    val result = Arguments.createArray()
    val wire = computeWireArray(reactTag, cacheKey) ?: return result
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
