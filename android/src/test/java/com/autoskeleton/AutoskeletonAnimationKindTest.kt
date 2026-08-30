package com.autoskeleton

import android.graphics.Color
import android.widget.FrameLayout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.GraphicsMode

/**
 * The `animation` prop is public API, and tier-1 used to collapse it into a
 * single boolean: `isReducedMotionEffective() = reducedMotion || animation ==
 * "none"`.
 *
 * Two defects fell out of that one line, in opposite directions:
 *
 *  - `"pulse"` is NOT in the predicate, so an explicit `animation="pulse"`
 *    with the platform preference off played the full travelling shimmer.
 *  - `"none"` IS in the predicate, and the predicate's true branch is the
 *    reduced-motion PULSE — so the one value that means "do not animate" was
 *    the one value that got an animation it never asked for.
 *
 * This table is the Kotlin mirror of `src/core/animation.ts`'s
 * `effectiveAnimation`, pinned against the same cases its Vitest table drives.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class AutoskeletonAnimationKindTest {

    @Test
    fun effectiveAnimationMatchesTheSharedTable() {
        assertEquals("shimmer", AutoskeletonOverlayView.effectiveAnimation("shimmer", false))
        assertEquals("pulse", AutoskeletonOverlayView.effectiveAnimation("pulse", false))
        assertEquals("none", AutoskeletonOverlayView.effectiveAnimation("none", false))
        assertEquals("pulse", AutoskeletonOverlayView.effectiveAnimation("shimmer", true))
        assertEquals("pulse", AutoskeletonOverlayView.effectiveAnimation("pulse", true))
        // The whole point: reduce-motion must never turn "none" into a pulse.
        assertEquals("none", AutoskeletonOverlayView.effectiveAnimation("none", true))
    }

    @Test
    fun effectiveAnimationIsIdempotent() {
        for (kind in listOf("shimmer", "pulse", "none")) {
            for (reduced in listOf(false, true)) {
                val once = AutoskeletonOverlayView.effectiveAnimation(kind, reduced)
                assertEquals(once, AutoskeletonOverlayView.effectiveAnimation(once, reduced))
            }
        }
    }

    @Test
    fun anUnknownKindFallsBackToShimmerRatherThanSilentlyDisablingTheSkeleton() {
        assertEquals("shimmer", AutoskeletonOverlayView.effectiveAnimation("", false))
        assertEquals("shimmer", AutoskeletonOverlayView.effectiveAnimation("sparkle", false))
    }

    // MARK: - what each kind actually does to the draw pass

    private fun theme() = AutoskeletonSkeletonTheme(
        baseColor = Color.LTGRAY,
        highlightColor = Color.WHITE,
        defaultRadius = 0f,
        speedMs = 1500.0,
    )

    private fun mountedSurface(): FrameLayout {
        val surface = FrameLayout(RuntimeEnvironment.getApplication())
        surface.layout(0, 0, 200, 200)
        return surface
    }

    private fun mount(
        kind: String,
        scheduler: AutoskeletonRecordingFrameScheduler,
        clock: AutoskeletonShimmerClock = AutoskeletonShimmerClock(),
    ): AutoskeletonShimmerOverlayView {
        val surface = mountedSurface()
        AutoskeletonRendererTier1().mount(surface, emptyList(), theme(), clock, kind, scheduler = scheduler)
        return surface.getChildAt(0) as AutoskeletonShimmerOverlayView
    }

    @Test
    fun onlyNoneStopsTheFrameLoop() {
        // 'pulse' is an ANIMATION. It has to be driven, exactly as the CSS
        // renderer drives its own `@keyframes askl-pulse` and iOS drives its
        // `CABasicAnimation`. Stopping the loop for it is what produced the
        // frozen-at-an-arbitrary-phase gradient this change exists to remove.
        val shimmerScheduler = AutoskeletonRecordingFrameScheduler()
        mount("shimmer", shimmerScheduler)
        assertTrue(shimmerScheduler.postCount > 0)

        val pulseScheduler = AutoskeletonRecordingFrameScheduler()
        mount("pulse", pulseScheduler)
        assertTrue(pulseScheduler.postCount > 0)

        val noneScheduler = AutoskeletonRecordingFrameScheduler()
        mount("none", noneScheduler)
        assertEquals(0, noneScheduler.postCount)
    }

    @Test
    fun pulseParksTheGradientAtTheContainerCentreRatherThanWhereverTheSweepStopped() {
        // The defect: `setReducedMotion(true)` only called `stopAnimating()`.
        // Nothing repositioned the shader, so the highlight streak stayed
        // frozen at whatever phase the last drawn frame happened to be at —
        // it could sit anywhere across the skeleton, and where it sat was a
        // function of when the user toggled the setting.
        val clock = AutoskeletonShimmerClock()
        val overlay = mount("pulse", AutoskeletonRecordingFrameScheduler(), clock)
        overlay.draw(android.graphics.Canvas())
        assertEquals(overlay.width / 2f, overlay.lastShaderTranslateX, 0.001f)
    }

    @Test
    fun pulseParkingIsIndependentOfTheClockPhase() {
        // "A defined frame" means the same place every time, no matter WHEN it
        // is drawn. The old behaviour failed exactly here: the position was a
        // function of the moment the loop stopped, so the identical assertion
        // over a moving clock is what separates parked from frozen. A short
        // period makes the phase sweep several times across these draws.
        val clock = AutoskeletonShimmerClock()
        clock.setPeriod(40.0)
        val overlay = mount("pulse", AutoskeletonRecordingFrameScheduler(), clock)
        val translations = mutableListOf<Float>()
        repeat(8) {
            overlay.draw(android.graphics.Canvas())
            translations.add(overlay.lastShaderTranslateX)
            Thread.sleep(7)
        }
        assertEquals("parked position drifted with the clock: $translations", 1, translations.distinct().size)
        assertEquals(overlay.width / 2f, translations.first(), 0.001f)
    }

    @Test
    fun shimmerStillTravels() {
        val clock = AutoskeletonShimmerClock()
        clock.setPeriod(50.0)
        val overlay = mount("shimmer", AutoskeletonRecordingFrameScheduler(), clock)
        overlay.draw(android.graphics.Canvas())
        val first = overlay.lastShaderTranslateX
        Thread.sleep(20)
        overlay.draw(android.graphics.Canvas())
        assertNotEquals(first, overlay.lastShaderTranslateX)
    }

    @Test
    fun pulseBreathesTheHighlightAlphaOverAnOpaqueBase() {
        // Two independent claims, both required:
        //  - the highlight's alpha really varies (otherwise "pulse" is static);
        //  - it never goes below PULSE_MIN_ALPHA, and the base is drawn at full
        //    opacity underneath, so the skeleton never becomes see-through and
        //    the real content can never read through the loading state.
        val clock = AutoskeletonShimmerClock()
        clock.setPeriod(60.0)
        val overlay = mount("pulse", AutoskeletonRecordingFrameScheduler(), clock)
        val alphas = mutableListOf<Int>()
        repeat(12) {
            overlay.draw(android.graphics.Canvas())
            alphas.add(overlay.lastHighlightAlpha)
            Thread.sleep(6)
        }
        assertTrue("highlight alpha never changed: $alphas", alphas.distinct().size > 1)
        assertTrue("highlight went below the floor: $alphas", alphas.min() >= AutoskeletonShimmerOverlayView.PULSE_MIN_ALPHA)
        assertTrue("highlight exceeded opaque: $alphas", alphas.max() <= 255)
        assertTrue("pulse must paint an opaque base underneath", overlay.lastDrewOpaqueBase)
    }

    @Test
    fun noneDrawsTheCoveringBaseAndNothingElse() {
        // "Do not animate" must not be allowed to become "do not paint": the
        // skeleton still has to hide the content underneath it.
        val overlay = mount("none", AutoskeletonRecordingFrameScheduler())
        overlay.draw(android.graphics.Canvas())
        assertTrue(overlay.lastDrewOpaqueBase)
        assertEquals(0, overlay.lastHighlightAlpha)
    }

    @Test
    fun shimmerNeedsNoSeparateBasePass() {
        val overlay = mount("shimmer", AutoskeletonRecordingFrameScheduler())
        overlay.draw(android.graphics.Canvas())
        assertEquals(255, overlay.lastHighlightAlpha)
    }
}
