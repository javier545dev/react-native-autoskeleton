import { describe, expect, it } from 'vitest';
import type { ShapeCacheKey } from './cache-key';
import { composeCacheKey } from './cache-key';
import type { ShapeSnapshot } from './types';
import { WIRE_VERSION } from './types';
import { encodeWire } from './wire';
import type { SensorResult } from './contracts';
import { assembleMetrics } from './metrics';

// Task 1.8 (tasks.md Phase 1): this task IS the metrics-assembly module —
// covers REQ-OBS-METRICS-1's cold-load and hot-load scenarios end to end
// from the other core modules' outputs.

const KEY: ShapeCacheKey = composeCacheKey({
  skeletonKey: 'profile',
  itemType: undefined,
  viewportWidth: 390,
  fontScale: 1,
  direction: 'ltr',
  platform: 'ios',
});

function snapshotWithShapes(count: number, radiusSources?: Uint8Array): ShapeSnapshot {
  const shapes = Array.from({ length: count }, (_, i) => ({ x: i, y: i, w: 10, h: 10, r: 4 }));
  return {
    key: KEY,
    version: WIRE_VERSION,
    capturedAt: 0,
    frameWidth: 390,
    frameHeight: 844,
    data: encodeWire(shapes),
    radiusSources,
    degraded: [],
  };
}

describe('assembleMetrics — cold-load scenario (REQ-OBS-METRICS-1)', () => {
  it('reports cacheHit:false, the true shape count, traversalMs > 0, and matching platform/renderer', () => {
    // 3 shapes measured/outline/hint -> radius source codes [0, 1, 3]
    const radiusSources = new Uint8Array([0, 1, 3]);
    const sensorResult: SensorResult = {
      snapshot: snapshotWithShapes(3, radiusSources),
      traversalMs: 1.4,
      degraded: [],
    };
    const metrics = assembleMetrics({
      sensorResult,
      cacheHit: false,
      ttfsMs: 5,
      handoff: { displayDurationMs: 800, handoffMs: 120, handoffReason: 'no-successor' },
      platform: 'ios',
      renderer: 'native',
    });

    expect(metrics.cacheHit).toBe(false);
    expect(metrics.shapeCount).toBe(3);
    expect(metrics.traversalMs).toBeGreaterThan(0);
    expect(metrics.platform).toBe('ios');
    expect(metrics.renderer).toBe('native');
    expect(metrics.radiusSourceHistogram).toEqual({
      measured: 1,
      outline: 1,
      'raster-probe': 0,
      hint: 1,
      default: 0,
      style: 0,
    });
    expect(metrics.cacheKey).toBe(KEY);
  });
});

describe('assembleMetrics — hot-load scenario (REQ-OBS-METRICS-1)', () => {
  it('reports cacheHit:true and traversalMs:0 with a smaller ttfsMs than a cold load', () => {
    const sensorResult: SensorResult = {
      snapshot: snapshotWithShapes(3),
      traversalMs: 0,
      degraded: [],
    };
    const metrics = assembleMetrics({
      sensorResult,
      cacheHit: true,
      ttfsMs: 0.3,
      handoff: { displayDurationMs: 400, handoffMs: 120, handoffReason: 'no-successor' },
      platform: 'web',
      renderer: 'css',
    });

    expect(metrics.cacheHit).toBe(true);
    expect(metrics.traversalMs).toBe(0);
    const coldTtfsMs = 5;
    expect(metrics.ttfsMs).toBeLessThan(coldTtfsMs);
  });

  it('defaults every radiusSourceHistogram bucket to 0 when no radiusSources sidecar is present', () => {
    const sensorResult: SensorResult = { snapshot: snapshotWithShapes(3), traversalMs: 0, degraded: [] };
    const metrics = assembleMetrics({
      sensorResult,
      cacheHit: true,
      ttfsMs: 0.1,
      handoff: { displayDurationMs: 100, handoffMs: 120, handoffReason: 'no-successor' },
      platform: 'android',
      renderer: 'native',
    });
    expect(metrics.radiusSourceHistogram).toEqual({
      measured: 0,
      outline: 0,
      'raster-probe': 0,
      hint: 0,
      default: 0,
      style: 0,
    });
  });
});

describe('assembleMetrics — degraded flag merging', () => {
  it('merges sensor-reported and snapshot-carried degradation flags without duplicates', () => {
    const snapshot = snapshotWithShapes(1);
    const withDegraded: ShapeSnapshot = { ...snapshot, degraded: ['budget-exceeded'] };
    const sensorResult: SensorResult = {
      snapshot: withDegraded,
      traversalMs: 3,
      degraded: ['budget-exceeded', 'shape-cap-reached'],
    };
    const metrics = assembleMetrics({
      sensorResult,
      cacheHit: false,
      ttfsMs: 3,
      handoff: { displayDurationMs: 100, handoffMs: 120, handoffReason: 'timeout' },
      platform: 'ios',
      renderer: 'native',
    });
    expect([...metrics.degraded].sort()).toEqual(['budget-exceeded', 'shape-cap-reached']);
  });
});
