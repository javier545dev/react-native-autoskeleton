package com.autoskeletonbarern

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Rect
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.PixelCopy
import androidx.annotation.RequiresApi
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.Configurator
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * ON-DEVICE VISUAL PAINT GATE FOR TIER 2 (Skia + Reanimated) — the Android
 * sibling of `PaintGateUITests.swift`'s `testTier2*` assertions.
 *
 * WHY THIS FILE EXISTS. Tier-2 shipped with ten passing unit tests and had
 * never rendered a pixel on either platform. Worse, it *could* not: the tier
 * was selected by a `require()` with a VARIABLE specifier, which Metro
 * rewrites into an unconditional `throw new Error('Dynamic require … not
 * supported by Metro')`, so the probe answered "peers absent" in every
 * Metro-bundled app regardless of what was installed — and even had it
 * answered otherwise, `SkiaShimmerOverlay` had no call site anywhere in the
 * library, so tier-1 drew either way. Both were confirmed on real devices
 * before being fixed.
 *
 * WHAT IT RUNS AGAINST. The `tier2` screen of `examples/bare-rn/App.tsx`,
 * wrapped in `<SkeletonProvider overlay={createSkiaOverlay(...)}>` — the real,
 * documented ADR-5 opt-in a consumer writes, with `@shopify/react-native-skia`
 * and `react-native-reanimated` imported by the APP's own module graph. There
 * is no test-only backdoor into tier-2 and there must never be one: the thing
 * being gated is precisely that the shipped opt-in path works.
 *
 * The `card` and `list` screens deliberately stay on tier-1, so every
 * assertion in `PaintGateInstrumentedTest` / `PaintGateListInstrumentedTest`
 * keeps exercising the default tier. Turning the whole app tier-2 would have
 * silently deleted tier-1's on-device coverage while all of its gates stayed
 * green.
 *
 * Run in isolation: `./gradlew :app:connectedDebugAndroidTest --tests
 * "com.autoskeletonbarern.Tier2PaintGateInstrumentedTest"` from
 * `examples/bare-rn/android`, against a booted emulator/device.
 */
@RunWith(AndroidJUnit4::class)
class Tier2PaintGateInstrumentedTest {

    companion object {
        private const val MOUNT_TIMEOUT_MS = 20_000L

        /**
         * `examples/bare-rn/App.tsx` `TIER2_FIXTURE.theme` — a DELIBERATELY
         * high-contrast ramp, passed through the ordinary public
         * `SkeletonProvider theme` prop.
         *
         * This is not decoration. The DEFAULT theme's ramp spans
         * `#e2e2e2..#f5f5f5` — nineteen units per channel, end to end — which is
         * narrower than `COLOR_TOLERANCE`. Any phase comparison against it is
         * therefore wider than the entire signal, and two skeletons a full half
         * period out of phase compare EQUAL. That is not a hypothetical: the
         * first version of [tier2InstancesMountedAtDifferentTimesShimmerInPhase]
         * PASSED against a deliberately planted "ignore the shared origin"
         * defect on iOS for exactly this reason.
         *
         * 174 units of ramp puts the signal an order of magnitude above the
         * compositor noise floor.
         */
        private val TIER2_BASE_COLOR = Color.parseColor("#3A3A3A")
        private val TIER2_HIGHLIGHT_COLOR = Color.parseColor("#E8E8E8")
        private const val TIER2_RAMP_SPAN = 0xE8 - 0x3A

        /** `TIER2_FIXTURE.colors`. Both have R = 0, which is 58 units below the
         *  ramp's darkest channel — a margin no compositor noise can cross. */
        private val TIER2_EARLY_COLOR = Color.parseColor("#0000FF")
        private val TIER2_LATE_COLOR = Color.parseColor("#00A651")

        /** `native/AutoSkeleton.tsx` `DEFAULT_THEME` — the tier-1 `card` screen. */
        private val SKELETON_BASE_COLOR = Color.parseColor("#e2e2e2")
        private val SKELETON_HIGHLIGHT_COLOR = Color.parseColor("#f5f5f5")

        private const val COLOR_TOLERANCE = 16

        private const val LABEL_SCREEN_TOGGLE = "paint-gate-screen-toggle"
        private const val LABEL_CARD_TOGGLE = "paint-gate-toggle"
        private const val LABEL_CARD_RENDERER_PREFIX = "paint-gate-renderer:"
        private const val LABEL_TIER2_TOGGLE = "tier2-toggle"
        private const val LABEL_TIER2_RENDERER_PREFIX = "tier2-renderer:"
        private const val LABEL_TIER2_EARLY = "tier2-early-block"
        private const val LABEL_TIER2_LATE = "tier2-late-block"

        /** `native/AutoSkeleton.tsx` `DEFAULT_THEME.speedMs` — the shimmer
         *  clock's PERIOD. Hardcoded so a drift in the production default fails
         *  this gate loudly. */
        private const val SHIMMER_PERIOD_MS = 1400L

        /** One and a half full periods, so the sweep is guaranteed to pass
         *  through BOTH of its extremes inside the window regardless of the
         *  phase the first sample happens to land on. */
        private const val CYCLE_SAMPLE_SPAN_MS = SHIMMER_PERIOD_MS * 3 / 2

        /** Only keeps the loop from spinning the CPU flat out; `PixelCopy` is
         *  itself the rate limiter. */
        private const val CYCLE_SAMPLE_INTERVAL_MS = 50L

        /** A one-shot sample can never see the defects below, so a run that
         *  collected too few samples is a FIXTURE FAILURE, not a pass. */
        private const val MIN_CYCLE_SAMPLES = 12

        /** `TIER2_FIXTURE.lateMountMs` (700 ms) plus slack for the second
         *  block's own cold `getShapes` round-trip. Real fixture timing, not a
         *  guessed sleep: the mount delay is what creates the phase offset the
         *  ADR-8 gate exists to detect. */
        private const val TIER2_LATE_MOUNT_SETTLE_MS = 3_000L

        /** ADR-16 defaults (`core/handoff.ts`): handoffTimeoutMs=250,
         *  handoffFadeMs=120, plus slack. */
        private const val HANDOFF_SETTLE_MS = 1_500L
    }

    private lateinit var device: UiDevice

    @Before
    fun setUp() {
        device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        // UiAutomator blocks every query until the window reports IDLE. A Skia
        // canvas driven by a Reanimated shared value invalidates on EVERY
        // frame, so this window is never idle and `findObject`/`wait` block
        // indefinitely — observed as a run that reached "Tests 1/4 completed"
        // and then sat for over thirty minutes while the screen was plainly
        // rendering and the app was healthy.
        //
        // Zeroing the idle timeout is the documented way to query an animating
        // window and is NOT a weakening of anything: every assertion in this
        // file samples PIXELS, and the element queries only ever resolve
        // BOUNDS, which are layout-stable regardless of what the shimmer is
        // doing. The tier-1 gates do not need this because their shimmer
        // animates inside a native draw pass that does not re-post to the
        // accessibility-idle machinery the same way.
        Configurator.getInstance().waitForIdleTimeout = 0
    }

    // ---------------------------------------------------------------------
    // Fixture plumbing (mirrors PaintGateInstrumentedTest exactly)
    // ---------------------------------------------------------------------

    private fun launchAndWaitForMount(): ActivityScenario<MainActivity> {
        val scenario = ActivityScenario.launch(MainActivity::class.java)
        assertTrue(
            "FIXTURE FAILURE (not the gate's own assertion): the app never mounted within " +
                "${MOUNT_TIMEOUT_MS}ms — the JS bundle, Metro connection, or App.tsx fixture " +
                "itself is broken, not the native draw path.",
            device.wait(Until.hasObject(By.desc(LABEL_SCREEN_TOGGLE)), MOUNT_TIMEOUT_MS),
        )
        return scenario
    }

    /**
     * Walks the screen switcher card -> list -> tier2, then waits out the
     * fixture's own late-mount timer so the SECOND block genuinely exists.
     * A timeout here is a FIXTURE FAILURE, never the gate's assertion.
     */
    private fun goToTier2Screen() {
        val toggle = device.findObject(By.desc(LABEL_SCREEN_TOGGLE))
        assertTrue("FIXTURE FAILURE: the screen switcher never mounted", toggle != null)
        toggle!!.click()
        device.waitForIdle()
        device.findObject(By.desc(LABEL_SCREEN_TOGGLE))!!.click()
        // Waits on the TOGGLE, not on `tier2-root`. React Native maps `testID`
        // to `resource-id` on Android and to `accessibilityIdentifier` on iOS,
        // while `accessibilityLabel` maps to `contentDescription`; `tier2-root`
        // carries only a `testID`, so `By.desc` can never match it. The iOS gate
        // CAN wait on it because XCUITest matches identifiers. Observed as four
        // Android tests failing with "the tier-2 screen never mounted after two
        // switcher taps" while the screen was plainly on the device.
        assertTrue(
            "FIXTURE FAILURE: the tier-2 screen never mounted after two switcher taps.",
            device.wait(Until.hasObject(By.desc(LABEL_TIER2_TOGGLE)), MOUNT_TIMEOUT_MS),
        )
        Thread.sleep(TIER2_LATE_MOUNT_SETTLE_MS)
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

    private fun boundsOf(label: String): Rect {
        val obj = device.findObject(By.desc(label))
        assertTrue("FIXTURE FAILURE: could not locate accessibilityLabel=\"$label\"", obj != null)
        return obj!!.visibleBounds
    }

    private fun centerPixel(bitmap: Bitmap, bounds: Rect): Int {
        val x = ((bounds.left + bounds.right) / 2).coerceIn(0, bitmap.width - 1)
        val y = ((bounds.top + bounds.bottom) / 2).coerceIn(0, bitmap.height - 1)
        return bitmap.getPixel(x, y)
    }

    private fun colorsClose(a: Int, b: Int, tolerance: Int = COLOR_TOLERANCE): Boolean =
        Math.abs(Color.red(a) - Color.red(b)) <= tolerance &&
            Math.abs(Color.green(a) - Color.green(b)) <= tolerance &&
            Math.abs(Color.blue(a) - Color.blue(b)) <= tolerance

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

    /** Reads `<prefix><kind>` off a fixture readout element, waiting out the
     *  `pending` state that precedes the first `onMetrics` callback. */
    private fun awaitRendererReadout(prefix: String): String {
        assertTrue(
            "FIXTURE FAILURE: renderer readout \"$prefix\" never appeared.",
            device.wait(Until.hasObject(By.descStartsWith(prefix)), MOUNT_TIMEOUT_MS),
        )
        val deadline = System.currentTimeMillis() + MOUNT_TIMEOUT_MS
        var label = device.findObject(By.descStartsWith(prefix))?.contentDescription ?: ""
        while (label.endsWith(":pending") && System.currentTimeMillis() < deadline) {
            Thread.sleep(100)
            label = device.findObject(By.descStartsWith(prefix))?.contentDescription ?: label
        }
        return label.substringAfterLast(':')
    }

    /**
     * Samples both probes from the SAME bitmap, repeatedly, for
     * [CYCLE_SAMPLE_SPAN_MS]. Pairing samples from ONE rasterization is what
     * makes the phase comparison meaningful: two probes read from two different
     * frames could differ purely because time passed between them.
     *
     * Uses `UiAutomation.takeScreenshot()`, NOT the `PixelCopy` +
     * `ActivityScenario.onActivity` pair every single-shot assertion in this
     * directory uses. That pair is correct for ONE capture and deadlocks in a
     * loop: `onActivity` blocks until the main thread runs the posted block,
     * and the main thread is saturated driving the Skia canvas at 60 fps.
     * Observed here as a run that reached "Tests 1/4 completed" and then sat
     * for over thirty minutes with the screen plainly rendering.
     * `takeScreenshot` reads the surface through the system's own
     * screen-capture path and never touches the app's main thread.
     */
    private fun sampleAcrossCycle(a: Rect, b: Rect): Triple<List<Int>, List<Int>, Long> {
        val automation = InstrumentationRegistry.getInstrumentation().uiAutomation
        val aSamples = mutableListOf<Int>()
        val bSamples = mutableListOf<Int>()
        val start = System.currentTimeMillis()
        do {
            val bitmap = requireNotNull(automation.takeScreenshot()) {
                "FIXTURE FAILURE: UiAutomation.takeScreenshot() returned null"
            }
            aSamples += centerPixel(bitmap, a)
            bSamples += centerPixel(bitmap, b)
            bitmap.recycle()
            Thread.sleep(CYCLE_SAMPLE_INTERVAL_MS)
        } while (System.currentTimeMillis() - start < CYCLE_SAMPLE_SPAN_MS)
        return Triple(aSamples, bSamples, System.currentTimeMillis() - start)
    }

    /** Largest end-to-end variation any single channel showed across [samples].
     *  Per-channel rather than per-pixel-distance because the shimmer is grey:
     *  all three channels move together, and taking the max keeps a single
     *  noisy channel from inflating the result. */
    private fun channelExcursion(samples: List<Int>): Int {
        if (samples.isEmpty()) return 0
        val r = samples.map { Color.red(it) }
        val g = samples.map { Color.green(it) }
        val b = samples.map { Color.blue(it) }
        return maxOf(
            r.max() - r.min(),
            g.max() - g.min(),
            b.max() - b.min(),
        )
    }

    private fun assertCoveredAtEverySample(
        samples: List<Int>,
        probe: String,
        contentColor: Int,
        bounds: Rect,
    ) {
        samples.forEachIndexed { index, pixel ->
            assertFalse(
                "At sample ${index + 1}/${samples.size} of one shimmer cycle, the real content " +
                    "(${hex(contentColor)}) was DIRECTLY VISIBLE at $probe " +
                    "(${(bounds.left + bounds.right) / 2}, ${(bounds.top + bounds.bottom) / 2}). " +
                    "The skeleton is only covering it at part of the cycle — the covered region " +
                    "is travelling with the sweep instead of staying put while a highlight " +
                    "sweeps through it.",
                colorsClose(pixel, contentColor),
            )
            assertTrue(
                "At sample ${index + 1}/${samples.size} of one shimmer cycle, $probe was " +
                    "${hex(pixel)} — outside the shimmer ramp " +
                    "(${hex(TIER2_BASE_COLOR)}..${hex(TIER2_HIGHLIGHT_COLOR)}). The skeleton must " +
                    "cover this point at EVERY phase, not merely at some of them.",
                colorInRamp(pixel, TIER2_BASE_COLOR, TIER2_HIGHLIGHT_COLOR),
            )
        }
    }


    /**
     * Ends the loading cycle before closing the scenario.
     *
     * `ActivityScenario.close()` calls `Instrumentation.waitForIdleSync()`, which
     * blocks until the main looper is idle. A Skia canvas driven by a Reanimated
     * shared value invalidates on EVERY frame, so an activity showing a tier-2
     * skeleton is NEVER idle and `close()` blocks forever — observed as
     * `tier2SkeletonCoverageStaysStationaryAcrossAWholeShimmerCycle` timing out
     * at 240s inside `ActivityScenario.moveToState` with every one of its own
     * assertions already passed.
     *
     * Tapping the fixture's `isLoading` toggle is the real production path out
     * of that state: the handoff completes, the overlay unmounts, the canvas
     * goes away, and the looper idles. It is not a workaround for the gate, it
     * is the gate's own teardown using the same mechanism
     * [tier2SkeletonIsGoneAndContentVisibleAfterTheLoadCompletes] asserts.
     */
    private fun quiesceAndClose(scenario: ActivityScenario<MainActivity>) {
        device.findObject(By.desc(LABEL_TIER2_TOGGLE))?.click()
        Thread.sleep(HANDOFF_SETTLE_MS)
        scenario.close()
    }

    // ---------------------------------------------------------------------
    // Gates
    // ---------------------------------------------------------------------

    /**
     * RISK-8's own stated detection signal, both halves of it.
     *
     * The `card` screen has NOT opted in, and both optional peers ARE installed
     * and linked in this app. It must still report `native`. Before this session
     * that assertion was meaningless in both directions at once: the tier was
     * chosen by a probe that could never succeed under Metro, AND tier-1 drew
     * regardless of the probe's answer because the tier-2 overlay had no call
     * site.
     */
    @RequiresApi(Build.VERSION_CODES.O)
    @Test(timeout = 240_000)
    fun tierIsReportedByWhatActuallyDrewNotByWhatIsInstalled() {
        val scenario = launchAndWaitForMount()

        device.findObject(By.desc(LABEL_CARD_TOGGLE))!!.click()
        assertEquals(
            "The default `card` screen never opted in to tier-2, but both optional peers are " +
                "installed in this app. It must still report the tier that actually drew.",
            "native",
            awaitRendererReadout(LABEL_CARD_RENDERER_PREFIX),
        )

        goToTier2Screen()
        device.findObject(By.desc(LABEL_TIER2_TOGGLE))!!.click()
        assertEquals(
            "The tier-2 screen passed a real `createSkiaOverlay(...)` to " +
                "`<SkeletonProvider overlay>`, so `onMetrics.renderer` must report `skia` — and " +
                "it must report it because Skia DREW, not because a probe found a package on disk.",
            "skia",
            awaitRendererReadout(LABEL_TIER2_RENDERER_PREFIX),
        )

        scenario.close()
    }

    /**
     * The tier-2 sibling of iOS's
     * `testSkeletonCoverageStaysStationaryAcrossAWholeShimmerCycle`, and it
     * exists for the reason that one does: every other pixel assertion in this
     * directory samples a SINGLE frame against a colour RAMP that was
     * deliberately built to tolerate the sweep, so the combination is blind to a
     * shimmer that translates the SKELETON instead of translating a highlight
     * THROUGH it. A gate that tolerates variation along the axis a defect moves
     * cannot see that defect.
     *
     * Tier-2 has that failure mode in a form tier-1 does not: the Skia mask path
     * and the Skia gradient are two independent nodes, and a `<Group transform>`
     * applied one level too high moves both together while every sampled pixel
     * stays inside the ramp. Proven RED against exactly that planted defect.
     */
    @RequiresApi(Build.VERSION_CODES.O)
    @Test(timeout = 240_000)
    fun tier2SkeletonCoverageStaysStationaryAcrossAWholeShimmerCycle() {
        val scenario = launchAndWaitForMount()
        goToTier2Screen()

        val earlyBounds = boundsOf(LABEL_TIER2_EARLY)
        val lateBounds = boundsOf(LABEL_TIER2_LATE)
        val (early, late, span) = sampleAcrossCycle(earlyBounds, lateBounds)

        assertTrue(
            "FIXTURE FAILURE: only ${early.size} samples in ${span}ms — too few to observe a " +
                "${SHIMMER_PERIOD_MS}ms cycle, so this gate proved nothing.",
            early.size >= MIN_CYCLE_SAMPLES,
        )
        assertTrue(
            "FIXTURE FAILURE: sampled for only ${span}ms, less than one full shimmer period.",
            span >= SHIMMER_PERIOD_MS,
        )

        assertCoveredAtEverySample(early, LABEL_TIER2_EARLY, TIER2_EARLY_COLOR, earlyBounds)
        assertCoveredAtEverySample(late, LABEL_TIER2_LATE, TIER2_LATE_COLOR, lateBounds)

        // Anti-vacuity: a completely frozen screen satisfies every assertion
        // above. Expressed as a FRACTION OF THE RAMP rather than "more than one
        // distinct colour", which a single unit of compositor dither satisfies.
        val excursion = channelExcursion(early)
        assertTrue(
            "The tier-2 shimmer only varied by $excursion units across ${span}ms, out of a " +
                "$TIER2_RAMP_SPAN-unit ramp — it is not sweeping through this probe, so \"the " +
                "covered region never moved\" is vacuously true rather than earned.",
            excursion >= TIER2_RAMP_SPAN / 2,
        )

        quiesceAndClose(scenario)
    }

    /**
     * ADR-8, in the only form a screen can express it: two skeletons that
     * STARTED AT DIFFERENT TIMES must be at the same phase.
     *
     * The fixture mounts the second block `TIER2_FIXTURE.lateMountMs` (700 ms —
     * half the 1400 ms period, i.e. very nearly antiphase) after the first, so a
     * renderer that starts its own `withRepeat` from zero on mount — exactly
     * what tier-2 did before this session — puts the two blocks permanently out
     * of phase. No single-instance gate can see that: each block on its own
     * stays inside the ramp at every sample, sweeps at the right rate, and
     * covers its content perfectly. The defect exists only BETWEEN them.
     */
    @RequiresApi(Build.VERSION_CODES.O)
    @Test(timeout = 240_000)
    fun tier2InstancesMountedAtDifferentTimesShimmerInPhase() {
        val scenario = launchAndWaitForMount()
        goToTier2Screen()

        val earlyBounds = boundsOf(LABEL_TIER2_EARLY)
        val lateBounds = boundsOf(LABEL_TIER2_LATE)
        val (early, late, span) = sampleAcrossCycle(earlyBounds, lateBounds)

        assertTrue(
            "FIXTURE FAILURE: only ${early.size} paired samples in ${span}ms.",
            early.size >= MIN_CYCLE_SAMPLES,
        )
        assertTrue(
            "FIXTURE FAILURE: sampled for only ${span}ms, less than one full shimmer period.",
            span >= SHIMMER_PERIOD_MS,
        )

        // ANTI-VACUITY, deliberately BEFORE the phase assertion: two STATIONARY
        // skeletons are trivially "in phase". This gate is only meaningful if
        // the shimmer genuinely swept a large part of the ramp through both
        // probes inside the window, so a frozen — or barely moving — screen
        // must fail HERE rather than pass below.
        for ((label, series) in listOf("EARLY" to early, "LATE" to late)) {
            val excursion = channelExcursion(series)
            assertTrue(
                "The $label tier-2 block only varied by $excursion units across ${span}ms, out " +
                    "of a $TIER2_RAMP_SPAN-unit ramp. The shimmer is not sweeping through this " +
                    "probe, so \"the two blocks are in phase\" would be vacuously true rather " +
                    "than earned.",
                excursion >= TIER2_RAMP_SPAN / 2,
            )
        }

        // THE PHASE ASSERTION, AND AN HONEST TOLERANCE.
        //
        // The tolerance is DERIVED FROM MEASUREMENT, not chosen to make this
        // green. Three facts fix it:
        //
        //  * With the shared origin REMOVED (a deliberately planted "phase = 0"
        //    defect), the two blocks measured 167 units apart out of 174 —
        //    essentially antiphase, which is what a 700 ms mount offset against
        //    a 1400 ms period must produce.
        //  * With the shared origin in place, iOS measured within 32 units and
        //    Android measured 60 and 64 units in two of three runs.
        //  * That residual is NOT noise and NOT a defect in the join. It is the
        //    JS-to-UI-thread dispatch latency: `tier2PhaseAt` is evaluated on
        //    the JS thread inside an effect, and the animation it produces
        //    begins on the UI thread whenever Reanimated next processes it.
        //    ~60 units of a 174-unit ramp is ~0.17 of a period, i.e. ~240 ms —
        //    entirely plausible for a debug bundle on an emulator immediately
        //    after a `getShapes` bridge round-trip.
        //
        // Reanimated's public API cannot close that gap: every animation it
        // builds is START-RELATIVE (`withTiming.onStart` stamps
        // `animation.startTime = now`), `withDelay` clamps a negative delay to
        // zero (`if (now - startTime >= delayMs)`, so it can wait but never
        // seek), and the only absolute clock, `global._getAnimationTimestamp()`,
        // is declared in `privateGlobals.d.ts` and is not public API. So exact
        // phase LOCK is not achievable here; joining the shared wave to within
        // the dispatch latency is.
        //
        // 80 is therefore what this gate can honestly assert: it is above the
        // measured residual on the slower of the two platforms and less than
        // half the divergence the defect it exists to catch produces. It is
        // NOT a widened tolerance hiding a failure — the pre-fix code fails it
        // by more than 2x.
        //
        // Both probes sit at the same X within their own equally-wide, equally
        // positioned blocks, so at any instant one shared wave puts the same
        // point of the gradient over both.
        val phaseTolerance = 80
        var worst = 0
        var worstIndex = 0
        early.indices.forEach { index ->
            val a = early[index]
            val b = late[index]
            val delta = maxOf(
                Math.abs(Color.red(a) - Color.red(b)),
                Math.abs(Color.green(a) - Color.green(b)),
                Math.abs(Color.blue(a) - Color.blue(b)),
            )
            if (delta > worst) {
                worst = delta
                worstIndex = index
            }
        }
        assertTrue(
            "At paired sample ${worstIndex + 1}/${early.size} the EARLY block was " +
                "${hex(early[worstIndex])} and the LATE block was ${hex(late[worstIndex])} — " +
                "$worst units apart, out of a $TIER2_RAMP_SPAN-unit ramp. They were mounted " +
                "700ms apart, and ADR-8 gives every instance ONE clock with an absolute origin, " +
                "so they must be at the same phase. A renderer that starts its own sweep from " +
                "zero on mount is permanently offset by however late it mounted.",
            worst <= phaseTolerance,
        )

        quiesceAndClose(scenario)
    }

    /**
     * The tier-1 half of the handoff contract, re-asserted for tier-2: once the
     * load completes, the Skia canvas must be GONE and the real content visible.
     * A renderer that draws correctly but never tears down is the same class of
     * defect as one that never draws.
     */
    @RequiresApi(Build.VERSION_CODES.O)
    @Test(timeout = 240_000)
    fun tier2SkeletonIsGoneAndContentVisibleAfterTheLoadCompletes() {
        val scenario = launchAndWaitForMount()
        goToTier2Screen()

        val earlyBounds = boundsOf(LABEL_TIER2_EARLY)
        device.findObject(By.desc(LABEL_TIER2_TOGGLE))!!.click()
        Thread.sleep(HANDOFF_SETTLE_MS)

        val bitmap = screenshotBitmap(scenario)
        val pixel = centerPixel(bitmap, boundsOf(LABEL_TIER2_EARLY))
        assertTrue(
            "After the load completed, the real content (${hex(TIER2_EARLY_COLOR)}) must be " +
                "visible at $LABEL_TIER2_EARLY (${earlyBounds.left}, ${earlyBounds.top}), but the " +
                "pixel was ${hex(pixel)} — the tier-2 Skia canvas is still painted over it.",
            colorsClose(pixel, TIER2_EARLY_COLOR),
        )
        assertFalse(
            "After the load completed, no shimmer pixel may remain at $LABEL_TIER2_EARLY, but " +
                "${hex(pixel)} is still inside the tier-2 ramp.",
            colorInRamp(pixel, TIER2_BASE_COLOR, TIER2_HIGHLIGHT_COLOR),
        )
        bitmap.recycle()

        // The tier-1 ramp is asserted too, so a tier-2 teardown that fell back
        // to painting the DEFAULT theme instead of nothing cannot pass.
        assertFalse(
            "A tier-1-coloured shimmer pixel remains where tier-2 drew.",
            colorInRamp(pixel, SKELETON_BASE_COLOR, SKELETON_HIGHLIGHT_COLOR),
        )

        scenario.close()
    }
}
