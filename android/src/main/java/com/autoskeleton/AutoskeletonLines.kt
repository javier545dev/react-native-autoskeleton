package com.autoskeleton

import kotlin.math.PI
import kotlin.math.roundToInt
import kotlin.math.sin

// Task 4.1 (tasks.md Phase 4) / plan.md §7.1/§7.2: collapsed-text line synthesis. A
// literal Kotlin PORT of `src/core/lines.ts` (already ported once for iOS as
// `ios/AutoskeletonLines.swift`) — any change to the width-variance formula MUST be
// made in all three files together, or the three platforms' skeletons will visibly
// diverge for the same collapsed-text shape.

private const val MIN_WIDTH_RATIO = 0.6f
private const val MAX_WIDTH_RATIO = 0.85f

/** Deterministic pseudo-variance in [MIN_WIDTH_RATIO, MAX_WIDTH_RATIO] — identical
 *  formula to `lines.ts`'s `widthRatioForLine` / `AutoskeletonLines.swift`'s
 *  `autoskeletonWidthRatio`. */
private fun widthRatioForLine(lineIndex: Int, lineCount: Int): Float {
    if (lineCount <= 1) {
        return MAX_WIDTH_RATIO
    }
    val t = lineIndex.toFloat() / (lineCount - 1)
    val oscillation = (sin(t * PI.toFloat() * 2) + 1) / 2
    return MIN_WIDTH_RATIO + oscillation * (MAX_WIDTH_RATIO - MIN_WIDTH_RATIO)
}

/** Hard cap on how many placeholder rects one collapsed text node may produce.
 *  Nothing a human reads collapses into anywhere near a thousand lines; the cap
 *  exists so a hostile or accidental input degrades into a wrong-looking
 *  skeleton instead of an unbounded allocation. Deliberately the same value in
 *  `src/core/lines.ts` and `AutoskeletonLines.swift`. */
const val MAX_SYNTHESIZED_LINES = 1000

/** `lineHeight` reaches this module from `defaultLineHeight` multiplied by the
 *  display density, and on web from `parseLineHeight`, where CSS
 *  `line-height: 0` is legal, common, and parses cleanly to 0 rather than NaN.
 *
 *  A non-positive or non-finite value is not a line height, and there is no
 *  honest way to invent one, so geometry uses 0 — a degenerate rect the web
 *  sensor already drops and a renderer draws as nothing. The alternative,
 *  propagating it, made `(h / 0f).roundToInt()` return `Int.MAX_VALUE`, and the
 *  `map` below then tried to build a two-billion-element list. */
private fun sanitizedLineHeight(lineHeight: Float): Float =
    if (lineHeight.isFinite() && lineHeight > 0f) lineHeight else 0f

/** Identical formula to `lines.ts`'s `defaultLineCount`: `Math.round` in JS and
 *  Kotlin's `Float.roundToInt()` both round half away from zero (ties towards
 *  positive infinity, which is the same thing for the always-positive inputs
 *  here), so the two stay identical at the `.5` boundary. A zero `lineHeight`
 *  means the count is not derivable at all, which is NOT the same as zero
 *  lines: the caller asked for a collapsed-text placeholder and must still get
 *  one. */
private fun defaultLineCount(h: Float, lineHeight: Float): Int =
    if (lineHeight <= 0f || !h.isFinite()) 1 else maxOf(1, (h / lineHeight).roundToInt())

/** The `lines` hint arrives UNVALIDATED from the public API: `<AutoSkeleton.Hint
 *  lines={n} />` puts whatever the consumer typed straight into
 *  `HintRegistry.linesFor`, which is this argument. A negative one is clamped
 *  to 0, which is what `lines = 0` already means and what this platform and
 *  TypeScript already did — Swift trapped on `0..<(-1)`. */
private fun resolveLineCount(hint: Int?, h: Float, lineHeight: Float): Int =
    minOf(maxOf(0, hint ?: defaultLineCount(h, lineHeight)), MAX_SYNTHESIZED_LINES)

data class AutoskeletonSynthesizeLinesOptions(
    val x: Float,
    val y: Float,
    val w: Float,
    val h: Float,
    val lineHeight: Float,
    /** typed-prop hint; overrides the height/lineHeight-derived default when present */
    val lines: Int? = null,
    /** Writing direction of the frame being synthesized for, as a boolean
     *  because Kotlin has no `Direction` type to port — `true` is the `'rtl'`
     *  of `src/core/lines.ts`'s `direction`.
     *
     *  A synthesized line is NARROWER than its frame, so which edge it hangs
     *  from is a real decision: text runs flush against the leading edge and
     *  falls short on the trailing one. Defaults to `false`, which is the
     *  behaviour every caller had before this parameter existed. */
    val isRightToLeft: Boolean = false,
)

/** Synthesizes N placeholder line rects for a collapsed text node. Honors an
 *  explicit `lines` hint over the height-derived default; every rect has
 *  `h == lineHeight` and a width within 60%-85% of the collapsed width,
 *  anchored to the frame's LEADING edge for the writing direction — exactly
 *  `src/core/lines.ts`'s contract.
 *
 *  The anchor is why `isRightToLeft` exists. Anchoring at `options.x`
 *  unconditionally puts an RTL placeholder over the blank half of the frame
 *  while the live text — flush right — stays uncovered; that was measured on
 *  the emulator, not theorised (see `AutoskeletonLinesTest` for the pixel
 *  readings). The mirror is about the frame, so widths and the 60%-85%
 *  variance are untouched; only the origin moves. */
fun autoskeletonSynthesizeLines(options: AutoskeletonSynthesizeLinesOptions): List<AutoskeletonShapeInfo> {
    val lineHeight = sanitizedLineHeight(options.lineHeight)
    val lineCount = resolveLineCount(options.lines, options.h, lineHeight)
    return (0 until lineCount).map { i ->
        val w = options.w * widthRatioForLine(i, lineCount)
        AutoskeletonShapeInfo(
            x = if (options.isRightToLeft) options.x + options.w - w else options.x,
            y = options.y + i * lineHeight,
            w = w,
            h = lineHeight,
            r = 0f,
            source = AutoskeletonShapeSource.SYNTHETIC_LINE,
            radiusSource = AutoskeletonRadiusSource.MEASURED,
        )
    }
}
