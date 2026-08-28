package com.autoskeleton

import android.content.Context
import android.graphics.Color
import android.view.View
import android.widget.FrameLayout
import com.facebook.react.bridge.Callback
import com.facebook.react.bridge.CatalystInstance
import com.facebook.react.bridge.JavaOnlyArray
import com.facebook.react.bridge.JavaOnlyMap
import com.facebook.react.bridge.JavaScriptContextHolder
import com.facebook.react.bridge.JavaScriptModule
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.RuntimeExecutor
import com.facebook.react.bridge.UIManager
import com.facebook.react.turbomodule.core.interfaces.CallInvokerHolder
import com.facebook.react.uimanager.BackgroundStyleApplicator
import com.facebook.react.uimanager.DisplayMetricsHolder
import com.facebook.react.uimanager.LengthPercentage
import com.facebook.react.uimanager.LengthPercentageType
import com.facebook.react.uimanager.style.BorderRadiusProp
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

    /** Mirrors `AutoskeletonSensorOptions.defaults` exactly, as a plain
     *  `AutoskeletonGetShapesConfig` — the "nothing configured" baseline
     *  most tests below use so only the field under test diverges. */
    private val defaultConfig = AutoskeletonGetShapesConfig(
        defaultRadius = 0f,
        budgetMs = AUTOSKELETON_DEFAULT_BUDGET_MS,
        maxShapes = AUTOSKELETON_DEFAULT_MAX_SHAPES,
        collectDebugSidecars = true,
    )

    private fun moduleFor(view: View, cache: AutoskeletonNativeShapeCache = AutoskeletonNativeShapeCache): AutoskeletonModule {
        DisplayMetricsHolder.initDisplayMetricsIfNotInitialized(RuntimeEnvironment.getApplication())
        val reactContext = FakeReactApplicationContext(RuntimeEnvironment.getApplication())
        return AutoskeletonModule(
            reactContext = reactContext,
            viewResolver = AutoskeletonViewResolver { tag -> if (tag == 42) view else null },
            shapeCache = cache,
        )
    }

    /** Same production `BackgroundStyleApplicator` path
     *  `AutoskeletonSensorObservabilityTest` already verified produces RN's
     *  real `CompositeBackgroundDrawable` — whose `getOutline()` never
     *  reports a radius (plan.md ADR-2 R1 dead end), so a rounded leaf
     *  reliably falls through to the R3 `defaultRadius` fallback rung this
     *  task wires from `config`. */
    private fun roundedLeaf(radiusPx: Float, w: Int = 40, h: Int = 40): FrameLayout {
        val context = RuntimeEnvironment.getApplication()
        DisplayMetricsHolder.initDisplayMetricsIfNotInitialized(context)
        val view = FrameLayout(context)
        view.layout(0, 0, w, h)
        BackgroundStyleApplicator.setBackgroundColor(view, Color.RED)
        BackgroundStyleApplicator.setBorderRadius(
            view,
            BorderRadiusProp.BORDER_RADIUS,
            LengthPercentage(radiusPx, LengthPercentageType.POINT),
        )
        view.background?.setBounds(0, 0, view.width, view.height)
        return view
    }

    @Test
    fun computeWireArrayReturnsNullWhenTheReactTagDoesNotResolveToAView() {
        val fixture = SyntheticHierarchyBuilder.loadFixture("nested-offsets")
        val root = SyntheticHierarchyBuilder.build(fixture)
        val module = moduleFor(root)

        assertNull(module.computeWireArray(999.0, "k", defaultConfig))
    }

    @Test
    fun computeWireArrayReturnsTheFlatWireArrayFromARealTraversal() {
        AutoskeletonNativeShapeCache.clear()
        val fixture = SyntheticHierarchyBuilder.loadFixture("nested-offsets")
        val root = SyntheticHierarchyBuilder.build(fixture)
        val module = moduleFor(root)

        val result = module.computeWireArray(42.0, "cache-key-1", defaultConfig)

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

        val result = module.computeWireArray(42.0, "cache-key-2", defaultConfig)
        val cached = cache.get("cache-key-2")

        assertTrue(result != null)
        assertTrue(cached != null)
        assertEquals(result!!.toList(), cached!!.toList())
    }

    // MARK: - Phase-5-remediation (post-7.2 gap closure): config actually
    // arrives at the real `sensor.measure()` options, proven by the wire
    // GEOMETRY changing, not merely that the signature accepts a config.

    @Test
    fun computeWireArrayTruncatesTheShapeCountWhenMaxShapesIsTightened() {
        AutoskeletonNativeShapeCache.clear()
        // "ignore-subtree" has multiple real leaves (used by
        // `AutoskeletonSensorObservabilityTest`'s own shape-cap case for the
        // same reason) — a fixture whose UNTRUNCATED traversal produces more
        // than one shape is required to prove truncation actually happened.
        val fixture = SyntheticHierarchyBuilder.loadFixture("ignore-subtree")
        val root = SyntheticHierarchyBuilder.build(fixture)
        val module = moduleFor(root)

        val untruncated = module.computeWireArray(42.0, "untruncated", defaultConfig)!!
        val untruncatedShapeCount = (untruncated.size - 1) / 5
        assertTrue(
            "fixture must produce >1 shape for this test to prove anything; got $untruncatedShapeCount",
            untruncatedShapeCount > 1,
        )

        val tightened = module.computeWireArray(
            42.0,
            "truncated",
            defaultConfig.copy(maxShapes = 1),
        )!!

        assertEquals(1.0, tightened[0], 0.0001) // WIRE_VERSION untouched
        assertEquals("maxShapes=1 must truncate to exactly one shape (6 slots total)", 6, tightened.size)
    }

    @Test
    fun computeWireArrayUsesTheConfiguredDefaultRadiusForAnR3FallbackShape() {
        AutoskeletonNativeShapeCache.clear()
        val leaf = roundedLeaf(radiusPx = 8f)
        val module = moduleFor(leaf)
        val density = leaf.resources.displayMetrics.density

        val withRadius16 = module.computeWireArray(42.0, "r16", defaultConfig.copy(defaultRadius = 16f))!!
        val withRadius3 = module.computeWireArray(42.0, "r3", defaultConfig.copy(defaultRadius = 3f))!!

        assertEquals(6, withRadius16.size)
        assertEquals(6, withRadius3.size)
        // Slot 5 is the single container shape's `r` (VERSION + x,y,w,h,r).
        assertEquals(16.0 / density, withRadius16[5], 0.0001)
        assertEquals(3.0 / density, withRadius3[5], 0.0001)
    }

    @Test
    fun computeWireArrayThreadsBudgetMsAndCollectDebugSidecarsIntoTheRealSensorOptions() {
        // budgetMs = -1 is a deterministic real trigger (any real
        // traversalMs >= 0 exceeds -1) — same technique
        // `AutoskeletonSensorObservabilityTest` already uses for the
        // equivalent Android/iOS assertions. A real traversal against a
        // -1ms budget truncates to ZERO shapes (the very first
        // `overBudget()` check trips before any shape is reserved), which
        // is only reachable if `config.budgetMs` genuinely replaced the
        // compiled `AutoskeletonSensorOptions.defaults.budgetMs` (2.0) used
        // before this task.
        val fixture = SyntheticHierarchyBuilder.loadFixture("nested-offsets")
        val root = SyntheticHierarchyBuilder.build(fixture)
        val module = moduleFor(root)

        val result = module.computeWireArray(42.0, "budget", defaultConfig.copy(budgetMs = -1.0))!!

        assertEquals(1, result.size) // VERSION slot only — zero shapes survived the budget
        assertEquals(1.0, result[0], 0.0001)
    }

    @Test
    fun toGetShapesConfigDecodesARealReadableMapVerbatim() {
        // The real codegen'd parameter type (verified against the actual
        // generated `NativeAutoskeletonSpec.java`:
        // `getShapes(double, String, ReadableMap)`) decoded by
        // `toGetShapesConfig()`. `JavaOnlyMap` is the pure-JVM `ReadableMap`
        // implementation, safe under Robolectric with no JNI involved
        // (mirrors `JavaOnlyArray`'s already-established use in
        // `evictShapesRemovesOnlyTheRequestedKeys` below). `getShapes()`
        // itself is deliberately NOT exercised here — same reason
        // `computeWireArray` exists as a separate seam (see this class's
        // own header comment): `Arguments.createArray()` needs a JNI
        // native-library loader Robolectric does not provide, confirmed
        // empirically when this exact case was first written against
        // `getShapes()` directly and failed with
        // `ExceptionInInitializerError`/`IllegalStateException`, not a
        // config-decoding defect.
        val map = JavaOnlyMap.of(
            "defaultRadius", 16.0,
            "budgetMs", 4.0,
            "maxShapes", 1.0,
            "collectDebugSidecars", true,
            "hints", JavaOnlyArray.of(),
        )

        val config = map.toGetShapesConfig()

        assertEquals(
            AutoskeletonGetShapesConfig(defaultRadius = 16f, budgetMs = 4.0, maxShapes = 1, collectDebugSidecars = true),
            config,
        )
    }

    // MARK: - Typed-hint channel (plan.md ADR-2 R0): `config.hints` decoding
    // and end-to-end wiring into a real `AutoskeletonMapHintRegistry`.

    @Test
    fun toGetShapesConfigDecodesHintEntriesApplyingTheNoOverrideSentinels() {
        // Mirrors `NativeAutoskeleton.ts`'s documented sentinel convention:
        // `lines: 0` / `radius: -1` mean "no override" and decode to `null`,
        // never a wrong "real" value of exactly 0 or -1.
        val map = JavaOnlyMap.of(
            "defaultRadius", 0.0,
            "budgetMs", 2.0,
            "maxShapes", 60.0,
            "collectDebugSidecars", true,
            "hints",
            JavaOnlyArray.of(
                JavaOnlyMap.of("nodeId", "title", "lines", 3.0, "radius", -1.0),
                JavaOnlyMap.of("nodeId", "avatar", "lines", 0.0, "radius", 24.0),
            ),
        )

        val config = map.toGetShapesConfig()

        assertEquals(
            listOf(
                AutoskeletonHintEntry(nodeId = "title", lines = 3, radius = null),
                AutoskeletonHintEntry(nodeId = "avatar", lines = null, radius = 24f),
            ),
            config.hints,
        )
    }

    @Test
    fun toGetShapesConfigDefaultsHintsToEmptyWhenTheKeyIsAbsent() {
        val map = JavaOnlyMap.of(
            "defaultRadius", 0.0,
            "budgetMs", 2.0,
            "maxShapes", 60.0,
            "collectDebugSidecars", true,
        )

        assertEquals(emptyList<AutoskeletonHintEntry>(), map.toGetShapesConfig().hints)
    }

    @Test
    fun computeWireArrayAppliesARegisteredRadiusHintOverridingTheMeasuredValue() {
        // Real production proof: a leaf with NO backgroundRadius set (so R1
        // alone would resolve `MEASURED`/radius 0) but a `nativeID` matching
        // a `config.hints` entry gets the HINTED radius instead — the exact
        // ADR-2 R0 rung, exercised through the REAL bridge decode path
        // (`toGetShapesConfig`) and the REAL `AutoskeletonMapHintRegistry`,
        // not a hand-built fake registry (that unit is already covered by
        // `AutoskeletonRadiusResolverTest`).
        AutoskeletonNativeShapeCache.clear()
        val context = RuntimeEnvironment.getApplication()
        DisplayMetricsHolder.initDisplayMetricsIfNotInitialized(context)
        val leaf = FrameLayout(context)
        leaf.layout(0, 0, 40, 40)
        leaf.setTag(com.facebook.react.R.id.view_tag_native_id, "card")
        BackgroundStyleApplicator.setBackgroundColor(leaf, Color.RED)
        val module = moduleFor(leaf)
        val density = leaf.resources.displayMetrics.density

        val hinted = module.computeWireArray(
            42.0,
            "hinted",
            defaultConfig.copy(hints = listOf(AutoskeletonHintEntry(nodeId = "card", lines = null, radius = 20f))),
        )!!

        assertEquals(6, hinted.size)
        assertEquals(20.0 / density, hinted[5], 0.0001) // slot 5 = r
    }

    @Test
    fun computeWireArrayAppliesARegisteredLinesHintProducingTheHintedShapeCount() {
        // Full production pipeline, `ReadableMap` decode through to the real
        // `AutoskeletonSensor` shape count: the same "collapsed-text" fixture
        // `AutoskeletonSensorTest.collapsedTextHonorsLinesHint` already
        // proves the SENSOR honors (nodeId "collapsed-text-1", h=2 collapses
        // below defaultLineHeight) — this test proves the BRIDGE config
        // reaches that same registry consultation, not a hand-built fake.
        AutoskeletonNativeShapeCache.clear()
        val fixture = SyntheticHierarchyBuilder.loadFixture("collapsed-text")
        val root = SyntheticHierarchyBuilder.build(fixture)
        val module = moduleFor(root)

        val hinted = module.computeWireArray(
            42.0,
            "lines-hinted",
            defaultConfig.copy(
                hints = listOf(AutoskeletonHintEntry(nodeId = "collapsed-text-1", lines = 3, radius = null)),
            ),
        )!!
        val unhinted = module.computeWireArray(42.0, "lines-unhinted", defaultConfig)!!

        val hintedShapeCount = (hinted.size - 1) / 5
        val unhintedShapeCount = (unhinted.size - 1) / 5
        assertEquals("hinted lines=3 must produce exactly 3 synthesized line shapes", 3, hintedShapeCount)
        assertEquals("unhinted collapsed text (h=2) defaults to 1 line", 1, unhintedShapeCount)
    }

    @Test
    fun computeWireArrayIgnoresAHintRegisteredUnderADifferentNodeId() {
        AutoskeletonNativeShapeCache.clear()
        val context = RuntimeEnvironment.getApplication()
        DisplayMetricsHolder.initDisplayMetricsIfNotInitialized(context)
        val leaf = FrameLayout(context)
        leaf.layout(0, 0, 40, 40)
        leaf.setTag(com.facebook.react.R.id.view_tag_native_id, "card")
        BackgroundStyleApplicator.setBackgroundColor(leaf, Color.RED)
        val module = moduleFor(leaf)

        val unhinted = module.computeWireArray(
            42.0,
            "unhinted",
            defaultConfig.copy(hints = listOf(AutoskeletonHintEntry(nodeId = "unrelated", lines = null, radius = 20f))),
        )!!

        assertEquals(0.0, unhinted[5], 0.0001) // no background radius set, no matching hint -> R1 MEASURED 0
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
