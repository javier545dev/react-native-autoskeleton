// src/core/cache-key.ts
//
// plan.md §3.2: the composite cache key. Pure key algebra, no lifecycle path —
// this task is observability-EXEMPT per its DoD.

import type { Direction, Platform } from './types';

export interface CacheKeyParts {
  readonly skeletonKey: string;
  /** virtualized-list cell type; `undefined` for whole-screen skeletons */
  readonly itemType?: string;
  /** already bucketed by `bucketWidth` — never a raw viewport width */
  readonly viewportWidth: number;
  /** already quantized by `quantizeFontScale` */
  readonly fontScale: number;
  readonly direction: Direction;
  readonly platform: Platform;
}

/** Opaque, order-stable, and safe to use as an object key, a CSS class suffix and a
 *  filename fragment. Branded so a raw string can never be passed by accident. */
export type ShapeCacheKey = string & { readonly __brand: 'ShapeCacheKey' };

/** Width buckets are shared by the runtime AND the SSR capture CLI (ADR-10).
 *  Divergence between the two is a hydration bug by construction, so there is
 *  exactly one table. */
export const WIDTH_BUCKETS: readonly number[] = [320, 375, 414, 768, 1024, 1280, 1536];

const CACHE_KEY_VERSION = 'v1';
const CACHE_KEY_FIELD_COUNT = 7;
const EMPTY_ITEM_TYPE_SEGMENT = '-';
const FONT_SCALE_DECIMALS = 2;

/** Returns the smallest bucket `>= px`, clamped to the largest bucket when `px`
 *  exceeds every bucket, and to the smallest bucket when `px` is non-positive
 *  or below every bucket. */
export function bucketWidth(px: number): number {
  for (const bucket of WIDTH_BUCKETS) {
    if (px <= bucket) {
      return bucket;
    }
  }
  return WIDTH_BUCKETS[WIDTH_BUCKETS.length - 1]!;
}

/** Quantized to 2 decimals; anything finer thrashes the cache without changing layout. */
export function quantizeFontScale(scale: number): number {
  const factor = 10 ** FONT_SCALE_DECIMALS;
  return Math.round(scale * factor) / factor;
}

function escapeSegment(segment: string): string {
  // '%' must escape first so a literal '%7C' in user input is never
  // misinterpreted as an escaped '|' on the way back out.
  //
  // The anchored '-' rule (adversarial-review defect, 2026-08-29) reserves
  // `EMPTY_ITEM_TYPE_SEGMENT`. '|' is the separator and was ALREADY safe here;
  // '-' is a SENTINEL drawn from the very alphabet it guards, so `itemType:
  // '-'` composed the byte-identical key as `itemType: undefined` and parsed
  // back as `undefined` — `composeCacheKey` was not injective and
  // `parseCacheKey` was not its inverse. Closed at the alphabet level rather
  // than by special-casing the one known input: the escaped output can only
  // ever contain '%' as the head of '%25' or '%7C', so '%2D' is unreachable
  // by escaping ANY input and cannot impersonate the sentinel. Anchored, so
  // only a whole segment (which is all the sentinel can ever occupy) escapes
  // — 'feed-card' and every other embedded '-' is untouched, and every key
  // this function has ever produced is byte-identical.
  return segment.replace(/%/g, '%25').replace(/\|/g, '%7C').replace(/^-$/, '%2D');
}

function unescapeSegment(segment: string): string {
  return segment.replace(/^%2D$/, '-').replace(/%7C/g, '|').replace(/%25/g, '%');
}

/** Produces `v1|<skeletonKey>|<itemType|'-'>|<width>|<fontScale>|<dir>|<platform>`
 *  with each user-supplied segment percent-escaped for `|`. Deterministic,
 *  reversible, and printable in the debug overlay. */
export function composeCacheKey(parts: CacheKeyParts): ShapeCacheKey {
  const segments = [
    CACHE_KEY_VERSION,
    escapeSegment(parts.skeletonKey),
    parts.itemType === undefined ? EMPTY_ITEM_TYPE_SEGMENT : escapeSegment(parts.itemType),
    String(parts.viewportWidth),
    String(parts.fontScale),
    parts.direction,
    parts.platform,
  ];
  return segments.join('|') as ShapeCacheKey;
}

export function parseCacheKey(key: ShapeCacheKey): CacheKeyParts {
  const segments = key.split('|');
  if (segments.length !== CACHE_KEY_FIELD_COUNT || segments[0] !== CACHE_KEY_VERSION) {
    throw new Error(`Invalid cache key: ${String(key)}`);
  }
  const skeletonKeyRaw = segments[1]!;
  const itemTypeRaw = segments[2]!;
  const widthRaw = segments[3]!;
  const fontScaleRaw = segments[4]!;
  const direction = segments[5]! as Direction;
  const platform = segments[6]! as Platform;

  return {
    skeletonKey: unescapeSegment(skeletonKeyRaw),
    itemType: itemTypeRaw === EMPTY_ITEM_TYPE_SEGMENT ? undefined : unescapeSegment(itemTypeRaw),
    viewportWidth: Number(widthRaw),
    fontScale: Number(fontScaleRaw),
    direction,
    platform,
  };
}

/** Bulk invalidation predicate support without re-parsing at every call site. */
export function keyMatches(
  key: ShapeCacheKey,
  predicate: (parts: CacheKeyParts) => boolean,
): boolean {
  return predicate(parseCacheKey(key));
}
