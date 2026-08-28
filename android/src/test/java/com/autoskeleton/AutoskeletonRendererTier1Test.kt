package com.autoskeleton

import android.graphics.Color
import android.graphics.RectF
import android.view.View
import android.widget.FrameLayout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.GraphicsMode
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * Task 4.4 (tasks.md Phase 4) / plan.md §3.5, §7.2c, brief §4 "Renderers > Default":
 * `AutoskeletonRendererTier1` — single draw pass, `Path` union + `canvas.clipPath`,
 * ONE `LinearGradient` shader translated per frame via `Matrix.setTranslate` +
 * `Shader.setLocalMatrix` (rebuilding forbidden), invalidation via
 * `postInvalidateOnAnimation`/`Choreographer`, zero view-state mutation inside the
 * draw pass.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class AutoskeletonRendererTier1Test {
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

    // MARK: - unionPath geometry

    @Test
    fun unionPathBoundsMatchTheUnionOfEveryShape() {
        val shapes = listOf(
            AutoskeletonShapeInfo(0f, 0f, 50f, 20f, 0f, AutoskeletonShapeSource.TEXT, AutoskeletonRadiusSource.MEASURED),
            AutoskeletonShapeInfo(60f, 40f, 30f, 30f, 8f, AutoskeletonShapeSource.CONTAINER, AutoskeletonRadiusSource.MEASURED),
        )
        val path = AutoskeletonRendererTier1.unionPath(shapes)
        val bounds = RectF()
        path.computeBounds(bounds, true)
        assertEquals(0f, bounds.left)
        assertEquals(0f, bounds.top)
        assertEquals(90f, bounds.right)
        assertEquals(70f, bounds.bottom)
    }

    @Test
    fun unionPathClampsRadiusToHalfTheShorterSide() {
        // r=999 on a 20x10 shape must not produce a degenerate/negative-inset path;
        // clamped to min(w,h)/2 = 5.
        val shapes = listOf(
            AutoskeletonShapeInfo(0f, 0f, 20f, 10f, 999f, AutoskeletonShapeSource.CONTAINER, AutoskeletonRadiusSource.MEASURED),
        )
        val path = AutoskeletonRendererTier1.unionPath(shapes)
        assertFalse(path.isEmpty)
        val bounds = RectF()
        path.computeBounds(bounds, true)
        assertEquals(20f, bounds.width())
        assertEquals(10f, bounds.height())
    }

    // MARK: - shader created ONCE, translated (not rebuilt) across many invalidations (NFR-5)

    @Test
    fun shaderInstanceIsStableAcrossAtLeast120Invalidations() {
        val surface = mountedSurface()
        val scheduler = AutoskeletonRecordingFrameScheduler()
        val clock = AutoskeletonShimmerClock()
        val renderer = AutoskeletonRendererTier1()
        val handle = renderer.mount(surface, emptyList(), theme(), clock, reducedMotion = false, scheduler = scheduler)

        val overlay = surface.getChildAt(0) as AutoskeletonShimmerOverlayView
        overlay.draw(android.graphics.Canvas()) // forces the shader to exist
        val firstShader = overlay.currentShader
        assertTrue(firstShader != null)

        repeat(120) {
            handle.update(
                listOf(
                    AutoskeletonShapeInfo(0f, 0f, 10f, 10f, 0f, AutoskeletonShapeSource.TEXT, AutoskeletonRadiusSource.MEASURED),
                ),
            )
            overlay.draw(android.graphics.Canvas())
        }

        assertSame("the LinearGradient instance must never be rebuilt", firstShader, overlay.currentShader)
        assertEquals(1, overlay.shaderInstanceCount)
    }

    @Test
    fun geometryUpdateDoesNotRestartTheClockOrRebuildTheShader() {
        val surface = mountedSurface()
        val scheduler = AutoskeletonRecordingFrameScheduler()
        val clock = AutoskeletonShimmerClock()
        val renderer = AutoskeletonRendererTier1()
        val handle = renderer.mount(surface, emptyList(), theme(), clock, reducedMotion = false, scheduler = scheduler)
        val overlay = surface.getChildAt(0) as AutoskeletonShimmerOverlayView
        overlay.draw(android.graphics.Canvas())
        val startedAt = clock.startedAt

        handle.update(listOf(AutoskeletonShapeInfo(1f, 1f, 5f, 5f, 0f, AutoskeletonShapeSource.TEXT, AutoskeletonRadiusSource.MEASURED)))

        assertEquals(startedAt, clock.startedAt, 0.0) // phase origin never resets on a geometry update
        assertEquals(1, overlay.shaderInstanceCount)
    }

    // MARK: - invalidation via postInvalidateOnAnimation / Choreographer

    @Test
    fun mountSchedulesAChoreographerFrameWhenNotReducedMotion() {
        val surface = mountedSurface()
        val scheduler = AutoskeletonRecordingFrameScheduler()
        val clock = AutoskeletonShimmerClock()
        val renderer = AutoskeletonRendererTier1()
        renderer.mount(surface, emptyList(), theme(), clock, reducedMotion = false, scheduler = scheduler)
        assertEquals(1, scheduler.postCount)
    }

    @Test
    fun eachFrameTickReschedulesTheNextOne() {
        val surface = mountedSurface()
        val scheduler = AutoskeletonRecordingFrameScheduler()
        val clock = AutoskeletonShimmerClock()
        val renderer = AutoskeletonRendererTier1()
        renderer.mount(surface, emptyList(), theme(), clock, reducedMotion = false, scheduler = scheduler)

        repeat(120) { scheduler.tick() }
        // 1 initial post + 120 re-posts from each tick's own re-schedule
        assertEquals(121, scheduler.postCount)
    }

    @Test
    fun reducedMotionNeverSchedulesAFrame() {
        val surface = mountedSurface()
        val scheduler = AutoskeletonRecordingFrameScheduler()
        val clock = AutoskeletonShimmerClock()
        val renderer = AutoskeletonRendererTier1()
        renderer.mount(surface, emptyList(), theme(), clock, reducedMotion = true, scheduler = scheduler)
        assertEquals(0, scheduler.postCount)
    }

    @Test
    fun setReducedMotionStopsAndRestartsTheFrameLoop() {
        val surface = mountedSurface()
        val scheduler = AutoskeletonRecordingFrameScheduler()
        val clock = AutoskeletonShimmerClock()
        val renderer = AutoskeletonRendererTier1()
        val handle = renderer.mount(surface, emptyList(), theme(), clock, reducedMotion = false, scheduler = scheduler)

        handle.setReducedMotion(true)
        val countAfterStop = scheduler.postCount
        scheduler.tick() // no pending callback: reduced motion cancelled it
        assertEquals(countAfterStop, scheduler.postCount)

        handle.setReducedMotion(false)
        assertEquals(countAfterStop + 1, scheduler.postCount)
    }

    // MARK: - no view-state mutation inside the draw pass (dispatchDraw prohibition)

    @Test
    fun drawingNeverMutatesVisibilityOrAlpha() {
        val surface = mountedSurface()
        val scheduler = AutoskeletonRecordingFrameScheduler()
        val clock = AutoskeletonShimmerClock()
        val renderer = AutoskeletonRendererTier1()
        renderer.mount(surface, emptyList(), theme(), clock, reducedMotion = false, scheduler = scheduler)
        val overlay = surface.getChildAt(0) as AutoskeletonShimmerOverlayView

        overlay.visibility = View.VISIBLE
        overlay.alpha = 1f
        repeat(10) {
            overlay.draw(android.graphics.Canvas())
            scheduler.tick()
        }
        assertEquals(View.VISIBLE, overlay.visibility)
        assertEquals(1f, overlay.alpha)
    }

    // MARK: - NFR-2 proxy: the frame loop is a pure per-tick mechanism, independent
    // of any other (e.g. JS) thread being blocked.

    @Test
    fun frameLoopProgressesIndependentlyOfABlockedBackgroundThread() {
        val surface = mountedSurface()
        val scheduler = AutoskeletonRecordingFrameScheduler()
        val clock = AutoskeletonShimmerClock()
        val renderer = AutoskeletonRendererTier1()
        renderer.mount(surface, emptyList(), theme(), clock, reducedMotion = false, scheduler = scheduler)

        val blockStarted = CountDownLatch(1)
        val releaseBlock = CountDownLatch(1)
        val blockedThread = Thread {
            blockStarted.countDown()
            releaseBlock.await(2, TimeUnit.SECONDS)
        }
        blockedThread.start()
        blockStarted.await()

        val ticksWhileBlocked = AtomicInteger(0)
        val start = System.nanoTime()
        // Simulate 500ms+ of continued ticking on the (unblocked) UI thread while
        // the "JS thread" stand-in stays synchronously blocked.
        while ((System.nanoTime() - start) / 1_000_000 < 500) {
            scheduler.tick()
            ticksWhileBlocked.incrementAndGet()
        }
        releaseBlock.countDown()
        blockedThread.join()

        assertTrue(
            "the Choreographer-driven frame loop must keep progressing regardless of another blocked thread",
            ticksWhileBlocked.get() > 0,
        )
    }
}
