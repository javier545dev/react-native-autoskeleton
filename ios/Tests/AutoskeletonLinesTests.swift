import XCTest
@testable import Autoskeleton

/// A synthesized line is deliberately NARROWER than the frame it stands in
/// for (`MAX_WIDTH_RATIO` is 0.85, and multi-line blocks go down to 0.6), so
/// which edge it hangs from is a real decision rather than a formality. Text
/// runs flush against the LEADING edge and falls short on the trailing one —
/// so a line anchored at `x` unconditionally is right in LTR and wrong in RTL,
/// where it ends up sitting over the blank half of the frame while the live
/// glyphs stay uncovered next to it.
///
/// This was measured on device before it was fixed, not theorised. On the
/// iPhone 17 Pro simulator under `I18nManager.forceRTL(true)`, the paint
/// gate's `paint-gate-text` block (real pixels of 1206):
///
///   frame of the `<Text>` : 402 → 1134
///   synthesized skeleton   : 402 → 1023   (622px, the 85% single-line ratio)
///   glyphs left exposed    : 1024 → ~1132 (~110px of live text, in the clear)
///
/// Android showed the same shape of failure (~90px of "block" hanging out of
/// the skeleton), which is why the assertions here are mirrored one-for-one in
/// `android/src/test/java/com/autoskeleton/AutoskeletonLinesTest.kt` and in
/// `src/core/lines.test.ts`. This file is a literal port of that TypeScript
/// contract; a fix in one place alone leaves the other two wrong.
///
/// One caveat worth recording, because it cost a wrong conclusion: the defect
/// is INVISIBLE on iOS unless the `<Text>` declares `textAlign`. React Native's
/// `RCTResolveTextAlignment` resolves `Start`/`End` against the layout
/// direction but lets `Natural` through its `default:` branch untouched, and
/// an omitted `textAlign` never reaches that function at all. With no
/// `textAlign`, iOS keeps the glyphs on the left under RTL and the
/// left-anchored skeleton covers them by coincidence.
final class AutoskeletonLinesTests: XCTestCase {
    private func lines(
        x: CGFloat = 0,
        y: CGFloat = 0,
        w: CGFloat = 200,
        h: CGFloat = 20,
        lineHeight: CGFloat = 20,
        count: Int? = nil,
        rtl: Bool = false
    ) -> [AutoskeletonShapeInfo] {
        autoskeletonSynthesizeLines(
            AutoskeletonSynthesizeLinesOptions(
                x: x, y: y, w: w, h: h, lineHeight: lineHeight, lines: count, isRightToLeft: rtl
            )
        )
    }

    func testAnchorsToTheLeftEdgeInLTRWhichIsThePreExistingBehaviour() {
        let result = lines(x: 100, w: 200, rtl: false)
        XCTAssertEqual(result[0].x, 100, accuracy: 1e-9)
    }

    func testDefaultsToLTRAnchoringWhenNoDirectionIsGiven() {
        let implicit = autoskeletonSynthesizeLines(
            AutoskeletonSynthesizeLinesOptions(x: 100, y: 0, w: 200, h: 20, lineHeight: 20, lines: nil)
        )
        let explicitLTR = lines(x: 100, w: 200, rtl: false)
        XCTAssertEqual(implicit.count, explicitLTR.count)
        for (a, b) in zip(implicit, explicitLTR) {
            XCTAssertEqual(a.x, b.x, accuracy: 1e-9)
            XCTAssertEqual(a.w, b.w, accuracy: 1e-9)
        }
    }

    func testAnchorsAShortLineToTheRightEdgeInRTL() {
        let x: CGFloat = 100
        let w: CGFloat = 200
        let line = lines(x: x, w: w, rtl: true)[0]
        // Flush with the frame's right edge...
        XCTAssertEqual(line.x + line.w, x + w, accuracy: 1e-9)
        // ...so a line narrower than its frame starts INSIDE it, not at `x`.
        XCTAssertGreaterThan(line.x, x)
    }

    func testMirrorsEveryLineAboutTheFrameWithWidthsUnchanged() {
        let x: CGFloat = 40
        let w: CGFloat = 300
        let ltr = lines(x: x, w: w, h: 100, count: 5, rtl: false)
        let rtl = lines(x: x, w: w, h: 100, count: 5, rtl: true)

        XCTAssertEqual(ltr.count, rtl.count)
        for i in 0..<ltr.count {
            // The 60%-85% width variance is untouched; only the origin moves.
            XCTAssertEqual(rtl[i].w, ltr[i].w, accuracy: 1e-9)
            XCTAssertEqual(rtl[i].y, ltr[i].y, accuracy: 1e-9)
            XCTAssertEqual(rtl[i].x, x + w - (ltr[i].x - x) - ltr[i].w, accuracy: 1e-9)
        }
    }

    func testNeverLetsALineEscapeTheFrameItWasSynthesizedFrom() {
        let x: CGFloat = 12
        let w: CGFloat = 250
        for rtl in [false, true] {
            for line in lines(x: x, w: w, h: 80, count: 4, rtl: rtl) {
                XCTAssertGreaterThanOrEqual(line.x, x - 1e-9, "rtl=\(rtl)")
                XCTAssertLessThanOrEqual(line.x + line.w, x + w + 1e-9, "rtl=\(rtl)")
            }
        }
    }

    // MARK: - Hostile inputs

    /// `lines` arrives UNVALIDATED from the public API — `<AutoSkeleton.Hint
    /// lines={n} />` puts whatever the consumer typed straight into
    /// `HintRegistry.linesFor`, which is this field. Each of these was a
    /// DIFFERENT failure on each of the three platforms, which is the argument
    /// for fixing the shared formula rather than three call sites: a zero
    /// `lineHeight` gave `Math.round(h / 0)` = `Infinity` in TypeScript (an
    /// unbounded push loop), `Int(Double.infinity)` HERE (a hard trap), and
    /// `Int.MAX_VALUE` in Kotlin. A `lines` of -1 returned empty in TypeScript
    /// and Kotlin and trapped HERE on `0..<(-1)`. `lines.test.ts` and
    /// `AutoskeletonLinesTest.kt` carry the same cases.
    func testUnderivableLineHeightYieldsOnePlaceholderRatherThanTrapping() {
        for lineHeight in [CGFloat(0), -20, .nan, .infinity] {
            let lines = autoskeletonSynthesizeLines(
                AutoskeletonSynthesizeLinesOptions(x: 0, y: 0, w: 100, h: 40, lineHeight: lineHeight, lines: nil)
            )
            // Not derivable is not the same as "none": the caller asked for a
            // collapsed-text placeholder and must still get one.
            XCTAssertEqual(lines.count, 1, "lineHeight \(lineHeight)")
            XCTAssertTrue(lines[0].h.isFinite, "lineHeight \(lineHeight)")
            XCTAssertGreaterThanOrEqual(lines[0].h, 0, "lineHeight \(lineHeight)")
        }
    }

    func testAbsurdLinesHintIsClampedRatherThanAllocatedFor() {
        let lines = autoskeletonSynthesizeLines(
            AutoskeletonSynthesizeLinesOptions(x: 0, y: 0, w: 100, h: 40, lineHeight: 20, lines: 1_000_000_000)
        )
        XCTAssertEqual(lines.count, autoskeletonMaxSynthesizedLines)
    }

    func testNegativeLinesHintYieldsNoLinesRatherThanTrapping() {
        let lines = autoskeletonSynthesizeLines(
            AutoskeletonSynthesizeLinesOptions(x: 0, y: 0, w: 100, h: 40, lineHeight: 20, lines: -1)
        )
        // Matches `lines: 0`, and matches what TypeScript and Kotlin already did.
        XCTAssertEqual(lines.count, 0)
    }

    func testNoNonFiniteCoordinateForAnyHostileInput() {
        for lineHeight in [CGFloat(0), -20, .nan, .infinity] {
            for line in autoskeletonSynthesizeLines(
                AutoskeletonSynthesizeLinesOptions(x: 5, y: 5, w: 100, h: 40, lineHeight: lineHeight, lines: nil)
            ) {
                for v in [line.x, line.y, line.w, line.h] {
                    XCTAssertTrue(v.isFinite, "lineHeight \(lineHeight)")
                }
            }
        }
    }

    /// Anti-vacuity: every assertion above would hold for a function that
    /// always returned []. The ordinary path must be untouched.
    func testOrdinaryDerivedCountIsUnchanged() {
        XCTAssertEqual(
            autoskeletonSynthesizeLines(
                AutoskeletonSynthesizeLinesOptions(x: 0, y: 0, w: 100, h: 100, lineHeight: 20, lines: nil)
            ).count,
            5
        )
        XCTAssertEqual(
            autoskeletonSynthesizeLines(
                AutoskeletonSynthesizeLinesOptions(x: 0, y: 0, w: 100, h: 100, lineHeight: 20, lines: 3)
            ).count,
            3
        )
    }
}
