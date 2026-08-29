// src/web/ssr/manifest.ts
//
// plan.md §3.3 / §6, tasks.md 8.1/8.3: the JSON-safe artifact the capture CLI
// (`cli/capture.ts`) writes and `<AutoSkeleton.SSR>` (task 8.3) reads. Lives
// under `src/web/ssr/` (not `cli/`) because it is PUBLIC runtime API surface
// — a consumer's Next.js app imports the manifest JSON the CLI wrote and
// passes it to `<AutoSkeleton.SSR manifest={...}>` — whereas `cli/` is a
// build-time-only tool. `cli/manifest.ts` re-exports these same types rather
// than duplicating them, so the CLI's write side and the component's read
// side can never drift out of sync.

import type { Direction, SerializedShapeSnapshot } from '../../core/types';

// BUMPED 1 -> 2 (2026-08-28) when `integrity` became a required field. The
// bump is what makes the previously-unvalidated `v` field earn its keep: an
// older manifest has no build token at all, so replaying it would stamp
// `data-askl-ssr-build="undefined"` and silently never match any CSS rule.
// `isReplayableManifest` below turns that into the defined ADR-12 neutral
// degradation instead.
export const SSR_MANIFEST_VERSION = 2;

/** One captured snapshot for a single (skeletonKey, widthBucket, direction)
 *  combination — the CLI captures the full cross-product declared by
 *  `WIDTH_BUCKETS` x ['ltr','rtl'] for every registry entry. */
export interface AutoSkeletonSSRManifestEntry {
  readonly skeletonKey: string;
  readonly widthBucket: number;
  readonly direction: Direction;
  readonly snapshot: SerializedShapeSnapshot;
}

/** The complete build-time artifact a consumer app imports and passes to
 *  `<AutoSkeleton.SSR manifest={...}>` (server AND client — ADR-12 requires
 *  the SAME pure function/data on both sides) and to
 *  `<AutoSkeleton.SSRHydrate manifest={...}>` (the client hydration bridge).
 *  `widthBuckets` travels WITH the manifest (rather than the component
 *  re-importing `WIDTH_BUCKETS` at read time) so the RISK-2 drift-guard CI
 *  check (task 8.2) has a concrete value to compare the runtime table
 *  against, independent of when a given manifest was captured. */
export interface AutoSkeletonSSRManifest {
  readonly v: number;
  /** Build token binding this manifest to the `bundle.css` generated from it
   *  in the same capture run (`integrity.ts`). It is baked into every
   *  geometry rule's SELECTOR in that CSS and stamped onto the replayed
   *  element, so a mismatched manifest/CSS pair cannot select and degrades to
   *  the ADR-12 neutral block instead of painting stale geometry. */
  readonly integrity: string;
  readonly widthBuckets: readonly number[];
  /** Every `skeletonKey` the CLI actually captured at least one entry for —
   *  the exact membership test ADR-12's "uncaptured key -> neutral block"
   *  branch reads, identically on server and client. */
  readonly capturedKeys: readonly string[];
  readonly entries: readonly AutoSkeletonSSRManifestEntry[];
}

/** Read-time schema gate. `v` was written by the capture CLI since task 8.1
 *  and read by NOTHING until now — a manifest captured by a different library
 *  version was replayed as if it were current, which is precisely the "subtly
 *  wrong geometry ships" failure this whole module exists to prevent.
 *
 *  A pure predicate on purpose: `<AutoSkeleton.SSR>` (server) and
 *  `<AutoSkeleton.SSRHydrate>` (client) must reach the SAME verdict from the
 *  SAME data, or the guard would itself become a hydration mismatch. */
export function isReplayableManifest(manifest: AutoSkeletonSSRManifest): boolean {
  return manifest.v === SSR_MANIFEST_VERSION;
}
