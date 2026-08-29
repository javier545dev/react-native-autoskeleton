// src/web/ssr/integrity.test.ts
//
// The build token is the only thing binding `manifest.json` to `bundle.css`,
// so its two properties have to be pinned hard, and they pull in opposite
// directions:
//
//   * SENSITIVE to everything the generated CSS is derived from — one changed
//     coordinate must change the token, or drift goes undetected;
//   * INSENSITIVE to churn that does not change geometry — above all the
//     `capturedAt` timestamp, because this repo's established practice is to
//     revert that churn when the geometry is byte-identical. A token that
//     moved on every capture run would report a mismatch on every build and
//     be ignored within a week, which is worse than having no check at all.

import { describe, expect, it } from 'vitest';
import { assertSsrManifestIntegrity, computeSsrManifestIntegrity } from './integrity';
import type { AutoSkeletonSSRManifest, AutoSkeletonSSRManifestEntry } from './manifest';
import { SSR_MANIFEST_VERSION } from './manifest';

function entry(
  skeletonKey: string,
  widthBucket: number,
  direction: 'ltr' | 'rtl',
  frame: readonly [number, number],
  data: readonly number[] = [1, 0, 0, frame[0], frame[1], 4],
): AutoSkeletonSSRManifestEntry {
  return {
    skeletonKey,
    widthBucket,
    direction,
    snapshot: {
      v: 1,
      key: `v1|${skeletonKey}|-|${widthBucket}|1|${direction}|web`,
      capturedAt: 1_700_000_000_000,
      frame,
      data,
    },
  };
}

function manifest(overrides: Partial<AutoSkeletonSSRManifest> = {}): AutoSkeletonSSRManifest {
  return {
    v: SSR_MANIFEST_VERSION,
    integrity: '',
    widthBuckets: [375, 1280],
    capturedKeys: ['dashboard'],
    entries: [entry('dashboard', 375, 'ltr', [375, 312]), entry('dashboard', 1280, 'ltr', [640, 312])],
    ...overrides,
  };
}

describe('computeSsrManifestIntegrity — stable under churn that does not change geometry', () => {
  it('ignores the capture timestamp entirely (the documented revert precedent)', () => {
    const base = manifest();
    const later = manifest({
      entries: base.entries.map((e) => ({
        ...e,
        snapshot: { ...e.snapshot, capturedAt: e.snapshot.capturedAt + 86_400_000 },
      })),
    });
    expect(computeSsrManifestIntegrity(later)).toBe(computeSsrManifestIntegrity(base));
  });

  it('ignores entry ORDER — a reordered capture run of the same geometry is not drift', () => {
    const base = manifest();
    const reordered = manifest({ entries: [...base.entries].reverse() });
    expect(computeSsrManifestIntegrity(reordered)).toBe(computeSsrManifestIntegrity(base));
  });

  it('ignores the recorded `integrity` field itself, so stamping it is not self-referential', () => {
    const base = manifest();
    expect(computeSsrManifestIntegrity({ ...base, integrity: 'askl1-deadbeefdeadbeef' })).toBe(
      computeSsrManifestIntegrity(base),
    );
  });

  it('ignores the dev-only sidecars, so a dev and a production capture agree', () => {
    const base = manifest();
    const withSidecars = manifest({
      entries: base.entries.map((e) => ({
        ...e,
        snapshot: { ...e.snapshot, sources: [1, 1], radiusSources: [2, 2] },
      })),
    });
    expect(computeSsrManifestIntegrity(withSidecars)).toBe(computeSsrManifestIntegrity(base));
  });
});

describe('computeSsrManifestIntegrity — sensitive to everything the CSS is derived from', () => {
  const baseToken = computeSsrManifestIntegrity(manifest());

  it('changes when a single captured coordinate changes', () => {
    const drifted = manifest({
      entries: [entry('dashboard', 375, 'ltr', [375, 312], [1, 0, 0, 375, 313, 4]), manifest().entries[1]!],
    });
    expect(computeSsrManifestIntegrity(drifted)).not.toBe(baseToken);
  });

  it('changes when a captured frame size changes', () => {
    const drifted = manifest({
      entries: [entry('dashboard', 375, 'ltr', [375, 400]), manifest().entries[1]!],
    });
    expect(computeSsrManifestIntegrity(drifted)).not.toBe(baseToken);
  });

  it('changes when the width-bucket table changes', () => {
    expect(computeSsrManifestIntegrity(manifest({ widthBuckets: [375, 768, 1280] }))).not.toBe(baseToken);
  });

  it('changes when the captured-key set changes', () => {
    expect(computeSsrManifestIntegrity(manifest({ capturedKeys: ['dashboard', 'settings'] }))).not.toBe(
      baseToken,
    );
  });

  it('changes when the direction of an entry changes', () => {
    const drifted = manifest({
      entries: [entry('dashboard', 375, 'rtl', [375, 312]), manifest().entries[1]!],
    });
    expect(computeSsrManifestIntegrity(drifted)).not.toBe(baseToken);
  });

  it('changes when the schema version changes, so a v-bump can never reuse a token', () => {
    expect(computeSsrManifestIntegrity(manifest({ v: SSR_MANIFEST_VERSION + 1 }))).not.toBe(baseToken);
  });

  it('is CSS-identifier-safe so it can sit inside an attribute selector unescaped', () => {
    expect(baseToken).toMatch(/^askl1-[0-9a-f]{16}$/);
  });
});

describe('assertSsrManifestIntegrity — the loud, opt-in build-time half', () => {
  it('accepts a manifest whose recorded token matches its contents', () => {
    const base = manifest();
    const stamped = { ...base, integrity: computeSsrManifestIntegrity(base) };
    expect(() => assertSsrManifestIntegrity(stamped)).not.toThrow();
  });

  it('throws an actionable error when the manifest was hand-edited', () => {
    const base = manifest();
    const stamped = { ...base, integrity: computeSsrManifestIntegrity(base) };
    const handEdited: AutoSkeletonSSRManifest = {
      ...stamped,
      entries: [entry('dashboard', 375, 'ltr', [375, 999]), stamped.entries[1]!],
    };

    expect(() => assertSsrManifestIntegrity(handEdited)).toThrow(/integrity mismatch/i);
    expect(() => assertSsrManifestIntegrity(handEdited)).toThrow(/Re-run the capture CLI/);
  });
});
