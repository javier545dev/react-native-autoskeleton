// src/web/ssr/AutoSkeletonSSR.tsx
//
// tasks.md 8.3 / spec REQ-SSR-1/REQ-SSR-4: `<AutoSkeleton.SSR>` — a server-
// renderable `<Suspense>` fallback that REPLAYS a build-time-captured
// snapshot instead of attempting live layout detection (REQ-SSR-1: there is
// nothing to sense inside a `<Suspense>` fallback — it renders before its
// children exist, on the server (no layout engine) or the client).
//
// A plain function component with ZERO hooks, ZERO effects, and ZERO
// browser/DOM reads — a pure function of `(skeletonKey, manifest,
// direction)`. That purity IS the zero-hydration-mismatch mechanism
// (REQ-SSR-4): given the identical props, the server render and the client's
// pre-hydration render compute byte-identical output, because there is
// nothing else the function could read that would differ between the two
// environments. The only thing this component KNOWS about the viewport is
// which `@media`-bucketed CSS rule the BROWSER selects after paint (task
// 8.2's `cli/media-bundle.ts` output, imported by the consumer app
// alongside the manifest) — the server never guesses it (REQ-SSR-3).
//
// Usable directly as a React Server Component (no "use client" directive):
// safe inside `<Suspense fallback={<AutoSkeleton.SSR .../>}>` in a Next.js
// App Router server component tree without adding a client boundary.

import type { ReactElement } from 'react';
import type { Direction } from '../../core/types';
import { SSR_BUILD_ATTRIBUTE } from './integrity';
import { emitManifestVersionWarning } from './manifest-warning';
import { NeutralSkeletonBlock } from './neutral-block';
import { SR_ONLY_STYLE } from './sr-only-style';
import { emitUncapturedSkeletonKeyWarning } from './uncaptured-warning';
import type { AutoSkeletonSSRManifest } from './manifest';
import { isReplayableManifest } from './manifest';

export interface AutoSkeletonSSRProps {
  readonly skeletonKey: string;
  /** The build-time capture CLI's output (`cli/capture.ts`'s
   *  `manifest.json`), imported by the consuming app and passed through
   *  explicitly — this component never reads the filesystem itself. */
  readonly manifest: AutoSkeletonSSRManifest;
  /** Spec §1.8's residual limit: the server cannot know a request's actual
   *  locale direction from this component alone. Defaults to `'ltr'` when
   *  omitted; a consumer serving RTL locales passes their own known-at-
   *  request-time direction (e.g. from a route segment or a header already
   *  read by their own server component), never guessed here. */
  readonly direction?: Direction;
}

/** `<AutoSkeleton.SSR>` (task 8.3). When `skeletonKey` is in
 *  `manifest.capturedKeys`, renders a geometry-less overlay carrying
 *  `data-askl-ssr-key`/`data-askl-ssr-dir` — the ACTUAL shape (clip-path,
 *  width, height) comes entirely from the `@media`-bucketed CSS bundle the
 *  consumer imports globally (task 8.2), never from inline styles computed
 *  here, which is what lets one server payload be correct at every width
 *  (REQ-SSR-3). When `skeletonKey` was never captured, renders the ADR-12
 *  neutral generic block — the SAME `NeutralSkeletonBlock` the client
 *  renders for the identical (uncaptured) key, so there is nothing to
 *  mismatch on. */
export function AutoSkeletonSSR(props: AutoSkeletonSSRProps): ReactElement {
  // Schema gate FIRST. `manifest.v` has been written by the capture CLI since
  // task 8.1 and read by nothing — a manifest captured by a different library
  // version replayed as if it were current. The correct failure mode is the
  // block that renders NOTHING WRONG, not a best-effort replay: subtly wrong
  // geometry is worse than none, because the wrong one ships. Pure and
  // prop-derived, so the client reaches the same verdict from the same data
  // and there is nothing to mismatch on.
  if (!isReplayableManifest(props.manifest)) {
    emitManifestVersionWarning(props.manifest.v);
    return <NeutralSkeletonBlock />;
  }

  const captured = props.manifest.capturedKeys.includes(props.skeletonKey);
  if (!captured) {
    // RISK-4's runtime detection signal (dev-only): a console.warn side
    // effect during render does not touch the RENDERED OUTPUT (React's
    // reconciliation/hydration diffing never inspects console output), so
    // it cannot introduce a hydration mismatch — the component's markup
    // stays a pure function of props either way.
    emitUncapturedSkeletonKeyWarning(props.skeletonKey);
    return <NeutralSkeletonBlock />;
  }

  const direction = props.direction ?? 'ltr';
  return (
    <div
      aria-busy="true"
      role="status"
      data-autoskeleton-ignore="true"
      data-askl-ssr-key={props.skeletonKey}
      data-askl-ssr-dir={direction}
      // The manifest<->CSS binding (see `integrity.ts`). The generated
      // bundle's geometry rules are qualified by this exact token, so a
      // `bundle.css` from a DIFFERENT capture run simply does not select this
      // element and its drift-fallback rule paints the neutral block's
      // geometry instead. Structural, not advisory: there is no code path in
      // which a stale pair can paint stale shapes.
      {...{ [SSR_BUILD_ATTRIBUTE]: props.manifest.integrity }}
      className="askl-overlay askl-anim-shimmer"
      style={{ position: 'relative', overflow: 'hidden' }}
    >
      <div className="askl-overlay-base" style={{ position: 'absolute', inset: 0 }} />
      <div className="askl-shimmer-layer" />
      <span style={SR_ONLY_STYLE}>Loading</span>
    </div>
  );
}
