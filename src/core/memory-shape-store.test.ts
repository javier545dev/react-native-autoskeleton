import { describe, expect, it, vi } from 'vitest';
import type { ShapeCacheKey } from './cache-key';
import { composeCacheKey } from './cache-key';
import type { ShapeSnapshot } from './types';
import { WIRE_VERSION } from './types';
import { encodeWire } from './wire';
import { isEmptySnapshot, MAX_EMPTY_MEASUREMENTS, MemoryShapeStore } from './snapshot';

// Task 1.3 (tasks.md Phase 1): Observability N/A directly for this task; the
// store underlies `onMetrics.cacheHit` correctness downstream (assembled in 1.8).

function keyFor(skeletonKey: string, platform: 'ios' | 'android' | 'web' = 'ios'): ShapeCacheKey {
  return composeCacheKey({
    skeletonKey,
    itemType: undefined,
    viewportWidth: 390,
    fontScale: 1,
    direction: 'ltr',
    platform,
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

describe('MemoryShapeStore basic get/has/set/delete', () => {
  it('stores and retrieves a snapshot by key', () => {
    const store = new MemoryShapeStore();
    const key = keyFor('profile');
    expect(store.has(key)).toBe(false);
    store.set(key, snapshotFor(key));
    expect(store.has(key)).toBe(true);
    expect(store.get(key)?.frameWidth).toBe(390);
    expect(store.size).toBe(1);
  });

  it('deletes an entry and reports whether one was removed', () => {
    const store = new MemoryShapeStore();
    const key = keyFor('profile');
    expect(store.delete(key)).toBe(false);
    store.set(key, snapshotFor(key));
    expect(store.delete(key)).toBe(true);
    expect(store.has(key)).toBe(false);
  });

  it('clear() empties the store', () => {
    const store = new MemoryShapeStore();
    store.set(keyFor('a'), snapshotFor(keyFor('a')));
    store.set(keyFor('b'), snapshotFor(keyFor('b')));
    store.clear();
    expect(store.size).toBe(0);
  });
});

describe('MemoryShapeStore LRU eviction order', () => {
  it('evicts the least-recently-used entry when the cap is exceeded', () => {
    const store = new MemoryShapeStore({ maxEntries: 2 });
    const a = keyFor('a');
    const b = keyFor('b');
    const c = keyFor('c');
    store.set(a, snapshotFor(a));
    store.set(b, snapshotFor(b));
    store.set(c, snapshotFor(c)); // exceeds cap of 2 -> evicts 'a' (oldest)
    expect(store.has(a)).toBe(false);
    expect(store.has(b)).toBe(true);
    expect(store.has(c)).toBe(true);
  });

  it('a get() refreshes recency so the touched entry survives eviction', () => {
    const store = new MemoryShapeStore({ maxEntries: 2 });
    const a = keyFor('a');
    const b = keyFor('b');
    const c = keyFor('c');
    store.set(a, snapshotFor(a));
    store.set(b, snapshotFor(b));
    store.get(a); // touch 'a' -> 'b' becomes the least-recently-used
    store.set(c, snapshotFor(c)); // evicts 'b', not 'a'
    expect(store.has(a)).toBe(true);
    expect(store.has(b)).toBe(false);
    expect(store.has(c)).toBe(true);
  });

  it('defaults the cap to 128 entries (ASSUMPTION plan.md §11.6)', () => {
    const store = new MemoryShapeStore();
    for (let i = 0; i < 129; i++) {
      const key = keyFor(`item-${i}`);
      store.set(key, snapshotFor(key));
    }
    expect(store.size).toBe(128);
    expect(store.has(keyFor('item-0'))).toBe(false);
    expect(store.has(keyFor('item-128'))).toBe(true);
  });
});

describe('MemoryShapeStore invalidate predicate', () => {
  it('removes only entries matching the predicate and returns the removed count', () => {
    const store = new MemoryShapeStore();
    const ios = keyFor('profile', 'ios');
    const android = keyFor('profile', 'android');
    store.set(ios, snapshotFor(ios));
    store.set(android, snapshotFor(android));
    const removed = store.invalidate((parts) => parts.platform === 'ios');
    expect(removed).toBe(1);
    expect(store.has(ios)).toBe(false);
    expect(store.has(android)).toBe(true);
  });
});

describe('MemoryShapeStore subscribe notifications', () => {
  it('notifies subscribers with the affected key on set()', () => {
    const store = new MemoryShapeStore();
    const listener = vi.fn();
    store.subscribe(listener);
    const key = keyFor('profile');
    store.set(key, snapshotFor(key));
    expect(listener).toHaveBeenCalledWith(key);
  });

  it('stops notifying after unsubscribe', () => {
    const store = new MemoryShapeStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();
    store.set(keyFor('profile'), snapshotFor(keyFor('profile')));
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('MemoryShapeStore synchronous lookup budget (NFR-4 local guard)', () => {
  it('p95 sync get() stays under 0.2 ms over 1000 iterations', () => {
    const store = new MemoryShapeStore();
    const keys = Array.from({ length: 100 }, (_, i) => keyFor(`item-${i}`));
    for (const key of keys) {
      store.set(key, snapshotFor(key));
    }

    const samples: number[] = [];
    for (let i = 0; i < 1000; i++) {
      const key = keys[i % keys.length]!;
      const start = performance.now();
      store.get(key);
      samples.push(performance.now() - start);
    }

    samples.sort((a, b) => a - b);
    const p95 = samples[Math.floor(samples.length * 0.95)]!;
    // Local guard only; the authoritative CI benchmark is task 9.1.
    expect(p95).toBeLessThan(0.2);
  });
});

describe('MemoryShapeStore values() (bulk-iteration seam for opt-in serialization)', () => {
  it('yields every stored snapshot', () => {
    const store = new MemoryShapeStore();
    const a = keyFor('a');
    const b = keyFor('b');
    store.set(a, snapshotFor(a));
    store.set(b, snapshotFor(b));
    expect(Array.from(store.values())).toHaveLength(2);
  });
});

// PHASE 2 REVISION (task 2.5, NFR-6 remediation): the `export()`/`import()`
// round-trip tests that used to live here now live in
// `snapshot-io.test.ts`, because `MemoryShapeStore` no longer HAS those
// methods — they moved to the `exportShapeStore`/`importIntoShapeStore` free
// functions in `snapshot-io.ts` so a bundler can tree-shake them out of a
// web build that never calls them. See `snapshot-io.ts`'s header comment and
// plan.md §3.3 for the full rationale.

// ---------------------------------------------------------------------------
// Empty-measurement ceiling (defect, 2026-08-29): a measurement that produced
// ZERO shapes was written to the store like any other, so every later cycle
// served that empty snapshot back instead of re-measuring — the skeleton for
// an `<img>` (or anything else) that had no layout box at first measure was
// permanently blank, on both platforms. See `snapshot.ts`'s
// `MAX_EMPTY_MEASUREMENTS` doc comment for why the answer is a BOUNDED,
// INSPECTABLE re-measure budget rather than "never cache zero shapes".
// ---------------------------------------------------------------------------

function emptySnapshotFor(key: ShapeCacheKey): ShapeSnapshot {
  return { ...snapshotFor(key), data: encodeWire([]) };
}

describe('isEmptySnapshot', () => {
  it('is true for a snapshot carrying no shapes and false for one carrying any', () => {
    const key = keyFor('profile');
    expect(isEmptySnapshot(emptySnapshotFor(key))).toBe(true);
    expect(isEmptySnapshot(snapshotFor(key))).toBe(false);
  });
});

describe('MemoryShapeStore empty-measurement ceiling', () => {
  it('reports zero empty measurements for a key that was never measured', () => {
    const store = new MemoryShapeStore();
    expect(store.emptyMeasurementsFor(keyFor('profile'))).toBe(0);
  });

  it('counts each stored EMPTY measurement per key, independently of other keys', () => {
    const store = new MemoryShapeStore();
    const a = keyFor('a');
    const b = keyFor('b');
    store.set(a, emptySnapshotFor(a));
    store.set(a, emptySnapshotFor(a));
    store.set(b, emptySnapshotFor(b));
    expect(store.emptyMeasurementsFor(a)).toBe(2);
    expect(store.emptyMeasurementsFor(b)).toBe(1);
  });

  it('does not count a measurement that produced shapes, and clears a prior empty run', () => {
    const store = new MemoryShapeStore();
    const key = keyFor('profile');
    store.set(key, emptySnapshotFor(key));
    expect(store.emptyMeasurementsFor(key)).toBe(1);
    store.set(key, snapshotFor(key));
    expect(store.emptyMeasurementsFor(key)).toBe(0);
  });

  it('the ceiling is a real, inspectable bound — not an infinite retry', () => {
    const store = new MemoryShapeStore();
    const key = keyFor('nothing-to-draw');
    for (let i = 0; i < MAX_EMPTY_MEASUREMENTS; i++) {
      expect(store.emptyMeasurementsFor(key)).toBeLessThan(MAX_EMPTY_MEASUREMENTS);
      store.set(key, emptySnapshotFor(key));
    }
    expect(store.emptyMeasurementsFor(key)).toBe(MAX_EMPTY_MEASUREMENTS);
  });

  it('forgets the count when the entry is deleted, so a re-measured key starts fresh', () => {
    const store = new MemoryShapeStore();
    const key = keyFor('profile');
    store.set(key, emptySnapshotFor(key));
    store.delete(key);
    expect(store.emptyMeasurementsFor(key)).toBe(0);
  });

  it('forgets the count when the entry is invalidated', () => {
    const store = new MemoryShapeStore();
    const key = keyFor('profile', 'ios');
    store.set(key, emptySnapshotFor(key));
    store.invalidate((parts) => parts.platform === 'ios');
    expect(store.emptyMeasurementsFor(key)).toBe(0);
  });

  it('forgets the count when the store is cleared', () => {
    const store = new MemoryShapeStore();
    const key = keyFor('profile');
    store.set(key, emptySnapshotFor(key));
    store.clear();
    expect(store.emptyMeasurementsFor(key)).toBe(0);
  });

  it('forgets the count when the entry is evicted by the LRU cap', () => {
    const store = new MemoryShapeStore({ maxEntries: 1 });
    const a = keyFor('a');
    const b = keyFor('b');
    store.set(a, emptySnapshotFor(a));
    store.set(b, emptySnapshotFor(b)); // evicts 'a'
    expect(store.has(a)).toBe(false);
    expect(store.emptyMeasurementsFor(a)).toBe(0);
  });
});
