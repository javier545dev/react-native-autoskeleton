// src/core/lines.ts
//
// plan.md §2 module layout: collapsed-text line synthesis heuristics. When a
// sensor detects a collapsed text node, it synthesizes N placeholder rects
// instead of shipping one big rectangle, which is what makes a text skeleton
// look like text.
//
// Observability: every synthesized shape is tagged `source: 'synthetic-line'`
// (§4.4 dev sidecar); this task performs no runtime emission of its own.
// Performance: N/A standalone; folded into the traversal budget once called
// from a Sensor in Phase 2-4.

import type { Direction, ShapeInfo } from './types';

const MIN_WIDTH_RATIO = 0.6;
const MAX_WIDTH_RATIO = 0.85;

export interface SynthesizeLinesOptions {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly lineHeight: number;
  /** typed-prop hint; overrides the height/lineHeight-derived default when present */
  readonly lines?: number;
  /** Writing direction of the frame being synthesized for. A synthesized line
   *  is NARROWER than its frame, so which edge it hangs from is a real
   *  decision, not a formality: text runs flush against the leading edge and
   *  falls short on the trailing one. Defaults to `'ltr'`, which is the
   *  behaviour every caller had before this parameter existed. */
  readonly direction?: Direction;
}

/** Deterministic pseudo-variance in [MIN_WIDTH_RATIO, MAX_WIDTH_RATIO], so
 *  repeated calls with the same inputs produce the same output (no shared RNG
 *  dependency — ADR-4: `src/core/` has zero platform imports). */
function widthRatioForLine(lineIndex: number, lineCount: number): number {
  if (lineCount <= 1) {
    return MAX_WIDTH_RATIO;
  }
  const t = lineIndex / (lineCount - 1);
  const oscillation = (Math.sin(t * Math.PI * 2) + 1) / 2; // normalized to [0, 1]
  return MIN_WIDTH_RATIO + oscillation * (MAX_WIDTH_RATIO - MIN_WIDTH_RATIO);
}

/** Hard cap on how many placeholder rects one collapsed text node may produce.
 *  Nothing a human reads collapses into anywhere near a thousand lines; the
 *  cap exists so a hostile or accidental input degrades into a wrong-looking
 *  skeleton instead of an unbounded allocation. Deliberately the same value in
 *  `AutoskeletonLines.swift` and `AutoskeletonLines.kt`. */
export const MAX_SYNTHESIZED_LINES = 1000;

/** `lineHeight` reaches this module from two places that guarantee nothing
 *  about it. On web it is `parseLineHeight`, and CSS `line-height: 0` is legal
 *  and common (icon rows, reset stylesheets) and parses cleanly to 0 rather
 *  than to NaN. On native it is `defaultLineHeight`, a constant today, but
 *  multiplied by a density this module cannot see.
 *
 *  A non-positive or non-finite value is not a line height, and there is no
 *  honest way to invent one, so geometry uses 0 — a degenerate rect the web
 *  sensor already drops and native renders as nothing. The alternative,
 *  propagating it, produced `Math.round(h / 0)` = `Infinity` here and a
 *  matching hang or trap on each native platform. */
function sanitizedLineHeight(lineHeight: number): number {
  return Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : 0;
}

/** `h / lineHeight` with both operands already known finite, so the only
 *  remaining hazard is a zero divisor — and a zero `lineHeight` means the
 *  count is not derivable at all, which is NOT the same as zero lines: the
 *  caller asked for a collapsed-text placeholder and must still get one. */
function defaultLineCount(h: number, lineHeight: number): number {
  if (lineHeight <= 0 || !Number.isFinite(h)) {
    return 1;
  }
  return Math.max(1, Math.round(h / lineHeight));
}

/** The `lines` hint arrives UNVALIDATED from the public API: `<AutoSkeleton.Hint
 *  lines={n} />` puts whatever the consumer typed straight into
 *  `HintRegistry.linesFor`, which is this argument.
 *
 *  A non-finite hint is not a count, so it is discarded in favour of the
 *  derived one rather than guessed at. A negative one is clamped to 0, which
 *  is what `lines={0}` already means and what TypeScript and Kotlin already
 *  did — Swift trapped on `0..<(-1)`. A fractional one is truncated, since a
 *  count is a count; before this, TypeScript rendered 3 lines for `2.7` while
 *  the native ports could not express it at all. */
function resolveLineCount(hint: number | undefined, h: number, lineHeight: number): number {
  const derived = defaultLineCount(h, lineHeight);
  const requested = hint === undefined || !Number.isFinite(hint) ? derived : Math.trunc(hint);
  return Math.min(Math.max(0, requested), MAX_SYNTHESIZED_LINES);
}

/** Synthesizes N placeholder line rects for a collapsed text node. Honors an
 *  explicit `lines` hint over the height-derived default; every rect has
 *  `h === lineHeight` and a width within 60%-85% of the collapsed width,
 *  anchored to the frame's LEADING edge for `direction`.
 *
 *  The anchor is the whole reason `direction` is a parameter. Every line here
 *  is deliberately shorter than the frame, so anchoring at `options.x`
 *  unconditionally puts an RTL placeholder over the blank half of the frame
 *  while the live text — flush right — stays uncovered. That was a real,
 *  measured defect on both native platforms, not a theoretical one: see the
 *  regression block in `lines.test.ts` for the pixel readings that found it.
 *  The mirror is about the frame, so widths and the 60%-85% variance are
 *  untouched; only the origin moves. */
export function synthesizeLines(options: SynthesizeLinesOptions): ShapeInfo[] {
  const lineHeight = sanitizedLineHeight(options.lineHeight);
  const lineCount = resolveLineCount(options.lines, options.h, lineHeight);
  const rightToLeft = options.direction === 'rtl';
  const lines: ShapeInfo[] = [];
  for (let i = 0; i < lineCount; i++) {
    const w = options.w * widthRatioForLine(i, lineCount);
    lines.push({
      x: rightToLeft ? options.x + options.w - w : options.x,
      y: options.y + i * lineHeight,
      w,
      h: lineHeight,
      r: 0,
      source: 'synthetic-line',
    });
  }
  return lines;
}
