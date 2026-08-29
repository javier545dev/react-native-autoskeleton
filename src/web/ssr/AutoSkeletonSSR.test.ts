// src/web/ssr/AutoSkeletonSSR.test.ts
//
// tasks.md 8.3 / REQ-SSR-4 local guard: `<AutoSkeleton.SSR>` is a pure
// function of its props — this is a fast, browser-free proof of that
// purity, using `react-dom/server`'s `renderToStaticMarkup` (no DOM, no
// hydration event needed to prove BYTE IDENTITY of output). The
// authoritative zero-hydration-mismatch gate (a real browser actually
// hydrating and asserting no React console warning) is `test/ssr/*.spec.ts`
// (Playwright, against the real Next.js example — task 8.3's Next.js E2E).
//
// Uses `React.createElement` rather than JSX so this file can stay a plain
// `.test.ts` (matches `vitest.config.ts`'s `src/**/*.test.ts` include glob;
// `src/web/**` has no other component-level Vitest coverage — component
// behavior is otherwise proven under Playwright, per plan.md §7.3).

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AutoSkeletonSSR } from './AutoSkeletonSSR';
import { computeSsrManifestIntegrity } from './integrity';
import type { AutoSkeletonSSRManifest } from './manifest';
import { SSR_MANIFEST_VERSION } from './manifest';
import { NeutralSkeletonBlock } from './neutral-block';

/** Builds a manifest carrying its OWN real integrity token, never a
 *  hand-written placeholder — otherwise these tests would pass against a
 *  manifest no capture run could ever produce. */
function fakeManifest(capturedKeys: readonly string[]): AutoSkeletonSSRManifest {
  const base: AutoSkeletonSSRManifest = {
    v: SSR_MANIFEST_VERSION,
    integrity: '',
    widthBuckets: [360, 768],
    capturedKeys,
    entries: [],
  };
  return { ...base, integrity: computeSsrManifestIntegrity(base) };
}

describe('AutoSkeletonSSR — pure function of props (REQ-SSR-4 local guard)', () => {
  it('renders byte-identical markup across two independent renders with the SAME props', () => {
    const manifest = fakeManifest(['dashboard']);
    const first = renderToStaticMarkup(createElement(AutoSkeletonSSR, { skeletonKey: 'dashboard', manifest }));
    const second = renderToStaticMarkup(createElement(AutoSkeletonSSR, { skeletonKey: 'dashboard', manifest }));
    expect(first).toBe(second);
  });

  it('a captured skeletonKey renders the overlay carrying data-askl-ssr-key/dir, never inline geometry', () => {
    const manifest = fakeManifest(['dashboard']);
    const markup = renderToStaticMarkup(
      createElement(AutoSkeletonSSR, { skeletonKey: 'dashboard', manifest, direction: 'rtl' }),
    );
    expect(markup).toContain('data-askl-ssr-key="dashboard"');
    expect(markup).toContain('data-askl-ssr-dir="rtl"');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('role="status"');
    // No inline width/height/clip-path — those come entirely from the
    // `@media`-bucketed CSS bundle (REQ-SSR-3), never computed here.
    expect(markup).not.toMatch(/style="[^"]*clip-path/);
  });

  it('defaults direction to ltr when omitted', () => {
    const manifest = fakeManifest(['dashboard']);
    const markup = renderToStaticMarkup(createElement(AutoSkeletonSSR, { skeletonKey: 'dashboard', manifest }));
    expect(markup).toContain('data-askl-ssr-dir="ltr"');
  });
});

describe('AutoSkeletonSSR — ADR-12 uncaptured key renders the SAME neutral block server AND client', () => {
  it('an uncaptured skeletonKey renders byte-identical markup to NeutralSkeletonBlock directly', () => {
    const manifest = fakeManifest(['dashboard']); // 'new-widget' is NOT in capturedKeys
    const viaSSR = renderToStaticMarkup(
      createElement(AutoSkeletonSSR, { skeletonKey: 'new-widget', manifest }),
    );
    const direct = renderToStaticMarkup(createElement(NeutralSkeletonBlock, {}));
    expect(viaSSR).toBe(direct);
  });

  it('the neutral block never carries data-askl-ssr-key (would be meaningless — no captured geometry exists)', () => {
    const manifest = fakeManifest([]);
    const markup = renderToStaticMarkup(createElement(AutoSkeletonSSR, { skeletonKey: 'anything', manifest }));
    expect(markup).not.toContain('data-askl-ssr-key');
    expect(markup).toContain('data-askl-ssr-neutral="true"');
  });

  it('renders identically regardless of which uncaptured key is requested — the SAME pure fallback either way', () => {
    const manifest = fakeManifest(['dashboard']);
    const a = renderToStaticMarkup(createElement(AutoSkeletonSSR, { skeletonKey: 'widget-a', manifest }));
    const b = renderToStaticMarkup(createElement(AutoSkeletonSSR, { skeletonKey: 'widget-b', manifest }));
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// Manifest integrity: version validation + CSS binding (2026-08-28)
// ---------------------------------------------------------------------------
//
// Two halves of ONE concern, deliberately not split into two patches:
//
//   * the manifest's own `v` was written by `cli/capture.ts` and never read
//     by anything — a manifest captured by a different library version was
//     replayed as if it were current;
//   * nothing at all bound `manifest.json` to the generated `bundle.css`, so
//     regenerating one without the other made the page replay geometry that
//     no longer corresponded to the CSS actually shipped.
//
// Both fail the same way — subtly WRONG geometry, which is worse than none,
// because the wrong one ships. The required failure mode is the neutral
// block that already exists (ADR-12), never a silent wrong replay.

describe('AutoSkeletonSSR — manifest version is validated on read', () => {
  it('refuses to replay a manifest from a NEWER schema version, rendering the neutral block instead', () => {
    const manifest: AutoSkeletonSSRManifest = {
      ...fakeManifest(['dashboard']),
      v: SSR_MANIFEST_VERSION + 1,
    };
    const markup = renderToStaticMarkup(createElement(AutoSkeletonSSR, { skeletonKey: 'dashboard', manifest }));

    expect(markup).not.toContain('data-askl-ssr-key');
    expect(markup).toBe(renderToStaticMarkup(createElement(NeutralSkeletonBlock, {})));
  });

  it('refuses to replay a manifest from an OLDER schema version too', () => {
    const manifest: AutoSkeletonSSRManifest = {
      ...fakeManifest(['dashboard']),
      v: SSR_MANIFEST_VERSION - 1,
    };
    const markup = renderToStaticMarkup(createElement(AutoSkeletonSSR, { skeletonKey: 'dashboard', manifest }));

    expect(markup).not.toContain('data-askl-ssr-key');
    expect(markup).toBe(renderToStaticMarkup(createElement(NeutralSkeletonBlock, {})));
  });

  it('degrades identically for every key, so server and client cannot disagree', () => {
    const manifest: AutoSkeletonSSRManifest = {
      ...fakeManifest(['dashboard', 'settings']),
      v: SSR_MANIFEST_VERSION + 1,
    };
    const a = renderToStaticMarkup(createElement(AutoSkeletonSSR, { skeletonKey: 'dashboard', manifest }));
    const b = renderToStaticMarkup(createElement(AutoSkeletonSSR, { skeletonKey: 'settings', manifest }));
    expect(a).toBe(b);
  });
});

describe('AutoSkeletonSSR — the replayed overlay is bound to the CSS that generated it', () => {
  it('stamps the manifest integrity token so a stale CSS bundle cannot select this element', () => {
    const manifest = fakeManifest(['dashboard']);
    const markup = renderToStaticMarkup(createElement(AutoSkeletonSSR, { skeletonKey: 'dashboard', manifest }));

    expect(markup).toMatch(/data-askl-ssr-build="[^"]+"/);
  });
});
