package com.autoskeleton

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A synthesized line is deliberately NARROWER than the frame it stands in for
 * (`MAX_WIDTH_RATIO` is 0.85, and multi-line blocks go down to 0.6), so which
 * edge it hangs from is a real decision rather than a formality. Text runs
 * flush against the LEADING edge and falls short on the trailing one — so a
 * line anchored at `x` unconditionally is right in LTR and wrong in RTL, where
 * it sits over the blank half of the frame while the live glyphs stay
 * uncovered next to it.
 *
 * This was measured on device before it was fixed, not theorised. On the
 * Android emulator under `I18nManager.forceRTL(true)`, the paint gate's
 * `paint-gate-text` block (real pixels of 1080):
 *
 *   container            : 356 → 1037
 *   glyphs               : 608 → 1012  (flush right, as RTL requires)
 *   synthesized skeleton : 377 →  921  (the SAME rect it produced in LTR)
 *   left exposed         : 922 → 1012  (~90px — the word "block", in the clear)
 *
 * iOS showed the same failure (~110px exposed), which is why these assertions
 * are mirrored one-for-one in `ios/Tests/AutoskeletonLinesTests.swift` and in
 * `src/core/lines.test.ts`. This file is a literal port of that TypeScript
 * contract; a fix in one place alone leaves the other two wrong.
 *
 * No Robolectric here on purpose: this is a pure geometry function with no
 * Android framework dependency, and the sibling tests that DO need a real
 * `View` pay for the runner. Keeping this one plain JUnit means it cannot be
 * made to pass or fail by a shadow's behaviour.
 */
class AutoskeletonLinesTest {
    private fun lines(
        x: Float = 0f,
        y: Float = 0f,
        w: Float = 200f,
        h: Float = 20f,
        lineHeight: Float = 20f,
        count: Int? = null,
        rtl: Boolean = false,
    ): List<AutoskeletonShapeInfo> = autoskeletonSynthesizeLines(
        AutoskeletonSynthesizeLinesOptions(
            x = x, y = y, w = w, h = h, lineHeight = lineHeight, lines = count, isRightToLeft = rtl,
        ),
    )

    @Test
    fun `anchors to the left edge in LTR, which is the pre-existing behaviour`() {
        assertEquals(100f, lines(x = 100f, w = 200f, rtl = false)[0].x, 1e-4f)
    }

    @Test
    fun `defaults to LTR anchoring when no direction is given`() {
        val implicit = autoskeletonSynthesizeLines(
            AutoskeletonSynthesizeLinesOptions(x = 100f, y = 0f, w = 200f, h = 20f, lineHeight = 20f),
        )
        val explicitLtr = lines(x = 100f, w = 200f, rtl = false)
        assertEquals(explicitLtr.size, implicit.size)
        implicit.forEachIndexed { i, line ->
            assertEquals(explicitLtr[i].x, line.x, 1e-4f)
            assertEquals(explicitLtr[i].w, line.w, 1e-4f)
        }
    }

    @Test
    fun `anchors a short line to the RIGHT edge in RTL`() {
        val x = 100f
        val w = 200f
        val line = lines(x = x, w = w, rtl = true)[0]
        // Flush with the frame's right edge...
        assertEquals(x + w, line.x + line.w, 1e-4f)
        // ...so a line narrower than its frame starts INSIDE it, not at `x`.
        assertTrue("expected ${line.x} to start inside the frame at $x", line.x > x)
    }

    @Test
    fun `mirrors every line about the frame with widths unchanged`() {
        val x = 40f
        val w = 300f
        val ltr = lines(x = x, w = w, h = 100f, count = 5, rtl = false)
        val rtl = lines(x = x, w = w, h = 100f, count = 5, rtl = true)

        assertEquals(ltr.size, rtl.size)
        ltr.forEachIndexed { i, line ->
            // The 60%-85% width variance is untouched; only the origin moves.
            assertEquals(line.w, rtl[i].w, 1e-4f)
            assertEquals(line.y, rtl[i].y, 1e-4f)
            assertEquals(x + w - (line.x - x) - line.w, rtl[i].x, 1e-4f)
        }
    }

    @Test
    fun `never lets a line escape the frame it was synthesized from`() {
        val x = 12f
        val w = 250f
        for (rtl in listOf(false, true)) {
            for (line in lines(x = x, w = w, h = 80f, count = 4, rtl = rtl)) {
                assertTrue("rtl=$rtl: ${line.x} < $x", line.x >= x - 1e-4f)
                assertTrue("rtl=$rtl: right edge escaped", line.x + line.w <= x + w + 1e-4f)
            }
        }
    }
}
