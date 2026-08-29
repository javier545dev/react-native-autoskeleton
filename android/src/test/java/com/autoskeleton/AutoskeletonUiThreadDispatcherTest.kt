package com.autoskeleton

import android.os.Looper
import java.util.concurrent.atomic.AtomicReference
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf

/**
 * Visual-paint-gate remediation (tasks.md Phase 5 follow-up) / ADR-1:
 * `getShapes()` is a SYNCHRONOUS Turbo Module method invoked on the JS
 * thread, but `FabricUIManager.resolveView` requires the UI thread —
 * confirmed on a real device via `PaintGateInstrumentedTest` to silently
 * return `null` off it (a defect no JVM test caught throughout Phase 5,
 * because `AutoskeletonModuleTest` injects a FAKE `AutoskeletonViewResolver`
 * — Robolectric cannot run a real Fabric `UIManager`). This is the
 * dispatch primitive that fixes it.
 */
@RunWith(RobolectricTestRunner::class)
class AutoskeletonUiThreadDispatcherTest {
    @Test
    fun runAndWaitReturnsTheBlockResultWhenAlreadyOnTheUiThread() {
        val result = AutoskeletonSystemUiThreadDispatcher.runAndWait(200L) { "value" }
        assertEquals("value", result)
    }

    @Test
    fun runAndWaitPropagatesANullBlockResult() {
        val result = AutoskeletonSystemUiThreadDispatcher.runAndWait<String?>(200L) { null }
        assertNull(result)
    }

    @Test
    fun runAndWaitDispatchesToTheRealUiThreadWhenCalledFromABackgroundThread() {
        // This is the exact defect the visual paint gate caught: a call
        // made from a non-UI thread must still observe the UI thread's
        // Looper inside `block`, not merely execute inline.
        val observedOnUiThread = AtomicReference<Boolean?>(null)
        val thread = Thread {
            AutoskeletonSystemUiThreadDispatcher.runAndWait(1000L) {
                observedOnUiThread.set(Looper.myLooper() == Looper.getMainLooper())
            }
        }
        thread.start()

        var waitedMs = 0
        while (thread.isAlive && waitedMs < 2000) {
            shadowOf(Looper.getMainLooper()).idle()
            Thread.sleep(10)
            waitedMs += 10
        }
        thread.join(1000)

        assertTrue("dispatched block never ran", observedOnUiThread.get() != null)
        assertTrue("block did not observe the UI thread's Looper", observedOnUiThread.get() == true)
    }

    @Test
    fun runAndWaitReturnsNullRatherThanHangingForeverWhenTheUiThreadNeverPumps() {
        // Regression guard for the timeout bound itself: a background
        // caller must never wait longer than the requested timeout, even
        // if nothing ever idles the target looper.
        val startedAt = System.currentTimeMillis()
        var result: String? = "not-yet-set"
        val thread = Thread {
            result = AutoskeletonSystemUiThreadDispatcher.runAndWait(50L) { "unreachable" }
        }
        thread.start()
        thread.join(2000)
        val elapsedMs = System.currentTimeMillis() - startedAt

        assertNull(result)
        assertTrue("waited far longer than the requested timeout: ${elapsedMs}ms", elapsedMs < 1000)
    }

    // Adversarial-review defect (2026-08-28): the test above only ever
    // asserted what the CALLER observes (a prompt `null`). It never idled
    // the looper afterward to let the ABANDONED posted block actually run
    // -- so nothing in this suite ever caught that `latch.await`'s return
    // value was discarded, the posted Runnable was never told the caller
    // gave up, and `result` was read across threads with no visibility
    // guarantee (a plain, non-`@Volatile` `var`). This is that missing
    // coverage: it proves the block DOES still run (Android's
    // `UiThreadUtil.runOnUiThread` gives no handle to cancel an
    // already-posted Runnable), but now gets told it was abandoned via a
    // cooperative `isCancelled` check it can consult before doing anything
    // observable (e.g. a cache write) -- see `AutoskeletonModule
    // .computeWireArray`'s own guard for the production consequence.
    @Test
    fun runAndWaitLetsAnAbandonedBlockObserveCancellationOnceItFinallyRuns() {
        val observedCancelledDuringBlock = AtomicReference<Boolean?>(null)
        val thread = Thread {
            AutoskeletonSystemUiThreadDispatcher.runAndWait(50L) { isCancelled ->
                // Only reachable once the main looper is later idled --
                // well after the caller below already timed out.
                observedCancelledDuringBlock.set(isCancelled())
            }
        }
        thread.start()
        thread.join(1000) // the caller must already have given up (50ms timeout)

        assertNull("the abandoned block must not have run yet", observedCancelledDuringBlock.get())

        shadowOf(Looper.getMainLooper()).idle() // let the abandoned block actually run

        assertEquals(
            "the abandoned block must observe that its caller already timed out",
            true,
            observedCancelledDuringBlock.get(),
        )
    }

    @Test
    fun runAndWaitReportsIsCancelledFalseWhenTheBlockCompletesWithinTheTimeout() {
        // Negative control for the test above: the happy path must never
        // report a false-positive cancellation.
        val observedCancelledDuringBlock = AtomicReference<Boolean?>(null)
        val result = AutoskeletonSystemUiThreadDispatcher.runAndWait(200L) { isCancelled ->
            observedCancelledDuringBlock.set(isCancelled())
            "value"
        }

        assertEquals("value", result)
        assertEquals(false, observedCancelledDuringBlock.get())
    }
}
