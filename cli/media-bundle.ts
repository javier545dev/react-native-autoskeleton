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
          `[data-askl-ssr-dir="${entry.direction}"]`;
        return `${selector}{clip-path:${path};width:${entry.snapshot.frame[0]}px;height:${entry.snapshot.frame[1]}px;}`;
      });
      return `${mediaQuery(range)}{${rules.join('')}}`;
    })
    .filter((block) => block.length > 0);

  return [buildShimmerStylesheet(), ...blocks].join('');
}
