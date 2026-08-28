package com.autoskeleton

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

/**
 * Visual-paint-gate remediation (tasks.md Phase 5, task 5.7 follow-up):
 * `AutoskeletonOverlayViewManager` registers the Fabric component name
 * codegen expects ("AutoskeletonOverlayView", matching
 * `src/native/AutoskeletonOverlayNativeComponent.ts`) and forwards every
 * codegen'd prop setter straight to `AutoskeletonOverlayView`'s own public
 * setters (asserted individually because a swapped/typo'd setter is a
 * silent-wrong-prop bug the generated
 * `AutoskeletonOverlayViewManagerDelegate`'s `switch` would never catch).
 */
@RunWith(RobolectricTestRunner::class)
class AutoskeletonOverlayViewManagerTest {
    private lateinit var manager: AutoskeletonOverlayViewManager
    private lateinit var view: AutoskeletonOverlayView

    @Before
    fun setUp() {
        manager = AutoskeletonOverlayViewManager()
        view = AutoskeletonOverlayView(RuntimeEnvironment.getApplication())
    }

    // `createViewInstance(ThemedReactContext)` is intentionally NOT unit
    // tested here: `ThemedReactContext` has no lightweight concrete
    // constructor in this RN version (its only concrete
    // `ReactApplicationContext` sibling, `BridgelessReactContext`, requires
    // a full `ReactHostImpl`) and `createViewInstance` is a one-line
    // delegation (`AutoskeletonOverlayView(context)`) with nothing else to
    // get wrong. It is proven end-to-end by the real-device
    // `PaintGateInstrumentedTest`, which cannot mount ANY view without this
    // method working correctly.

    @Test
    fun getNameMatchesTheCodegenComponentNameExactly() {
        assertEquals("AutoskeletonOverlayView", manager.name)
    }

    @Test
    fun setCacheKeyForwardsToTheView() {
        manager.setCacheKey(view, "v1|key|-|375|1|ltr|android")
        assertEquals("v1|key|-|375|1|ltr|android", view.cacheKey)
    }

    @Test
    fun setBaseColorAndHighlightColorForwardToTheView() {
        manager.setBaseColor(view, "#e2e2e2")
        manager.setHighlightColor(view, "#f5f5f5")
        assertEquals("#e2e2e2", view.baseColor)
        assertEquals("#f5f5f5", view.highlightColor)
    }

    @Test
    fun setDefaultRadiusAndSpeedMsForwardToTheView() {
        manager.setDefaultRadius(view, 4.0)
        manager.setSpeedMs(view, 1400.0)
        assertEquals(4.0, view.defaultRadius, 0.0001)
        assertEquals(1400.0, view.speedMs, 0.0001)
    }

    @Test
    fun setAnimationForwardsToTheViewAndDefaultsToShimmerWhenNull() {
        manager.setAnimation(view, "pulse")
        assertEquals("pulse", view.animation)
        manager.setAnimation(view, null)
        assertEquals("shimmer", view.animation)
    }

    @Test
    fun setReducedMotionAndDebugOverlayForwardToTheView() {
        manager.setReducedMotion(view, true)
        manager.setDebugOverlay(view, true)
        assertTrue(view.reducedMotion)
        assertTrue(view.debugOverlay)
        manager.setReducedMotion(view, false)
        assertFalse(view.reducedMotion)
    }

    @Test
    fun onDropViewInstanceDestroysTheMountedOverlay() {
        AutoskeletonNativeShapeCache.clear()
        AutoskeletonNativeShapeCache.set("k1", doubleArrayOf(1.0, 0.0, 0.0, 50.0, 50.0, 4.0))
        view.layout(0, 0, 200, 200)
        manager.setCacheKey(view, "k1")
        assertEquals(1, view.childCount)

        manager.onDropViewInstance(view)

        assertEquals(0, view.childCount)
    }
}
