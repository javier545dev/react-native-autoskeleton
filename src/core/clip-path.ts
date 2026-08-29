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

/** Clamps a resolved radius to at most half the shorter side. Defect fix:
 *  CSS `border-radius` legitimately reports a raw value larger than the box
 *  — `border-radius: 999px` on a 40x20 badge resolves to `r=30` via
 *  `getComputedStyle`, UNCLAMPED, because the browser only clamps radii
 *  visually at paint time, never in the computed-style value it returns.
 *  This is not a measurement bug (the raw value is faithfully reported, and
 *  every sensor across the codebase — web, iOS, Android — reports its raw
 *  measured radius the same way), so the fix belongs here, at the single
 *  point that actually turns `(w, h, r)` into path geometry, exactly
 *  mirroring the pattern every OTHER renderer in this codebase already
 *  applies at its own draw call site: `ios/AutoskeletonRendererTier1.swift`,
 *  `ios/AutoskeletonDebugOverlay.swift`, `android/.../
 *  AutoskeletonRendererTier1.kt`, `android/.../AutoskeletonDebugOverlay.kt`,
 *  and `src/native/tier2/SkiaRenderer.tsx` all already compute exactly
 *  `min(shape.r, min(shape.w, shape.h) / 2)` before drawing. This module was
 *  the one renderer/geometry-builder in the codebase that had never adopted
 *  that established clamp — an inconsistency, not a new pattern.
 *
 *  This is also the single correct home to fix the web + SSR rendering
 *  defect in ONE place: `buildClipPath` (and therefore this function) is
 *  reused verbatim by BOTH the live web CSS renderer
 *  (`src/web/css-renderer.ts`'s `applyGeometry`) AND the build-time SSR
 *  capture CLI (`cli/media-bundle.ts`), per ADR-7 — so clamping here, and
 *  only here, covers every web/SSR consumer of a shape's radius, including
 *  radii that originated from the typed `<AutoSkeleton.Hint radius={...}>`
 *  channel (`src/web/Hint.tsx`), since a hint radius flows through the exact
 *  same `ShapeInfo.r` -> wire -> `ClipPathRect.r` pipeline as a
 *  measured/CSS radius. `src/web/dom-sensor.ts`'s `parseRadius` deliberately
 *  keeps reporting the raw, unclamped value — clamping there too would
 *  duplicate this clamp for no benefit and would break from the
 *  measure-raw/clamp-at-draw convention every other sensor already follows. */
function clampRadius(radius: number, w: number, h: number): number {
  return Math.min(radius, Math.min(w, h) / 2);
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
    const radius = clampRadius(resolveRadius(rect.r, options.defaultRadius), rect.w, rect.h);
    const x = mirrorForDirection(rect.x, rect.w, options.direction, options.containerWidth);
    return rectPathData(x, rect.y, rect.w, rect.h, radius);
  });
  return `path("${subpaths.join(' ')}")`;
}
