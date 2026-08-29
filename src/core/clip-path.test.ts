import { describe, expect, it } from 'vitest';
import { buildClipPath, type ClipPathRect } from './clip-path';

// Task 1.5 (tasks.md Phase 1): pure geometry, no lifecycle path — this task
// is observability N/A per its DoD. Reused verbatim by the web renderer (2.2)
// and the capture CLI (8.1), per ADR-7.

describe('buildClipPath — single rect', () => {
  it('wraps a single square rect (r=0) in a CSS path() value', () => {
    const rect: ClipPathRect = { x: 0, y: 0, w: 100, h: 50, r: 0 };
    const result = buildClipPath([rect], { defaultRadius: 4, direction: 'ltr', containerWidth: 100 });
    expect(result).toBe('path("M0 0H100V50H0Z")');
  });

  it('draws rounded corners with SVG arc commands when r > 0', () => {
    const rect: ClipPathRect = { x: 0, y: 0, w: 100, h: 50, r: 8 };
    const result = buildClipPath([rect], { defaultRadius: 4, direction: 'ltr', containerWidth: 100 });
    expect(result).toBe(
      'path("M8 0H92A8 8 0 0 1 100 8V42A8 8 0 0 1 92 50H8A8 8 0 0 1 0 42V8A8 8 0 0 1 8 0Z")',
    );
  });
});

describe('buildClipPath — overlapping rects (union via multi-subpath)', () => {
  it('emits one M...Z subpath per rect so the browser unions them via nonzero fill', () => {
    const rects: ClipPathRect[] = [
      { x: 0, y: 0, w: 50, h: 50, r: 0 },
      { x: 20, y: 20, w: 50, h: 50, r: 0 }, // overlaps the first
    ];
    const result = buildClipPath(rects, { defaultRadius: 4, direction: 'ltr', containerWidth: 100 });
    expect((result.match(/M/g) ?? []).length).toBe(2);
    expect((result.match(/Z/g) ?? []).length).toBe(2);
  });
});

describe('buildClipPath — r=-1 substitutes defaultRadius', () => {
  it('substitutes options.defaultRadius when a rect declares r=-1 ("rounded, amount unknown")', () => {
    const unknownRadiusRect: ClipPathRect = { x: 0, y: 0, w: 100, h: 50, r: -1 };
    const explicitRadiusRect: ClipPathRect = { x: 0, y: 0, w: 100, h: 50, r: 6 };
    const options = { defaultRadius: 6, direction: 'ltr' as const, containerWidth: 100 };
    expect(buildClipPath([unknownRadiusRect], options)).toBe(
      buildClipPath([explicitRadiusRect], options),
    );
  });
});

describe('buildClipPath — radius clamped to half the shorter side (defect fix)', () => {
  it('clamps an oversized radius on a 40x20 badge (border-radius: 999px -> r=30) to a valid pill shape (r=10), never producing coordinates outside the box', () => {
    // Reproduction: a 40x20 badge with border-radius:999px resolves (via
    // getComputedStyle) to r=30 on the web sensor. Unclamped, rectPathData
    // draws arcs of radius 30 into a box only 20px tall, producing
    // out-of-bounds/self-intersecting coordinates like "V-10" and "V30" on a
    // 20-tall box. Clamped to min(w,h)/2 = 10, it degenerates to a correct
    // pill (stadium) shape instead.
    const rect: ClipPathRect = { x: 0, y: 0, w: 40, h: 20, r: 30 };
    const result = buildClipPath([rect], { defaultRadius: 4, direction: 'ltr', containerWidth: 40 });
    expect(result).toBe(
      'path("M10 0H30A10 10 0 0 1 40 10V10A10 10 0 0 1 30 20H10A10 10 0 0 1 0 10V10A10 10 0 0 1 10 0Z")',
    );
    // No coordinate in the path may fall outside the box's own bounds
    // ([0, w] x [0, h]) — the exact class of defect this guards against.
    const numbers = result.match(/-?\d+(\.\d+)?/g)!.map(Number);
    for (const n of numbers) {
      // every emitted x/y-ish number must stay within the rect's bounding box
      expect(n).toBeGreaterThanOrEqual(-0.001);
    }
  });

  it('clamps a fully circular avatar (radius far exceeding a 100x100 box) to r=50, not the raw hint value', () => {
    const rect: ClipPathRect = { x: 0, y: 0, w: 100, h: 100, r: 9999 };
    const result = buildClipPath([rect], { defaultRadius: 4, direction: 'ltr', containerWidth: 100 });
    expect(result).toBe(
      'path("M50 0H50A50 50 0 0 1 100 50V50A50 50 0 0 1 50 100H50A50 50 0 0 1 0 50V50A50 50 0 0 1 50 0Z")',
    );
  });

  it('leaves an already-valid radius (r <= half the shorter side) unchanged — no regression on the existing r=8 case', () => {
    const rect: ClipPathRect = { x: 0, y: 0, w: 100, h: 50, r: 8 };
    const result = buildClipPath([rect], { defaultRadius: 4, direction: 'ltr', containerWidth: 100 });
    expect(result).toBe(
      'path("M8 0H92A8 8 0 0 1 100 8V42A8 8 0 0 1 92 50H8A8 8 0 0 1 0 42V8A8 8 0 0 1 8 0Z")',
    );
  });
});

describe('buildClipPath — RTL mirroring', () => {
  it('mirrors x across the container width so the rect keeps its distance from the reading edge', () => {
    const rect: ClipPathRect = { x: 10, y: 0, w: 50, h: 20, r: 0 };
    const ltr = buildClipPath([rect], { defaultRadius: 4, direction: 'ltr', containerWidth: 200 });
    const rtl = buildClipPath([rect], { defaultRadius: 4, direction: 'rtl', containerWidth: 200 });
    expect(ltr).toBe('path("M10 0H60V20H10Z")');
    // mirroredX = containerWidth - (x + w) = 200 - 60 = 140
    expect(rtl).toBe('path("M140 0H190V20H140Z")');
  });
});
