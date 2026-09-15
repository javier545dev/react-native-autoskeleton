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

describe('parseCacheKey — malformed key rejection', () => {
  it('throws when the key does not start with the expected version prefix', () => {
    expect(() => parseCacheKey('v2|profile|-|390|1|ltr|ios' as ReturnType<typeof composeCacheKey>)).toThrow(
      /Invalid cache key/,
    );
  });

  it('throws when the key does not have exactly 7 segments', () => {
    expect(() => parseCacheKey('v1|profile|-|390|1|ltr' as ReturnType<typeof composeCacheKey>)).toThrow(
      /Invalid cache key/,
    );
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

// Adversarial-review defect (2026-08-29). The mechanism named in the report
// ("a separator that can appear inside a component") is NOT what is wrong
// here: the separator is '|', and BOTH user-supplied segments already escape
// it (proven above). '-' is a SENTINEL, not a separator — and it is a value a
// caller can legitimately pass as `itemType`, so `composeCacheKey` is not
// injective and `parseCacheKey` is not its inverse.
//
// The class is "a sentinel drawn from the same alphabet as the payload it
// guards". The fix closes it at the alphabet level rather than special-casing
// the one known input: `escapeSegment`'s output alphabet is provably unable
// to contain '%2D' (its only '%' outputs are the two-char-suffixed '%25' and
// '%7C'), so an escaped itemType can never impersonate the sentinel.
describe('composeCacheKey — the empty-itemType sentinel is not a legal payload value', () => {
  const baseParts: CacheKeyParts = {
    skeletonKey: 'profile',
    itemType: undefined,
    viewportWidth: 390,
    fontScale: 1,
    direction: 'ltr',
    platform: 'ios',
  };

  it('round-trips an itemType that is literally the sentinel character', () => {
    const parts: CacheKeyParts = { ...baseParts, itemType: '-' };
    expect(parseCacheKey(composeCacheKey(parts))).toEqual(parts);
  });

  it('never composes the same key for itemType "-" and no itemType at all', () => {
    expect(composeCacheKey({ ...baseParts, itemType: '-' })).not.toBe(
      composeCacheKey({ ...baseParts, itemType: undefined }),
    );
  });

  it('keeps the round-trip injective across every adversarial itemType, including escapes of the sentinel', () => {
    // Closes the CLASS: any input that could impersonate the sentinel after
    // escaping, plus the escape of that escape.
    for (const itemType of ['-', '%2D', '%252D', '%25', '%7C', '|', '%', '-|-', 'a-b']) {
      const parts: CacheKeyParts = { ...baseParts, itemType };
      const key = composeCacheKey(parts);
      expect(key.split('|')).toHaveLength(7);
      expect(parseCacheKey(key)).toEqual(parts);
      expect(key).not.toBe(composeCacheKey({ ...baseParts, itemType: undefined }));
    }
  });
});
