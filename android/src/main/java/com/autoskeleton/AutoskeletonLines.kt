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

/** Identical formula to `lines.ts`'s `defaultLineCount`: `Math.round` in JS and
 *  Kotlin's `Float.roundToInt()` both round half away from zero (ties towards
 *  positive infinity, which is the same thing for the always-positive inputs
 *  here), so the two stay identical at the `.5` boundary. */
private fun defaultLineCount(h: Float, lineHeight: Float): Int =
    maxOf(1, (h / lineHeight).roundToInt())

data class AutoskeletonSynthesizeLinesOptions(
    val x: Float,
    val y: Float,
    val w: Float,
    val h: Float,
    val lineHeight: Float,
    /** typed-prop hint; overrides the height/lineHeight-derived default when present */
    val lines: Int? = null,
)

/** Synthesizes N placeholder line rects for a collapsed text node. Honors an
 *  explicit `lines` hint over the height-derived default; every rect has
 *  `h == lineHeight` and a width within 60%-85% of the collapsed width — exactly
 *  `src/core/lines.ts`'s contract. */
fun autoskeletonSynthesizeLines(options: AutoskeletonSynthesizeLinesOptions): List<AutoskeletonShapeInfo> {
    val lineCount = options.lines ?: defaultLineCount(options.h, options.lineHeight)
    return (0 until lineCount).map { i ->
        AutoskeletonShapeInfo(
            x = options.x,
            y = options.y + i * options.lineHeight,
            w = options.w * widthRatioForLine(i, lineCount),
            h = options.lineHeight,
            r = 0f,
            source = AutoskeletonShapeSource.SYNTHETIC_LINE,
            radiusSource = AutoskeletonRadiusSource.MEASURED,
        )
    }
}
