import { describe, expect, it } from 'vitest';
import { MAX_SYNTHESIZED_LINES, synthesizeLines } from './lines';

// Task 1.4 (tasks.md Phase 1): Observability — tags synthesized shapes
// `source: 'synthetic-line'` in the dev sidecar (§4.4); asserted below.
// Performance: N/A standalone (folded into traversal budget once called from
// sensors in Phase 2-4).

describe('synthesizeLines — no-hint default', () => {
  it('derives the line count from height / lineHeight when no hint is given', () => {
    const lines = synthesizeLines({ x: 0, y: 0, w: 200, h: 60, lineHeight: 20 });
    expect(lines).toHaveLength(3);
  });

  it('rounds to at least one line for a collapsed node shorter than one lineHeight', () => {
    const lines = synthesizeLines({ x: 0, y: 0, w: 200, h: 5, lineHeight: 20 });
    expect(lines).toHaveLength(1);
  });
});

describe('synthesizeLines — hinted count', () => {
  it('honors an explicit `lines` hint over the height-derived default', () => {
    const lines = synthesizeLines({ x: 0, y: 0, w: 200, h: 60, lineHeight: 20, lines: 5 });
    expect(lines).toHaveLength(5);
  });
});

describe('synthesizeLines — width bounds', () => {
  it('keeps every synthesized line width within 60%-85% of the collapsed width', () => {
    const w = 240;
    const lines = synthesizeLines({ x: 0, y: 0, w, h: 100, lineHeight: 20, lines: 5 });
    for (const line of lines) {
      expect(line.w).toBeGreaterThanOrEqual(w * 0.6 - 1e-9);
      expect(line.w).toBeLessThanOrEqual(w * 0.85 + 1e-9);
    }
  });

  it('does not produce identical widths for every line (real width variance)', () => {
    const lines = synthesizeLines({ x: 0, y: 0, w: 240, h: 100, lineHeight: 20, lines: 4 });
    const widths = new Set(lines.map((l) => l.w));
    expect(widths.size).toBeGreaterThan(1);
  });
});

describe('synthesizeLines — height equality', () => {
  it('gives every line exactly `lineHeight` as its height', () => {
    const lines = synthesizeLines({ x: 0, y: 0, w: 200, h: 60, lineHeight: 20, lines: 3 });
    expect(lines.every((l) => l.h === 20)).toBe(true);
  });

  it('stacks lines vertically at consecutive lineHeight offsets from y', () => {
    const lines = synthesizeLines({ x: 0, y: 100, w: 200, h: 60, lineHeight: 20, lines: 3 });
    expect(lines.map((l) => l.y)).toEqual([100, 120, 140]);
  });
});

describe('synthesizeLines — dev sidecar tagging', () => {
  it('tags every synthesized shape source: "synthetic-line"', () => {
    const lines = synthesizeLines({ x: 0, y: 0, w: 200, h: 40, lineHeight: 20 });
    expect(lines.every((l) => l.source === 'synthetic-line')).toBe(true);
  });
});

// REGRESSION (2026-09-04): a synthesized line was ALWAYS anchored to `x` and
// shortened on the right, in every writing direction. That is correct in LTR,
// where a ragged line ends early on the right, and wrong in RTL, where the
// text is flush against the RIGHT edge and runs short on the LEFT.
//
// Measured on the Android emulator before the fix, `paint-gate-text` fixture,
// real pixels of 1080: the text sat at 608..1037 while the skeleton sat at
// 377..921 — the SAME rect it produced in LTR — leaving 116 of 429 px of live
// text uncovered next to a placeholder standing over blank space.
//
// iOS ships a literal port of this function (`ios/AutoskeletonLines.swift`)
// and Android another (`android/.../AutoskeletonLines.kt`); both carry the
// same assertions, because a fix here alone would leave both natives wrong.
describe('synthesizeLines — writing direction (RTL anchoring)', () => {
  it('anchors to the left edge in LTR, which is the pre-existing behaviour', () => {
    const lines = synthesizeLines({ x: 100, y: 0, w: 200, h: 20, lineHeight: 20, direction: 'ltr' });
    expect(lines[0]!.x).toBe(100);
  });

  it('defaults to LTR anchoring when no direction is given', () => {
    const withoutDirection = synthesizeLines({ x: 100, y: 0, w: 200, h: 20, lineHeight: 20 });
    const explicitLtr = synthesizeLines({ x: 100, y: 0, w: 200, h: 20, lineHeight: 20, direction: 'ltr' });
    expect(withoutDirection).toEqual(explicitLtr);
  });

  it('anchors a short line to the RIGHT edge in RTL', () => {
    const x = 100;
    const w = 200;
    const [line] = synthesizeLines({ x, y: 0, w, h: 20, lineHeight: 20, direction: 'rtl' });
    // The right edge is flush with the frame's right edge...
    expect(line!.x + line!.w).toBeCloseTo(x + w, 9);
    // ...so a line narrower than the frame starts INSIDE it, not at `x`.
    expect(line!.x).toBeGreaterThan(x);
  });

  it('mirrors every line of a multi-line block about the frame, widths unchanged', () => {
    const x = 40;
    const w = 300;
    const ltr = synthesizeLines({ x, y: 0, w, h: 100, lineHeight: 20, lines: 5, direction: 'ltr' });
    const rtl = synthesizeLines({ x, y: 0, w, h: 100, lineHeight: 20, lines: 5, direction: 'rtl' });

    expect(rtl.map((l) => l.w)).toEqual(ltr.map((l) => l.w));
    expect(rtl.map((l) => l.y)).toEqual(ltr.map((l) => l.y));
    // Each RTL line is the exact mirror of its LTR counterpart about the frame.
    for (let i = 0; i < ltr.length; i++) {
      expect(rtl[i]!.x).toBeCloseTo(x + w - (ltr[i]!.x - x) - ltr[i]!.w, 9);
    }
  });

  it('never lets a line escape the frame it was synthesized from', () => {
    const x = 12;
    const w = 250;
    for (const direction of ['ltr', 'rtl'] as const) {
      for (const line of synthesizeLines({ x, y: 0, w, h: 80, lineHeight: 20, lines: 4, direction })) {
        expect(line.x).toBeGreaterThanOrEqual(x - 1e-9);
        expect(line.x + line.w).toBeLessThanOrEqual(x + w + 1e-9);
      }
    }
  });

  // ---------------------------------------------------------------------
  // Hostile inputs: this function must never hang, never allocate without
  // bound, and never throw.
  //
  // `lines` arrives UNVALIDATED from the public API — `<AutoSkeleton.Hint
  // lines={n} />` puts whatever the consumer typed straight into
  // `HintRegistry.linesFor`, which is this argument. `lineHeight` is a
  // constant 20 on both native platforms today, but web derives it from
  // `parseLineHeight`, and CSS `line-height: 0` is both legal and common
  // (icon rows, reset stylesheets), parsing cleanly to 0 rather than NaN.
  //
  // Each of these was a DIFFERENT failure on each of the three platforms,
  // which is the whole argument for fixing it in the shared formula rather
  // than at three call sites: `lineHeight: 0` gave `Math.round(h / 0)` =
  // `Infinity` here (an unbounded push loop), `Int(Double.infinity)` in
  // Swift (a hard trap), and `Int.MAX_VALUE` in Kotlin (2^31 iterations).
  // `lines: -1` returned empty here and in Kotlin, and trapped in Swift on
  // `0..<(-1)`. `AutoskeletonLinesTests.swift` and `AutoskeletonLinesTest.kt`
  // carry the same cases.
  describe('hostile inputs', () => {
    it('does not derive an unbounded line count from a zero lineHeight', () => {
      const lines = synthesizeLines({ x: 0, y: 0, w: 100, h: 40, lineHeight: 0 });
      expect(lines.length).toBeLessThanOrEqual(MAX_SYNTHESIZED_LINES);
      // Not derivable is not the same as "none": the caller asked for a
      // collapsed-text placeholder and must still get one.
      expect(lines.length).toBe(1);
    });

    it.each([
      ['negative', -20],
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
    ])('treats a %s lineHeight as underivable rather than propagating it', (_label, lineHeight) => {
      const lines = synthesizeLines({ x: 0, y: 0, w: 100, h: 40, lineHeight });
      expect(lines.length).toBe(1);
      expect(Number.isFinite(lines[0]!.h)).toBe(true);
      expect(lines[0]!.h).toBeGreaterThanOrEqual(0);
    });

    it('clamps an absurd lines hint instead of allocating for it', () => {
      const lines = synthesizeLines({ x: 0, y: 0, w: 100, h: 40, lineHeight: 20, lines: 1e9 });
      expect(lines).toHaveLength(MAX_SYNTHESIZED_LINES);
    });

    it.each([
      ['negative', -1],
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
      ['fractional', 2.7],
    ])('never produces a partial or impossible count for a %s lines hint', (_label, lines) => {
      const out = synthesizeLines({ x: 0, y: 0, w: 100, h: 40, lineHeight: 20, lines });
      expect(Number.isInteger(out.length)).toBe(true);
      expect(out.length).toBeGreaterThanOrEqual(0);
      expect(out.length).toBeLessThanOrEqual(MAX_SYNTHESIZED_LINES);
    });

    it('emits no non-finite coordinate for any hostile input', () => {
      const hostile = [0, -20, Number.NaN, Number.POSITIVE_INFINITY];
      for (const lineHeight of hostile) {
        for (const line of synthesizeLines({ x: 5, y: 5, w: 100, h: 40, lineHeight })) {
          for (const v of [line.x, line.y, line.w, line.h]) {
            expect(Number.isFinite(v)).toBe(true);
          }
        }
      }
    });

    // Anti-vacuity: every assertion above would hold for a function that
    // always returned []. The ordinary path must be untouched.
    it('leaves the ordinary derived count exactly as it was', () => {
      expect(synthesizeLines({ x: 0, y: 0, w: 100, h: 100, lineHeight: 20 })).toHaveLength(5);
      expect(synthesizeLines({ x: 0, y: 0, w: 100, h: 100, lineHeight: 20, lines: 3 })).toHaveLength(3);
    });
  });
});
