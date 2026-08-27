import { describe, expect, it } from 'vitest';
import {
  WIDTH_BUCKETS,
  bucketWidth,
  quantizeFontScale,
  composeCacheKey,
  parseCacheKey,
  keyMatches,
  type CacheKeyParts,
} from './cache-key';

// Task 1.1 (tasks.md Phase 1): pure key algebra — no lifecycle path, so this
// task is observability-EXEMPT per its DoD.

describe('WIDTH_BUCKETS', () => {
  it('is the shared table used by the runtime and the SSR capture CLI (ADR-10)', () => {
    expect(WIDTH_BUCKETS).toEqual([320, 375, 414, 768, 1024, 1280, 1536]);
  });
});

describe('bucketWidth', () => {
  it('rounds a raw viewport width up to the next bucket', () => {
    expect(bucketWidth(300)).toBe(320);
    expect(bucketWidth(400)).toBe(414);
  });

  it('returns the exact bucket when the width already matches one', () => {
    expect(bucketWidth(768)).toBe(768);
  });

  it('clamps to the largest bucket when the width exceeds every bucket', () => {
    expect(bucketWidth(2000)).toBe(1536);
  });

  it('clamps to the smallest bucket when the width is below every bucket', () => {
    expect(bucketWidth(0)).toBe(320);
  });
});

describe('quantizeFontScale', () => {
  it('quantizes to 2 decimals', () => {
    expect(quantizeFontScale(1.233)).toBe(1.23);
    expect(quantizeFontScale(1.238)).toBe(1.24);
  });

  it('leaves an already-quantized scale unchanged', () => {
    expect(quantizeFontScale(1.5)).toBe(1.5);
  });
});

describe('composeCacheKey / parseCacheKey round-trip', () => {
  const baseParts: CacheKeyParts = {
    skeletonKey: 'profile',
    itemType: undefined,
    viewportWidth: 390,
    fontScale: 1,
    direction: 'ltr',
    platform: 'ios',
  };

  it('round-trips a whole-screen key with no itemType', () => {
    const key = composeCacheKey(baseParts);
    expect(parseCacheKey(key)).toEqual(baseParts);
  });

  it('round-trips a list-cell key with an itemType', () => {
    const parts: CacheKeyParts = { ...baseParts, itemType: 'feedCard', platform: 'android' };
    const key = composeCacheKey(parts);
    expect(parseCacheKey(key)).toEqual(parts);
  });

  it('percent-escapes a literal "|" inside a user-supplied segment so it round-trips', () => {
    const parts: CacheKeyParts = { ...baseParts, skeletonKey: 'a|b', itemType: 'c|d' };
    const key = composeCacheKey(parts);
    // The escaped key must not contain a raw, unescaped '|' inside the user segments —
    // proven indirectly: splitting on '|' would otherwise produce more than 7 fields.
    expect(key.split('|')).toHaveLength(7);
    expect(parseCacheKey(key)).toEqual(parts);
  });

  it('percent-escapes a literal "%" so escaping itself is reversible', () => {
    const parts: CacheKeyParts = { ...baseParts, skeletonKey: '100%done' };
    const key = composeCacheKey(parts);
    expect(parseCacheKey(key)).toEqual(parts);
  });
});

describe('keyMatches', () => {
  it('applies the predicate against the parsed parts', () => {
    const key = composeCacheKey({
      skeletonKey: 'profile',
      itemType: undefined,
      viewportWidth: 390,
      fontScale: 1,
      direction: 'ltr',
      platform: 'ios',
    });
    expect(keyMatches(key, (parts) => parts.skeletonKey === 'profile')).toBe(true);
    expect(keyMatches(key, (parts) => parts.platform === 'android')).toBe(false);
  });
});
