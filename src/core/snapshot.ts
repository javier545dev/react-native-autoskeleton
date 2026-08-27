// src/core/snapshot.ts
//
// plan.md §3.3 / §2 module layout: `serializeSnapshot`/`deserializeSnapshot`
// and `MemoryShapeStore`. Observability N/A directly for this task; the
// store/serializer underlie `onMetrics.cacheHit` correctness downstream
// (assembled in task 1.8's `assembleMetrics`).

import type { CacheKeyParts, ShapeCacheKey } from './cache-key';
import { keyMatches } from './cache-key';
import type { ImportReport, ShapeStore } from './contracts';
import type { DegradationFlag, SerializedShapeSnapshot, ShapeSnapshot } from './types';
import { decodeWire } from './wire';

/** Deviation note: plan.md's contract sketch names the too-new-version throw
 *  `WireVersionError`; this implementation reuses `wire.ts`'s
 *  `WireVersionMismatchError` (via `decodeWire`) instead of introducing a
 *  second error type for the identical condition. No downstream task or spec
 *  scenario references the literal symbol name `WireVersionError`. */
function isProductionBuild(): boolean {
  return (
    typeof process !== 'undefined' && process.env?.['NODE_ENV'] === 'production'
  );
}

/** Converts a runtime snapshot to its JSON-safe form. Dev sidecars
 *  (`sources`/`radiusSources`) are stripped in production builds so they can
 *  never inflate the SSR payload (plan.md §4.4). */
export function serializeSnapshot(s: ShapeSnapshot): SerializedShapeSnapshot {
  const includeSidecars = !isProductionBuild();
  const serialized: {
    v: number;
    key: string;
    capturedAt: number;
    frame: readonly [number, number];
    data: readonly number[];
    sources?: readonly number[];
    radiusSources?: readonly number[];
    degraded?: readonly DegradationFlag[];
  } = {
    v: s.version,
    key: s.key,
    capturedAt: s.capturedAt,
    frame: [s.frameWidth, s.frameHeight],
    data: Array.from(s.data),
  };
  if (includeSidecars && s.sources) {
    serialized.sources = Array.from(s.sources);
  }
  if (includeSidecars && s.radiusSources) {
    serialized.radiusSources = Array.from(s.radiusSources);
  }
  if (s.degraded.length > 0) {
    serialized.degraded = s.degraded;
  }
  return serialized;
}

/** Reconstructs a runtime snapshot from its JSON-safe form. Rejects a newer
 *  schema version and forward-migrates an older one (both via `decodeWire`),
 *  merging any resulting `snapshot-version-mismatch` flag with the flags the
 *  serialized snapshot already carried. */
export function deserializeSnapshot(s: SerializedShapeSnapshot): ShapeSnapshot {
  const data = Float32Array.from(s.data);
  const decoded = decodeWire(data);
  const degraded = new Set<DegradationFlag>([...(s.degraded ?? []), ...decoded.degraded]);

  return {
    key: s.key as ShapeCacheKey,
    version: decoded.version,
    capturedAt: s.capturedAt,
    frameWidth: s.frame[0],
    frameHeight: s.frame[1],
    data,
    sources: s.sources ? Uint8Array.from(s.sources) : undefined,
    radiusSources: s.radiusSources ? Uint8Array.from(s.radiusSources) : undefined,
    degraded: Array.from(degraded),
  };
}

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

  export(): readonly SerializedShapeSnapshot[] {
    return Array.from(this.entries.values(), serializeSnapshot);
  }

  import(entries: readonly SerializedShapeSnapshot[]): ImportReport {
    let accepted = 0;
    let rejected = 0;
    const reasons: DegradationFlag[] = [];
    for (const entry of entries) {
      try {
        const snapshot = deserializeSnapshot(entry);
        this.set(snapshot.key, snapshot);
        accepted += 1;
      } catch {
        rejected += 1;
        // No dedicated DegradationFlag exists for "malformed wire buffer";
        // 'snapshot-version-mismatch' is documented as "stored snapshot
        // rejected by wire version negotiation", which is the closest and
        // only applicable flag for any import-time decode rejection.
        reasons.push('snapshot-version-mismatch');
      }
    }
    return { accepted, rejected, reasons };
  }

  subscribe(listener: (key: ShapeCacheKey) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
