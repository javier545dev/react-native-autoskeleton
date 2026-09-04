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
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

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

    /** The R3 case that SURVIVES R1b. Four independent corner radii cannot be
     *  carried by `ShapeInfo.r`, which is one scalar, so the ladder declines to
     *  guess and keeps the `radius-unavailable` flag that says so. Note this
     *  sets NO uniform `BORDER_RADIUS`, which is exactly what makes
     *  `getBorderRadius(view, BORDER_RADIUS)` return null. */
    private fun applyPerCornerBackground(view: FrameLayout, radiusPx: Float) {
        BackgroundStyleApplicator.setBackgroundColor(view, Color.RED)
        BackgroundStyleApplicator.setBorderRadius(
            view,
            BorderRadiusProp.BORDER_TOP_LEFT_RADIUS,
            LengthPercentage(radiusPx, LengthPercentageType.POINT),
        )
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

    // MARK: - R1b: the rounded case, recovered through the public style getter

    /**
     * A circular avatar is the most visible thing this ladder can get wrong, and
     * until R1b existed it got it wrong on every Android device: `borderRadius:
     * 28` on a 56dp image painted as a near-square block while iOS painted a
     * circle, because R1's `Outline` reports `RADIUS_UNDEFINED` for anything
     * rounded and R3 then substituted `defaultRadius`.
     *
     * `BackgroundStyleApplicator.getBorderRadius` is the symmetric READ of the
     * exact public API `applyBackground` below uses to write it — the same class
     * RN's own `ReactViewManager` uses in production. It is `@JvmStatic public`
     * in both RN 0.77 (this package's declared `peerDependencies` floor) and RN
     * 0.87, so this rung covers the whole supported range, and it names no
     * internal class, which is what ADR-2 actually forbids.
     */
    @Test
    fun r1bRecoversARoundedRadiusThroughThePublicStyleGetter() {
        val view = freshView()
        applyBackground(view, radiusPx = 28f)

        val resolution = AutoskeletonPublicApiRadiusResolver(defaultRadius = 2f).resolve(view, AutoskeletonEmptyHintRegistry(), null)

        assertEquals(28f, resolution.radius)
        assertEquals(AutoskeletonRadiusSource.STYLE, resolution.source)
        assertNull("a recovered radius is not a degradation", resolution.degraded)
    }

    /**
     * The unit guard. Robolectric's default density is 1, so every other test in
     * this file is blind to a missing dp -> px conversion — and this repo has
     * already been bitten by exactly that once (`AutoskeletonModule`'s own
     * `toSensorOptions` doc comment records it for `defaultRadius` and hints).
     *
     * `borderRadius: 28` is 28 DP: `ReactViewManager.setBorderRadius` stores the
     * raw JS number with no `toPixelFromDIP`. The sensor measures in raw view
     * PIXELS, so at density 3 a 28dp radius has to come back as 84px. The
     * unit-blind first version returned 28 here, which on a real device painted a
     * 56dp circular avatar with a ~10dp corner — visibly rounded, visibly not a
     * circle.
     */
    @Test
    @Config(qualifiers = "xxhdpi")
    fun r1bScalesADpRadiusToPixelsAtDensity3() {
        val view = freshView()
        assertEquals(3f, view.resources.displayMetrics.density, 0.0001f)
        applyBackground(view, radiusPx = 28f)

        val resolution = AutoskeletonPublicApiRadiusResolver().resolve(view, AutoskeletonEmptyHintRegistry(), null)

        assertEquals(84f, resolution.radius)
        assertEquals(AutoskeletonRadiusSource.STYLE, resolution.source)
    }

    /** R0 still outranks it: an explicit hint is authoritative over anything read
     *  back off the view. */
    @Test
    fun r0HintStillBeatsTheStyleGetter() {
        val view = freshView()
        applyBackground(view, radiusPx = 28f)
        val hints = object : AutoskeletonHintRegistry by AutoskeletonEmptyHintRegistry() {
            override fun radius(nodeId: String) = if (nodeId == "n1") 4f else null
        }

        val resolution = AutoskeletonPublicApiRadiusResolver(defaultRadius = 2f).resolve(view, hints, "n1")

        assertEquals(4f, resolution.radius)
        assertEquals(AutoskeletonRadiusSource.HINT, resolution.source)
    }

    // MARK: - R1: rounded background -> RADIUS_UNDEFINED characterization -> falls to R3

    @Test
    fun perCornerRadiiStillFallThroughToR3() {
        val view = freshView()
        applyPerCornerBackground(view, radiusPx = 8f)
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
        val perCornerBg = freshView().also { applyPerCornerBackground(it, radiusPx = 8f) }
        val hintedView = freshView().also { applyBackground(it, radiusPx = 8f) }

        val resolutions = listOf(
            resolver.resolve(noBg, hints, null),
            resolver.resolve(squareBg, hints, null),
            resolver.resolve(roundedBg, hints, null),
            resolver.resolve(perCornerBg, hints, null),
            resolver.resolve(hintedView, hints, "hinted"),
        )
        val histogram = resolutions.groupingBy { it.source }.eachCount()

        assertEquals(1, histogram[AutoskeletonRadiusSource.MEASURED])
        assertEquals(1, histogram[AutoskeletonRadiusSource.OUTLINE])
        assertEquals(1, histogram[AutoskeletonRadiusSource.STYLE])
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
        // Rounded background (cornerRadius: 8 in the fixture). R1's outline is
        // undefined for it, but R1b reads the radius straight back off the style
        // it was written with — so the shape now carries the REAL 8, not a
        // `defaultRadius` substitute, and nothing is degraded. This assertion is
        // the end-to-end proof that a circular avatar paints as a circle.
        assertEquals(8f, result.shapes[0].r)
        assertEquals(AutoskeletonRadiusSource.STYLE, result.shapes[0].radiusSource)
        assertTrue(result.degraded.isEmpty())
    }
}
