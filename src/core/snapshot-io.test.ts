import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ShapeCacheKey } from './cache-key';
import { composeCacheKey } from './cache-key';
import type { ShapeSnapshot } from './types';
import { WIRE_VERSION } from './types';
import { encodeWire } from './wire';
import { serializeSnapshot, deserializeSnapshot, exportShapeStore, importIntoShapeStore } from './snapshot-io';
import { MemoryShapeStore } from './snapshot';

// Task 1.3 (tasks.md Phase 1): Observability N/A directly for this task; the
// serialize/deserialize round-trip underlies `onMetrics.cacheHit` correctness
// downstream (assembled in 1.8).
//
// PHASE 2 REVISION (task 2.5, NFR-6 remediation): `serializeSnapshot` /
// `deserializeSnapshot` and the `exportShapeStore` / `importIntoShapeStore`
// free functions moved here, out of `snapshot.ts`, so a bundler can
// tree-shake the whole serialization path out of a web build that never
// calls it (see snapshot-io.ts's own header comment and plan.md §3.3). This
// file was `snapshot.test.ts` before that move; the `MemoryShapeStore`
// import/export round-trip tests (formerly in `memory-shape-store.test.ts`)
// were merged in here alongside it, since they now exercise this module's
// free functions rather than class methods.

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

function keyFor(skeletonKey: string): ShapeCacheKey {
  return composeCacheKey({
    skeletonKey,
    itemType: undefined,
    viewportWidth: 390,
    fontScale: 1,
    direction: 'ltr',
    platform: 'ios',
  });
}

function snapshotFor(key: ShapeCacheKey): ShapeSnapshot {
  return {
    key,
    version: WIRE_VERSION,
    capturedAt: Date.now(),
    frameWidth: 390,
    frameHeight: 844,
    data: encodeWire([{ x: 0, y: 0, w: 100, h: 20, r: 4 }]),
    degraded: [],
  };
}

// Moved from memory-shape-store.test.ts (Phase 2 revision, task 2.5): these
// now exercise the `exportShapeStore` / `importIntoShapeStore` free
// functions instead of `MemoryShapeStore.export()` / `.import()` methods,
// which no longer exist on the class (see snapshot-io.ts header comment for
// why: a bundler cannot tree-shake individual class methods, so this
// serialization logic rode into every web bundle regardless of use).
describe('exportShapeStore / importIntoShapeStore round-trip (MemoryShapeStore)', () => {
  it('exports every entry and a fresh store imports them all as accepted', () => {
    const source = new MemoryShapeStore();
    const a = keyFor('a');
    const b = keyFor('b');
    source.set(a, snapshotFor(a));
    source.set(b, snapshotFor(b));

    const exported = exportShapeStore(source);
    expect(exported).toHaveLength(2);

    const target = new MemoryShapeStore();
    const report = importIntoShapeStore(target, exported);
    expect(report).toEqual({ accepted: 2, rejected: 0, reasons: [] });
    expect(target.has(a)).toBe(true);
    expect(target.has(b)).toBe(true);
  });

  it('rejects an unparseable entry and reports the reason', () => {
    const target = new MemoryShapeStore();
    const report = importIntoShapeStore(target, [
      {
        v: WIRE_VERSION,
        key: keyFor('broken'),
        capturedAt: 0,
        frame: [0, 0],
        data: [WIRE_VERSION, 1, 2], // malformed length: fails the modulus check
      },
    ]);
    expect(report.accepted).toBe(0);
    expect(report.rejected).toBe(1);
    expect(report.reasons.length).toBeGreaterThan(0);
  });
});
