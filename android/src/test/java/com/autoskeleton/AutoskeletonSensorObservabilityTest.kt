package com.autoskeleton

import android.content.pm.ApplicationInfo
import android.graphics.Color
import android.widget.FrameLayout
import com.facebook.react.uimanager.BackgroundStyleApplicator
import com.facebook.react.uimanager.DisplayMetricsHolder
import com.facebook.react.uimanager.LengthPercentage
import com.facebook.react.uimanager.LengthPercentageType
import com.facebook.react.uimanager.style.BorderRadiusProp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

/**
 * Task G.3 (tasks.md, observability gap closure, post-Phase-4) / spec.md
 * REQ-OBS-BUDGET-1/2: proves the dev warnings actually fire from
 * `AutoskeletonSensor.measure()` — the REAL traversal path — not merely from a
 * formatter called in isolation (`AutoskeletonObservabilityTest`'s job). This is
 * the exact acceptance criterion the brief states explicitly: "Drive the real
 * sensor through a real traversal that trips the threshold, and assert the
 * warning actually surfaces."
 *
 * Dev-gate: mirrors `AutoskeletonDebugOverlayTest`'s runtime
 * `ApplicationInfo.FLAG_DEBUGGABLE` pattern (task 4.5) rather than a
 * compile-time flag — a published Android AAR is a single already-compiled
 * variant, so a Swift-style `#if DEBUG` strip is not available here.
 */
@RunWith(RobolectricTestRunner::class)
class AutoskeletonSensorObservabilityTest {

    private fun setDebuggable(debuggable: Boolean) {
        val app = RuntimeEnvironment.getApplication()
        app.applicationInfo.flags = if (debuggable) {
            app.applicationInfo.flags or ApplicationInfo.FLAG_DEBUGGABLE
        } else {
            app.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE.inv()
        }
    }

    private fun freshLeaf(x: Int, w: Int = 40, h: Int = 40): FrameLayout {
        val context = RuntimeEnvironment.getApplication()
        DisplayMetricsHolder.initDisplayMetricsIfNotInitialized(context)
        val view = FrameLayout(context)
        view.layout(x, 0, x + w, h)
        return view
    }

    private fun applyRoundedBackground(view: FrameLayout, radiusPx: Float? = null) {
        BackgroundStyleApplicator.setBackgroundColor(view, Color.RED)
        if (radiusPx != null) {
            BackgroundStyleApplicator.setBorderRadius(
                view,
                BorderRadiusProp.BORDER_RADIUS,
                LengthPercentage(radiusPx, LengthPercentageType.POINT),
            )
        }
        view.background?.setBounds(0, 0, view.width, view.height)
    }

    // MARK: - REQ-OBS-BUDGET-1: time budget

    @Test
    fun timeBudgetExceededEmitsWarningFromRealTraversal() {
        setDebuggable(true)
        val fixture = SyntheticHierarchyBuilder.loadFixture("nested-offsets")
        val root = SyntheticHierarchyBuilder.build(fixture)
        val emitter = AutoskeletonRecordingWarningEmitter()
        val sensor = AutoskeletonSensor(warnings = emitter)

        // budgetMs = -1 is a deterministic real trigger (any real traversalMs >= 0
        // exceeds -1) — same technique as the web wiring (G.1), avoids a flaky
        // positive-time-budget assertion depending on how fast the JVM runs.
        sensor.measure(root, AutoskeletonSensorOptions.defaults.copy(budgetMs = -1.0))

        assertTrue(
            "expected a time-budget warning citing 'traversal took', got: ${emitter.warnings}",
            emitter.warnings.any { it.contains("traversal took") },
        )
    }

    // MARK: - REQ-OBS-BUDGET-1: shape cap

    @Test
    fun shapeCapExceededEmitsWarningFromRealTraversal() {
        setDebuggable(true)
        val fixture = SyntheticHierarchyBuilder.loadFixture("ignore-subtree")
        val root = SyntheticHierarchyBuilder.build(fixture)
        val emitter = AutoskeletonRecordingWarningEmitter()
        val sensor = AutoskeletonSensor(warnings = emitter)

        // Generous budgetMs: this test is about the shape cap, not the time
        // budget — same cold-JVM-warmup rationale documented on
        // AutoskeletonSensorTest.shapeCapReachedTruncatesAndFlagsDegraded.
        val result = sensor.measure(
            root,
            AutoskeletonSensorOptions.defaults.copy(maxShapes = 1, budgetMs = 1000.0),
        )!!
        assertTrue(result.degraded.contains(AutoskeletonDegradationFlag.SHAPE_CAP_REACHED))

        assertTrue(
            "expected a shape-cap warning citing '2 shapes' (maxShapes+1, the honest lower " +
                "bound derived from the real shape-cap-reached flag) and the configured cap, " +
                "got: ${emitter.warnings}",
            emitter.warnings.any { it.contains("2 shapes") && it.contains("1-shape budget") },
        )
    }

    // MARK: - REQ-OBS-BUDGET-2: radius fallback, real R0/R1/R3 ladder, no internal API

    @Test
    fun radiusFallbackShareExceededEmitsWarningFromRealTraversal() {
        setDebuggable(true)
        val context = RuntimeEnvironment.getApplication()
        DisplayMetricsHolder.initDisplayMetricsIfNotInitialized(context)
        val root = FrameLayout(context)
        root.layout(0, 0, 400, 40)

        val hints = object : AutoskeletonHintRegistry by AutoskeletonEmptyHintRegistry() {
            override fun radius(nodeId: String) = if (nodeId == "hinted-0" || nodeId == "hinted-1") 6f else null
        }

        // 8 rounded, unhinted leaves -> real R1 (Outline.getRadius() undefined for
        // rounded, per the measured on-device limitation in spec.md §1.1) -> R3
        // DEFAULT rung. No RN internal class touched anywhere in this path.
        for (i in 0 until 8) {
            val leaf = freshLeaf(x = i * 40)
            applyRoundedBackground(leaf, radiusPx = 8f)
            root.addView(leaf)
        }
        // 2 hinted leaves -> R0 HINT rung, never DEFAULT.
        for (i in 0 until 2) {
            val leaf = freshLeaf(x = (8 + i) * 40)
            applyRoundedBackground(leaf, radiusPx = 8f)
            leaf.setTag(com.facebook.react.R.id.view_tag_native_id, "hinted-$i")
            root.addView(leaf)
        }

        val emitter = AutoskeletonRecordingWarningEmitter()
        val sensor = AutoskeletonSensor(warnings = emitter)
        val options = AutoskeletonSensorOptions.defaults.copy(
            hints = hints,
            radiusResolver = AutoskeletonPublicApiRadiusResolver(),
            budgetMs = 1000.0,
        )

        val result = sensor.measure(root, options)!!
        assertEquals(10, result.shapes.size)
        assertEquals(8, result.shapes.count { it.radiusSource == AutoskeletonRadiusSource.DEFAULT })

        assertTrue(
            "expected a radius-fallback warning citing 8/10 (80%) against the 30% threshold, " +
                "got: ${emitter.warnings}",
            emitter.warnings.any {
                it.contains("8/10") && it.contains("80%") && it.contains("30%") && it.contains("radius")
            },
        )
    }

    // MARK: - no false positive: real traversal within every budget stays silent

    @Test
    fun noWarningsWhenEveryBudgetIsRespected() {
        setDebuggable(true)
        val context = RuntimeEnvironment.getApplication()
        DisplayMetricsHolder.initDisplayMetricsIfNotInitialized(context)
        val root = FrameLayout(context)
        root.layout(0, 0, 200, 40)

        // Square (non-rounded) backgrounds resolve via real R1 OUTLINE, never
        // DEFAULT — genuinely zero radius-fallback share, not a stubbed resolver.
        for (i in 0 until 5) {
            val leaf = freshLeaf(x = i * 40)
            applyRoundedBackground(leaf, radiusPx = null)
            root.addView(leaf)
        }

        val emitter = AutoskeletonRecordingWarningEmitter()
        val sensor = AutoskeletonSensor(warnings = emitter)
        val options = AutoskeletonSensorOptions.defaults.copy(
            radiusResolver = AutoskeletonPublicApiRadiusResolver(),
            budgetMs = 1000.0,
            maxShapes = 60,
        )

        val result = sensor.measure(root, options)!!
        assertEquals(5, result.shapes.size)
        assertTrue(emitter.warnings.isEmpty())
    }

    // MARK: - dev gate: no warnings when the consuming app is not debuggable

    @Test
    fun warningsSuppressedWhenApplicationIsNotDebuggable() {
        setDebuggable(false)
        val fixture = SyntheticHierarchyBuilder.loadFixture("nested-offsets")
        val root = SyntheticHierarchyBuilder.build(fixture)
        val emitter = AutoskeletonRecordingWarningEmitter()
        val sensor = AutoskeletonSensor(warnings = emitter)

        // A genuine, real trip condition (same as the first test) -- proves the
        // gate suppresses emission, not that nothing tripped.
        sensor.measure(root, AutoskeletonSensorOptions.defaults.copy(budgetMs = -1.0))

        assertTrue(
            "warnings must be suppressed in a non-debuggable build even though a real " +
                "budget was exceeded, got: ${emitter.warnings}",
            emitter.warnings.isEmpty(),
        )
    }
}
