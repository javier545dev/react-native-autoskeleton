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
}
