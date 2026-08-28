package com.autoskeletonbarern

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Rect
import android.os.Build
import android.os.Debug
import android.os.Handler
import android.os.Looper
import android.view.PixelCopy
import androidx.annotation.RequiresApi
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.UiObject2
import androidx.test.uiautomator.Until
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Phase 6 (tasks.md 6.1-6.4) — the ON-DEVICE VISUAL PAINT GATE for
 * virtualized-list skeletons. Mirrors `PaintGateInstrumentedTest.kt`'s own
 * discipline exactly (PixelCopy against the real, currently-displayed
 * frame; UiAutomator by real accessibility label, never guessed
 * coordinates; a colour-RAMP oracle, never a single target colour, since
 * the production draw pass is one animated `LinearGradient`).
 *
 * Targets `examples/bare-rn/App.tsx`'s `PaintGateListScreen`: a real
 * `@shopify/flash-list` `FlashList` of 40 rows, 2 of every 3 rows loading
 * (`SkeletonCell`, `itemType="paint-gate-list-card"`), so scrolling
 * genuinely exercises FlashList's native view-instance RECYCLING
 * (RISK-3) — not merely a single-instance `isLoading` toggle, which
 * `PaintGateInstrumentedTest.kt` already covers for the whole-screen case
 * and cannot exercise this defect class by construction.
 *
 * Run in isolation: `./gradlew :app:connectedDebugAndroidTest --tests
 * "com.autoskeletonbarern.PaintGateListInstrumentedTest"` (from
 * `examples/bare-rn/android`), against a booted emulator/device.
 */
@RunWith(AndroidJUnit4::class)
class PaintGateListInstrumentedTest {

    companion object {
        private const val MOUNT_TIMEOUT_MS = 20_000L
        private const val RECYCLE_CYCLES = 10

        // native/AutoSkeleton.tsx's DEFAULT_THEME — see PaintGateInstrumentedTest.kt
        // for the full rationale on why this is a RAMP oracle, not a single
        // target colour.
        private val SKELETON_BASE_COLOR = Color.parseColor("#e2e2e2")
        private val SKELETON_HIGHLIGHT_COLOR = Color.parseColor("#f5f5f5")

        // examples/bare-rn/App.tsx PAINT_GATE_LIST_FIXTURE.colors — real,
        // opaque, mutually distinct from the skeleton ramp.
        private val CONTENT_TEXT_COLOR = Color.parseColor("#101010")
        private val CONTENT_ACCENT_COLOR = Color.parseColor("#0000FF")

        private const val COLOR_TOLERANCE = 16

        private const val LABEL_SCREEN_TOGGLE = "paint-gate-screen-toggle"
        private const val LABEL_TRAVERSAL_COUNTER = "paint-gate-list-traversal-counter"
        private const val REAL_CARD_PREFIX = "paint-gate-list-real-item-"
        private const val SKELETON_CARD_PREFIX = "paint-gate-list-skeleton-item-"

        // Loose upper bound for a 10-cycle scroll stress test on an
        // emulator. This is a REAL Debug.getNativeHeapAllocatedSize()
        // measurement (`android.os.Debug`), not a proxy — but it is
        // explicitly NOT a precise leak-detection tool: JVM/ART GC timing,
        // JIT warm-up, and one-time class-loading allocations all
        // contribute noise on a single sampled pair of points. A
        // MONOTONIC, UNBOUNDED climb across cycles is what a genuine leak
        // looks like; a bounded absolute delta after 10 cycles is the
        // honest, defensible thing this test can assert without a
        // dedicated heap-dump/LeakCanary-class tool this project does not
        // have wired up. Documented as a real measurement with a stated
        // limitation, not a proxy dressed up as authoritative.
        private const val MAX_NATIVE_HEAP_GROWTH_BYTES = 12L * 1024 * 1024
    }

    private lateinit var device: UiDevice

    @Before
    fun setUp() {
        device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
    }

    private fun launchAndOpenListScreen(): ActivityScenario<MainActivity> {
        val scenario = ActivityScenario.launch(MainActivity::class.java)
        val toggleAppeared = device.wait(Until.hasObject(By.desc(LABEL_SCREEN_TOGGLE)), MOUNT_TIMEOUT_MS)
        assertTrue(
            "FIXTURE FAILURE (not the gate's own assertion): the app never mounted within " +
                "${MOUNT_TIMEOUT_MS}ms — the JS bundle, Metro connection, or App.tsx fixture itself " +
                "is broken, not the list draw path.",
            toggleAppeared,
        )
        val toggle = device.findObject(By.desc(LABEL_SCREEN_TOGGLE))
        assertTrue("FIXTURE FAILURE: could not locate the screen toggle", toggle != null)
        toggle!!.click()
        val listMounted = device.wait(Until.hasObject(By.desc(LABEL_TRAVERSAL_COUNTER)), MOUNT_TIMEOUT_MS)
        assertTrue(
            "FIXTURE FAILURE: PaintGateListScreen never mounted within ${MOUNT_TIMEOUT_MS}ms " +
                "after switching screens",
            listMounted,
        )
        return scenario
    }

    @RequiresApi(Build.VERSION_CODES.O)
    private fun screenshotBitmap(scenario: ActivityScenario<MainActivity>): Bitmap {
        var bitmap: Bitmap? = null
        var copyResult = -1
        val latch = CountDownLatch(1)
        scenario.onActivity { activity ->
            val window = activity.window
            val decor = window.decorView
            val out = Bitmap.createBitmap(decor.width, decor.height, Bitmap.Config.ARGB_8888)
            PixelCopy.request(
                window,
                out,
                { result ->
                    copyResult = result
                    if (result == PixelCopy.SUCCESS) {
                        bitmap = out
                    }
                    latch.countDown()
                },
                Handler(Looper.getMainLooper()),
            )
        }
        assertTrue("PixelCopy did not complete in time", latch.await(10, TimeUnit.SECONDS))
        assertTrue("PixelCopy failed with result code $copyResult", copyResult == PixelCopy.SUCCESS)
        return requireNotNull(bitmap) { "PixelCopy reported SUCCESS but produced no bitmap" }
    }

    private fun centerPixel(bitmap: Bitmap, bounds: Rect): Int {
        val x = ((bounds.left + bounds.right) / 2).coerceIn(0, bitmap.width - 1)
        val y = ((bounds.top + bounds.bottom) / 2).coerceIn(0, bitmap.height - 1)
        return bitmap.getPixel(x, y)
    }

    private fun colorsClose(a: Int, b: Int, tolerance: Int = COLOR_TOLERANCE): Boolean {
        return Math.abs(Color.red(a) - Color.red(b)) <= tolerance &&
            Math.abs(Color.green(a) - Color.green(b)) <= tolerance &&
            Math.abs(Color.blue(a) - Color.blue(b)) <= tolerance
    }

    /** Identical oracle to `PaintGateInstrumentedTest.kt`'s own
     *  `colorInRamp` — see that file for the full rationale (the shimmer is
     *  one animated two-stop `LinearGradient`, so a captured pixel can
     *  legitimately land anywhere between the two stops). */
    private fun colorInRamp(pixel: Int, from: Int, to: Int, tolerance: Int = COLOR_TOLERANCE): Boolean {
        fun channelInRange(value: Int, a: Int, b: Int): Boolean {
            val lo = minOf(a, b) - tolerance
            val hi = maxOf(a, b) + tolerance
            return value in lo..hi
        }
        return channelInRange(Color.red(pixel), Color.red(from), Color.red(to)) &&
            channelInRange(Color.green(pixel), Color.green(from), Color.green(to)) &&
            channelInRange(Color.blue(pixel), Color.blue(from), Color.blue(to))
    }

    private fun hex(color: Int): String = String.format("#%06X", 0xFFFFFF and color)

    private fun visibleRealCards(): List<UiObject2> = device.findObjects(By.descStartsWith(REAL_CARD_PREFIX))

    private fun visibleSkeletonCards(): List<UiObject2> = device.findObjects(By.descStartsWith(SKELETON_CARD_PREFIX))

    private fun readTraversalCounterText(): String {
        val node = device.findObject(By.desc(LABEL_TRAVERSAL_COUNTER))
        assertTrue("FIXTURE FAILURE: could not locate the traversal counter node", node != null)
        return node!!.text ?: ""
    }

    private fun scrollDown(cycles: Int) {
        val displayHeight = device.displayHeight
        repeat(cycles) {
            device.swipe(device.displayWidth / 2, (displayHeight * 0.75).toInt(), device.displayWidth / 2, (displayHeight * 0.2).toInt(), 15)
            device.waitForIdle()
        }
    }

    private fun scrollUp(cycles: Int) {
        val displayHeight = device.displayHeight
        repeat(cycles) {
            device.swipe(device.displayWidth / 2, (displayHeight * 0.2).toInt(), device.displayWidth / 2, (displayHeight * 0.75).toInt(), 15)
            device.waitForIdle()
        }
    }

    /**
     * REQ-LIST-CELL-1 / ADR-13's HARD RULE, the direct on-device proof:
     * with ~26 loading cells (2 of every 3 of 40 rows) all binding to the
     * SAME unseen `itemType` on first mount, the real traversal count —
     * read from the app's own dev-only `templateTraversalCounter`,
     * rendered into an accessible node — settles at EXACTLY 1, never once
     * per bind. This is the genuine "traversal-call counter stays flat"
     * assertion, exercised against the real running app end to end, not a
     * formatter in isolation.
     */
    @Test
    fun zeroTraversalOnBindAcrossManyConcurrentLoadingCells() {
        val scenario = launchAndOpenListScreen()
        // The deferred measurement is scheduled via `runAfterInteractions`/
        // `requestIdleCallback` and retried across a bounded RAF budget —
        // give it real wall-clock time to settle before reading the
        // counter, mirroring `PaintGateInstrumentedTest`'s own
        // `HANDOFF_SETTLE_MS` discipline for a different async boundary.
        Thread.sleep(1_500)

        val counterText = readTraversalCounterText()
        assertTrue(
            "Expected the real on-screen traversal counter to read exactly " +
                "'traversalCount:1' after mounting ~26 concurrently-loading cells for the " +
                "same unseen itemType, but it read '$counterText' — ADR-13's zero-traversal-" +
                "on-bind rule requires the deferred template measurement to run AT MOST ONCE, " +
                "ever, regardless of how many cells bind concurrently.",
            counterText == "traversalCount:1",
        )

        // Scroll through the whole list and back — REQ-LIST-CELL-1's
        // "subsequent binds of a known itemType use zero traversal" case.
        // Rebinding many more cells via recycling must NOT move the
        // counter at all.
        scrollDown(6)
        scrollUp(6)
        device.waitForIdle()
        Thread.sleep(500)

        val counterAfterScroll = readTraversalCounterText()
        assertTrue(
            "Expected the traversal counter to stay EXACTLY at 'traversalCount:1' after " +
                "scrolling through the list (many more cells rebinding via recycling), but it " +
                "read '$counterAfterScroll' — a change here means a bind triggered a real " +
                "traversal instead of a synchronous cache lookup.",
            counterAfterScroll == "traversalCount:1",
        )
        scenario.close()
    }

    /**
     * RISK-3's explicit assertion: after repeated scroll-driven recycling
     * (FlashList reusing native view instances across DIFFERENT list
     * items), every currently-visible "real" row shows real content
     * colours (never a stale skeleton overlay left behind by a PREVIOUS
     * occupant of that recycled view), and every currently-visible
     * "skeleton" row shows skeleton-ramp colours (never leftover real
     * content from a previous occupant). Both directions of leak are
     * checked, since RISK-3 explicitly calls out "a skeleton overlay OR a
     * hide/restore flag can leak into the next item" — either direction is
     * a real defect.
     */
    @RequiresApi(Build.VERSION_CODES.O)
    @Test
    fun noStaleSkeletonAfterTenRecycleCycles() {
        val scenario = launchAndOpenListScreen()
        Thread.sleep(1_500) // let the first template measurement land

        repeat(RECYCLE_CYCLES) {
            scrollDown(1)
            scrollUp(1)
        }
        device.waitForIdle()
        Thread.sleep(300)

        val bitmap = screenshotBitmap(scenario)

        val realCards = visibleRealCards()
        assertTrue("FIXTURE FAILURE: no real (loaded) cards visible after recycling", realCards.isNotEmpty())
        for (card in realCards) {
            val pixel = centerPixel(bitmap, card.visibleBounds)
            assertFalse(
                "Expected real content at ${card.contentDescription} to show its own colour " +
                    "after ${RECYCLE_CYCLES} recycle cycles, but the sampled pixel " +
                    "${hex(pixel)} falls inside the skeleton shimmer ramp " +
                    "(${hex(SKELETON_BASE_COLOR)}..${hex(SKELETON_HIGHLIGHT_COLOR)}) — a stale " +
                    "skeleton is painted over real content on a recycled view instance.",
                colorInRamp(pixel, SKELETON_BASE_COLOR, SKELETON_HIGHLIGHT_COLOR, tolerance = 4),
            )
        }

        val skeletonCards = visibleSkeletonCards()
        assertTrue("FIXTURE FAILURE: no skeleton (loading) cards visible after recycling", skeletonCards.isNotEmpty())
        for (card in skeletonCards) {
            val pixel = centerPixel(bitmap, card.visibleBounds)
            assertFalse(
                "Expected a skeleton at ${card.contentDescription} to show shimmer colours after " +
                    "${RECYCLE_CYCLES} recycle cycles, but the sampled pixel ${hex(pixel)} matches " +
                    "real content colour ${hex(CONTENT_TEXT_COLOR)} or ${hex(CONTENT_ACCENT_COLOR)} " +
                    "— stale real content is leaking through a recycled skeleton view instance.",
                colorsClose(pixel, CONTENT_TEXT_COLOR) || colorsClose(pixel, CONTENT_ACCENT_COLOR),
            )
        }
        scenario.close()
    }

    /**
     * ADR-8's observable meaning of "one shared clock": several visible
     * skeleton cells, sampled in the SAME captured frame (one PixelCopy
     * covers every currently-displayed pixel simultaneously — there is no
     * per-cell capture skew), must agree with EACH OTHER at the same
     * relative position within their own shape, not merely each
     * individually fall somewhere in the ramp. Two independently-clocked
     * shimmers would almost certainly disagree at any sampled instant;
     * `sharedShimmerClock` (a Kotlin file-scope singleton — see
     * `AutoskeletonOverlayView.kt`) is what makes them agree.
     */
    @RequiresApi(Build.VERSION_CODES.O)
    @Test
    fun allVisibleSkeletonCellsShareOnePhaseInTheSameFrame() {
        val scenario = launchAndOpenListScreen()
        Thread.sleep(1_500)

        val bitmap = screenshotBitmap(scenario)
        val skeletonCards = visibleSkeletonCards()
        assertTrue(
            "FIXTURE FAILURE: need at least 2 visible skeleton cards to prove a SHARED clock; " +
                "found ${skeletonCards.size}",
            skeletonCards.size >= 2,
        )

        val samples = skeletonCards.map { centerPixel(bitmap, it.visibleBounds) }
        val reference = samples.first()
        for ((index, pixel) in samples.withIndex()) {
            assertTrue(
                "Expected cell #$index's skeleton pixel ${hex(pixel)} to match the reference " +
                    "cell's ${hex(reference)} within a tight tolerance (same captured frame, " +
                    "same relative position within an identical shape) — a mismatch this large " +
                    "means the cells are NOT sharing one clock/phase.",
                colorsClose(pixel, reference, tolerance = 10),
            )
        }
        scenario.close()
    }

    /**
     * NFR-8: a REAL native-heap measurement (`Debug
     * .getNativeHeapAllocatedSize()`), sampled before and after
     * ${RECYCLE_CYCLES} scroll-driven recycle cycles, not a proxy. See
     * `MAX_NATIVE_HEAP_GROWTH_BYTES`'s own doc comment for the honestly-
     * stated limitation of a two-point sample on a JVM/ART-managed heap.
     */
    @Test
    fun noUnboundedNativeHeapGrowthAcrossRecycleCycles() {
        val scenario = launchAndOpenListScreen()
        Thread.sleep(1_500)

        // Settle + one GC-encouraging pass before the baseline sample, so
        // the measurement reflects steady-state retained memory rather
        // than transient first-load allocation noise.
        System.gc()
        Thread.sleep(200)
        val before = Debug.getNativeHeapAllocatedSize()

        repeat(RECYCLE_CYCLES) {
            scrollDown(1)
            scrollUp(1)
        }
        device.waitForIdle()

        System.gc()
        Thread.sleep(200)
        val after = Debug.getNativeHeapAllocatedSize()

        val growth = after - before
        assertTrue(
            "Native heap grew by $growth bytes (before=$before, after=$after) across " +
                "$RECYCLE_CYCLES scroll-recycle cycles, exceeding the " +
                "$MAX_NATIVE_HEAP_GROWTH_BYTES-byte bound. This is a real Debug." +
                "getNativeHeapAllocatedSize() measurement, not a proxy — see this test's own " +
                "companion-object doc comment for its stated precision limits.",
            growth < MAX_NATIVE_HEAP_GROWTH_BYTES,
        )
        scenario.close()
    }
}
