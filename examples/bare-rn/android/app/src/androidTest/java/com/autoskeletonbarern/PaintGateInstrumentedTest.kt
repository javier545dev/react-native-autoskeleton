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
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * task 5.7 (tasks.md Phase 5) — the ON-DEVICE VISUAL PAINT GATE.
 *
 * THIS TEST IS DELIBERATELY RED AND MUST NEVER BE WEAKENED, SKIPPED, OR
 * DELETED TO MAKE CI GREEN. It closes only when a real `AutoskeletonOverlayView`
 * `ViewManager` is registered by `AutoskeletonPackage` (Android) and actually
 * draws through `AutoskeletonRendererTier1.mount(surface:...)` — the exact gap
 * `apply-progress`/`tasks.md` 5.5 documents as still open. Until then, `<AutoSkeleton>`'s
 * `resolveAutoskeletonOverlayNativeComponent()` (`src/native/renderer/AutoskeletonOverlayHostComponent.tsx`)
 * fails safely to `null`, so `AutoSkeleton.tsx` never mounts an overlay at all —
 * the real content renders immediately, unobscured, even while `isLoading` is
 * `true`.
 *
 * What this test actually exercises, end to end, on a real emulator/device:
 * 1. Launches the REAL `AutoskeletonBareRn` app (`MainActivity`), which boots
 *    the real JS bundle and mounts the real `PaintGateScreen`
 *    (`examples/bare-rn/App.tsx`) — the exact fixture screen this brief asked
 *    for, imported from the published `autoskeleton` package via the real
 *    `getShapes` Turbo Module bridge (task 5.1) and the real `AutoskeletonSensor`
 *    (task 4.1).
 * 2. Locates each fixture region by its real `accessibilityLabel`
 *    (`contentDescription` on Android) via UiAutomator — never by guessed
 *    coordinates, so a layout change alone can never cause a false RED.
 * 3. Rasterizes the REAL, currently-displayed frame with `PixelCopy.request`
 *    against the `Activity`'s `Window` — never `View.draw(Canvas)`, which can
 *    silently miss GPU-composited content — then reads real ARGB pixels back.
 *
 * Why the debug overlay (`AutoskeletonDebugOverlay.kt`) cannot satisfy this
 * gate even once someone starts wiring native views: (a) the fixture never
 * passes `debugOverlay` to `<AutoSkeleton>`, so a spec-compliant
 * implementation never renders it here at all (REQ-OBS-OVERLAY-1 gates it
 * behind that prop, dev-build only); (b) even if a shortcut ignored that gate,
 * the debug overlay draws thin per-shape OUTLINE strokes, never a solid fill —
 * every pixel this test samples is the geometric CENTER of a fixture shape
 * (e.g. the middle of a 160x160 px placeholder), far from any stroke edge, so
 * only a genuine solid-fill production draw pass (`AutoskeletonRendererTier1`)
 * can turn that exact pixel into the skeleton's `baseColor`.
 *
 * Run in isolation: `./gradlew :app:connectedDebugAndroidTest --tests
 * "com.autoskeletonbarern.PaintGateInstrumentedTest"` (from
 * `examples/bare-rn/android`), against a booted emulator/device.
 */
@RunWith(AndroidJUnit4::class)
class PaintGateInstrumentedTest {

    companion object {
        private const val MOUNT_TIMEOUT_MS = 20_000L

        // native/AutoSkeleton.tsx's DEFAULT_THEME.baseColor/highlightColor — not
        // redefined anywhere else, deliberately hardcoded here so this test fails
        // loudly (wrong expected color) rather than silently (drifted alongside a
        // shared constant) if the production theme default ever changes.
        //
        // AutoskeletonRendererTier1.kt's `ensureShader()` builds ONE
        // `LinearGradient(baseColor, highlightColor, baseColor)` and translates it
        // every frame (never rebuilt — NFR-5), so "a skeleton painted here" means
        // "this pixel sampled at SOME shimmer phase between baseColor and
        // highlightColor", never "at this exact phase". A single-target-color
        // assertion against `baseColor` alone is a calibration bug: the
        // base->highlight per-channel delta (19) exceeds `COLOR_TOLERANCE` (16),
        // so any capture landing near the true highlight peak would fail this
        // assertion even on a fully correct implementation.
        private val SKELETON_BASE_COLOR = Color.parseColor("#e2e2e2")
        private val SKELETON_HIGHLIGHT_COLOR = Color.parseColor("#f5f5f5")

        // examples/bare-rn/App.tsx PAINT_GATE_FIXTURE.colors — real, opaque,
        // mutually distinct from SKELETON_BASE_COLOR and from each other.
        private val CONTENT_IMAGE_COLOR = Color.parseColor("#0000FF")
        private val CONTENT_CARD_COLOR = Color.parseColor("#00A651")

        // `<AutoSkeleton.Ignore>` bug-fix gate: `ignored` sits INSIDE
        // `<AutoSkeleton.Ignore>`, `ignoredSibling` is its NOT-ignored sibling
        // in the same frame.
        private val CONTENT_IGNORED_COLOR = Color.parseColor("#FF6600")
        private val CONTENT_IGNORED_SIBLING_COLOR = Color.parseColor("#8000FF")

        // Per-channel ARGB slack for device JPEG/scaling/compositor noise —
        // generous enough to absorb minor rendering variance, far too tight
        // for "wrong solid color entirely" (the failure mode under test) to
        // slip through.
        private const val COLOR_TOLERANCE = 16

        private const val LABEL_TOGGLE = "paint-gate-toggle"
        private const val LABEL_IMAGE = "paint-gate-image"
        private const val LABEL_CARD = "paint-gate-rounded-card"
        private const val LABEL_IGNORED_CONTENT = "paint-gate-ignored-content"
        private const val LABEL_IGNORED_SIBLING = "paint-gate-ignored-sibling"
        private const val LABEL_HINTED_CARD = "paint-gate-hinted-card"
        private const val LABEL_UNHINTED_CARD = "paint-gate-unhinted-card"

        // ADR-16 defaults (`core/handoff.ts`): handoffTimeoutMs=250,
        // handoffFadeMs=120. Waiting past both, plus slack, before sampling
        // post-toggle pixels is real production timing, not an arbitrary
        // sleep.
        private const val HANDOFF_SETTLE_MS = 600L
    }

    private lateinit var device: UiDevice

    @Before
    fun setUp() {
        device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
    }

    private fun launchAndWaitForMount(): ActivityScenario<MainActivity> {
        val scenario = ActivityScenario.launch(MainActivity::class.java)
        val mounted = device.wait(Until.hasObject(By.desc(LABEL_IMAGE)), MOUNT_TIMEOUT_MS)
        assertTrue(
            "FIXTURE FAILURE (not the gate's own assertion): PaintGateScreen never " +
                "mounted within ${MOUNT_TIMEOUT_MS}ms — the JS bundle, Metro connection, " +
                "or App.tsx fixture itself is broken, not the native draw path.",
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

    /** A pixel [inset] px in from the region's top-left CORNER — the exact
     *  spot a rounded/near-circular clip excludes but a square clip does
     *  not. Used by the typed-hint-channel radius gate below. */
    private fun cornerInsetPixel(bitmap: Bitmap, bounds: Rect, inset: Int): Int {
        val x = (bounds.left + inset).coerceIn(0, bitmap.width - 1)
        val y = (bounds.top + inset).coerceIn(0, bitmap.height - 1)
        return bitmap.getPixel(x, y)
    }

    private fun colorsClose(a: Int, b: Int, tolerance: Int = COLOR_TOLERANCE): Boolean {
        return Math.abs(Color.red(a) - Color.red(b)) <= tolerance &&
            Math.abs(Color.green(a) - Color.green(b)) <= tolerance &&
            Math.abs(Color.blue(a) - Color.blue(b)) <= tolerance
    }

    /**
     * True when every channel of [pixel] falls within the color RAMP spanning
     * [from]..[to] (inclusive of both ends, in either order), inflated by
     * [tolerance] at each end for device/compositor noise. This is the correct
     * "a skeleton painted here" oracle for an animated shimmer surface backed
     * by a two-stop `LinearGradient`: the sampled pixel can legitimately be at
     * ANY phase between [from] and [to], not just equal to [from].
     *
     * This is STRICTLY STRONGER than widening `COLOR_TOLERANCE`, which would
     * blur toward arbitrary colors near `baseColor` alone. Here every channel
     * is still bounded to the real gradient's own per-channel min/max (plus a
     * small tolerance), so an unrelated fixture color (e.g. `#0000FF`,
     * `#101010`, `#00A651` — none of which are within tolerance of the grey
     * 226..245 ramp on at least one channel) can never satisfy this check by
     * "content bleeding through".
     */
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

    /**
     * Assertion 1 of the brief: with `isLoading` true, skeleton pixels are
     * actually painted in the region the sensor detected a shape.
     *
     * The oracle is a color RAMP, not a single target color: the production
     * draw pass (`AutoskeletonRendererTier1.ensureShader()`) paints one
     * `LinearGradient(baseColor, highlightColor, baseColor)` translated every
     * frame, so any real capture can legitimately land at any phase between
     * `baseColor` and `highlightColor`. "A skeleton painted here" means "this
     * pixel is somewhere in the shimmer ramp", not "at this exact phase".
     */
    @RequiresApi(Build.VERSION_CODES.O)
    @Test
    fun skeletonPaintsOverDetectedShapes() {
        val scenario = launchAndWaitForMount()
        val bounds = boundsOf(LABEL_IMAGE)
        val bitmap = screenshotBitmap(scenario)
        val pixel = centerPixel(bitmap, bounds)
        assertTrue(
            "Expected a skeleton pixel within the shimmer ramp " +
                "(${hex(SKELETON_BASE_COLOR)}..${hex(SKELETON_HIGHLIGHT_COLOR)}) painted over the " +
                "detected image-placeholder shape while isLoading=true, but the pixel at " +
                "(${(bounds.left + bounds.right) / 2}, ${(bounds.top + bounds.bottom) / 2}) " +
                "was ${hex(pixel)} — outside the ramp, so nothing painted a skeleton there.",
            colorInRamp(pixel, SKELETON_BASE_COLOR, SKELETON_HIGHLIGHT_COLOR),
        )
        scenario.close()
    }

    /**
     * Assertion 2 of the brief: with `isLoading` true, the real content is
     * NOT visible.
     *
     * CURRENT FAILURE: the real content IS visible (its own fixture color is
     * exactly what gets sampled), because nothing ever draws over it.
     */
    @RequiresApi(Build.VERSION_CODES.O)
    @Test
    fun realContentHiddenWhileLoading() {
        val scenario = launchAndWaitForMount()
        val bounds = boundsOf(LABEL_IMAGE)
        val bitmap = screenshotBitmap(scenario)
        val pixel = centerPixel(bitmap, bounds)
        assertFalse(
            "Expected the real content (${hex(CONTENT_IMAGE_COLOR)} image placeholder) to be " +
                "hidden while isLoading=true, but it was directly visible at " +
                "${hex(pixel)} — no skeleton is covering it.",
            colorsClose(pixel, CONTENT_IMAGE_COLOR),
        )
        scenario.close()
    }

    /**
     * `<AutoSkeleton.Ignore>` bug-fix gate (this session's brief): with
     * `isLoading` true, the region wrapped in `<AutoSkeleton.Ignore>` must
     * show NO skeleton pixels (only its own fixture color), while its
     * NOT-ignored sibling in the exact same frame DOES show real skeleton
     * pixels. Both halves are asserted from the SAME `screenshotBitmap`
     * capture — asserting only the ignored half would pass even if the
     * whole skeleton failed to render at all, which is exactly why the
     * sibling assertion is not optional.
     */
    @RequiresApi(Build.VERSION_CODES.O)
    @Test
    fun ignoredRegionPaintsNoSkeletonWhileSiblingDoes() {
        val scenario = launchAndWaitForMount()
        val ignoredBounds = boundsOf(LABEL_IGNORED_CONTENT)
        val siblingBounds = boundsOf(LABEL_IGNORED_SIBLING)
        val bitmap = screenshotBitmap(scenario)

        val ignoredPixel = centerPixel(bitmap, ignoredBounds)
        val siblingPixel = centerPixel(bitmap, siblingBounds)

        assertTrue(
            "Expected the <AutoSkeleton.Ignore>-wrapped region to show its own " +
                "fixture color (${hex(CONTENT_IGNORED_COLOR)}) while isLoading=true " +
                "(no skeleton should ever be painted over ignored content), but the " +
                "pixel was ${hex(ignoredPixel)}.",
            colorsClose(ignoredPixel, CONTENT_IGNORED_COLOR),
        )
        assertFalse(
            "Expected NO skeleton ramp pixel over the <AutoSkeleton.Ignore>-wrapped " +
                "region while isLoading=true, but the pixel at " +
                "(${(ignoredBounds.left + ignoredBounds.right) / 2}, " +
                "${(ignoredBounds.top + ignoredBounds.bottom) / 2}) was " +
                "${hex(ignoredPixel)} — inside the shimmer ramp.",
            colorInRamp(ignoredPixel, SKELETON_BASE_COLOR, SKELETON_HIGHLIGHT_COLOR),
        )
        assertTrue(
            "Expected the NOT-ignored sibling region to show a real skeleton pixel " +
                "within the shimmer ramp (${hex(SKELETON_BASE_COLOR)}..${hex(SKELETON_HIGHLIGHT_COLOR)}) " +
                "in the SAME frame the ignored region was sampled from — proving the " +
                "skeleton itself painted at all, not just that the ignored region " +
                "happened to show nothing — but the pixel was ${hex(siblingPixel)}.",
            colorInRamp(siblingPixel, SKELETON_BASE_COLOR, SKELETON_HIGHLIGHT_COLOR),
        )
        assertFalse(
            "The NOT-ignored sibling's own fixture color " +
                "(${hex(CONTENT_IGNORED_SIBLING_COLOR)}) should be hidden by the " +
                "skeleton while isLoading=true, but it was directly visible.",
            colorsClose(siblingPixel, CONTENT_IGNORED_SIBLING_COLOR),
        )
        scenario.close()
    }

    /**
     * Assertion 3 of the brief: with `isLoading` false, the real content IS
     * visible and no skeleton pixels remain. This assertion documents the
     * required post-load state; it may already pass today only because
     * nothing ever hides the content in the first place (see the other two
     * assertions in this file for the actual defect).
     */
    @RequiresApi(Build.VERSION_CODES.O)
    @Test
    fun realContentVisibleAndSkeletonGoneAfterLoadCompletes() {
        val scenario = launchAndWaitForMount()
        val toggle = device.findObject(By.desc(LABEL_TOGGLE))
        assertTrue("FIXTURE FAILURE: could not locate the isLoading toggle", toggle != null)
        toggle!!.click()
        device.waitForIdle()
        Thread.sleep(HANDOFF_SETTLE_MS)

        val imageBounds = boundsOf(LABEL_IMAGE)
        val cardBounds = boundsOf(LABEL_CARD)
        val bitmap = screenshotBitmap(scenario)

        val imagePixel = centerPixel(bitmap, imageBounds)
        val cardPixel = centerPixel(bitmap, cardBounds)

        assertTrue(
            "Expected the real image-placeholder content (${hex(CONTENT_IMAGE_COLOR)}) visible " +
                "after isLoading=false, got ${hex(imagePixel)}",
            colorsClose(imagePixel, CONTENT_IMAGE_COLOR),
        )
        assertTrue(
            "Expected the real rounded-card content (${hex(CONTENT_CARD_COLOR)}) visible after " +
                "isLoading=false, got ${hex(cardPixel)}",
            colorsClose(cardPixel, CONTENT_CARD_COLOR),
        )
        assertFalse(
            "No skeleton pixels should remain over the image placeholder after isLoading=false",
            colorsClose(imagePixel, SKELETON_BASE_COLOR),
        )
        assertFalse(
            "No skeleton pixels should remain over the rounded card after isLoading=false",
            colorsClose(cardPixel, SKELETON_BASE_COLOR),
        )
        scenario.close()
    }

    /**
     * Typed-hint channel gate (this session's brief): a `radius` hint must
     * VISIBLY CHANGE THE PAINTED CORNER on Android — the primary radius
     * mechanism there, per brief §9c's on-device finding that no public API
     * otherwise recovers a rounded RN view's corner radius.
     *
     * Both fixture regions are SQUARE views (no `borderRadius` style at
     * all) of the SAME size, in the SAME frame. `hintedCard` is wrapped in
     * `<AutoSkeleton.Hint radius={40}>` (a near-circular radius on an 80x80
     * box); `unhintedCard` has no hint. A pixel a few px in from the
     * top-left CORNER of each region is the oracle: the rounded/circular
     * clip excludes it for the hinted region but a square clip does not
     * exclude it for the unhinted one — so the SAME corner-inset pixel must
     * differ between the two, proving the hint changed what was actually
     * painted, not merely that the API accepted a `radius` prop.
     */
    @RequiresApi(Build.VERSION_CODES.O)
    @Test
    fun hintedRadiusChangesThePaintedCornerOnAndroid() {
        val scenario = launchAndWaitForMount()
        val hintedBounds = boundsOf(LABEL_HINTED_CARD)
        val unhintedBounds = boundsOf(LABEL_UNHINTED_CARD)
        val bitmap = screenshotBitmap(scenario)

        // 3px in from an 80dp-square box's corner sits well inside the
        // corner arc excluded by radius=40 (sqrt(37^2+37^2) ≈ 52.3 > 40),
        // while comfortably inside a square (unrounded) box's own bounds.
        val inset = 3
        val hintedCorner = cornerInsetPixel(bitmap, hintedBounds, inset)
        val unhintedCorner = cornerInsetPixel(bitmap, unhintedBounds, inset)

        assertTrue(
            "Expected the UNHINTED (square) region's corner-inset pixel to show a real " +
                "skeleton pixel within the shimmer ramp (${hex(SKELETON_BASE_COLOR)}.." +
                "${hex(SKELETON_HIGHLIGHT_COLOR)}) — a square clip does not exclude a pixel " +
                "this close to its own corner — but it was ${hex(unhintedCorner)}.",
            colorInRamp(unhintedCorner, SKELETON_BASE_COLOR, SKELETON_HIGHLIGHT_COLOR),
        )
        assertFalse(
            "Expected the HINTED (radius=40) region's corner-inset pixel to be EXCLUDED " +
                "from the skeleton's rounded/near-circular clip — proving the radius hint " +
                "actually changed the painted shape, not just that the API accepted it — " +
                "but it was ${hex(hintedCorner)}, inside the shimmer ramp just like the " +
                "unhinted region's corner (${hex(unhintedCorner)}).",
            colorInRamp(hintedCorner, SKELETON_BASE_COLOR, SKELETON_HIGHLIGHT_COLOR),
        )
        scenario.close()
    }
}
