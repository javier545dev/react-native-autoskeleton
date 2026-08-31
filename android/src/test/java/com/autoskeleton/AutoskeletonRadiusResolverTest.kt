package com.autoskeleton

import android.graphics.Color
import android.widget.FrameLayout
import com.facebook.react.uimanager.BackgroundStyleApplicator
import com.facebook.react.uimanager.DisplayMetricsHolder
import com.facebook.react.uimanager.LengthPercentage
import com.facebook.react.uimanager.LengthPercentageType
import com.facebook.react.uimanager.style.BorderRadiusProp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

/**
 * Task 4.2 (tasks.md Phase 4) / plan.md ADR-2: the public-API-only radius
 * degradation ladder (R0 hint -> R1 outline -> R3 default). R2 (raster probe) is
 * task 4.3's job and is deliberately excluded from this resolver.
 *
 * The R1 characterization here is against a REAL `CompositeBackgroundDrawable`
 * produced via the public `BackgroundStyleApplicator` — the exact mechanism RN's
 * own `ReactViewManager` uses in production — not a synthetic stand-in, verified
 * empirically (see `SyntheticHierarchyBuilder`'s class doc): the square case
 * reports an exact `outline.getRadius() == 0`; the rounded case reports
 * `Outline.RADIUS_UNDEFINED` (`Float.NEGATIVE_INFINITY`). This documents current RN
 * 0.87.1 behavior so a future RN fix (a real usable radius on `getOutline`) is
 * caught by this test breaking, rather than silently changing behavior
 * (plan.md §7.2b).
 */
@RunWith(RobolectricTestRunner::class)
class AutoskeletonRadiusResolverTest {
    /** See the rule's own doc: without it any code path that reads a React
     *  Native feature flag fails to link on the host JVM. */
    @get:Rule val featureFlags = AutoskeletonFeatureFlagsRule()

    private fun freshView(): FrameLayout {
        val context = RuntimeEnvironment.getApplication()
        DisplayMetricsHolder.initDisplayMetricsIfNotInitialized(context)
        val view = FrameLayout(context)
        view.layout(0, 0, 100, 100)
        return view
    }

    private fun applyBackground(view: FrameLayout, radiusPx: Float? = null) {
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

    // MARK: - R0: hint precedence

    @Test
    fun r0HintTakesPrecedenceOverEverythingElse() {
        val view = freshView()
        applyBackground(view, radiusPx = 8f) // would otherwise fall to R3 (rounded, undefined)
        val hints = object : AutoskeletonHintRegistry by AutoskeletonEmptyHintRegistry() {
            override fun radius(nodeId: String) = if (nodeId == "n1") 12f else null
        }
        val resolver = AutoskeletonPublicApiRadiusResolver()
        val resolution = resolver.resolve(view, hints, "n1")
        assertEquals(12f, resolution.radius)
        assertEquals(AutoskeletonRadiusSource.HINT, resolution.source)
        assertNull(resolution.degraded)
    }

    // MARK: - R1: no background at all -> trivially square, MEASURED, zero noise

    @Test
    fun noBackgroundIsTriviallySquare() {
        val view = freshView()
        val resolver = AutoskeletonPublicApiRadiusResolver()
        val resolution = resolver.resolve(view, AutoskeletonEmptyHintRegistry(), null)
        assertEquals(0f, resolution.radius)
        assertEquals(AutoskeletonRadiusSource.MEASURED, resolution.source)
        assertNull(resolution.degraded)
    }

    // MARK: - R1: square background -> exact radius via public Outline API

    @Test
    fun r1RecoversExactRadiusForSquareBackground() {
        val view = freshView()
        applyBackground(view) // background, no radius requested
        val resolver = AutoskeletonPublicApiRadiusResolver()
        val resolution = resolver.resolve(view, AutoskeletonEmptyHintRegistry(), null)
        assertEquals(0f, resolution.radius)
        assertEquals(AutoskeletonRadiusSource.OUTLINE, resolution.source)
        assertNull(resolution.degraded)
    }

    // MARK: - R1: rounded background -> RADIUS_UNDEFINED characterization -> falls to R3

    @Test
    fun r1FallsThroughToR3ForRoundedBackground() {
        val view = freshView()
        applyBackground(view, radiusPx = 8f)
        val resolver = AutoskeletonPublicApiRadiusResolver(defaultRadius = 2f)
        val resolution = resolver.resolve(view, AutoskeletonEmptyHintRegistry(), null)
        assertEquals(2f, resolution.radius)
        assertEquals(AutoskeletonRadiusSource.DEFAULT, resolution.source)
        assertEquals(AutoskeletonDegradationFlag.RADIUS_UNAVAILABLE, resolution.degraded)
    }

    // MARK: - radiusSourceHistogram correctness for every rung (ADR-2: mandatory)

    @Test
    fun everyRungIsDistinctlyReportedForAHistogramTally() {
        val resolver = AutoskeletonPublicApiRadiusResolver(defaultRadius = 0f)
        val hints = object : AutoskeletonHintRegistry by AutoskeletonEmptyHintRegistry() {
            override fun radius(nodeId: String) = if (nodeId == "hinted") 5f else null
        }

        val noBg = freshView()
        val squareBg = freshView().also { applyBackground(it) }
        val roundedBg = freshView().also { applyBackground(it, radiusPx = 8f) }
        val hintedView = freshView().also { applyBackground(it, radiusPx = 8f) }

        val resolutions = listOf(
            resolver.resolve(noBg, hints, null),
            resolver.resolve(squareBg, hints, null),
            resolver.resolve(roundedBg, hints, null),
            resolver.resolve(hintedView, hints, "hinted"),
        )
        val histogram = resolutions.groupingBy { it.source }.eachCount()

        assertEquals(1, histogram[AutoskeletonRadiusSource.MEASURED])
        assertEquals(1, histogram[AutoskeletonRadiusSource.OUTLINE])
        assertEquals(1, histogram[AutoskeletonRadiusSource.DEFAULT])
        assertEquals(1, histogram[AutoskeletonRadiusSource.HINT])
        assertTrue(histogram[AutoskeletonRadiusSource.RASTER_PROBE] == null)
    }

    // MARK: - wired into AutoskeletonSensor: container-rule-no-leaves fixture now
    // resolves its real radius (task 4.1's own test deliberately skipped `r` here)

    @Test
    fun sensorWiredWithRealResolverRecoversContainerRadius() {
        val fixture = SyntheticHierarchyBuilder.loadFixture("container-rule-no-leaves")
        val root = SyntheticHierarchyBuilder.build(fixture)
        val sensor = AutoskeletonSensor()
        // budgetMs generous for the same cold-JVM-warmup reason documented on
        // AutoskeletonSensorTest.shapeCapReachedTruncatesAndFlagsDegraded.
        val options = AutoskeletonSensorOptions.defaults.copy(
            radiusResolver = AutoskeletonPublicApiRadiusResolver(),
            budgetMs = 1000.0,
        )
        val result = sensor.measure(root, options)!!
        assertEquals(1, result.shapes.size)
        // Rounded background (cornerRadius: 8 in the fixture) -> R1 undefined -> R3
        // default (0f here, since no SkeletonProvider.defaultRadius override was
        // configured) with radius-unavailable — the honest degraded answer, not a
        // silently wrong "8".
        assertEquals(0f, result.shapes[0].r)
        assertEquals(AutoskeletonRadiusSource.DEFAULT, result.shapes[0].radiusSource)
        assertTrue(result.degraded.contains(AutoskeletonDegradationFlag.RADIUS_UNAVAILABLE))
    }
}
