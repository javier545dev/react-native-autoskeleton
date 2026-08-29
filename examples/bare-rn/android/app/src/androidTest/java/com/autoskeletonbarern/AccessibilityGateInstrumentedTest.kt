package com.autoskeletonbarern

import android.accessibilityservice.AccessibilityServiceInfo
import android.app.UiAutomation
import android.view.accessibility.AccessibilityNodeInfo
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * G.15 — the ON-DEVICE ACCESSIBILITY GATE (Android half).
 *
 * The defect this closes: `<AutoSkeleton>` correctly hid its own skeleton
 * OVERLAY from assistive technology (`accessible={false}` +
 * `importantForAccessibility="no-hide-descendants"`, `src/native/AutoSkeleton.tsx`)
 * but never hid `props.children` — the REAL content that ADR-16
 * reveal-before-hide keeps mounted underneath the overlay at all times. So
 * TalkBack read content the sighted user cannot see: placeholder text, empty
 * strings, stale data. `src/web/AutoSkeleton.tsx` had always done the
 * equivalent (`aria-hidden` around the real content while the overlay shows);
 * native did not.
 *
 * WHY THIS TEST EXISTS AND WHY A UNIT TEST COULD NOT REPLACE IT.
 * `android/src/main/java/com/autoskeleton/AutoskeletonAccessibility.kt` shipped
 * a fully unit-tested `setLoading(isLoading, realContentRoot)` helper with NINE
 * green unit tests and ZERO production call sites. Green unit tests on dead code
 * are exactly the defect. Only an assertion against the accessibility tree of a
 * REAL RUNNING APP can distinguish "the mechanism exists" from "the mechanism
 * runs".
 *
 * WHY THE ACCESSIBILITY-SERVICE FLAGS ARE CHANGED IN [setUp].
 * UiAutomator's `UiDevice` deliberately sets
 * `AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS` on its
 * `UiAutomation` so that test automation can reach views an accessibility
 * service is not supposed to see. That flag makes `View.includeForAccessibility()`
 * return true even when `View.isImportantForAccessibility()` is false — which is
 * precisely the state `IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS` puts the
 * real content into. A gate that queried through the default UiAutomator
 * configuration would therefore be UNABLE TO OBSERVE THE FIX AT ALL, and would
 * report the same result before and after it — a vacuous gate.
 *
 * This class clears that flag for the duration of each test and restores it in
 * [tearDown], so every query below sees exactly what TalkBack sees: the real,
 * unmodified accessibility tree. That restoration matters — `PaintGateInstrumentedTest`
 * runs in the same instrumentation process and depends on the default,
 * flag-enabled UiAutomator behaviour.
 *
 * Run in isolation: `./gradlew :app:connectedDebugAndroidTest --tests
 * "com.autoskeletonbarern.AccessibilityGateInstrumentedTest"` (from
 * `examples/bare-rn/android`), against a booted emulator/device.
 */
@RunWith(AndroidJUnit4::class)
class AccessibilityGateInstrumentedTest {

    companion object {
        private const val MOUNT_TIMEOUT_MS = 20_000L

        /** How long the real cold `getShapes` bridge round-trip plus the first
         *  overlay frame may legitimately take before the content must be gone
         *  from the accessibility tree. Mirrors `PaintGateUITests.swift`'s
         *  `overlaySettleTimeout` (5s) — the same "wait for the real condition,
         *  never guess a sleep" discipline the pixel gates already use. */
        private const val OVERLAY_SETTLE_TIMEOUT_MS = 8_000L

        /** ADR-16 defaults (`core/handoff.ts`): handoffTimeoutMs=250,
         *  handoffFadeMs=120. Same constant, same rationale as
         *  `PaintGateInstrumentedTest.HANDOFF_SETTLE_MS`. */
        private const val HANDOFF_SETTLE_TIMEOUT_MS = 8_000L

        private const val POLL_INTERVAL_MS = 100L

        // examples/bare-rn/App.tsx PAINT_GATE_FIXTURE.labels. The toggle lives
        // OUTSIDE `<AutoSkeleton>`; every other label lives INSIDE it, in the
        // subtree ADR-16 keeps mounted under the overlay.
        private const val LABEL_TOGGLE = "paint-gate-toggle"
        private const val LABEL_CONTENT = "paint-gate-content"
        private const val LABEL_IMAGE = "paint-gate-image"
        private const val LABEL_CARD = "paint-gate-rounded-card"

        /** `src/native/AutoSkeleton.tsx`'s `LOADING_ACCESSIBILITY_LABEL`, and
         *  the exact string `src/web/AutoSkeleton.tsx` already renders inside
         *  its `role="status"` overlay. Hardcoded here on purpose, so a drift
         *  in the production string fails this gate loudly. */
        private const val LOADING_STATUS_LABEL = "Loading"
    }

    private lateinit var automation: UiAutomation
    private var originalServiceFlags: Int = 0

    @Before
    fun setUp() {
        automation = InstrumentationRegistry.getInstrumentation().uiAutomation
        val info = automation.serviceInfo
            ?: throw IllegalStateException("UiAutomation reported no AccessibilityServiceInfo")
        originalServiceFlags = info.flags
        info.flags = info.flags and AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS.inv()
        automation.serviceInfo = info
    }

    @After
    fun tearDown() {
        val info = automation.serviceInfo ?: return
        info.flags = originalServiceFlags
        automation.serviceInfo = info
    }

    // MARK: - Accessibility-tree plumbing

    /** Depth-first search of the LIVE accessibility tree for a node whose
     *  `contentDescription` equals [description]. The root is re-fetched by
     *  every caller, never cached, so a stale snapshot can never make a
     *  disappearing node look present (or vice versa). */
    private fun findByDescription(description: String): AccessibilityNodeInfo? {
        val root = automation.rootInActiveWindow ?: return null
        return findByDescription(root, description)
    }

    private fun findByDescription(node: AccessibilityNodeInfo, description: String): AccessibilityNodeInfo? {
        if (node.contentDescription?.toString() == description) {
            return node
        }
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            val found = findByDescription(child, description)
            if (found != null) {
                return found
            }
        }
        return null
    }

    /** Polls [condition] every [POLL_INTERVAL_MS] until it holds or [timeoutMs]
     *  elapses. Returns whether it held. */
    private fun waitUntil(timeoutMs: Long, condition: () -> Boolean): Boolean {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            if (condition()) {
                return true
            }
            Thread.sleep(POLL_INTERVAL_MS)
        }
        return condition()
    }

    private fun launchAndWaitForMount(): ActivityScenario<MainActivity> {
        val scenario = ActivityScenario.launch(MainActivity::class.java)
        val mounted = waitUntil(MOUNT_TIMEOUT_MS) { findByDescription(LABEL_TOGGLE) != null }
        assertTrue(
            "FIXTURE FAILURE (not the gate's own assertion): the PaintGateScreen toggle never " +
                "appeared in the accessibility tree within ${MOUNT_TIMEOUT_MS}ms — the JS bundle, " +
                "Metro connection, or App.tsx fixture itself is broken, not the accessibility path.",
            mounted,
        )
        return scenario
    }

    /**
     * The control assertion, asserted alongside EVERY "content is absent"
     * assertion below. `paint-gate-toggle` is a real, accessible `Pressable`
     * that sits OUTSIDE `<AutoSkeleton>`, so it must be present in every
     * accessibility tree this gate ever inspects. Without it, "the node was not
     * found" would be satisfied just as well by a crashed app, an unmounted
     * screen, or a broken query — the exact way an absence assertion goes
     * vacuous.
     */
    private fun assertQueryIsWorking() {
        assertNotNull(
            "CONTROL FAILURE: \"$LABEL_TOGGLE\" (an accessible Pressable OUTSIDE <AutoSkeleton>, " +
                "so never affected by this fix) was itself missing from the accessibility tree. " +
                "Every 'content is absent' assertion in this class is meaningless unless this " +
                "node is present in the same tree — the app is down or the query is broken.",
            findByDescription(LABEL_TOGGLE),
        )
    }

    /**
     * The SECOND control, and the one that closes the last way an absence
     * assertion could pass for the wrong reason. `paint-gate-toggle` proves the
     * app is up, but it renders in `PaintGateScreen` OUTSIDE `<AutoSkeleton>` —
     * on its own it cannot rule out "the `<AutoSkeleton>` subtree simply had not
     * been attached yet when we looked".
     *
     * The `Loading` status node is mounted by `<AutoSkeleton>` itself, and ONLY
     * while `overlayVisible` is true — i.e. only once the cold `getShapes`
     * round-trip resolved and the real overlay is painted. Requiring it in the
     * SAME accessibility tree as the missing content is positive proof that the
     * component is mounted and actively showing a skeleton at the exact instant
     * the content was found to be absent.
     */
    private fun assertSkeletonIsActuallyShowing() {
        assertNotNull(
            "CONTROL FAILURE: the \"$LOADING_STATUS_LABEL\" status node (mounted by " +
                "<AutoSkeleton> itself, and only while the overlay is actually painted) was " +
                "missing from the SAME accessibility tree the content was found absent in. " +
                "Without it, 'the content is not in the tree' could just mean the " +
                "<AutoSkeleton> subtree was never attached.",
            findByDescription(LOADING_STATUS_LABEL),
        )
    }

    private fun toggleIsLoading() {
        val toggle = findByDescription(LABEL_TOGGLE)
        assertNotNull("FIXTURE FAILURE: could not locate the isLoading toggle", toggle)
        assertTrue(
            "FIXTURE FAILURE: the isLoading toggle did not accept ACTION_CLICK",
            toggle!!.performAction(AccessibilityNodeInfo.ACTION_CLICK),
        )
    }

    // MARK: - The gate

    /**
     * REQ-A11Y-1, hidden half: while the skeleton overlay is painted, the real
     * content underneath it must be EXCLUDED from the accessibility tree.
     *
     * Every content node inside `<AutoSkeleton>` is checked, not just one:
     * `IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS` is a SUBTREE mechanism,
     * so a fix that only hid the immediate child while leaving deeper
     * descendants exposed would still read stale data to TalkBack.
     */
    @Test
    fun realContentIsExcludedFromTheAccessibilityTreeWhileTheSkeletonShows() {
        val scenario = launchAndWaitForMount()

        val hidden = waitUntil(OVERLAY_SETTLE_TIMEOUT_MS) { findByDescription(LABEL_IMAGE) == null }

        assertQueryIsWorking()
        assertSkeletonIsActuallyShowing()
        assertTrue(
            "Expected the real content subtree to be EXCLUDED from the accessibility tree while " +
                "the skeleton overlay is painted, but \"$LABEL_IMAGE\" was still reachable by an " +
                "assistive technology after ${OVERLAY_SETTLE_TIMEOUT_MS}ms. TalkBack would read " +
                "content the user cannot see.",
            hidden,
        )
        assertNull(
            "Expected the WHOLE content subtree to be excluded, but the container " +
                "\"$LABEL_CONTENT\" was still reachable.",
            findByDescription(LABEL_CONTENT),
        )
        assertNull(
            "Expected the WHOLE content subtree to be excluded, but the deeper descendant " +
                "\"$LABEL_CARD\" was still reachable — a shallow hide is not a subtree hide.",
            findByDescription(LABEL_CARD),
        )

        scenario.close()
    }

    /**
     * REQ-A11Y-1, RESTORED half. A gate that only proves content disappears
     * cannot tell you it ever comes back — an implementation that hid the
     * content permanently would pass the test above and leave the app
     * unusable with TalkBack.
     *
     * This test requires BOTH transitions in one run: first the hidden state
     * (so it can never pass against an implementation that simply never hides
     * anything), then the restored state after the real `isLoading` toggle and
     * the real ADR-16 handoff.
     */
    @Test
    fun realContentReturnsToTheAccessibilityTreeAfterTheHandoffCompletes() {
        val scenario = launchAndWaitForMount()

        val hidden = waitUntil(OVERLAY_SETTLE_TIMEOUT_MS) { findByDescription(LABEL_IMAGE) == null }
        assertQueryIsWorking()
        assertSkeletonIsActuallyShowing()
        assertTrue(
            "PRECONDITION: this test asserts the content is RESTORED, which is only meaningful " +
                "once it was genuinely hidden first. \"$LABEL_IMAGE\" never left the accessibility " +
                "tree while the skeleton was painted.",
            hidden,
        )

        toggleIsLoading()

        val restoredImage = waitUntil(HANDOFF_SETTLE_TIMEOUT_MS) { findByDescription(LABEL_IMAGE) != null }
        assertTrue(
            "Expected the real content to RETURN to the accessibility tree after isLoading=false " +
                "and the ADR-16 handoff settled, but \"$LABEL_IMAGE\" was still excluded after " +
                "${HANDOFF_SETTLE_TIMEOUT_MS}ms — the content is permanently invisible to TalkBack.",
            restoredImage,
        )
        assertNotNull(
            "Expected the whole content subtree to return, but \"$LABEL_CONTENT\" was still excluded.",
            findByDescription(LABEL_CONTENT),
        )
        assertNotNull(
            "Expected the whole content subtree to return, but \"$LABEL_CARD\" was still excluded.",
            findByDescription(LABEL_CARD),
        )

        scenario.close()
    }

    /**
     * REQ-A11Y-2, as actually shipped. `src/web/AutoSkeleton.tsx` renders a
     * visually-hidden `Loading` inside a `role="status"` overlay: a STATICALLY
     * READABLE element, politely announced, never an interrupting one. Native
     * mirrors that with a zero-footprint accessible `View` carrying
     * `accessibilityLabel="Loading"` and `accessibilityLiveRegion="polite"`
     * (Android's real analogue of `role="status"`).
     *
     * It is deliberately NOT `AccessibilityInfo.announceForAccessibility`,
     * which INTERRUPTS the screen reader — see this session's tasks.md entry
     * for the full argument.
     *
     * `getLiveRegion()` is asserted, not just the label: a plain accessible
     * `View` would satisfy a label-only assertion while announcing nothing.
     */
    @Test
    fun loadingStatusIsExposedPolitelyWhileLoadingAndRemovedAfterHandoff() {
        val scenario = launchAndWaitForMount()

        val statusAppeared = waitUntil(OVERLAY_SETTLE_TIMEOUT_MS) {
            findByDescription(LOADING_STATUS_LABEL) != null
        }
        assertQueryIsWorking()
        assertTrue(
            "Expected an accessible \"$LOADING_STATUS_LABEL\" status node while the skeleton is " +
                "painted — with the real content hidden, a screen-reader user would otherwise " +
                "encounter an EMPTY region and no indication anything is loading.",
            statusAppeared,
        )

        val status = findByDescription(LOADING_STATUS_LABEL)!!
        assertEquals(
            "Expected the loading status node to be a POLITE live region (Android's analogue of " +
                "web's role=\"status\"), so TalkBack announces it without interrupting whatever " +
                "the user is currently hearing.",
            android.view.View.ACCESSIBILITY_LIVE_REGION_POLITE,
            status.liveRegion,
        )

        toggleIsLoading()

        val statusRemoved = waitUntil(HANDOFF_SETTLE_TIMEOUT_MS) {
            findByDescription(LOADING_STATUS_LABEL) == null
        }
        assertQueryIsWorking()
        assertTrue(
            "Expected the \"$LOADING_STATUS_LABEL\" status node to be GONE once loading finished " +
                "and the handoff settled, but it was still in the accessibility tree after " +
                "${HANDOFF_SETTLE_TIMEOUT_MS}ms — a permanent 'Loading' announcement on loaded " +
                "content is worse than none.",
            statusRemoved,
        )

        scenario.close()
    }
}
