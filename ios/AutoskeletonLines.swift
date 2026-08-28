import CoreGraphics
import Foundation

// Task 3.1 (tasks.md Phase 3) / plan.md §7.1: collapsed-text line synthesis. This is
// a deliberate, literal Swift PORT of `src/core/lines.ts`'s `synthesizeLines` — the
// task's DoD explicitly requires reusing that algorithm rather than reinventing it.
// Any change to the width-variance formula MUST be made in both files together, or
// the iOS and web skeletons will visibly diverge for the same collapsed-text shape.

private let autoskeletonMinWidthRatio: CGFloat = 0.6
private let autoskeletonMaxWidthRatio: CGFloat = 0.85

/// Deterministic pseudo-variance in [minWidthRatio, maxWidthRatio] — identical
/// formula to `lines.ts`'s `widthRatioForLine`.
private func autoskeletonWidthRatio(forLine lineIndex: Int, lineCount: Int) -> CGFloat {
    if lineCount <= 1 {
        return autoskeletonMaxWidthRatio
    }
    let t = CGFloat(lineIndex) / CGFloat(lineCount - 1)
    let oscillation = (sin(t * .pi * 2) + 1) / 2
    return autoskeletonMinWidthRatio + oscillation * (autoskeletonMaxWidthRatio - autoskeletonMinWidthRatio)
}

/// Identical formula to `lines.ts`'s `defaultLineCount`: `Math.round` in JS and
/// Swift's `.rounded()` both round half away from zero, so the two stay identical
/// at the `.5` boundary.
private func autoskeletonDefaultLineCount(h: CGFloat, lineHeight: CGFloat) -> Int {
    max(1, Int((h / lineHeight).rounded()))
}

struct AutoskeletonSynthesizeLinesOptions {
    let x: CGFloat
    let y: CGFloat
    let w: CGFloat
    let h: CGFloat
    let lineHeight: CGFloat
    /// typed-prop hint; overrides the height/lineHeight-derived default when present
    let lines: Int?
}

/// Synthesizes N placeholder line rects for a collapsed text node. Honors an
/// explicit `lines` hint over the height-derived default; every rect has
/// `h == lineHeight` and a width within 60%-85% of the collapsed width — exactly
/// `src/core/lines.ts`'s contract.
func autoskeletonSynthesizeLines(_ options: AutoskeletonSynthesizeLinesOptions) -> [AutoskeletonShapeInfo] {
    let lineCount = options.lines ?? autoskeletonDefaultLineCount(h: options.h, lineHeight: options.lineHeight)
    var lines: [AutoskeletonShapeInfo] = []
    lines.reserveCapacity(lineCount)
    for i in 0..<lineCount {
        lines.append(
            AutoskeletonShapeInfo(
                x: options.x,
                y: options.y + CGFloat(i) * options.lineHeight,
                w: options.w * autoskeletonWidthRatio(forLine: i, lineCount: lineCount),
                h: options.lineHeight,
                r: 0,
                source: .syntheticLine,
                radiusSource: .measured
            )
        )
    }
    return lines
}
