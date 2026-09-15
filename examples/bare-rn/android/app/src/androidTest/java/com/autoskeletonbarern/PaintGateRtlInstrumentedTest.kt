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
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import com.facebook.react.modules.i18nmanager.I18nUtil
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The RTL half of the paint gate, and the reason it exists as its own class:
 * until this file, NOT ONE on-device gate ran right-to-left. That is how a
 * synthesized text line stayed anchored to the wrong edge without anything
 * going red.
 *
 * WHAT THE DEFECT LOOKED LIKE. A synthesized line is deliberately narrower
 * than its frame (`MAX_WIDTH_RATIO` = 0.85 for a single line), so it has to
 * hang from the LEADING edge. It hung from `x` unconditionally, which is
 * correct in LTR and wrong in RTL: the placeholder sat over the blank half of
 * the frame while the live glyphs — flush right — stayed in the clear.
 * Measured on this emulator before the fix, in real pixels of 1080:
 *
 *     container            : 356 → 1037
 *     glyphs               : 608 → 1012   (flush right, as RTL requires)
 *     synthesized skeleton : 377 →  921   (the SAME rect it produced in LTR)
 *     left exposed         : 922 → 1012   (~90px, the word "block", readable)
 *
 * After the fix the skeleton is 473 → 1017 — the exact mirror.
 *
 * WHAT THIS GATE ASSERTS, and why it is phrased as a gap comparison rather
 * than an absolute coordinate. The skeleton covers a contiguous run of the
 * block; whatever it does not cover shows the block's own fill. Which SIDE
 * that uncovered gap falls on is the whole defect, and it is invariant across
 * densities, fonts and screen sizes — an absolute pixel bound would not be.
 * So: under RTL the gap must sit on the LEFT. Under the defect it sat on the
 * right, which is precisely what makes this assertion non-vacuous.
 *
 * WHY THE ARABIC BLOCK IS HERE. The Latin block cannot carry this gate on
 * iOS — with no `textAlign` declared, React Native leaves Latin glyphs on the
 * left under RTL and a left-anchored skeleton covers them by coincidence, so
 * the gate would PASS with the defect in place. `App.tsx` pins
 * `textAlign: 'start'` on both blocks for exactly that reason, and adds an
 * Arabic block whose every strong character is RTL. Both are asserted here so
 * the two platforms' gates stay symmetric.
 */
@RunWith(AndroidJUnit4::class)
class PaintGateRtlInstrumentedTest {
    companion object {
        /** 60s was not enough and the failure was indistinguishable from a real
         *  regression: on a freshly booted emulator the system's own apps ANR in
         *  a pile (`gms.persistent`, `settings.intelligence`, `dialer`) while RN
         *  is still fetching from Metro, and the gate reported "never mounted"
         *  for what was only a slow cold start. A mount timeout is not a
         *  behavioural assertion — nothing about the anchor is proven by being
         *  fast — so it is set generously on purpose. */
        private const val MOUNT_TIMEOUT_MS = 180_000L
        private const val COLOR_TOLERANCE = 16

        private const val LABEL_TEXT_LTR_STRING = "paint-gate-text"
        private const val LABEL_TEXT_RTL_STRING = "paint-gate-text-rtl"

        /** `PAINT_GATE_FIXTURE.colors` — kept in sync with `App.tsx`, whose
         *  header says not to change one without the other. */
        private val FILL_TEXT = Color.parseColor("#101010")
        private val FILL_TEXT_RTL = Color.parseColor("#8B0000")

        /** `native/AutoSkeleton.tsx`'s `DEFAULT_THEME`. */
        private val SKELETON_BASE = Color.parseColor("#E2E2E2")
        private val SKELETON_HIGHLIGHT = Color.parseColor("#F5F5F5")
    }

    private lateinit var device: UiDevice

    @Before
    fun setUp() {
        device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        // RN's own public switch, and the same storage its JS `I18nManager`
        // writes: SharedPreferences `…i18nmanager.I18nUtil`, key
        // `RCTI18nUtil_forceRTL`. Driving it here instead of walking the demo
        // UI keeps the gate deterministic — and the flag has to be set BEFORE
        // the Activity is created, because the layout direction is read as the
        // view tree is built, not re-read afterwards.
        I18nUtil.instance.forceRTL(InstrumentationRegistry.getInstrumentation().targetContext, true)
    }

    @After
    fun tearDown() {
        // NOT optional. `forceRTL` PERSISTS across process restarts (RN
        // documents this), so leaving it on would silently flip every later
        // test — and every subsequent manual run on this emulator — into RTL.
        I18nUtil.instance.forceRTL(InstrumentationRegistry.getInstrumentation().targetContext, false)
    }

    @RequiresApi(Build.VERSION_CODES.O)
    @Test
    fun synthesizedTextLineHangsFromTheTrailingEdgeUnderRtl() {
        val scenario = launchAndWaitForMount()
        try {
            val bitmap = screenshotBitmap(scenario)
            assertGapIsOnTheLeft(bitmap, LABEL_TEXT_RTL_STRING, FILL_TEXT_RTL)
            assertGapIsOnTheLeft(bitmap, LABEL_TEXT_LTR_STRING, FILL_TEXT)
        } finally {
            scenario.close()
        }
    }

    /**
     * Scans the block's centre row and asserts the UNCOVERED region — the part
     * still showing the block's own fill — sits on the LEFT, which is where a
     * right-anchored line leaves it.
     *
     * THE ORACLE IS THE FILL, NOT THE RAMP, and that is not a stylistic
     * choice: the first version of this gate keyed off the skeleton ramp and
     * was VACUOUS. The fixture's glyphs are `#ffffff`, and the ramp check
     * spans `#E2E2E2`..`#F5F5F5` inflated by a ±16 tolerance, which reaches
     * 255 — so every white glyph counted as "skeleton painted here". With the
     * anchor deliberately reverted the gate still passed, reporting a ramp of
     * 675..1014 for a line that is only 544px wide: it had measured the text
     * as part of the placeholder. The block's fill (`#101010`, `#8B0000`) is
     * saturated and far from both the ramp and white, so "fill is visible
     * here" is an unambiguous reading of "the skeleton is NOT covering this".
     *
     * Counting fill pixels per half — rather than locating edges — also
     * survives the glyphs sitting inside the uncovered gap: they punch holes
     * in the fill run, but they cannot move which half the bulk of it is in.
     */
    private fun assertGapIsOnTheLeft(bitmap: Bitmap, label: String, fill: Int) {
        val bounds = boundsOf(label)
        val y = ((bounds.top + bounds.bottom) / 2).coerceIn(0, bitmap.height - 1)
        val left = bounds.left.coerceIn(0, bitmap.width - 1)
        val right = (bounds.right - 1).coerceIn(0, bitmap.width - 1)
        val middle = (left + right) / 2

        var fillLeft = 0
        var fillRight = 0
        var rampPixels = 0
        for (x in left..right) {
            val pixel = bitmap.getPixel(x, y)
            when {
                colorsClose(pixel, fill) -> if (x < middle) fillLeft++ else fillRight++
                colorInRamp(pixel, SKELETON_BASE, SKELETON_HIGHLIGHT) -> rampPixels++
            }
        }

        android.util.Log.i(
            "AutoskeletonRtlGate",
            "$label bounds=${bounds.left}..${bounds.right} y=$y " +
                "fillLeft=$fillLeft fillRight=$fillRight ramp=$rampPixels",
        )

        // Anti-vacuity: with no skeleton on screen at all, "the fill is mostly
        // on the left" could be satisfied by an empty or half-drawn frame.
        assertTrue(
            "FIXTURE FAILURE (not this gate's assertion): only ${rampPixels}px of skeleton ramp " +
                "across \"$label\" at y=$y. Either the skeleton never painted or the fixture " +
                "colours drifted from App.tsx — either way there is nothing here to judge.",
            rampPixels > bounds.width() / 4,
        )

        assertTrue(
            "RTL ANCHOR REGRESSION on \"$label\": ${hex(fill)} is still visible for ${fillRight}px " +
                "in the RIGHT half of ${bounds.left}..${bounds.right} against only ${fillLeft}px " +
                "in the left half. Under RTL the synthesized line must hang from the TRAILING " +
                "(right) edge, so the uncovered gap belongs on the LEFT. A gap on the right is " +
                "the original defect: the line kept its LTR origin while the glyphs moved to the " +
                "right edge, leaving live text in the open beside a placeholder standing over " +
                "blank space.",
            fillLeft > fillRight,
        )
    }

    private fun launchAndWaitForMount(): ActivityScenario<MainActivity> {
        val scenario = ActivityScenario.launch(MainActivity::class.java)
        val mounted = device.wait(Until.hasObject(By.desc(LABEL_TEXT_RTL_STRING)), MOUNT_TIMEOUT_MS)
        assertTrue(
            "FIXTURE FAILURE (not the gate's own assertion): PaintGateScreen never mounted " +
                "within ${MOUNT_TIMEOUT_MS}ms, or it mounted without the RTL text block — the JS " +
                "bundle, the Metro connection, or the App.tsx fixture is broken, not the anchor.",
            mounted,
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
                    if (result == PixelCopy.SUCCESS) bitmap = out
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

    /** Tight per-channel match against one of the fixture's opaque fills. The
     *  tolerance stays small on purpose: these colours were chosen to be
     *  mutually distinct AND distinct from the skeleton ramp, so a loose match
     *  here would give back exactly the ambiguity this oracle exists to avoid. */
    private fun colorsClose(a: Int, b: Int, tolerance: Int = COLOR_TOLERANCE): Boolean {
        return Math.abs(Color.red(a) - Color.red(b)) <= tolerance &&
            Math.abs(Color.green(a) - Color.green(b)) <= tolerance &&
            Math.abs(Color.blue(a) - Color.blue(b)) <= tolerance
    }

    /** Same ramp oracle the LTR gate uses: an animated two-stop gradient means
     *  a covered pixel is legitimately anywhere between base and highlight. */
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
}
