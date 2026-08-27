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
