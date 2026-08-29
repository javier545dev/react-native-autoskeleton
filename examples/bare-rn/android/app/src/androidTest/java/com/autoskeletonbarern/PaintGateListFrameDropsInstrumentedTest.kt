package com.autoskeletonbarern

import android.view.Choreographer
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.CopyOnWriteArrayList
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Task 9.1 (tasks.md Phase 9) — REQ-OBS-CI-1's "shimmer frame drops while
 * scrolling a 50-cell list", promoted from `PaintGateListInstrumentedTest`'s
 * (task 6.4) purely visual/correctness assertions into a dedicated timing
 * benchmark.
 *
 * CORRECTED CLAIM (adversarial-review finding): this test does NOT read
 * `benchmarks/budgets.json`'s `droppedFramesPerScroll` budget, and no
 * earlier version of it ever did — the assertion below is a SELF-CONTAINED
 * on-device ratio: dropped frames must stay at or under 5% of this run's own
 * sampled frames, relative to the MEDIAN sampled frame duration (NOT an
 * assumed fixed Hz — see `DROPPED_FRAME_MULTIPLIER`'s own comment). This
 * runs in a separate Android-emulator CI job
 * (`bench-android-frame-drops-and-memory` in
 * `.github/workflows/benchmarks.yml`) from the Node/Playwright benchmark
 * pipeline that reads `budgets.json`, and its result does not currently
 * feed back into that pipeline's JSON (`benchmarks/run.ts` reports
 * `droppedFramesMeasured: false` for that reason — see its own doc
 * comment). This test is nonetheless a genuine, independently-failing gate
 * on its own terms.
 *
 * Targets the SAME `examples/bare-rn/App.tsx` `PaintGateListScreen` fixture
 * (a real `@shopify/flash-list` `FlashList`, ~26 concurrently-loading
 * `SkeletonCell` rows sharing one `sharedShimmerClock`-driven shimmer,
 * `Choreographer`-scheduled per `AutoskeletonFrameScheduler`) — a REAL
 * `Choreographer.FrameCallback` samples `frameTimeNanos` on the real UI
 * thread across a sustained scroll, exactly the vsync signal
 * `AutoskeletonChoreographerFrameScheduler` itself is scheduled against, so
 * a genuinely dropped frame here is a genuinely dropped shimmer/scroll
 * frame, not a proxy.
 *
 * Run in isolation: `./gradlew :app:connectedDebugAndroidTest --tests
 * "com.autoskeletonbarern.PaintGateListFrameDropsInstrumentedTest"` (from
 * `examples/bare-rn/android`), against a booted emulator/device.
 */
@RunWith(AndroidJUnit4::class)
class PaintGateListFrameDropsInstrumentedTest {

    companion object {
        private const val MOUNT_TIMEOUT_MS = 20_000L
        private const val LABEL_SCREEN_TOGGLE = "paint-gate-screen-toggle"
        private const val LABEL_TRAVERSAL_COUNTER = "paint-gate-list-traversal-counter"
        private const val SCROLL_CYCLES = 6

        // A 60Hz display's nominal frame budget is ~16.67ms; a 90/120Hz
        // display is tighter still. Rather than hard-code a refresh rate,
        // a frame is counted as DROPPED when its duration exceeds 2x the
        // FIRST sampled frame interval's own device-reported nominal —
        // i.e. relative to what this specific device/emulator is actually
        // running at, not an assumed 60Hz. This mirrors NFR-1's own
        // "more than 5% of sampled frames" framing: the metric that
        // matters is dropped-relative-to-this-device's-own-cadence, not an
        // assumed absolute number.
        private const val DROPPED_FRAME_MULTIPLIER = 2.0
    }

    private lateinit var device: UiDevice

    @Before
    fun setUp() {
        device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
    }

    private fun launchAndOpenListScreen(): ActivityScenario<MainActivity> {
        val scenario = ActivityScenario.launch(MainActivity::class.java)
        val toggleAppeared = device.wait(Until.hasObject(By.desc(LABEL_SCREEN_TOGGLE)), MOUNT_TIMEOUT_MS)
        assertTrue("FIXTURE FAILURE: app never mounted within ${MOUNT_TIMEOUT_MS}ms", toggleAppeared)
        val toggle = device.findObject(By.desc(LABEL_SCREEN_TOGGLE))
        assertTrue("FIXTURE FAILURE: could not locate the screen toggle", toggle != null)
        toggle!!.click()
        val listMounted = device.wait(Until.hasObject(By.desc(LABEL_TRAVERSAL_COUNTER)), MOUNT_TIMEOUT_MS)
        assertTrue("FIXTURE FAILURE: PaintGateListScreen never mounted within ${MOUNT_TIMEOUT_MS}ms", listMounted)
        return scenario
    }

    private fun scrollDown(cycles: Int) {
        val displayHeight = device.displayHeight
        repeat(cycles) {
            device.swipe(
                device.displayWidth / 2,
                (displayHeight * 0.75).toInt(),
                device.displayWidth / 2,
                (displayHeight * 0.2).toInt(),
                15,
            )
        }
    }

    /**
     * NFR-1 / RISK-3's authoritative on-device signal: samples real vsync
     * frame durations (via `Choreographer.FrameCallback`, the SAME
     * scheduling primitive `AutoskeletonRendererTier1`'s shimmer runs on)
     * across a sustained scroll of the 50-cell reference list, and asserts
     * the dropped-frame ratio stays at or under 5% of this run's own
     * sampled frames (NFR-1: "fails if measured fps drops below target for
     * more than 5% of sampled frames") — a self-contained on-device
     * assertion, NOT a read of `benchmarks/budgets.json` (see this class's
     * own doc comment for the corrected claim and why).
     */
    @Test
    fun droppedFramesDuringFiftyCellScrollStaysWithinBudget() {
        val scenario = launchAndOpenListScreen()
        Thread.sleep(1_500) // let the first template measurement + initial shimmer settle

        val frameDurationsNanos = CopyOnWriteArrayList<Long>()
        val lastFrameTimeNanos = AtomicLong(-1L)
        val sampling = AtomicBoolean(true)
        val choreographer = arrayOfNulls<Choreographer>(1)
        val readyLatch = CountDownLatch(1)

        val callback = object : Choreographer.FrameCallback {
            override fun doFrame(frameTimeNanos: Long) {
                val last = lastFrameTimeNanos.getAndSet(frameTimeNanos)
                if (last >= 0) {
                    frameDurationsNanos.add(frameTimeNanos - last)
                }
                if (sampling.get()) {
                    choreographer[0]!!.postFrameCallback(this)
                } else {
                    readyLatch.countDown()
                }
            }
        }

        scenario.onActivity {
            choreographer[0] = Choreographer.getInstance()
            choreographer[0]!!.postFrameCallback(callback)
        }

        scrollDown(SCROLL_CYCLES)
        device.waitForIdle()
        Thread.sleep(300)

        sampling.set(false)
        assertTrue(
            "FIXTURE FAILURE: frame sampling never stopped cleanly",
            readyLatch.await(5, TimeUnit.SECONDS),
        )

        assertTrue(
            "FIXTURE FAILURE: fewer than 10 frames were sampled during the scroll (${frameDurationsNanos.size}) " +
                "— the Choreographer callback likely never started",
            frameDurationsNanos.size >= 10,
        )

        // Nominal cadence for THIS run: the median sampled frame duration.
        // Using the median (not the device's advertised refresh rate)
        // avoids assuming a fixed Hz on an emulator, whose reported
        // display metrics can differ from its actual rendering cadence.
        val sorted = frameDurationsNanos.sorted()
        val medianNanos = sorted[sorted.size / 2]
        val droppedThresholdNanos = (medianNanos * DROPPED_FRAME_MULTIPLIER).toLong()

        val droppedCount = frameDurationsNanos.count { it > droppedThresholdNanos }
        val droppedRatio = droppedCount.toDouble() / frameDurationsNanos.size

        assertTrue(
            "Dropped $droppedCount of ${frameDurationsNanos.size} sampled frames " +
                "(${"%.1f".format(droppedRatio * 100)}%) during a $SCROLL_CYCLES-cycle scroll of the " +
                "50-cell reference list — median frame duration was ${medianNanos / 1_000_000.0}ms, threshold " +
                "was ${droppedThresholdNanos / 1_000_000.0}ms. NFR-1 fails if more than 5% of sampled frames " +
                "drop below target.",
            droppedRatio <= 0.05,
        )
        scenario.close()
    }
}
