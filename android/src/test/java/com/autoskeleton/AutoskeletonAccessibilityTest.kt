package com.autoskeleton

import android.provider.Settings
import android.view.View
import android.widget.FrameLayout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

/**
 * Task 4.6 (tasks.md Phase 4) / spec.md §1.10 REQ-A11Y-1/2/3: Android accessibility
 * primitives. Same rationale as iOS's `AutoskeletonAccessibility.swift` for the
 * injectable seams: `AccessibilityManager.sendAccessibilityEvent` has nothing to
 * assert on directly from a fast unit test, and reading the LIVE
 * `Settings.Global.ANIMATOR_DURATION_SCALE` reflects real device/emulator state —
 * so production code depends on protocols and tests inject recording/fake doubles,
 * EXCEPT for one test that proves the real `Settings.Global` detection mechanism
 * itself works, via Robolectric's real (non-doubled) `Settings` shadow.
 */
@RunWith(RobolectricTestRunner::class)
class AutoskeletonAccessibilityTest {
    // MARK: - REQ-A11Y-1: real content hidden from the accessibility tree while loading

    @Test
    fun setLoadingTrueMarksNoHideDescendants() {
        val view = FrameLayout(RuntimeEnvironment.getApplication())
        AutoskeletonAccessibility.setLoading(true, view)
        assertEquals(View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS, view.importantForAccessibility)
    }

    @Test
    fun setLoadingFalseRestoresAuto() {
        val view = FrameLayout(RuntimeEnvironment.getApplication())
        AutoskeletonAccessibility.setLoading(true, view)
        AutoskeletonAccessibility.setLoading(false, view)
        assertEquals(View.IMPORTANT_FOR_ACCESSIBILITY_AUTO, view.importantForAccessibility)
    }

    // MARK: - REQ-A11Y-2: loading announcement

    private class RecordingAnnouncing : AutoskeletonAccessibilityAnnouncing {
        val announcements = mutableListOf<String>()
        override fun announce(view: View, message: String) {
            announcements.add(message)
        }
    }

    @Test
    fun announceLoadingUsesTheDefaultMessage() {
        val view = FrameLayout(RuntimeEnvironment.getApplication())
        val announcer = RecordingAnnouncing()
        AutoskeletonAccessibility.announceLoading(view, announcer = announcer)
        assertEquals(listOf(AutoskeletonAccessibility.DEFAULT_LOADING_ANNOUNCEMENT), announcer.announcements)
    }

    @Test
    fun announceLoadingAcceptsACustomMessage() {
        val view = FrameLayout(RuntimeEnvironment.getApplication())
        val announcer = RecordingAnnouncing()
        AutoskeletonAccessibility.announceLoading(view, message = "Cargando", announcer = announcer)
        assertEquals(listOf("Cargando"), announcer.announcements)
    }

    // MARK: - REQ-A11Y-3: reduce-motion degrades the shimmer

    private class FakeReduceMotionProviding(private val value: Boolean) : AutoskeletonReduceMotionProviding {
        override fun isReduceMotionEnabled(context: android.content.Context) = value
    }

    @Test
    fun shouldDegradeAnimationReflectsTheProviderTrue() {
        val context = RuntimeEnvironment.getApplication()
        assertTrue(AutoskeletonAccessibility.shouldDegradeAnimation(context, FakeReduceMotionProviding(true)))
    }

    @Test
    fun shouldDegradeAnimationReflectsTheProviderFalse() {
        val context = RuntimeEnvironment.getApplication()
        assertFalse(AutoskeletonAccessibility.shouldDegradeAnimation(context, FakeReduceMotionProviding(false)))
    }

    // MARK: - the REAL animator-duration-scale detection mechanism (task 4.6's own
    // named mechanism), against Robolectric's real Settings.Global shadow.

    @Test
    fun systemProviderReadsRealAnimatorDurationScaleZeroAsReduceMotion() {
        val context = RuntimeEnvironment.getApplication()
        Settings.Global.putFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 0f)
        assertTrue(AutoskeletonSystemReduceMotionProviding().isReduceMotionEnabled(context))
    }

    @Test
    fun systemProviderReadsRealAnimatorDurationScaleOneAsNormalMotion() {
        val context = RuntimeEnvironment.getApplication()
        Settings.Global.putFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f)
        assertFalse(AutoskeletonSystemReduceMotionProviding().isReduceMotionEnabled(context))
    }

    // MARK: - end-to-end: the resolved value feeds the tier-1 renderer's reducedMotion

    @Test
    fun resolvedReduceMotionFeedsIntoTheTier1RendererAsAPulseNotAShimmer() {
        val surface = FrameLayout(RuntimeEnvironment.getApplication())
        surface.layout(0, 0, 200, 200)
        val reduceMotion = AutoskeletonAccessibility.shouldDegradeAnimation(surface.context, FakeReduceMotionProviding(true))

        val scheduler = AutoskeletonRecordingFrameScheduler()
        val renderer = AutoskeletonRendererTier1()
        renderer.mount(
            surface,
            emptyList(),
            AutoskeletonSkeletonTheme(0, 0, 0f, 1500.0),
            AutoskeletonShimmerClock(),
            reducedMotion = reduceMotion,
            scheduler = scheduler,
        )
        // REQ-A11Y-3: no transform-based shimmer sweep when reduce-motion is
        // active — asserted the same way task 4.4 asserts the shimmer loop itself:
        // no frame ever gets scheduled.
        assertEquals(0, scheduler.postCount)
    }
}
