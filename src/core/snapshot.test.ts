import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ShapeCacheKey } from './cache-key';
import { composeCacheKey } from './cache-key';
import type { ShapeSnapshot } from './types';
import { WIRE_VERSION } from './types';
import { encodeWire } from './wire';
import { serializeSnapshot, deserializeSnapshot } from './snapshot';

// Task 1.3 (tasks.md Phase 1): Observability N/A directly for this task; the
// serialize/deserialize round-trip underlies `onMetrics.cacheHit` correctness
// downstream (assembled in 1.8).

const KEY: ShapeCacheKey = composeCacheKey({
  skeletonKey: 'profile',
  itemType: undefined,
  viewportWidth: 390,
  fontScale: 1,
  direction: 'ltr',
  platform: 'ios',
});

function makeSnapshot(overrides: Partial<ShapeSnapshot> = {}): ShapeSnapshot {
  return {
    key: KEY,
    version: WIRE_VERSION,
    capturedAt: 1000,
    frameWidth: 390,
    frameHeight: 844,
    data: encodeWire([{ x: 0, y: 0, w: 100, h: 20, r: 4 }]),
    degraded: [],
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('serializeSnapshot / deserializeSnapshot round-trip', () => {
  it('round-trips a snapshot with no sidecars', () => {
    const snapshot = makeSnapshot();
    const serialized = serializeSnapshot(snapshot);
    expect(serialized).toEqual({
      v: WIRE_VERSION,
      key: KEY,
      capturedAt: 1000,
      frame: [390, 844],
      data: Array.from(snapshot.data),
    });
    const restored = deserializeSnapshot(serialized);
    expect(restored.key).toBe(KEY);
    expect(restored.frameWidth).toBe(390);
    expect(restored.frameHeight).toBe(844);
    expect(Array.from(restored.data)).toEqual(Array.from(snapshot.data));
    expect(restored.degraded).toEqual([]);
  });

  it('preserves dev sidecars in a non-production build', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const snapshot = makeSnapshot({
      sources: new Uint8Array([1]),
      radiusSources: new Uint8Array([2]),
    });
    const serialized = serializeSnapshot(snapshot);
    expect(serialized.sources).toEqual([1]);
    expect(serialized.radiusSources).toEqual([2]);
    const restored = deserializeSnapshot(serialized);
    expect(Array.from(restored.sources!)).toEqual([1]);
    expect(Array.from(restored.radiusSources!)).toEqual([2]);
  });

  it('strips dev sidecars in a production build', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const snapshot = makeSnapshot({
      sources: new Uint8Array([1]),
      radiusSources: new Uint8Array([2]),
    });
    const serialized = serializeSnapshot(snapshot);
    expect(serialized.sources).toBeUndefined();
    expect(serialized.radiusSources).toBeUndefined();
  });

  it('forward-migrates an older serialized snapshot and reports snapshot-version-mismatch', () => {
    const olderData = encodeWire([{ x: 0, y: 0, w: 10, h: 10, r: 0 }], WIRE_VERSION - 1);
    const serialized = {
      v: WIRE_VERSION - 1,
      key: KEY,
      capturedAt: 500,
      frame: [390, 844] as const,
      data: Array.from(olderData),
    };
    const restored = deserializeSnapshot(serialized);
    expect(restored.degraded).toContain('snapshot-version-mismatch');
  });

  it('rejects a serialized snapshot from a newer schema version', () => {
    const newerData = encodeWire([{ x: 0, y: 0, w: 10, h: 10, r: 0 }], WIRE_VERSION + 1);
    const serialized = {
      v: WIRE_VERSION + 1,
      key: KEY,
      capturedAt: 500,
      frame: [390, 844] as const,
      data: Array.from(newerData),
    };
    expect(() => deserializeSnapshot(serialized)).toThrow();
  });
});
