// src/core/snapshot-io.ts
//
// PHASE 2 REVISION (task 2.5, NFR-6 remediation): `serializeSnapshot` /
// `deserializeSnapshot` and the `exportShapeStore` / `importIntoShapeStore`
// free functions used to live as methods on `MemoryShapeStore` itself
// (`snapshot.ts`). That coupled the hot-path `get`/`set`/`has` methods
// `AutoSkeleton` actually calls at runtime to serialization logic ONLY the
// Phase 8 SSR capture CLI and v2 disk persistence need — and a bundler
// cannot tree-shake individual class methods, so `export()`/`import()` (and
// everything they transitively called) rode into every web bundle
// regardless of whether the running app ever used them.
//
// Moving this logic into free functions in their own module fixes that: a
// bundler tree-shakes unused top-level exports normally, so a web build
// that never imports `exportShapeStore`/`importIntoShapeStore` (nor
// `serializeSnapshot`/`deserializeSnapshot`, which nothing else calls) drops
// this entire file's compiled output. See plan.md §3.3 for the contract as
// shipped and spec.md NFR-6 for the measured before/after.
//
// Observability / Performance: N/A — pure data transforms, cold/opt-in path
// only (never called on the hot `get`/`set`/`has` path this module avoids
// coupling to).

import type { ShapeCacheKey } from './cache-key';
import type { ImportReport, ShapeStore } from './contracts';
import type { DegradationFlag, SerializedShapeSnapshot, ShapeSnapshot } from './types';
import { decodeWire } from './wire';

/** Deviation note: plan.md's contract sketch names the too-new-version throw
 *  `WireVersionError`; this implementation reuses `wire.ts`'s
 *  `WireVersionMismatchError` (via `decodeWire`) instead of introducing a
 *  second error type for the identical condition. No downstream task or spec
 *  scenario references the literal symbol name `WireVersionError`. */
function isProductionBuild(): boolean {
  return typeof process !== 'undefined' && process.env?.['NODE_ENV'] === 'production';
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

/** Minimal read seam a store needs to support bulk export — deliberately
 *  narrower than the full `ShapeStore` contract so any future store
 *  implementation (v2 disk persistence, a test double, etc.) can opt into
 *  export without carrying the rest of this module. `MemoryShapeStore`
 *  satisfies this structurally via its `values()` method. */
export interface ShapeSnapshotSource {
  values(): Iterable<ShapeSnapshot>;
}

/** Opt-in bulk export. The Phase 8 capture CLI (and anything else that
 *  explicitly imports this function) calls it; the live web/native runtime
 *  never does, so it tree-shakes out of a production bundle. */
export function exportShapeStore(store: ShapeSnapshotSource): readonly SerializedShapeSnapshot[] {
  return Array.from(store.values(), serializeSnapshot);
}

/** Opt-in bulk import. Feeds a target `ShapeStore` via its normal hot-path
 *  `set()` — no extra coupling to the store's internals beyond the contract
 *  every `ShapeStore` already exposes. */
export function importIntoShapeStore(
  store: Pick<ShapeStore, 'set'>,
  entries: readonly SerializedShapeSnapshot[],
): ImportReport {
  let accepted = 0;
  let rejected = 0;
  const reasons: DegradationFlag[] = [];
  for (const entry of entries) {
    try {
      const snapshot = deserializeSnapshot(entry);
      store.set(snapshot.key, snapshot);
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
