// src/core/snapshot.ts
//
// plan.md §3.3 / §2 module layout: `MemoryShapeStore`. Observability N/A
// directly for this task; the store underlies `onMetrics.cacheHit`
// correctness downstream (assembled in task 1.8's `assembleMetrics`).
//
// PHASE 2 REVISION (task 2.5, NFR-6 remediation): `serializeSnapshot` /
// `deserializeSnapshot` and the `export()`/`import()` bulk-serialization
// methods moved OUT of this file (and off this class) into
// `snapshot-io.ts`'s `serializeSnapshot`/`deserializeSnapshot`/
// `exportShapeStore`/`importIntoShapeStore` free functions. This file now
// contains ONLY the hot-path `get`/`has`/`set`/`delete`/`invalidate`/
// `clear`/`subscribe` surface `AutoSkeleton` actually calls at runtime, so a
// web bundle that never imports `snapshot-io.ts` never pays for
// serialization code it doesn't use. See `snapshot-io.ts`'s header comment
// for the full rationale.

import type { CacheKeyParts, ShapeCacheKey } from './cache-key';
import { keyMatches } from './cache-key';
import type { ShapeStore } from './contracts';
import type { ShapeSnapshot } from './types';

const DEFAULT_MAX_ENTRIES = 128;

export interface MemoryShapeStoreOptions {
  /** LRU cap (ASSUMPTION plan.md §11.6: default 128, configurable). */
  readonly maxEntries?: number;
}

/** v1 in-memory `ShapeStore` (spec §5: disk persistence is out of scope for
 *  v1). LRU eviction on `set`, recency refreshed on `get`, so a long-lived
 *  list app cannot grow the cache without bound. */
export class MemoryShapeStore implements ShapeStore {
  private readonly maxEntries: number;
  private readonly entries = new Map<ShapeCacheKey, ShapeSnapshot>();
  private readonly listeners = new Set<(key: ShapeCacheKey) => void>();

  constructor(options: MemoryShapeStoreOptions = {}) {
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: ShapeCacheKey): ShapeSnapshot | undefined {
    const snapshot = this.entries.get(key);
    if (snapshot === undefined) {
      return undefined;
    }
    // Refresh recency: Map iteration order is insertion order, so re-inserting
    // moves this key to the "most recently used" end.
    this.entries.delete(key);
    this.entries.set(key, snapshot);
    return snapshot;
  }

  has(key: ShapeCacheKey): boolean {
    return this.entries.has(key);
  }

  set(key: ShapeCacheKey, snapshot: ShapeSnapshot): void {
    this.entries.delete(key);
    this.entries.set(key, snapshot);
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }
      this.entries.delete(oldestKey);
    }
    for (const listener of this.listeners) {
      listener(key);
    }
  }

  delete(key: ShapeCacheKey): boolean {
    return this.entries.delete(key);
  }

  invalidate(predicate: (parts: CacheKeyParts) => boolean): number {
    let removed = 0;
    for (const key of Array.from(this.entries.keys())) {
      if (keyMatches(key, predicate)) {
        this.entries.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  clear(): void {
    this.entries.clear();
  }

  /** Bulk-iteration seam for opt-in serialization (`snapshot-io.ts`'s
   *  `exportShapeStore`). Deliberately NOT `export()`: this is a plain
   *  iterator delegate with no serialization logic of its own, so it stays
   *  cheap to ship even in a bundle that never calls it. */
  values(): IterableIterator<ShapeSnapshot> {
    return this.entries.values();
  }

  subscribe(listener: (key: ShapeCacheKey) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
