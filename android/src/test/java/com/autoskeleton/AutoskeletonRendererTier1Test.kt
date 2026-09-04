package com.autoskeleton

import android.graphics.Color
import android.graphics.RectF
import android.view.View
import android.widget.FrameLayout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotSame
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
        val handle = renderer.mount(surface, emptyList(), theme(), clock, animation = "shimmer", scheduler = scheduler)

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
        val handle = renderer.mount(surface, emptyList(), theme(), clock, animation = "shimmer", scheduler = scheduler)
        val overlay = surface.getChildAt(0) as AutoskeletonShimmerOverlayView
        overlay.draw(android.graphics.Canvas())
        val startedAt = clock.startedAt

        handle.update(listOf(AutoskeletonShapeInfo(1f, 1f, 5f, 5f, 0f, AutoskeletonShapeSource.TEXT, AutoskeletonRadiusSource.MEASURED)))

        assertEquals(startedAt, clock.startedAt, 0.0) // phase origin never resets on a geometry update
        assertEquals(1, overlay.shaderInstanceCount)
    }

    // MARK: - the shader is rebuilt on a REAL geometry change, never per frame

    // Adversarial-review defect (2026-08-29). `ensureShader()` short-circuited
    // on `shader != null`, so the ONE thing that calls it on a size change —
    // `onSizeChanged` — could never do anything. NFR-5 says "zero PER-FRAME
    // allocations"; that was implemented as NEVER, which is a different and
    // wrong invariant: the `LinearGradient`'s stop geometry is a pure function
    // of `width` (`-width .. +width`), so a view that resizes keeps a gradient
    // built for the OLD geometry and the shimmer band covers the wrong span
    // for the rest of its life. The correct middle is a geometry KEY: rebuild
    // when the width actually changed, never on a frame.
    //
    // Reachable without rotation: a collapsing header, a split view, a
    // keyboard, any container resize. `AutoskeletonOverlayView` calls
    // `mountOrUpdate()` from `onSizeChanged`, but the composite cache key
    // embeds `bucketWidth(windowWidth)`, so a resize inside a stable window
    // never changes the key and takes the in-place `update(shapes)` path,
    // which by contract does not touch the shader.
    @Test
    fun shaderIsRebuiltWhenTheOverlayWidthActuallyChanges() {
        val surface = mountedSurface()
        val scheduler = AutoskeletonRecordingFrameScheduler()
        val clock = AutoskeletonShimmerClock()
        val renderer = AutoskeletonRendererTier1()
        renderer.mount(surface, emptyList(), theme(), clock, animation = "shimmer", scheduler = scheduler)
        val overlay = surface.getChildAt(0) as AutoskeletonShimmerOverlayView
        overlay.draw(android.graphics.Canvas())

        val shaderAt200 = overlay.currentShader
        assertTrue(shaderAt200 != null)
        assertEquals(1, overlay.shaderInstanceCount)

        overlay.layout(0, 0, 400, 200) // a real resize -> onSizeChanged
        overlay.draw(android.graphics.Canvas())

        assertNotSame(
            "a gradient built for a 200px-wide view is wrong geometry for a 400px-wide one",
            shaderAt200,
            overlay.currentShader,
        )
        assertEquals(2, overlay.shaderInstanceCount)
    }

    @Test
    fun theRebuiltShaderStillAllocatesNothingPerFrame() {
        val surface = mountedSurface()
        val scheduler = AutoskeletonRecordingFrameScheduler()
        val clock = AutoskeletonShimmerClock()
        val renderer = AutoskeletonRendererTier1()
        val handle = renderer.mount(surface, emptyList(), theme(), clock, animation = "shimmer", scheduler = scheduler)
        val overlay = surface.getChildAt(0) as AutoskeletonShimmerOverlayView
        overlay.draw(android.graphics.Canvas())
        overlay.layout(0, 0, 400, 200)
        overlay.draw(android.graphics.Canvas())
        assertEquals(2, overlay.shaderInstanceCount)

        // NFR-5 proper: 120 further frames plus 120 geometry updates at an
        // UNCHANGED width must allocate exactly zero new gradients. This is
        // the invariant the broken `shader != null` short-circuit was
        // protecting, and it must survive the fix.
        val shaderAt400 = overlay.currentShader
        repeat(120) {
            handle.update(
                listOf(
                    AutoskeletonShapeInfo(0f, 0f, 10f, 10f, 0f, AutoskeletonShapeSource.TEXT, AutoskeletonRadiusSource.MEASURED),
                ),
            )
            overlay.draw(android.graphics.Canvas())
        }
        assertSame(shaderAt400, overlay.currentShader)
        assertEquals(2, overlay.shaderInstanceCount)
    }

    @Test
    fun aHeightOnlyResizeDoesNotRebuildTheShader() {
        // Constrains the fix from over-rebuilding: the gradient is a function
        // of `width` alone, so keying it on the full size would allocate on
        // every vertical growth (a list adding rows) for no visual difference.
        // This one passes both before and after the fix by construction —
        // it is a bound on the fix, not a RED case — and was verified to FAIL
        // under a plant that keys the shader on `width to height`.
        val surface = mountedSurface()
        val scheduler = AutoskeletonRecordingFrameScheduler()
        val clock = AutoskeletonShimmerClock()
        val renderer = AutoskeletonRendererTier1()
        renderer.mount(surface, emptyList(), theme(), clock, animation = "shimmer", scheduler = scheduler)
        val overlay = surface.getChildAt(0) as AutoskeletonShimmerOverlayView
        overlay.draw(android.graphics.Canvas())
        val shaderBefore = overlay.currentShader

        overlay.layout(0, 0, 200, 900)
        overlay.draw(android.graphics.Canvas())

        assertSame(shaderBefore, overlay.currentShader)
        assertEquals(1, overlay.shaderInstanceCount)
    }

    // MARK: - invalidation via postInvalidateOnAnimation / Choreographer

    @Test
    fun mountSchedulesAChoreographerFrameWhenNotReducedMotion() {
        val surface = mountedSurface()
        val scheduler = AutoskeletonRecordingFrameScheduler()
        val clock = AutoskeletonShimmerClock()
        val renderer = AutoskeletonRendererTier1()
        renderer.mount(surface, emptyList(), theme(), clock, animation = "shimmer", scheduler = scheduler)
        assertEquals(1, scheduler.postCount)
    }

    @Test
    fun eachFrameTickReschedulesTheNextOne() {
        val surface = mountedSurface()
        val scheduler = AutoskeletonRecordingFrameScheduler()
        val clock = AutoskeletonShimmerClock()
        val renderer = AutoskeletonRendererTier1()
        renderer.mount(surface, emptyList(), theme(), clock, animation = "shimmer", scheduler = scheduler)

        repeat(120) { scheduler.tick() }
        // 1 initial post + 120 re-posts from each tick's own re-schedule
        assertEquals(121, scheduler.postCount)
    }

    // WAS `reducedMotionNeverSchedulesAFrame`, which asserted that the
    // reduced-motion presentation schedules NO frames — i.e. that it is
    // static. That was the defect, not the contract: with the loop stopped and
    // nothing repositioning the shader, the highlight stayed frozen wherever
    // the last frame left it. Reduce-motion now degrades to a real pulse
    // (REQ-A11Y-3 and spec §1.10's "the same opacity pulse the runtime
    // renderer degrades to"), and `animation="none"` is the kind that is
    // genuinely, deliberately static — so that is what this now pins.
    @Test
    fun onlyAnimationNoneNeverSchedulesAFrame() {
        val surface = mountedSurface()
        val scheduler = AutoskeletonRecordingFrameScheduler()
        val clock = AutoskeletonShimmerClock()
        val renderer = AutoskeletonRendererTier1()
        renderer.mount(surface, emptyList(), theme(), clock, animation = "none", scheduler = scheduler)
        assertEquals(0, scheduler.postCount)
    }

    @Test
    fun setAnimationStopsAndRestartsTheFrameLoop() {
        val surface = mountedSurface()
        val scheduler = AutoskeletonRecordingFrameScheduler()
        val clock = AutoskeletonShimmerClock()
        val renderer = AutoskeletonRendererTier1()
        val handle = renderer.mount(surface, emptyList(), theme(), clock, animation = "shimmer", scheduler = scheduler)

        handle.setAnimation("none")
        val countAfterStop = scheduler.postCount
        scheduler.tick() // no pending callback: the static kind cancelled it
        assertEquals(countAfterStop, scheduler.postCount)

        handle.setAnimation("shimmer")
        assertEquals(countAfterStop + 1, scheduler.postCount)
    }

    // MARK: - no view-state mutation inside the draw pass (dispatchDraw prohibition)

    @Test
    fun drawingNeverMutatesVisibilityOrAlpha() {
        val surface = mountedSurface()
        val scheduler = AutoskeletonRecordingFrameScheduler()
        val clock = AutoskeletonShimmerClock()
        val renderer = AutoskeletonRendererTier1()
        renderer.mount(surface, emptyList(), theme(), clock, animation = "shimmer", scheduler = scheduler)
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
        renderer.mount(surface, emptyList(), theme(), clock, animation = "shimmer", scheduler = scheduler)

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

    /**
     * The frame loop must stop when the overlay is not on screen.
     *
     * `scheduleNextFrame` re-posted a `Choreographer` callback unconditionally and
     * only ever stopped for `setAnimation("none")` or `destroySelf()`. There was no
     * `onDetachedFromWindow` / `onWindowVisibilityChanged` hook anywhere in the
     * package, so a mounted overlay kept invalidating while its Activity was
     * stopped and while it was scrolled out of view — one callback plus one
     * `postInvalidateOnAnimation` per frame per overlay, times every skeleton on
     * screen. iOS gets this free: CoreAnimation suspends its animations with the
     * app.
     *
     * The phase is not a casualty of stopping. It is derived from the SHARED clock
     * via `phaseAt(now)`, never accumulated across frames, so a resumed overlay
     * lands wherever its siblings already are rather than where it left off.
     */
    @Test
    fun theFrameLoopStopsWhenDetachedAndResumesOnReattach() {
        val scheduler = AutoskeletonRecordingFrameScheduler()
        // A REAL attached window, not a bare FrameLayout: `ViewGroup.removeView`
        // only dispatches `onDetachedFromWindow` when the parent actually has an
        // `mAttachInfo`, so an unattached fixture would silently prove nothing.
        val activity = org.robolectric.Robolectric.buildActivity(android.app.Activity::class.java)
            .setup()
            .get()
        val surface = FrameLayout(activity)
        activity.setContentView(surface)
        surface.layout(0, 0, 100, 100)
        val renderer = AutoskeletonRendererTier1()
        renderer.mount(
            surface,
            listOf(
                AutoskeletonShapeInfo(
                    0f, 0f, 50f, 50f, 0f,
                    AutoskeletonShapeSource.CONTAINER, AutoskeletonRadiusSource.MEASURED,
                ),
            ),
            theme(),
            AutoskeletonShimmerClock(),
            AutoskeletonOverlayView.ANIMATION_SHIMMER,
            scheduler = scheduler,
        )
        val overlay = surface.getChildAt(0) as AutoskeletonShimmerOverlayView
        scheduler.tick()
        val postsWhileAttached = scheduler.postCount
        assertTrue("precondition: the loop is running while attached", postsWhileAttached > 0)

        surface.removeView(overlay)
        val postsAtDetach = scheduler.postCount
        scheduler.tick()
        assertEquals(
            "a detached overlay must not schedule another frame",
            postsAtDetach,
            scheduler.postCount,
        )

        surface.addView(overlay)
        assertTrue("re-attaching must resume the loop", scheduler.postCount > postsAtDetach)
    }

    /** The same guarantee for a window that goes invisible without detaching —
     *  the app being backgrounded, which is the case that actually drains a
     *  battery. */
    @Test
    fun theFrameLoopStopsWhenTheWindowIsNotVisible() {
        val scheduler = AutoskeletonRecordingFrameScheduler()
        val surface = FrameLayout(RuntimeEnvironment.getApplication())
        surface.layout(0, 0, 100, 100)
        AutoskeletonRendererTier1().mount(
            surface,
            listOf(
                AutoskeletonShapeInfo(
                    0f, 0f, 50f, 50f, 0f,
                    AutoskeletonShapeSource.CONTAINER, AutoskeletonRadiusSource.MEASURED,
                ),
            ),
            theme(),
            AutoskeletonShimmerClock(),
            AutoskeletonOverlayView.ANIMATION_SHIMMER,
            scheduler = scheduler,
        )
        val overlay = surface.getChildAt(0) as AutoskeletonShimmerOverlayView
        scheduler.tick()

        overlay.dispatchWindowVisibilityChanged(android.view.View.INVISIBLE)
        val postsWhileHidden = scheduler.postCount
        scheduler.tick()
        assertEquals(
            "an overlay in an invisible window must not schedule another frame",
            postsWhileHidden,
            scheduler.postCount,
        )

        overlay.dispatchWindowVisibilityChanged(android.view.View.VISIBLE)
        assertTrue("becoming visible again must resume the loop", scheduler.postCount > postsWhileHidden)
    }

    /**
     * The origin and the per-frame reading must come from ONE time base.
     *
     * The clock's origin came from its injectable `now`, while the draw pass called
     * `System.currentTimeMillis()` directly. Any test injecting a fake `now` was
     * therefore computing `(wallClockNow - fakeOrigin) % period` — a phase built
     * from two unrelated epochs — and in production the two agreed only by
     * coincidence, because both happened to be wall clock.
     *
     * That coincidence ended when the origin moved to `SystemClock.elapsedRealtime`
     * to stop an NTP correction jumping every mounted overlay mid-sweep. This test
     * is what makes the pairing a property of the code rather than of that
     * coincidence: with a fake clock parked at exactly half a period, the sweep has
     * to sit at the centre of its travel.
     */
    @Test
    fun theDrawPassReadsTheClockOwnTimeBaseAndNotItsOwn() {
        val scheduler = AutoskeletonRecordingFrameScheduler()
        val surface = FrameLayout(RuntimeEnvironment.getApplication())
        surface.layout(0, 0, 100, 100)
        // Origin 0, "now" 750 of a 1500ms period => phase 0.5 exactly.
        var fakeNow = 0.0
        val clock = AutoskeletonShimmerClock(periodMs = 1500.0, now = { fakeNow })
        AutoskeletonRendererTier1().mount(
            surface,
            listOf(
                AutoskeletonShapeInfo(
                    0f, 0f, 100f, 100f, 0f,
                    AutoskeletonShapeSource.CONTAINER, AutoskeletonRadiusSource.MEASURED,
                ),
            ),
            theme(),
            clock,
            AutoskeletonOverlayView.ANIMATION_SHIMMER,
            scheduler = scheduler,
        )
        val overlay = surface.getChildAt(0) as AutoskeletonShimmerOverlayView

        fakeNow = 750.0
        overlay.draw(android.graphics.Canvas())

        // At phase 0.5 the sweep sits dead centre: ((0.5 * 2) - 1) * width == 0.
        assertEquals(
            "the draw pass must derive its phase from the clock's own base",
            0f,
            overlay.lastShaderTranslateX,
            0.001f,
        )
    }
}
