import { describe, expect, expectTypeOf, it } from 'vitest';
import type { DegradationFlag, RadiusSource, ShapeInfo, ShapeSnapshot } from './types';
import { isExactRadiusSource, RADIUS_SOURCES } from './types';
import type { SerializedShapeSnapshot } from './types';

// Task 1.9 (tasks.md Phase 1): consolidation only — no new logic. `types.ts`
// already carries `ShapeInfo`, `ShapeSnapshot`, `SerializedShapeSnapshot`,
// `DegradationFlag`, `RadiusSource` and `ShapeSource` (built up incrementally
// across tasks 1.1-1.8). This task's own deliverable is the drift-guard test
// below.

describe('DegradationFlag — drift guard', () => {
  it('enumerates exactly the 9 documented flags (plan.md §3.1)', () => {
    expectTypeOf<DegradationFlag>().toEqualTypeOf<
      | 'radius-unavailable'
      | 'radius-probe-failed'
      | 'leaf-class-unmatched'
      | 'budget-exceeded'
      | 'shape-cap-reached'
      | 'clientrects-empty'
      | 'snapshot-version-mismatch'
      | 'native-module-unavailable'
      | 'depth-cap-reached'
    >();
  });

  it('has no duplicate or missing flags in a runtime-checkable enumeration', () => {
    const flags: readonly DegradationFlag[] = [
      'radius-unavailable',
      'radius-probe-failed',
      'leaf-class-unmatched',
      'budget-exceeded',
      'shape-cap-reached',
      'clientrects-empty',
      'snapshot-version-mismatch',
      'native-module-unavailable',
      'depth-cap-reached',
    ];
    expect(flags).toHaveLength(9);
    expect(new Set(flags).size).toBe(9);
  });
});

describe('isExactRadiusSource — the grouping the histogram already relies on', () => {
  // WHY THIS EXISTS. `checkRadiusFallback` decides degradation with
  // `histogram.default / total` — so the histogram has always had TWO levels: a
  // binary exact-vs-fallback grouping that carries the meaning, and per-rung
  // granularity layered on top for diagnostics. That grouping lived only inside
  // one function body, so nothing in the public type said which buckets belong
  // together.
  //
  // It became load-bearing when Android gained the `style` rung: for one rounded
  // avatar, iOS and web report `measured` while Android reports `style`. All
  // three recovered the exact authored radius — but a consumer aggregating
  // `histogram.measured` across platforms would see Android's rounded views
  // vanish from the bucket and conclude the radius was lost.
  //
  // Exporting the predicate makes cross-platform aggregation correct by
  // construction WITHOUT collapsing the rungs, which would throw away the one
  // signal that tells you which rung answered — and that signal is how a future
  // RN release fixing `Outline.getRadius()` would become visible.
  it('treats every rung that recovered a real radius as exact', () => {
    for (const source of ['measured', 'outline', 'style', 'hint', 'raster-probe'] as const) {
      expect(isExactRadiusSource(source), source).toBe(true);
    }
  });

  it('treats only the default rung as a fallback', () => {
    expect(isExactRadiusSource('default')).toBe(false);
  });

  it('classifies every member of RADIUS_SOURCES, so a new rung cannot be silently unclassified', () => {
    const classified = RADIUS_SOURCES.filter(
      (source) => isExactRadiusSource(source) || source === 'default',
    );
    expect(classified).toHaveLength(RADIUS_SOURCES.length);
  });
});

describe('RadiusSource / RADIUS_SOURCES — stay in sync', () => {
  it('RADIUS_SOURCES enumerates every RadiusSource exactly once', () => {
    expectTypeOf<RadiusSource>().toEqualTypeOf<
      'measured' | 'outline' | 'raster-probe' | 'hint' | 'default' | 'style'
    >();
    expect(RADIUS_SOURCES).toHaveLength(6);
    expect(new Set(RADIUS_SOURCES).size).toBe(6);
  });
});

describe('ShapeInfo / ShapeSnapshot / SerializedShapeSnapshot — consolidated shape', () => {
  it('ShapeInfo carries x, y, w, h, r plus optional dev-only source/radiusSource', () => {
    const shape: ShapeInfo = { x: 0, y: 0, w: 10, h: 10, r: 4 };
    expect(shape.source).toBeUndefined();
    expect(shape.radiusSource).toBeUndefined();
  });

  it('ShapeSnapshot.data is a Float32Array owned exclusively by the snapshot', () => {
    expectTypeOf<ShapeSnapshot['data']>().toEqualTypeOf<Float32Array>();
    expectTypeOf<ShapeSnapshot['degraded']>().toEqualTypeOf<readonly DegradationFlag[]>();
  });

  it('SerializedShapeSnapshot is JSON-safe: no ArrayBuffers in its data field', () => {
    expectTypeOf<SerializedShapeSnapshot['data']>().toEqualTypeOf<readonly number[]>();
  });
});
