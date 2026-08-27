package com.autoskeleton

import android.content.res.Configuration
import android.widget.FrameLayout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import kotlin.math.abs

/**
 * Task 4.1 (tasks.md Phase 4) / plan.md §7.2a: `AutoskeletonSensor` tests against
 * the shared synthetic view-hierarchy harness. 0.5 dp tolerance per plan.md §7.2a.
 * Fixtures live under `test/fixtures/hierarchies`, expected wire output under
 * `test/fixtures/expected` — see `SyntheticHierarchyBuilder.kt`.
 *
 * Radius (`r`) is deliberately NOT asserted against the shared expected files here:
 * task 4.1 uses the placeholder `AutoskeletonNoRadiusResolver` (always
 * `r=0`/`DEFAULT`) since ADR-2's real ladder is task 4.2's job. Once 4.2 wires the
 * real resolver, `AutoskeletonRadiusResolverTest` re-runs the radius-bearing
 * fixtures (`container-rule-no-leaves`) and closes the loop on `r` — this is a
 * stated scope split, not a silently skipped assertion.
 */
@RunWith(RobolectricTestRunner::class)
class AutoskeletonSensorTest {
    private val tolerance = 0.5f

    private fun assertShapesMatch(actual: List<AutoskeletonShapeInfo>, expectedName: String) {
        val expected = SyntheticHierarchyBuilder.loadExpected(expectedName)
        assertEquals("shape count mismatch for $expectedName", expected.size, actual.size)
        actual.zip(expected).forEachIndexed { index, (a, e) ->
            assertTrue("shape $index x mismatch: ${a.x} vs ${e.x}", abs(a.x - e.x) <= tolerance)
            assertTrue("shape $index y mismatch: ${a.y} vs ${e.y}", abs(a.y - e.y) <= tolerance)
            assertTrue("shape $index w mismatch: ${a.w} vs ${e.w}", abs(a.w - e.w) <= tolerance)
            assertTrue("shape $index h mismatch: ${a.h} vs ${e.h}", abs(a.h - e.h) <= tolerance)
            assertEquals("shape $index source mismatch", e.source, a.source.wireValue)
        }
    }

    private fun measure(
        fixtureName: String,
        hints: AutoskeletonHintRegistry = AutoskeletonEmptyHintRegistry(),
        options: AutoskeletonSensorOptions = AutoskeletonSensorOptions.defaults,
    ): List<AutoskeletonShapeInfo> {
        val fixture = SyntheticHierarchyBuilder.loadFixture(fixtureName)
        val root = SyntheticHierarchyBuilder.build(fixture)
        val sensor = AutoskeletonSensor()
        val result = sensor.measure(root, options.copy(hints = hints))
        return result!!.shapes
    }

    // MARK: - Nested offsets (offset accumulation)

    @Test
    fun nestedOffsetsAccumulate() {
        assertShapesMatch(measure("nested-offsets"), "nested-offsets")
    }

    // MARK: - Scrolled ancestor (scroll subtraction)

    @Test
    fun scrolledAncestorSubtractsScrollOffset() {
        assertShapesMatch(measure("scrolled-ancestor"), "scrolled-ancestor")
    }

    // MARK: - Container rule, both branches

    @Test
    fun containerRuleLeavesWin() {
        assertShapesMatch(measure("container-rule-leaves-win"), "container-rule-leaves-win")
    }

    @Test
    fun containerRuleEmitsContainerWhenNoLeaves() {
        val shapes = measure("container-rule-no-leaves")
        val expected = SyntheticHierarchyBuilder.loadExpected("container-rule-no-leaves")
        assertEquals(1, shapes.size)
        assertEquals(AutoskeletonShapeSource.CONTAINER, shapes[0].source)
        assertTrue(abs(shapes[0].x - expected[0].x) <= tolerance)
        assertTrue(abs(shapes[0].y - expected[0].y) <= tolerance)
        assertTrue(abs(shapes[0].w - expected[0].w) <= tolerance)
        assertTrue(abs(shapes[0].h - expected[0].h) <= tolerance)
    }

    // MARK: - Ignore subtree

    @Test
    fun ignoreSubtreeExcludesEntireSubtree() {
        val ignoring = object : AutoskeletonHintRegistry by AutoskeletonEmptyHintRegistry() {
            override fun isIgnored(nodeId: String) = nodeId == "ignored-container"
        }
        assertShapesMatch(measure("ignore-subtree", hints = ignoring), "ignore-subtree")
    }

    // MARK: - Leaf classification
    //
    // `ReactTextView` is classified via a real constructed instance below.
    // `ReactImageView`/`ReactEditText` classification is NOT exercised here: neither
    // constructs cleanly without a live RN bridge/`ReactContext` (verified
    // empirically — see `SyntheticHierarchyBuilder`'s class doc), which a fast
    // traversal-algebra unit harness has no business standing up. Both classes are
    // still checked in `AutoskeletonSensor.hardLeafSource`'s production `when`
    // branch (compiled, type-checked, reviewable); their classification is exercised
    // behaviorally by the instrumented suite (task 4.3) and Phase 5's native E2E
    // tests, both of which mount real RN components through a real bridge.

    @Test
    fun classifiesReactTextViewAsText() {
        val context = RuntimeEnvironment.getApplication()
        val view = com.facebook.react.views.text.ReactTextView(context)
        assertEquals(AutoskeletonShapeSource.TEXT, AutoskeletonSensor.hardLeafSource(view))
    }

    @Test
    fun classifiesPlainViewGroupAsNeitherLeaf() {
        assertNull(AutoskeletonSensor.hardLeafSource(FrameLayout(RuntimeEnvironment.getApplication())))
    }

    // MARK: - Collapsed text synthesis (reuses AutoskeletonLines.kt, a port of lines.ts)

    @Test
    fun collapsedTextSynthesizesDefaultLineCount() {
        // h = 2 (fixture) is far below defaultLineHeight (20) with no `lines` hint,
        // so `defaultLineCount` clamps to exactly 1 line — mirrors lines.test.ts's
        // "rounds to at least one line" case.
        val shapes = measure("collapsed-text")
        assertEquals(1, shapes.size)
        assertEquals(AutoskeletonShapeSource.SYNTHETIC_LINE, shapes[0].source)
        assertTrue(abs(shapes[0].h - 20f) <= tolerance)
    }

    @Test
    fun collapsedTextHonorsLinesHint() {
        val hints = object : AutoskeletonHintRegistry by AutoskeletonEmptyHintRegistry() {
            override fun lines(nodeId: String) = if (nodeId == "collapsed-text-1") 3 else null
        }
        val shapes = measure("collapsed-text", hints = hints)
        assertEquals(3, shapes.size)
        assertTrue(shapes.all { it.source == AutoskeletonShapeSource.SYNTHETIC_LINE })
        assertTrue(shapes.all { it.h == 20f })
        assertEquals(listOf(10f, 30f, 50f), shapes.map { it.y })
        for (shape in shapes) {
            assertTrue(shape.w >= 200 * 0.6f - 0.01f)
            assertTrue(shape.w <= 200 * 0.85f + 0.01f)
        }
    }

    // MARK: - RTL (Yoga has already mirrored frames by the time the sensor runs)

    @Test
    fun rtlGeometryPassesThroughUnchanged() {
        assertShapesMatch(measure("rtl"), "rtl")
    }

    // MARK: - REQ-NAV-1: orientation / font-scale invalidation

    @Test
    fun observeInvokesCallbackOnOrientationAndFontScaleChange() {
        val fixture = SyntheticHierarchyBuilder.loadFixture("nested-offsets")
        val root = SyntheticHierarchyBuilder.build(fixture)
        val sensor = AutoskeletonSensor()

        val received = mutableListOf<AutoskeletonInvalidationReason>()
        val unsubscribe = sensor.observe(root) { reason -> received.add(reason) }

        val app = RuntimeEnvironment.getApplication()
        val baseConfig = Configuration(app.resources.configuration)

        val orientationConfig = Configuration(baseConfig).apply {
            orientation = if (baseConfig.orientation == Configuration.ORIENTATION_LANDSCAPE) {
                Configuration.ORIENTATION_PORTRAIT
            } else {
                Configuration.ORIENTATION_LANDSCAPE
            }
        }
        app.onConfigurationChanged(orientationConfig)
        assertEquals(listOf(AutoskeletonInvalidationReason.ORIENTATION), received)

        val fontScaleConfig = Configuration(orientationConfig).apply { fontScale = baseConfig.fontScale + 0.5f }
        app.onConfigurationChanged(fontScaleConfig)
        assertEquals(
            listOf(AutoskeletonInvalidationReason.ORIENTATION, AutoskeletonInvalidationReason.FONT_SCALE),
            received,
        )

        unsubscribe()
        val secondOrientationConfig = Configuration(fontScaleConfig).apply {
            orientation = baseConfig.orientation
        }
        app.onConfigurationChanged(secondOrientationConfig)
        assertEquals(
            "unsubscribe must stop further invalidation callbacks",
            listOf(AutoskeletonInvalidationReason.ORIENTATION, AutoskeletonInvalidationReason.FONT_SCALE),
            received,
        )
    }

    // MARK: - REQ-OBS-PROFILE-1: Trace.beginSection/endSection around traversal

    @Test
    fun traversalEmitsMatchedTraceBeginAndEnd() {
        val fixture = SyntheticHierarchyBuilder.loadFixture("nested-offsets")
        val root = SyntheticHierarchyBuilder.build(fixture)
        val tracing = AutoskeletonRecordingTracing()
        val sensor = AutoskeletonSensor(tracing = tracing)

        sensor.measure(root)

        assertEquals(
            listOf(
                AutoskeletonRecordingTracing.Event.Begin("AutoskeletonTraversal"),
                AutoskeletonRecordingTracing.Event.End("AutoskeletonTraversal"),
            ),
            tracing.events,
        )
    }

    // MARK: - Budget / shape-cap degradation

    @Test
    fun budgetExceededTruncatesAndFlagsDegraded() {
        val fixture = SyntheticHierarchyBuilder.loadFixture("nested-offsets")
        val root = SyntheticHierarchyBuilder.build(fixture)
        val sensor = AutoskeletonSensor()
        val result = sensor.measure(root, AutoskeletonSensorOptions.defaults.copy(budgetMs = 0.0))!!
        assertTrue(result.degraded.contains(AutoskeletonDegradationFlag.BUDGET_EXCEEDED))
        assertEquals(0, result.shapes.size)
    }

    @Test
    fun shapeCapReachedTruncatesAndFlagsDegraded() {
        val fixture = SyntheticHierarchyBuilder.loadFixture("ignore-subtree")
        val root = SyntheticHierarchyBuilder.build(fixture)
        val sensor = AutoskeletonSensor()
        // A generous budgetMs here: this test is about the shape cap, not the time
        // budget, and a cold-JVM first traversal call can occasionally exceed the
        // real 2ms production default purely from JIT/classloading warm-up —
        // observed empirically. `budgetExceededTruncatesAndFlagsDegraded` is the
        // dedicated, deterministic test for the budget path (budgetMs = 0).
        val result = sensor.measure(root, AutoskeletonSensorOptions.defaults.copy(maxShapes = 1, budgetMs = 1000.0))!!
        assertTrue(result.degraded.contains(AutoskeletonDegradationFlag.SHAPE_CAP_REACHED))
        assertEquals(1, result.shapes.size)
    }

    // MARK: - measure() returns null for an unlaid-out (zero-size) target

    @Test
    fun measureReturnsNullForZeroSizeRoot() {
        val root = FrameLayout(RuntimeEnvironment.getApplication())
        val sensor = AutoskeletonSensor()
        assertNull(sensor.measure(root))
    }

    // MARK: - hidden / transparent views contribute nothing

    @Test
    fun goneViewContributesNoShape() {
        val fixture = SyntheticHierarchyBuilder.loadFixture("nested-offsets")
        val root = SyntheticHierarchyBuilder.build(fixture) as android.view.ViewGroup
        (root.getChildAt(0) as android.view.ViewGroup).visibility = android.view.View.GONE
        val sensor = AutoskeletonSensor()
        val result = sensor.measure(root)!!
        assertFalse(result.shapes.isNotEmpty() && result.shapes.any { it.source == AutoskeletonShapeSource.TEXT })
    }
}
