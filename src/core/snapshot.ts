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
import { WIRE_HEADER_SLOTS } from './types';

const DEFAULT_MAX_ENTRIES = 128;

/** A snapshot whose wire buffer carries the header and nothing else — the
 *  traversal ran to completion and found no shape worth drawing. */
export function isEmptySnapshot(snapshot: ShapeSnapshot): boolean {
  return snapshot.data.length <= WIRE_HEADER_SLOTS;
}

/** Ceiling on how many times ONE cache key's empty measurement may be re-taken
 *  before the emptiness is accepted as the final truth for that key.
 *
 *  Defect this exists for (2026-08-29): an empty measurement used to be cached
 *  exactly like a populated one, so a subtree that had no layout box at the
 *  instant of its first cold traversal — an `<img>` whose bytes had not arrived
 *  is the everyday case — was answered with that same zero-shape snapshot for
 *  the whole lifetime of the key. The overlay host mounted, `aria-hidden` was
 *  applied, `onMetrics` reported a snapshot, and nothing was ever painted.
 *  Measured on both a real `<img>` and a real `react-native-web` view.
 *
 *  Why a BOUND and not "never cache zero shapes": zero shapes is sometimes the
 *  honest answer. A subtree that is entirely `<AutoSkeleton.Ignore>`d, or is
 *  nothing but transparent structural wrappers, has genuinely nothing to
 *  skeleton, and re-measuring it on every loading cycle forever is a silent
 *  traversal hot-loop — a different defect, not a fix. Nothing observable at
 *  the moment of measurement distinguishes "measured nothing because there is
 *  nothing" from "measured nothing because it was not ready yet", so the only
 *  honest resolution is to treat an empty result as PROVISIONAL for a bounded
 *  number of attempts and then accept it.
 *
 *  3, and `emptyMeasurementsFor` as a public read seam, deliberately mirror
 *  `list.ts`'s `MAX_MEASUREMENT_ATTEMPTS`/`attemptsFor` (tasks.md G.10), which
 *  solved the same class for the list template registry: an OBSERVABLE ceiling,
 *  never a silently-decided one. Retries are paced by loading CYCLES (both
 *  `AutoSkeleton` components re-run their cold measurement per cycle), not by
 *  frames, so the budget is spent across genuinely different moments in the
 *  app's life rather than burned in three consecutive frames that all observe
 *  the same not-yet-laid-out DOM. */
export const MAX_EMPTY_MEASUREMENTS = 3;

/** Internal store entry: a snapshot plus, for an EMPTY one, how many empty
 *  measurements in a row this key has now produced. Module-private — the count
 *  is read back through `emptyMeasurementsFor`, never off a snapshot handed to
 *  a caller, and `serializeSnapshot` picks its fields explicitly so it can
 *  never leak into a wire payload. */
type CountedSnapshot = ShapeSnapshot & { readonly emptyRuns?: number };

export interface MemoryShapeStoreOptions {
  /** LRU cap (ASSUMPTION plan.md §11.6: default 128, configurable). */
  readonly maxEntries?: number;
}

/** v1 in-memory `ShapeStore` (spec §5: disk persistence is out of scope for
 *  v1). LRU eviction on `set`, recency refreshed on `get`, so a long-lived
 *  list app cannot grow the cache without bound. */
export class MemoryShapeStore implements ShapeStore {
  private readonly maxEntries: number;
  private readonly entries = new Map<ShapeCacheKey, CountedSnapshot>();
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
    // `set` is the one place every completed measurement passes through, so it
    // is where the empty run is counted — no caller has to remember to. The
    // count rides ON the entry rather than in a parallel map so it dies with
    // the entry on EVERY removal path (delete / invalidate / clear / LRU
    // eviction) for free: a key whose entry is gone has no history, so its
    // next measurement starts from a fresh budget.
    const priorEmptyRuns = this.entries.get(key)?.emptyRuns ?? 0;
    this.entries.delete(key);
    this.entries.set(
      key,
      isEmptySnapshot(snapshot) ? { ...snapshot, emptyRuns: priorEmptyRuns + 1 } : snapshot,
    );
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

  /** How many times in a row an EMPTY measurement has been stored for `key`
   *  (`0` for a key that was never measured, or whose last measurement found
   *  shapes). The inspectable half of `MAX_EMPTY_MEASUREMENTS` — both
   *  `AutoSkeleton` components read it to decide whether a cached empty result
   *  is still provisional, and a test or a debugging session can read the exact
   *  same number rather than inferring the ceiling from behaviour. */
  emptyMeasurementsFor(key: ShapeCacheKey): number {
    return this.entries.get(key)?.emptyRuns ?? 0;
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
