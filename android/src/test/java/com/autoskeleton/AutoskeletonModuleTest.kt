package com.autoskeleton

import android.content.Context
import android.view.View
import android.widget.FrameLayout
import com.facebook.react.bridge.Callback
import com.facebook.react.bridge.CatalystInstance
import com.facebook.react.bridge.JavaOnlyArray
import com.facebook.react.bridge.JavaScriptContextHolder
import com.facebook.react.bridge.JavaScriptModule
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.RuntimeExecutor
import com.facebook.react.bridge.UIManager
import com.facebook.react.turbomodule.core.interfaces.CallInvokerHolder
import com.facebook.react.uimanager.DisplayMetricsHolder
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

/**
 * Task 5.1 (tasks.md Phase 5) / plan.md ADR-1: `AutoskeletonModule`'s
 * measure+encode+cache pipeline against a REAL `AutoskeletonSensor`
 * traversal over real, laid-out `View`s (via `SyntheticHierarchyBuilder`,
 * the same harness task 4.1's own tests use) — a fake
 * `AutoskeletonViewResolver` stands in only for Fabric's tag->view
 * resolution, which Robolectric cannot run.
 *
 * Exercises `computeWireArray()`, not the public `getShapes()` override
 * directly: `getShapes()`'s ONLY additional responsibility is copying a
 * `DoubleArray` into a `WritableArray` via `Arguments.createArray()`,
 * which returns a JNI-backed `WritableNativeArray` in production —
 * Robolectric has no native library loader for it. Separating the pure
 * measure+encode+cache logic from that thin marshaling step (see
 * `AutoskeletonModule.kt`'s own doc comment on `computeWireArray`) is what
 * keeps this REAL logic unit-testable at all.
 */
/** `ReactApplicationContext` (and its `ReactContext` base) is `abstract` in
 *  this RN version — this test never exercises any bridge/Fabric behavior
 *  through it (only `AutoskeletonModule`'s constructor requires one to
 *  satisfy the codegen'd `NativeAutoskeletonSpec` base class), so every
 *  abstract member is stubbed with an inert implementation. */
private class FakeReactApplicationContext(context: Context) : ReactApplicationContext(context) {
    override fun <T : JavaScriptModule> getJSModule(jsInterface: Class<T>): T =
        throw UnsupportedOperationException("not used by AutoskeletonModuleTest")
    override fun <T : NativeModule> hasNativeModule(nativeModuleInterface: Class<T>): Boolean = false
    override fun getNativeModules(): MutableCollection<NativeModule> = mutableListOf()
    override fun <T : NativeModule> getNativeModule(nativeModuleInterface: Class<T>): T? = null
    override fun getNativeModule(name: String): NativeModule? = null
    override fun getCatalystInstance(): CatalystInstance =
        throw UnsupportedOperationException("not used by AutoskeletonModuleTest")
    override fun hasActiveCatalystInstance(): Boolean = false
    override fun hasActiveReactInstance(): Boolean = false
    override fun hasCatalystInstance(): Boolean = false
    override fun hasReactInstance(): Boolean = false
    override fun getRuntimeExecutor(): RuntimeExecutor? = null
    override fun destroy() = Unit
    override fun handleException(e: Exception) = Unit
    override fun isBridgeless(): Boolean = false
    override fun getJavaScriptContextHolder(): JavaScriptContextHolder? = null
    override fun getJSCallInvokerHolder(): CallInvokerHolder? = null
    override fun getFabricUIManager(): UIManager? = null
    override fun getSourceURL(): String? = null
    override fun registerSegment(segmentId: Int, path: String, callback: Callback) = Unit
}

@RunWith(RobolectricTestRunner::class)
class AutoskeletonModuleTest {

    private fun moduleFor(view: View, cache: AutoskeletonNativeShapeCache = AutoskeletonNativeShapeCache): AutoskeletonModule {
        DisplayMetricsHolder.initDisplayMetricsIfNotInitialized(RuntimeEnvironment.getApplication())
        val reactContext = FakeReactApplicationContext(RuntimeEnvironment.getApplication())
        return AutoskeletonModule(
            reactContext = reactContext,
            viewResolver = AutoskeletonViewResolver { tag -> if (tag == 42) view else null },
            shapeCache = cache,
        )
    }

    @Test
    fun computeWireArrayReturnsNullWhenTheReactTagDoesNotResolveToAView() {
        val fixture = SyntheticHierarchyBuilder.loadFixture("nested-offsets")
        val root = SyntheticHierarchyBuilder.build(fixture)
        val module = moduleFor(root)

        assertNull(module.computeWireArray(999.0, "k"))
    }

    @Test
    fun computeWireArrayReturnsTheFlatWireArrayFromARealTraversal() {
        AutoskeletonNativeShapeCache.clear()
        val fixture = SyntheticHierarchyBuilder.loadFixture("nested-offsets")
        val root = SyntheticHierarchyBuilder.build(fixture)
        val module = moduleFor(root)

        val result = module.computeWireArray(42.0, "cache-key-1")

        assertTrue(result != null)
        assertTrue("expected at least a VERSION slot + one shape (6 slots)", result!!.size >= 6)
        assertEquals(1.0, result[0], 0.0001) // WIRE_VERSION
        assertEquals((result.size - 1) % 5, 0)
    }

    @Test
    fun computeWireArrayWritesTheSameWireArrayIntoTheNativeShapeCache() {
        val cache = AutoskeletonNativeShapeCache
        cache.clear()
        val fixture = SyntheticHierarchyBuilder.loadFixture("nested-offsets")
        val root = SyntheticHierarchyBuilder.build(fixture)
        val module = moduleFor(root, cache)

        val result = module.computeWireArray(42.0, "cache-key-2")
        val cached = cache.get("cache-key-2")

        assertTrue(result != null)
        assertTrue(cached != null)
        assertEquals(result!!.toList(), cached!!.toList())
    }

    @Test
    fun evictShapesRemovesOnlyTheRequestedKeys() {
        val cache = AutoskeletonNativeShapeCache
        cache.clear()
        cache.set("keep", doubleArrayOf(1.0))
        cache.set("drop", doubleArrayOf(1.0))
        val module = moduleFor(FrameLayout(RuntimeEnvironment.getApplication()), cache)

        module.evictShapes(JavaOnlyArray.of("drop"))

        assertTrue(cache.get("keep") != null)
        assertNull(cache.get("drop"))
    }

    @Test
    fun encodeWireArrayDividesRawViewPixelsByDensity() {
        // plan.md §4.1 "Units": Android divides by density before writing
        // the wire. Exercised directly against `AutoskeletonModule`'s pure
        // encoding step, hand-built `AutoskeletonShapeInfo`s and no
        // `View`/`AutoskeletonSensor`/Robolectric layout involved — the
        // traversal itself (leaf detection, frame computation) is already
        // covered by `AutoskeletonSensorTest` (task 4.1) and this file's
        // own `computeWireArrayReturnsTheFlatWireArrayFromARealTraversal`;
        // this test isolates ONLY the density arithmetic under test here.
        val shapes = listOf(
            AutoskeletonShapeInfo(
                x = 10f, y = 20f, w = 100f, h = 100f, r = 8f,
                source = AutoskeletonShapeSource.CONTAINER,
                radiusSource = AutoskeletonRadiusSource.DEFAULT,
            ),
        )
        val atDensity1 = AutoskeletonModule.encodeWireArray(shapes, density = 1f)
        val atDensity2 = AutoskeletonModule.encodeWireArray(shapes, density = 2f)

        assertEquals(6, atDensity1.size)
        assertEquals(1.0, atDensity1[0], 0.0001) // WIRE_VERSION
        assertEquals(10.0, atDensity1[1], 0.0001)
        assertEquals(20.0, atDensity1[2], 0.0001)
        assertEquals(100.0, atDensity1[3], 0.0001)
        assertEquals(100.0, atDensity1[4], 0.0001)
        assertEquals(8.0, atDensity1[5], 0.0001)

        // Halved density -> every geometry slot halved; VERSION untouched.
        assertEquals(1.0, atDensity2[0], 0.0001)
        for (i in 1..5) {
            assertEquals(atDensity1[i] / 2, atDensity2[i], 0.0001)
        }
    }
}
