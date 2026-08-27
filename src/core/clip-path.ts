// src/core/clip-path.ts
//
// plan.md ADR-7: the web renderer is one CSS overlay using `clip-path: path()`.
// The union path is generated here in pure TS, unit-testable without a
// browser, and reused verbatim by the web renderer (2.2) and the capture CLI
// (8.1). "Union" here means one M...Z subpath per rect concatenated into a
// single path string — a real browser applies the default nonzero fill rule,
// which visually unions same-winding overlapping subpaths without any
// polygon-boolean math on our side.
//
// Observability: N/A, pure geometry. Performance: N/A here; contributes to
// NFR-6 (web bundle size), verified in task 2.5.

import type { Direction } from './types';

export interface ClipPathRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** -1 means "rounded, amount unknown" -> substituted with `defaultRadius` */
  readonly r: number;
}

export interface ClipPathOptions {
  readonly defaultRadius: number;
  readonly direction: Direction;
  /** total content width; needed to mirror `x` for RTL */
  readonly containerWidth: number;
}

function resolveRadius(r: number, defaultRadius: number): number {
  return r === -1 ? defaultRadius : r;
}

function mirrorForDirection(x: number, w: number, direction: Direction, containerWidth: number): number {
  return direction === 'rtl' ? containerWidth - (x + w) : x;
}

/** Builds the `M...Z` path data for a single rounded rect. Degenerates to a
 *  plain 4-line rectangle (no arc commands) when `r <= 0`, which keeps the
 *  output deterministic and readable for the common "verified square" case
 *  (plan.md §4.1: `r === 0` means "verified square"). */
function rectPathData(x: number, y: number, w: number, h: number, r: number): string {
  if (r <= 0) {
    return `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
  }
  const right = x + w;
  const bottom = y + h;
  return (
    `M${x + r} ${y}` +
    `H${right - r}A${r} ${r} 0 0 1 ${right} ${y + r}` +
    `V${bottom - r}A${r} ${r} 0 0 1 ${right - r} ${bottom}` +
    `H${x + r}A${r} ${r} 0 0 1 ${x} ${bottom - r}` +
    `V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`
  );
}

/** Builds a CSS `path()` value from a union of rounded rects, mirroring `x`
 *  for RTL and substituting `options.defaultRadius` for any `r === -1`. */
export function buildClipPath(rects: readonly ClipPathRect[], options: ClipPathOptions): string {
  const subpaths = rects.map((rect) => {
    const radius = resolveRadius(rect.r, options.defaultRadius);
    const x = mirrorForDirection(rect.x, rect.w, options.direction, options.containerWidth);
    return rectPathData(x, rect.y, rect.w, rect.h, radius);
  });
  return `path("${subpaths.join(' ')}")`;
}
