import { describe, expect, it, vi } from 'vitest';
import type { ShapeCacheKey } from './cache-key';
import { composeCacheKey } from './cache-key';
import type { ShapeSnapshot } from './types';
import { WIRE_VERSION } from './types';
import { encodeWire } from './wire';
import { MemoryShapeStore } from './snapshot';

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

describe('MemoryShapeStore import/export round-trip', () => {
  it('exports every entry and a fresh store imports them all as accepted', () => {
    const source = new MemoryShapeStore();
    const a = keyFor('a');
    const b = keyFor('b');
    source.set(a, snapshotFor(a));
    source.set(b, snapshotFor(b));

    const exported = source.export();
    expect(exported).toHaveLength(2);

    const target = new MemoryShapeStore();
    const report = target.import(exported);
    expect(report).toEqual({ accepted: 2, rejected: 0, reasons: [] });
    expect(target.has(a)).toBe(true);
    expect(target.has(b)).toBe(true);
  });

  it('rejects an unparseable entry and reports the reason', () => {
    const target = new MemoryShapeStore();
    const report = target.import([
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
