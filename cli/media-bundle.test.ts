// cli/media-bundle.test.ts
//
// tasks.md 8.2: the `@media`-bucketed CSS bundle (REQ-SSR-3). Pure function
// over a manifest (task 8.1's output shape) — no browser, no filesystem.
// Asserts: one `@media` block per captured width bucket; the RISK-2
// drift-guard (runtime `WIDTH_BUCKETS` and the CSS-baked bucket list stay
// identical, proven by building FROM the real constant, never a hand copy);
// a single server payload's CSS is correct at MORE than one width (the
// load-bearing SSR assertion per this session's brief).

import { describe, expect, it } from 'vitest';
import { WIDTH_BUCKETS } from '../src/core/cache-key';
import type { AutoSkeletonSSRManifest, AutoSkeletonSSRManifestEntry } from './manifest';
import { computeSsrManifestIntegrity, SSR_MANIFEST_VERSION } from './manifest';
import { bucketRanges, buildSsrCssBundle } from './media-bundle';

/** Stamps a manifest with its own real integrity token — `buildSsrCssBundle`
 *  recomputes it anyway, but a fixture carrying a fake one would not be a
 *  manifest any capture run could produce. */
function withIntegrity(manifest: AutoSkeletonSSRManifest): AutoSkeletonSSRManifest {
  return { ...manifest, integrity: computeSsrManifestIntegrity(manifest) };
}

function fakeEntry(
  skeletonKey: string,
  widthBucket: number,
  direction: 'ltr' | 'rtl',
  frame: readonly [number, number],
): AutoSkeletonSSRManifestEntry {
  return {
    skeletonKey,
    widthBucket,
    direction,
    snapshot: {
      v: 1,
      key: `v1|${skeletonKey}|-|${widthBucket}|1|${direction}|web`,
      capturedAt: 0,
      frame,
      // slot 0 = VERSION, then one rect: x,y,w,h,r
      data: [1, 0, 0, frame[0], frame[1], 4],
    },
  };
}

describe('bucketRanges — mirrors cache-key.ts bucketWidth() semantics', () => {
  it('the smallest bucket has no min-width (covers everything up to and including it)', () => {
    const ranges = bucketRanges(WIDTH_BUCKETS);
    expect(ranges[0]!.bucket).toBe(WIDTH_BUCKETS[0]);
    expect(ranges[0]!.minWidth).toBeUndefined();
    expect(ranges[0]!.maxWidth).toBe(WIDTH_BUCKETS[0]);
  });

  it('the largest bucket has no max-width (covers everything above it, matching the clamp)', () => {
    const ranges = bucketRanges(WIDTH_BUCKETS);
    const last = ranges[ranges.length - 1]!;
    expect(last.bucket).toBe(WIDTH_BUCKETS[WIDTH_BUCKETS.length - 1]);
    expect(last.maxWidth).toBeUndefined();
  });

  it('interior buckets are contiguous, non-overlapping ranges (prev+1 .. bucket)', () => {
    const ranges = bucketRanges(WIDTH_BUCKETS);
    for (let i = 1; i < ranges.length - 1; i++) {
      expect(ranges[i]!.minWidth).toBe(ranges[i - 1]!.bucket + 1);
      expect(ranges[i]!.maxWidth).toBe(ranges[i]!.bucket);
    }
  });
});

describe('buildSsrCssBundle — one @media block per captured width bucket (RISK-2 drift guard)', () => {
  it('emits exactly one @media block per WIDTH_BUCKETS entry, built from the real runtime constant', () => {
    const manifest: AutoSkeletonSSRManifest = withIntegrity({
      v: SSR_MANIFEST_VERSION,
      integrity: '',
      widthBuckets: WIDTH_BUCKETS,
      capturedKeys: ['dashboard'],
      entries: WIDTH_BUCKETS.map((bucket) => fakeEntry('dashboard', bucket, 'ltr', [bucket, 200])),
    });
    const css = buildSsrCssBundle(manifest, { defaultRadius: 4 });
    const mediaBlockCount = (css.match(/@media/g) ?? []).length;
    expect(mediaBlockCount).toBe(WIDTH_BUCKETS.length);
  });

  it('emits one [dir] selector variant per captured direction within a bucket', () => {
    const manifest: AutoSkeletonSSRManifest = withIntegrity({
      v: SSR_MANIFEST_VERSION,
      integrity: '',
      widthBuckets: WIDTH_BUCKETS,
      capturedKeys: ['dashboard'],
      entries: [
        fakeEntry('dashboard', 768, 'ltr', [768, 200]),
        fakeEntry('dashboard', 768, 'rtl', [768, 200]),
      ],
    });
    const css = buildSsrCssBundle(manifest, { defaultRadius: 4 });
    expect(css).toContain('[data-askl-ssr-dir="ltr"]');
    expect(css).toContain('[data-askl-ssr-dir="rtl"]');
  });
});

describe('buildSsrCssBundle — single server payload correct at MULTIPLE widths (load-bearing SSR assertion)', () => {
  it('produces DIFFERENT clip-path/dimensions for the same skeletonKey at two different width buckets', () => {
    const manifest: AutoSkeletonSSRManifest = withIntegrity({
      v: SSR_MANIFEST_VERSION,
      integrity: '',
      widthBuckets: WIDTH_BUCKETS,
      capturedKeys: ['dashboard'],
      entries: [
        fakeEntry('dashboard', 375, 'ltr', [375, 120]),
        fakeEntry('dashboard', 1280, 'ltr', [1280, 480]),
      ],
    });
    const css = buildSsrCssBundle(manifest, { defaultRadius: 4 });

    // Both bucket blocks must be present in the SAME single bundle string —
    // this is the whole point of REQ-SSR-3: one server payload, browser
    // selects via @media, never a server-side viewport guess.
    expect(css).toContain('width:375px');
    expect(css).toContain('height:120px');
    expect(css).toContain('width:1280px');
    expect(css).toContain('height:480px');

    // The two bucket blocks' rules must be genuinely different (real
    // per-width geometry), not the same rule duplicated under two @media
    // guards — that would defeat REQ-SSR-3 by construction.
    const blocks = css.split('@media').slice(1); // [0] is the prepended base stylesheet
    const bucket375Block = blocks.find((b) => b.includes('max-width: 375px'))!;
    const bucket1280Block = blocks.find((b) => b.includes('max-width: 1280px'))!;
    expect(bucket375Block).toBeDefined();
    expect(bucket1280Block).toBeDefined();
    expect(bucket375Block).toContain('width:375px');
    expect(bucket375Block).not.toContain('width:1280px');
    expect(bucket1280Block).toContain('width:1280px');
    expect(bucket1280Block).not.toContain('width:375px');
  });

  it('includes the base shimmer stylesheet (reused from css-renderer.ts, never duplicated) exactly once', () => {
    const manifest: AutoSkeletonSSRManifest = withIntegrity({
      v: SSR_MANIFEST_VERSION,
      integrity: '',
      widthBuckets: WIDTH_BUCKETS,
      capturedKeys: ['dashboard'],
      entries: [fakeEntry('dashboard', 768, 'ltr', [768, 200])],
    });
    const css = buildSsrCssBundle(manifest, { defaultRadius: 4 });
    // The base stylesheet's own top-level overlay rule must appear exactly
    // once — proves `buildShimmerStylesheet()` was reused, not re-emitted
    // per bucket (it legitimately mentions `.askl-shimmer-layer` more than
    // once WITHIN a single call, e.g. once per animation-kind variant).
    expect((css.match(/\.askl-overlay\{position:absolute/g) ?? []).length).toBe(1);
    expect(css).not.toContain('background-position');
  });
});

describe('buildSsrCssBundle — no captured entries for a bucket omits its @media block', () => {
  it('a bucket with zero entries contributes no @media block at all', () => {
    const manifest: AutoSkeletonSSRManifest = withIntegrity({
      v: SSR_MANIFEST_VERSION,
      integrity: '',
      widthBuckets: WIDTH_BUCKETS,
      capturedKeys: ['dashboard'],
      entries: [fakeEntry('dashboard', 768, 'ltr', [768, 200])],
    });
    const css = buildSsrCssBundle(manifest, { defaultRadius: 4 });
    expect(css).not.toContain('max-width: 320px');
    expect(css).not.toContain('max-width: 375px');
  });
});

// ---------------------------------------------------------------------------
// manifest <-> CSS binding (2026-08-28)
// ---------------------------------------------------------------------------
//
// Before this, NOTHING bound the two generated artifacts together. Regenerate
// `bundle.css` without `manifest.json` (or the reverse — the established
// practice of reverting this repo's timestamp churn in `manifest.json` is
// exactly a hand-edit that keeps one and not the other) and the page happily
// replayed geometry that no longer corresponded to the CSS it shipped with,
// with no signal anywhere. The binding is structural: every geometry rule is
// qualified by a build token derived from the manifest's own geometry, so a
// mismatched pair simply does not select — it degrades to the ADR-12 neutral
// block instead of painting subtly wrong shapes.

describe('buildSsrCssBundle — geometry rules are bound to the manifest that generated them', () => {
  function manifestWith(frame: readonly [number, number]): AutoSkeletonSSRManifest {
    return withIntegrity({
      v: SSR_MANIFEST_VERSION,
      integrity: '',
      widthBuckets: [375],
      capturedKeys: ['dashboard'],
      entries: [fakeEntry('dashboard', 375, 'ltr', frame)],
    });
  }

  function buildTokens(css: string): string[] {
    return Array.from(css.matchAll(/\[data-askl-ssr-build="([^"]+)"\]/g)).map((m) => m[1]!);
  }

  it('qualifies every captured-geometry rule with a build token', () => {
    const css = buildSsrCssBundle(manifestWith([375, 200]), { defaultRadius: 4 });
    expect(buildTokens(css).length).toBeGreaterThan(0);
  });

  it('changes that token when the captured geometry changes — this is what detects drift', () => {
    const a = buildSsrCssBundle(manifestWith([375, 200]), { defaultRadius: 4 });
    const b = buildSsrCssBundle(manifestWith([375, 201]), { defaultRadius: 4 });
    expect(buildTokens(a)[0]).not.toBe(buildTokens(b)[0]);
  });

  it('keeps that token stable when only the capture TIMESTAMP churns (the documented revert precedent)', () => {
    const base = manifestWith([375, 200]);
    const later: AutoSkeletonSSRManifest = {
      ...base,
      entries: base.entries.map((entry) => ({
        ...entry,
        snapshot: { ...entry.snapshot, capturedAt: entry.snapshot.capturedAt + 999_999 },
      })),
    };
    expect(buildTokens(buildSsrCssBundle(base, { defaultRadius: 4 }))[0]).toBe(
      buildTokens(buildSsrCssBundle(later, { defaultRadius: 4 }))[0],
    );
  });

  it('ships a drift fallback so an unmatched overlay degrades to neutral geometry, never zero height', () => {
    const css = buildSsrCssBundle(manifestWith([375, 200]), { defaultRadius: 4 });
    expect(css).toMatch(/\.askl-overlay\[data-askl-ssr-key\]:not\(\[data-askl-ssr-build="[^"]+"\]\)\{[^}]*height:/);
  });

  it('publishes its own token as a CSS custom property so a dev build can name the drift', () => {
    const css = buildSsrCssBundle(manifestWith([375, 200]), { defaultRadius: 4 });
    expect(css).toMatch(/--askl-ssr-build:/);
  });
});
