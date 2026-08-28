package com.autoskeleton

import android.content.Context
import android.provider.Settings
import android.view.View
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityManager

// Task 4.6 (tasks.md Phase 4) / spec.md §1.10 REQ-A11Y-1/2/3: native accessibility
// primitives, mirroring iOS's `AutoskeletonAccessibility.swift`. These are the
// tested, reusable native surface — wiring them into the full public
// `<AutoSkeleton>` component happens in Phase 5, consistent with every other Phase
// 4 deliverable being sensor/renderer/overlay-level, not component-level.
//
// Both the announcer and the reduce-motion provider are injectable seams (the same
// pattern `AutoskeletonTracing` uses): `AccessibilityManager.sendAccessibilityEvent`
// is a fire-and-forget system call with nothing to assert on directly, and
// `Settings.Global.ANIMATOR_DURATION_SCALE` reflects live, non-deterministically-
// controllable device/emulator state — so production code depends on protocols,
// and tests inject recording/fake doubles instead.

interface AutoskeletonAccessibilityAnnouncing {
    fun announce(view: View, message: String)
}

/** Production implementation: REQ-A11Y-2's actual system call. Uses
 *  `AccessibilityManager.sendAccessibilityEvent` with a `TYPE_ANNOUNCEMENT` event
 *  rather than the deprecated `View.announceForAccessibility`, which is the
 *  currently-documented replacement mechanism. */
@Suppress("DEPRECATION")
class AutoskeletonSystemAccessibilityAnnouncing : AutoskeletonAccessibilityAnnouncing {
    override fun announce(view: View, message: String) {
        val manager = view.context.getSystemService(Context.ACCESSIBILITY_SERVICE) as? AccessibilityManager
            ?: return
        if (!manager.isEnabled) {
            return
        }
        val event = AccessibilityEvent.obtain(AccessibilityEvent.TYPE_ANNOUNCEMENT)
        event.text.add(message)
        event.className = view.javaClass.name
        event.packageName = view.context.packageName
        manager.sendAccessibilityEvent(event)
    }
}

interface AutoskeletonReduceMotionProviding {
    fun isReduceMotionEnabled(context: Context): Boolean
}

/** Production implementation: reads the live `ANIMATOR_DURATION_SCALE` system
 *  setting — Android's documented reduce-motion signal (there is no dedicated
 *  "reduce motion" toggle the way iOS has `UIAccessibility.isReduceMotionEnabled`;
 *  a `0` animator duration scale, set via Developer Options > "Disable animations"
 *  or an equivalent accessibility service, is the platform's actual mechanism —
 *  brief/spec name this explicitly as "animator-duration-scale detection"). */
class AutoskeletonSystemReduceMotionProviding : AutoskeletonReduceMotionProviding {
    override fun isReduceMotionEnabled(context: Context): Boolean {
        val scale = Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f)
        return scale == 0f
    }
}

object AutoskeletonAccessibility {
    const val DEFAULT_LOADING_ANNOUNCEMENT = "Loading"

    /** REQ-A11Y-1: hides the real content subtree from assistive technology while
     *  `isLoading`. `IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS` is Android's
     *  documented mechanism for excluding an ENTIRE subtree from the accessibility
     *  tree — mirrors iOS's `accessibilityElementsHidden`. */
    fun setLoading(isLoading: Boolean, realContentRoot: View) {
        realContentRoot.importantForAccessibility = if (isLoading) {
            View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
        } else {
            View.IMPORTANT_FOR_ACCESSIBILITY_AUTO
        }
    }

    /** REQ-A11Y-2: announces the loading state to screen readers once, when it
     *  begins (called by the future `<AutoSkeleton>` wiring exactly once per
     *  `isLoading: false -> true` transition, not on every re-render). */
    fun announceLoading(
        view: View,
        message: String = DEFAULT_LOADING_ANNOUNCEMENT,
        announcer: AutoskeletonAccessibilityAnnouncing = AutoskeletonSystemAccessibilityAnnouncing(),
    ) {
        announcer.announce(view, message)
    }

    /** REQ-A11Y-3: resolves whether the tier-1 shimmer must degrade to a pulse/
     *  static presentation. Callers pass this straight into
     *  `AutoskeletonRendererTier1.mount(reducedMotion:)`. */
    fun shouldDegradeAnimation(
        context: Context,
        provider: AutoskeletonReduceMotionProviding = AutoskeletonSystemReduceMotionProviding(),
    ): Boolean = provider.isReduceMotionEnabled(context)
}
