package com.autoskeleton

import android.graphics.Canvas
import android.graphics.Color
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.GraphicsMode

/**
 * Visual-paint-gate remediation (tasks.md Phase 5, task 5.7 follow-up) /
 * plan.md ADR-5, ADR-9: `AutoskeletonOverlayView` is the native tier-1
 * draw surface Fabric mounts for `AutoskeletonOverlayView` (the codegen'd
 * component). It reads shape geometry from `AutoskeletonNativeShapeCache`
 * by `cacheKey` (ADR-9: native holds shape DATA, JS holds POLICY) — never
 * from props — and hosts `AutoskeletonRendererTier1` (task 4.4), the
 * SAME renderer already covered by `AutoskeletonRendererTier1Test`. This
 * test proves the WIRING reaches that renderer's `mount()`/`update()`;
 * pixel-level proof is the real-device
 * `PaintGateInstrumentedTest.skeletonPaintsOverDetectedShapes` assertion.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class AutoskeletonOverlayViewTest {
    @Before
    fun setUp() {
        AutoskeletonNativeShapeCache.clear()
    }

    private fun wireFor(shapes: List<DoubleArray>): DoubleArray {
        val out = ArrayList<Double>()
        out.add(1.0) // WIRE_VERSION
        for (shape in shapes) {
            for (component in shape) out.add(component)
        }
        return out.toDoubleArray()
    }

    private fun sizedView(): AutoskeletonOverlayView {
        val view = AutoskeletonOverlayView(RuntimeEnvironment.getApplication())
        view.layout(0, 0, 200, 200)
        return view
    }

    @Test
    fun decodeWireShapesParsesTheVersionPrefixedWireArrayIntoShapeRectanglesAtDensityOne() {
        val wire = wireFor(listOf(doubleArrayOf(1.0, 2.0, 3.0, 4.0, 5.0), doubleArrayOf(10.0, 20.0, 30.0, 40.0, 0.0)))
        val shapes = AutoskeletonOverlayView.decodeWireShapes(wire, density = 1f)
        assertEquals(2, shapes.size)
        assertEquals(1f, shapes[0].x)
        assertEquals(2f, shapes[0].y)
        assertEquals(3f, shapes[0].w)
        assertEquals(4f, shapes[0].h)
        assertEquals(5f, shapes[0].r)
        assertEquals(10f, shapes[1].x)
    }

    @Test
    fun decodeWireShapesReturnsEmptyForAnEmptyWireArray() {
        assertTrue(AutoskeletonOverlayView.decodeWireShapes(DoubleArray(0), density = 1f).isEmpty())
    }

    // Visual-paint-gate remediation: `AutoskeletonModule.encodeWireArray`
    // divides every geometry value by density before writing the wire
    // (plan.md §4.1 "Units" — density-independent points). This decoder
    // must multiply back by the SAME density to produce raw view-pixel
    // shapes for `AutoskeletonRendererTier1`'s `Canvas`-space draw pass —
    // confirmed as the actual remaining root cause of the paint gate's RED
    // state via a real-device density mismatch (measured density 2.625:
    // shapes drew roughly 1/density too small and offset, so the sampled
    // content-center pixel never fell inside the drawn region at all).
    @Test
    fun decodeWireShapesScalesEveryGeometryComponentByDensity() {
        val wire = wireFor(listOf(doubleArrayOf(8.0, 10.0, 160.0, 160.0, 4.0)))
        val shapes = AutoskeletonOverlayView.decodeWireShapes(wire, density = 2.625f)
        assertEquals(1, shapes.size)
        assertEquals(21f, shapes[0].x, 0.001f)
        assertEquals(26.25f, shapes[0].y, 0.001f)
        assertEquals(420f, shapes[0].w, 0.001f)
        assertEquals(420f, shapes[0].h, 0.001f)
        assertEquals(10.5f, shapes[0].r, 0.001f)
    }

    @Test
    fun mountsTheTier1RendererOnceCacheKeyIsSetAndTheViewIsSized() {
        AutoskeletonNativeShapeCache.set("k1", wireFor(listOf(doubleArrayOf(0.0, 0.0, 50.0, 50.0, 4.0))))
        val view = sizedView()

        view.baseColor = "#e2e2e2"
        view.highlightColor = "#f5f5f5"
        view.defaultRadius = 4.0
        view.speedMs = 1400.0
        view.cacheKey = "k1"

        assertEquals(1, view.childCount)
        assertTrue(view.getChildAt(0) is AutoskeletonShimmerOverlayView)
    }

    @Test
    fun neverMountsWhenTheCacheHasNoEntryForTheGivenKey() {
        val view = sizedView()
        view.cacheKey = "missing-key"
        assertEquals(0, view.childCount)
    }

    @Test
    fun updatesShapesInPlaceWithoutRemountingWhenTheSameCacheKeyIsReSet() {
        AutoskeletonNativeShapeCache.set("k1", wireFor(listOf(doubleArrayOf(0.0, 0.0, 50.0, 50.0, 4.0))))
        val view = sizedView()
        view.cacheKey = "k1"
        val overlay = view.getChildAt(0)

        // Re-setting the SAME cacheKey with fresh data (e.g. R2 raster-probe
        // refine()) must update in place, never restart the shimmer phase by
        // remounting — mirrors `AutoskeletonRendererTier1Test`'s own
        // "update must not restart shimmer" contract.
        AutoskeletonNativeShapeCache.set("k1", wireFor(listOf(doubleArrayOf(0.0, 0.0, 80.0, 80.0, 8.0))))
        view.cacheKey = "k1"

        assertEquals(1, view.childCount)
        assertTrue(view.getChildAt(0) === overlay)
    }

    @Test
    fun destroyRemovesTheMountedOverlayChild() {
        AutoskeletonNativeShapeCache.set("k1", wireFor(listOf(doubleArrayOf(0.0, 0.0, 50.0, 50.0, 4.0))))
        val view = sizedView()
        view.cacheKey = "k1"
        assertEquals(1, view.childCount)

        view.destroy()

        assertEquals(0, view.childCount)
    }

    @Test
    fun parsesHexColorPropsIntoTheRendererThemeAndFallsBackSafelyOnAnInvalidColor() {
        AutoskeletonNativeShapeCache.set("k1", wireFor(listOf(doubleArrayOf(0.0, 0.0, 50.0, 50.0, 4.0))))
        val view = sizedView()
        view.baseColor = "not-a-color"
        view.highlightColor = "#f5f5f5"
        // Must not throw even with an invalid color string (defensive default).
        view.cacheKey = "k1"
        assertEquals(1, view.childCount)
    }

    /** A theme prop that arrives AFTER the overlay is already mounted has to
     *  reach the live renderer, exactly as `writingDirection` and `animation`
     *  already do. The user-visible symptom of it not doing so is a dark-mode
     *  toggle leaving every on-screen skeleton in the light palette until it
     *  happens to unmount.
     *
     *  `cacheKey` cannot rescue this: `composeCacheKey`
     *  (`src/core/cache-key.ts`) identifies GEOMETRY — version, skeleton key,
     *  item type, width bucket, font scale, direction, platform — and carries
     *  no theme segment, deliberately, because geometry does not depend on
     *  colour. So a palette change never invalidates the key and never forces
     *  the remount that would otherwise have picked the new colours up.
     *
     *  Both colours are read at `LinearGradient` construction time, so the
     *  cached gradient is the thing that has to be discarded — `shaderWidth`
     *  alone would keep it alive forever at an unchanged width. */
    @Test
    fun aThemeChangeAfterMountRepaintsTheAlreadyMountedOverlay() {
        AutoskeletonNativeShapeCache.set("k1", wireFor(listOf(doubleArrayOf(0.0, 0.0, 50.0, 50.0, 4.0))))
        val view = sizedView()
        view.baseColor = "#e2e2e2"
        view.highlightColor = "#f5f5f5"
        view.cacheKey = "k1"

        val overlay = view.getChildAt(0) as AutoskeletonShimmerOverlayView
        overlay.draw(Canvas())
        val lightGradient = overlay.currentShader
        val gradientsBuiltWhileLight = overlay.shaderInstanceCount

        // Dark mode is toggled with the skeleton still on screen: Fabric
        // re-delivers the colour props against the SAME cacheKey, one prop at
        // a time, and then closes the batch. `flushPendingTheme()` is what
        // `AutoskeletonOverlayViewManager.onAfterUpdateTransaction` calls at
        // that close; driving it explicitly here is what keeps this a unit
        // test of the view rather than of Fabric's dispatcher.
        view.baseColor = "#1c1c1e"
        view.highlightColor = "#2c2c2e"
        view.flushPendingTheme()

        assertSame("the overlay must be repainted in place, never remounted", overlay, view.getChildAt(0))
        assertEquals(Color.parseColor("#1c1c1e"), overlay.currentTheme.baseColor)
        assertEquals(Color.parseColor("#2c2c2e"), overlay.currentTheme.highlightColor)
        assertNotSame(
            "the highlight colour is baked into the LinearGradient, so a cached shader keeps painting the old one",
            lightGradient,
            overlay.currentShader,
        )
        // Exactly ONE rebuild for the whole batch, not one per colour prop:
        // the gradient is the expensive artifact and both colours live in it.
        assertEquals(gradientsBuiltWhileLight + 1, overlay.shaderInstanceCount)
    }

    /**
     * Fabric recycles overlay views: `ViewManager.onDropViewInstance` hands the
     * view to `prepareToRecycleView`, which pushes it onto a pool for the NEXT
     * `<AutoSkeleton>` that mounts. `BaseViewManager`'s implementation resets only
     * base view state, so every autoskeleton prop used to survive into the next
     * tenant — a recycled view could open with the previous screen's palette,
     * animation kind, writing direction, and a `cacheKey` pointing at geometry
     * measured for a different component.
     *
     * `destroy()` was not enough: it clears `handle` and `mountedCacheKey`, which
     * are the MOUNT state, and leaves all nine prop fields exactly as the previous
     * tenant left them. iOS never had this hole — `prepareForRecycle` in
     * `AutoskeletonOverlayView.mm` calls `host.destroy()` and the props live on
     * the Objective-C++ view, which Fabric resets itself.
     */
    @Test
    fun resetForRecycleReturnsEveryPropToItsDefault() {
        AutoskeletonNativeShapeCache.set("k1", wireFor(listOf(doubleArrayOf(0.0, 0.0, 50.0, 50.0, 4.0))))
        val view = sizedView()
        view.baseColor = "#111111"
        view.highlightColor = "#222222"
        view.defaultRadius = 9.0
        view.speedMs = 999.0
        view.animation = "pulse"
        view.reducedMotion = true
        view.writingDirection = AutoskeletonOverlayView.DIRECTION_RTL
        view.debugOverlay = true
        view.cacheKey = "k1"
        assertEquals("precondition: the overlay actually mounted", 1, view.childCount)

        view.resetForRecycle()

        assertNull(view.cacheKey)
        assertNull(view.baseColor)
        assertNull(view.highlightColor)
        assertEquals(0.0, view.defaultRadius, 0.0)
        assertEquals(1400.0, view.speedMs, 0.0)
        assertEquals("shimmer", view.animation)
        assertEquals(false, view.reducedMotion)
        assertEquals(AutoskeletonOverlayView.DIRECTION_LTR, view.writingDirection)
        assertEquals(false, view.debugOverlay)
        assertEquals("the previous tenant's overlay must not survive recycling", 0, view.childCount)
    }
}
