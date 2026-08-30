// cli/media-bundle.ts
//
// tasks.md 8.2 / spec REQ-SSR-3: the `@media`-bucketed CSS bundle. Emits one
// `@media` block per captured width bucket, so a single server-rendered
// payload is correct at every width without the server knowing the
// viewport — the browser's own media-query evaluation selects the matching
// block. Pure function over a manifest (`cli/manifest.ts`); no browser, no
// filesystem — `cli/capture.ts` (task 8.1) is the only caller that writes
// this string to disk.
//
// Reuses task 1.5's `buildClipPath` (never reimplements clip-path geometry)
// and task 2.2's `buildShimmerStylesheet` (the base `.askl-overlay`/
// `.askl-shimmer-layer` rules the runtime CSS renderer already ships, so the
// SSR bundle draws with the EXACT same visual mechanism, never a second
// shimmer implementation).
//
// Observability: N/A, build artifact generation. Performance: N/A.

import { buildClipPath } from '../src/core/clip-path';
import { decodeWire } from '../src/core/wire';
import { buildShimmerStylesheet } from '../src/web/css-renderer';
import {
  computeSsrManifestIntegrity,
  SSR_BUILD_ATTRIBUTE,
  SSR_BUILD_CSS_VARIABLE,
} from '../src/web/ssr/integrity';
import {
  NEUTRAL_SKELETON_HEIGHT_PX,
  NEUTRAL_SKELETON_RADIUS_PX,
} from '../src/web/ssr/neutral-geometry';
import type { AutoSkeletonSSRManifest } from './manifest';

export interface BucketRange {
  readonly bucket: number;
  /** `undefined` on the smallest bucket — it covers everything at or below it. */
  readonly minWidth: number | undefined;
  /** `undefined` on the largest bucket — it covers everything above it,
   *  mirroring `bucketWidth()`'s clamp-to-largest behaviour. */
  readonly maxWidth: number | undefined;
}

/** Splits `WIDTH_BUCKETS` (or any bucket list) into contiguous, non-
 *  overlapping CSS media-query ranges that mirror `cache-key.ts`'s
 *  `bucketWidth()` exactly: "smallest bucket >= px", clamped to the largest
 *  bucket for anything above it. Sorted ascending regardless of input order —
 *  the CSS-baked bucket list must match the runtime table's VALUES, not
 *  incidentally depend on its declaration order (RISK-2 drift guard). */
export function bucketRanges(widthBuckets: readonly number[]): readonly BucketRange[] {
  const sorted = [...widthBuckets].sort((a, b) => a - b);
  return sorted.map((bucket, i) => {
    const prev = sorted[i - 1];
    const isLast = i === sorted.length - 1;
    return {
      bucket,
      minWidth: prev !== undefined ? prev + 1 : undefined,
      maxWidth: isLast ? undefined : bucket,
    };
  });
}

function mediaQuery(range: BucketRange): string {
  const conditions: string[] = [];
  if (range.minWidth !== undefined) {
    conditions.push(`(min-width: ${range.minWidth}px)`);
  }
  if (range.maxWidth !== undefined) {
    conditions.push(`(max-width: ${range.maxWidth}px)`);
  }
  return conditions.length > 0 ? `@media ${conditions.join(' and ')}` : '@media all';
}

/** Escapes a value for use inside a CSS attribute-selector string literal
 *  (`[attr="VALUE"]`) — `skeletonKey` is developer-declared, not
 *  attacker-controlled input crossing a process boundary (that threat is
 *  `route-safety.ts`'s job), but this still guards against a stray `"` from
 *  breaking the generated stylesheet's selector syntax. */
function cssAttributeValueEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** The two attributes that mark an element as SERVER-rendered by this
 *  library: `<AutoSkeleton.SSR>`'s captured-key overlay carries the first,
 *  `NeutralSkeletonBlock` (the uncaptured-key AND manifest/CSS-drift branch)
 *  carries the second. Written as literals for the same reason the geometry
 *  selector above writes `data-askl-ssr-key`/`data-askl-ssr-dir` as literals:
 *  importing them would mean importing a `.tsx` module, dragging React and
 *  JSX into this CLI's esbuild graph for two strings (the same trade
 *  `neutral-geometry.ts` exists to avoid). */
const SSR_OVERLAY_MARKERS = ['data-askl-ssr-key', 'data-askl-ssr-neutral'];

/** REQ-A11Y-3 / spec §1.10 on the PRE-HYDRATION path.
 *
 *  The runtime web path already honours the preference, but it does so in
 *  JavaScript: `AutoSkeleton.tsx`'s `reducedMotionPreferred()` reads
 *  `matchMedia('(prefers-reduced-motion: reduce)')` and `css-renderer.ts`'s
 *  `effectiveAnimation()` swaps `askl-anim-shimmer` for `askl-anim-pulse`.
 *  None of that has run yet when a server-rendered skeleton first paints —
 *  and it cannot be made to: `<AutoSkeleton.SSR>` and `NeutralSkeletonBlock`
 *  are hook-free, DOM-read-free pure functions BY REQUIREMENT (REQ-SSR-4's
 *  zero-hydration-mismatch mechanism is precisely that they read nothing that
 *  could differ between server and client), so they hard-code
 *  `askl-anim-shimmer` and a user who asked for reduced motion got a full
 *  travelling sweep for the whole pre-hydration window.
 *
 *  CSS is therefore not a stylistic preference here, it is the only mechanism
 *  that can express the degradation with zero JavaScript — which is the whole
 *  point when nothing has hydrated.
 *
 *  Two deliberate scoping decisions:
 *
 *  1. It lives in the GENERATED SSR bundle, not in `buildShimmerStylesheet()`.
 *     That function is shipped inside the `.` web entry and measured by
 *     NFR-6; this bundle is a build artifact the consumer imports separately,
 *     so the fix costs the runtime entry nothing. More importantly, the
 *     runtime's authority over its own overlay stays with the JS path (which
 *     also has to honour an explicit `animation` prop) instead of being split
 *     across two mechanisms that could disagree.
 *  2. The selectors are qualified by the SSR marker attributes, which makes
 *     them (0,3,0) — strictly above the runtime stylesheet's (0,2,0)
 *     `.askl-anim-shimmer .askl-shimmer-layer`. Source order between the two
 *     is not knowable (the consumer imports `bundle.css` globally; the
 *     runtime injects its `<style>` into `<head>` on first mount, i.e.
 *     LATER), so relying on order would make this rule win or lose depending
 *     on whether a live `<AutoSkeleton>` happened to mount first.
 *
 *  The degraded presentation is the opacity pulse rather than nothing at all,
 *  matching `effectiveAnimation()`'s own choice exactly — the same
 *  `askl-pulse` keyframes and the same `--askl-speed` custom property the
 *  base stylesheet already defines, never a second animation implementation.
 *
 *  It targets `.askl-shimmer-layer` for the same reason the runtime rule in
 *  `buildShimmerStylesheet()` does, and this block is where that defect was
 *  originally COPIED from: it used to hide the shimmer layer and then pulse
 *  `.askl-overlay-base`, an element with no background of any kind, so the
 *  pre-hydration degradation was a perfectly-running animation over a
 *  completely static block. Overriding `animation-name` (rather than hiding
 *  one element and animating another) is also what keeps this a single
 *  declaration that cannot half-apply: the sweep is replaced, not layered
 *  over. */
function reducedMotionBlock(): string {
  const selectors = (child: string): string =>
    SSR_OVERLAY_MARKERS.map((marker) => `.askl-overlay[${marker}] ${child}`).join(',');
  return (
    '@media (prefers-reduced-motion: reduce){' +
    `${selectors('.askl-shimmer-layer')}{animation-name:askl-pulse;` +
    'animation-timing-function:ease-in-out;animation-iteration-count:infinite;' +
    'animation-duration:var(--askl-speed, 1400ms);transform:none;}' +
    '}'
  );
}

export interface BuildSsrCssBundleOptions {
  /** Substituted for any captured shape whose radius is `-1` ("rounded,
   *  amount unknown") — mirrors `buildClipPath`'s own `ClipPathOptions`. */
  readonly defaultRadius: number;
}

/** Builds the complete `@media`-bucketed CSS bundle (REQ-SSR-3) from a
 *  captured manifest. The base shimmer stylesheet is included exactly once
 *  at the top (never per-bucket); each bucket's block carries one
 *  `.askl-overlay[data-askl-ssr-key][data-askl-ssr-dir]` rule per captured
 *  (skeletonKey, direction) pair, setting `clip-path`/`width`/`height` from
 *  that bucket's real captured geometry. A bucket with zero captured entries
 *  contributes no `@media` block at all — nothing to select, nothing to ship. */
export function buildSsrCssBundle(manifest: AutoSkeletonSSRManifest, options: BuildSsrCssBundleOptions): string {
  // The token is RECOMPUTED from the manifest's own content rather than read
  // from `manifest.integrity`. That is the whole point: this CSS is then bound
  // to the geometry it was actually generated from, so a hand-edited
  // `manifest.json` whose recorded `integrity` no longer matches its contents
  // produces an element token that does not match this bundle's rules — and
  // degrades to the neutral block instead of painting the edited geometry.
  const buildToken = computeSsrManifestIntegrity(manifest);
  const ranges = bucketRanges(manifest.widthBuckets);
  const blocks = ranges
    .map((range) => {
      const entriesForBucket = manifest.entries.filter((entry) => entry.widthBucket === range.bucket);
      if (entriesForBucket.length === 0) {
        return '';
      }
      const rules = entriesForBucket.map((entry) => {
        const decoded = decodeWire(Float32Array.from(entry.snapshot.data));
        const path = buildClipPath(decoded.shapes, {
          defaultRadius: options.defaultRadius,
          // Real captured DOM geometry (from a real browser under the
          // captured `dir`) already reflects mirrored layout — never
          // double-mirror. Matches `css-renderer.ts`'s `applyGeometry`
          // convention exactly (see that file's doc comment).
          direction: 'ltr',
          containerWidth: entry.snapshot.frame[0],
        });
        const selector =
          `.askl-overlay[data-askl-ssr-key="${cssAttributeValueEscape(entry.skeletonKey)}"]` +
          `[data-askl-ssr-dir="${entry.direction}"]` +
          `[${SSR_BUILD_ATTRIBUTE}="${buildToken}"]`;
        return `${selector}{clip-path:${path};width:${entry.snapshot.frame[0]}px;height:${entry.snapshot.frame[1]}px;}`;
      });
      return `${mediaQuery(range)}{${rules.join('')}}`;
    })
    .filter((block) => block.length > 0);

  // Published so a dev build can compare it against the manifest's own token
  // and NAME the drift, instead of only observing that nothing matched.
  const tokenDeclaration = `:root{${SSR_BUILD_CSS_VARIABLE}:"${buildToken}";}`;

  // Drift fallback. Every geometry rule above is qualified by `buildToken`, so
  // an overlay stamped with a DIFFERENT token matches none of them and would
  // otherwise collapse to zero height — invisible, which is its own kind of
  // silent. `:not()` carries its argument's specificity (0,3,0), strictly
  // below a geometry rule's (0,4,0), so a MATCHING overlay is unaffected and
  // ordering never matters. The dimensions are the ADR-12 neutral block's own,
  // imported rather than duplicated, so "degraded to neutral" looks the same
  // whether it was reached by an uncaptured key or by manifest/CSS drift.
  const driftFallback =
    `.askl-overlay[data-askl-ssr-key]:not([${SSR_BUILD_ATTRIBUTE}="${buildToken}"])` +
    `{height:${NEUTRAL_SKELETON_HEIGHT_PX}px;border-radius:${NEUTRAL_SKELETON_RADIUS_PX}px;clip-path:none;}`;

  // `reducedMotionBlock()` goes LAST purely for readability — it wins on
  // specificity (0,3,0 over the base stylesheet's 0,2,0), never on order, so
  // an editor who inserts a new block above or below it cannot break it.
  return [buildShimmerStylesheet(), tokenDeclaration, driftFallback, ...blocks, reducedMotionBlock()].join('');
}
