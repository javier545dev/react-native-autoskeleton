package com.autoskeleton

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

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
}
