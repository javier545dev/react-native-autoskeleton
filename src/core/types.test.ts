import { describe, expect, expectTypeOf, it } from 'vitest';
import type { DegradationFlag, RadiusSource, ShapeInfo, ShapeSnapshot } from './types';
import { RADIUS_SOURCES } from './types';
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

describe('RadiusSource / RADIUS_SOURCES — stay in sync', () => {
  it('RADIUS_SOURCES enumerates every RadiusSource exactly once', () => {
    expectTypeOf<RadiusSource>().toEqualTypeOf<
      'measured' | 'outline' | 'raster-probe' | 'hint' | 'default'
    >();
    expect(RADIUS_SOURCES).toHaveLength(5);
    expect(new Set(RADIUS_SOURCES).size).toBe(5);
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
