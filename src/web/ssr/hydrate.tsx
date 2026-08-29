'use client';

// src/web/ssr/hydrate.tsx
//
// tasks.md 8.3: the client hydration bridge — "`ShapeStore.import()` on the
// client" (plan.md §5 architecture diagram: `CSER --> IMP["importIntoShapeStore()
// on the client"] --> STORE`). Mounted ONCE, typically near the app root
// (e.g. a Next.js root layout), so build-time-captured snapshots become
// available in the RUNTIME `ShapeStore` — a subsequent client-side-only
// re-render of the SAME `skeletonKey` (e.g. a client navigation elsewhere in
// the app that mounts a live `<AutoSkeleton skeletonKey="dashboard">`) gets a
// real cache hit instead of a fresh cold traversal, exactly the "hot path,
// no traversal" the architecture diagram promises.
//
// Deliberately a SEPARATE client component from `<AutoSkeleton.SSR>` (which
// stays hook-free and server-renderable): mixing "use client" into the SSR
// fallback component would force it into a client boundary, which is exactly
// what REQ-SSR-1 says a `<Suspense>` fallback must not need.
//
// no-use-effect skill compliance: importing captured snapshots into a
// module-level, mutable `ShapeStore` is genuine synchronization with an
// external system (Rule 4) — the store is not derivable render state.

import { useEffect, useRef } from 'react';
import { importIntoShapeStore } from '../../core/snapshot-io';
import type { ShapeStore } from '../../core/contracts';
import { defaultStore } from '../AutoSkeleton';
import { SSR_BUILD_CSS_VARIABLE } from './integrity';
import { emitManifestCssDriftWarning, emitManifestVersionWarning } from './manifest-warning';
import type { AutoSkeletonSSRManifest } from './manifest';
import { isReplayableManifest } from './manifest';

export interface AutoSkeletonSSRHydrateProps {
  readonly manifest: AutoSkeletonSSRManifest;
  /** Defaults to the SAME store `<AutoSkeleton>` reads from when no
   *  `<SkeletonProvider store={...}>` override is in effect. Pass the exact
   *  store a `<SkeletonProvider>` elsewhere in the tree was given so a
   *  custom store also benefits from the hydration bridge. */
  readonly store?: ShapeStore;
}

/** Renders nothing; imports `manifest.entries` into `store` exactly once per
 *  mount (deps intentionally exclude `manifest`/`store` reference identity
 *  churn — a manifest is a static, build-time artifact within one page
 *  load, so re-running the import on every re-render would just re-set
 *  already-set keys for no benefit). */
export function AutoSkeletonSSRHydrate(props: AutoSkeletonSSRHydrateProps): null {
  const manifestRef = useRef(props.manifest);
  manifestRef.current = props.manifest;
  const storeRef = useRef(props.store);
  storeRef.current = props.store;

  useEffect(() => {
    const manifest = manifestRef.current;
    // A manifest this build cannot replay must NOT be imported into the live
    // runtime cache. `<AutoSkeleton.SSR>` already refuses to render its
    // geometry; importing the same entries here would smuggle exactly that
    // geometry into the store a later client-side `<AutoSkeleton>` reads as a
    // "hot path" cache hit — the wrong-geometry failure re-entering through
    // the back door.
    if (!isReplayableManifest(manifest)) {
      emitManifestVersionWarning(manifest.v);
      return;
    }
    const target = storeRef.current ?? defaultStore;
    importIntoShapeStore(target, manifest.entries.map((entry) => entry.snapshot));
    warnOnManifestCssDrift(manifest);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

/** Dev-only drift report. The structural binding in `integrity.ts` has ALREADY
 *  prevented a stale `bundle.css` from painting stale geometry by the time
 *  this runs — this exists so the developer learns WHY their skeleton turned
 *  into a neutral rectangle instead of bisecting it.
 *
 *  Client-only by construction (`getComputedStyle`), which is exactly right:
 *  it runs in an effect, never during render, so it cannot influence markup
 *  and therefore cannot introduce a hydration mismatch. */
function warnOnManifestCssDrift(manifest: AutoSkeletonSSRManifest): void {
  if (process.env['NODE_ENV'] === 'production' || typeof document === 'undefined') {
    return;
  }
  const cssToken = getComputedStyle(document.documentElement)
    .getPropertyValue(SSR_BUILD_CSS_VARIABLE)
    .trim()
    .replace(/^["']|["']$/g, '');
  // An empty value means the generated bundle is not loaded at all — a
  // different, already-documented setup mistake (the consumer must import
  // `bundle.css` globally), not drift. Reporting it as drift would be a lie.
  if (cssToken !== '' && cssToken !== manifest.integrity) {
    emitManifestCssDriftWarning(manifest.integrity, cssToken);
  }
}
