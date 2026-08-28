package com.autoskeleton

import android.content.pm.ApplicationInfo
import android.widget.FrameLayout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

/**
 * Task 4.5 (tasks.md Phase 4) / spec.md REQ-OBS-OVERLAY-1, plan.md ADR-2: the
 * Android `debugOverlay` — outline + index/source/hit-miss badge per shape, PLUS
 * ADR-2's mandated per-shape radius-rung badge. Dev-only.
 *
 * **Stated deviation from iOS's `#if DEBUG` compile-time gate**: a published
 * Android AAR is already compiled as a single fixed variant (source is not
 * recompiled into the consuming app the way a CocoaPods pod is), so a Swift-style
 * compile-time strip is not available here. The standard, portable mechanism for a
 * library to behave differently in a consumer's debug vs. release build is the
 * RUNTIME `ApplicationInfo.FLAG_DEBUGGABLE` check
 * (`AutoskeletonDebugOverlayFactory.isDebugBuild`) — this is what Android's own
 * tooling (e.g. `StrictMode`, many analytics SDKs) uses for the same purpose. This
 * suite tests that runtime gate directly rather than a release-build symbol-table
 * check.
 */
@RunWith(RobolectricTestRunner::class)
class AutoskeletonDebugOverlayTest {
    private fun shape(index: Int, source: AutoskeletonShapeSource, radiusSource: AutoskeletonRadiusSource) =
        AutoskeletonShapeInfo(
            x = index * 10f,
            y = index * 10f,
            w = 40f,
            h = 20f,
            r = 4f,
            source = source,
            radiusSource = radiusSource,
        )

    // MARK: - outline count == shape count with correct annotations

    @Test
    fun mountDrawsOneBadgePerShapeWithCorrectAnnotations() {
        val overlay = AutoskeletonDebugOverlay(RuntimeEnvironment.getApplication())
        val shapes = listOf(
            shape(0, AutoskeletonShapeSource.TEXT, AutoskeletonRadiusSource.MEASURED),
            shape(1, AutoskeletonShapeSource.CONTAINER, AutoskeletonRadiusSource.DEFAULT),
        )
        overlay.update(shapes, cacheHit = true)

        assertEquals(2, overlay.lastBadges.size)
        assertEquals(0, overlay.lastBadges[0].index)
        assertEquals(AutoskeletonShapeSource.TEXT, overlay.lastBadges[0].source)
        assertTrue(overlay.lastBadges[0].cacheHit)
        assertEquals(AutoskeletonRadiusSource.MEASURED, overlay.lastBadges[0].radiusSource)

        assertEquals(1, overlay.lastBadges[1].index)
        assertEquals(AutoskeletonShapeSource.CONTAINER, overlay.lastBadges[1].source)
        // ADR-2's mandated rung badge — the whole point of task 4.5's addition over
        // the generic REQ-OBS-OVERLAY-1 badge every platform already has.
        assertEquals(AutoskeletonRadiusSource.DEFAULT, overlay.lastBadges[1].radiusSource)
    }

    @Test
    fun cacheMissIsReflectedInEveryBadge() {
        val overlay = AutoskeletonDebugOverlay(RuntimeEnvironment.getApplication())
        overlay.update(listOf(shape(0, AutoskeletonShapeSource.TEXT, AutoskeletonRadiusSource.MEASURED)), cacheHit = false)
        assertTrue(overlay.lastBadges.all { !it.cacheHit })
    }

    // MARK: - re-mounting on a data update never leaves stale badges behind

    @Test
    fun updatingReplacesRatherThanAppendsBadges() {
        val overlay = AutoskeletonDebugOverlay(RuntimeEnvironment.getApplication())
        overlay.update(
            listOf(
                shape(0, AutoskeletonShapeSource.TEXT, AutoskeletonRadiusSource.MEASURED),
                shape(1, AutoskeletonShapeSource.TEXT, AutoskeletonRadiusSource.MEASURED),
            ),
            cacheHit = true,
        )
        assertEquals(2, overlay.lastBadges.size)

        overlay.update(listOf(shape(0, AutoskeletonShapeSource.CONTAINER, AutoskeletonRadiusSource.DEFAULT)), cacheHit = false)
        assertEquals(1, overlay.lastBadges.size)
        assertEquals(AutoskeletonShapeSource.CONTAINER, overlay.lastBadges[0].source)
    }

    // MARK: - clear() removes everything

    @Test
    fun clearRemovesAllBadges() {
        val overlay = AutoskeletonDebugOverlay(RuntimeEnvironment.getApplication())
        overlay.update(listOf(shape(0, AutoskeletonShapeSource.TEXT, AutoskeletonRadiusSource.MEASURED)), cacheHit = true)
        assertEquals(1, overlay.lastBadges.size)
        overlay.clear()
        assertEquals(0, overlay.lastBadges.size)
    }

    // MARK: - dev-only runtime gate

    @Test
    fun factoryMountsOverlayWhenApplicationIsDebuggable() {
        val app = RuntimeEnvironment.getApplication()
        app.applicationInfo.flags = app.applicationInfo.flags or ApplicationInfo.FLAG_DEBUGGABLE
        val surface = FrameLayout(app)
        val overlay = AutoskeletonDebugOverlayFactory.createIfDebug(surface)
        assertNotNull(overlay)
        assertEquals(1, surface.childCount)
    }

    @Test
    fun factoryReturnsNullWhenApplicationIsNotDebuggable() {
        val app = RuntimeEnvironment.getApplication()
        app.applicationInfo.flags = app.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE.inv()
        val surface = FrameLayout(app)
        val overlay = AutoskeletonDebugOverlayFactory.createIfDebug(surface)
        assertNull(overlay)
        assertEquals(0, surface.childCount)
    }
}
