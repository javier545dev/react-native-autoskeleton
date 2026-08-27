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

import type { ShapeInfo } from './types';

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

function defaultLineCount(h: number, lineHeight: number): number {
  return Math.max(1, Math.round(h / lineHeight));
}

/** Synthesizes N placeholder line rects for a collapsed text node. Honors an
 *  explicit `lines` hint over the height-derived default; every rect has
 *  `h === lineHeight` and a width within 60%-85% of the collapsed width. */
export function synthesizeLines(options: SynthesizeLinesOptions): ShapeInfo[] {
  const lineCount = options.lines ?? defaultLineCount(options.h, options.lineHeight);
  const lines: ShapeInfo[] = [];
  for (let i = 0; i < lineCount; i++) {
    lines.push({
      x: options.x,
      y: options.y + i * options.lineHeight,
      w: options.w * widthRatioForLine(i, lineCount),
      h: options.lineHeight,
      r: 0,
      source: 'synthetic-line',
    });
  }
  return lines;
}
