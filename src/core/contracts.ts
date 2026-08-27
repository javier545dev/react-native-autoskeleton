// src/core/contracts.ts
//
// plan.md §2 module layout: `Sensor`, `Renderer`, `ShapeStore`, `ShimmerClock`.
// `ShapeStore`/`ImportReport` are needed by `MemoryShapeStore` (task 1.3) and
// land here first; `Sensor`/`Renderer`/`ShimmerClock`/`HintRegistry`/
// `SensorOptions`/`SensorResult` are finalized in task 1.8.

import type { CacheKeyParts, ShapeCacheKey } from './cache-key';
import type { DegradationFlag, SerializedShapeSnapshot, ShapeSnapshot } from './types';

export interface ImportReport {
  readonly accepted: number;
  readonly rejected: number;
  readonly reasons: readonly DegradationFlag[];
}

export interface ShapeStore {
  /** HOT PATH. MUST be synchronous and < 0.2 ms (spec NFR-4). Never async, never a
   *  Promise: an async lookup cannot produce a faithful first frame. */
  get(key: ShapeCacheKey): ShapeSnapshot | undefined;
  has(key: ShapeCacheKey): boolean;
  set(key: ShapeCacheKey, snapshot: ShapeSnapshot): void;
  delete(key: ShapeCacheKey): boolean;
  /** returns the number of entries removed */
  invalidate(predicate: (parts: CacheKeyParts) => boolean): number;
  clear(): void;
  readonly size: number;

  /** Serializable by construction. The capture CLI writes `export()` output; the SSR
   *  client and v2 disk persistence feed `import()`. Both are pure data. */
  export(): readonly SerializedShapeSnapshot[];
  import(entries: readonly SerializedShapeSnapshot[]): ImportReport;

  /** v2 disk persistence hook. Warm-up is async; lookup stays sync. Absent in v1. */
  hydrate?(): Promise<void>;

  /** list helpers and the debug overlay react to late-arriving cold results */
  subscribe(listener: (key: ShapeCacheKey) => void): () => void;
}
