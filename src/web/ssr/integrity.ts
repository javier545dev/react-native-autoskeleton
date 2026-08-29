// src/web/ssr/integrity.ts
//
// The SSR path ships TWO generated artifacts that must agree: `manifest.json`
// (geometry the server replays) and `bundle.css` (the `@media`-bucketed rules
// that actually paint it). Nothing bound them. Regenerate one without the
// other — and this repo's own documented practice of REVERTING the capture
// timestamp churn in `manifest.json` is exactly such a hand-edit — and the
// page replayed geometry that no longer corresponded to the CSS it shipped
// with, silently, at every viewport.
//
// A skeleton with subtly wrong geometry is worse than one that does not
// render, because the wrong one ships. So the binding is STRUCTURAL, not a
// runtime check that a consumer has to remember to wire: the build token
// below is baked into the generated CSS *selector* and stamped onto the
// server-rendered element as `data-askl-ssr-build`. A mismatched pair simply
// does not select, and the bundle's drift-fallback rule takes over — the
// ADR-12 neutral block's own geometry. Wrong geometry becomes impossible to
// paint rather than merely discouraged.
//
// Deliberately NOT keyed on `capturedAt`: the generated manifest carries a
// timestamp that churns on every capture run, and the established precedent
// is to revert that churn when the geometry is byte-identical. A timestamp
// integrity key would make every rebuild report a false mismatch, which is
// the fastest possible way to teach a team to ignore the signal.
//
// Pure TypeScript (no `node:crypto`) on purpose: the SAME function has to be
// callable from the build-time CLI and from browser/server runtime code, and
// this is not a security boundary — it detects accidental drift between two
// files a developer generated, not a forged manifest. Route-level trust is
// `cli/route-safety.ts`'s job.
//
// Observability / Performance: build-time only on the write side; the read
// side compares two short strings and never recomputes a digest per request.

import type { AutoSkeletonSSRManifest } from './manifest';

/** DOM attribute the server-rendered overlay carries, and the CSS selector
 *  qualifier the generated bundle matches on. */
export const SSR_BUILD_ATTRIBUTE = 'data-askl-ssr-build';

/** CSS custom property the generated bundle publishes on `:root`, carrying
 *  ITS OWN token. This is what lets a dev build name the actual drift ("CSS
 *  says X, manifest says Y") instead of only observing that nothing matched. */
export const SSR_BUILD_CSS_VARIABLE = '--askl-ssr-build';

const TOKEN_PREFIX = 'askl1';
const FIELD_SEPARATOR = '\u0001';
const RECORD_SEPARATOR = '\u0002';

/** Canonical, order-independent serialization of everything the generated CSS
 *  is actually derived from. Entries are sorted so that a reordered capture
 *  run (same geometry) is not reported as drift, and `capturedAt` / the
 *  dev-only `sources` / `radiusSources` sidecars are excluded so a dev build
 *  and a production build of the same capture agree. */
function canonicalize(manifest: AutoSkeletonSSRManifest): string {
  const buckets = [...manifest.widthBuckets].sort((a, b) => a - b).join(',');
  const keys = [...manifest.capturedKeys].sort().join(',');
  const entries = manifest.entries
    .map((entry) =>
      [
        entry.skeletonKey,
        entry.widthBucket,
        entry.direction,
        entry.snapshot.frame[0],
        entry.snapshot.frame[1],
        entry.snapshot.data.join(','),
      ].join(FIELD_SEPARATOR),
    )
    .sort();
  return [`${TOKEN_PREFIX}/${manifest.v}`, buckets, keys, ...entries].join(RECORD_SEPARATOR);
}

/** FNV-1a, run as two independent lanes with different offset bases, so the
 *  token is 64 bits of accidental-collision resistance rather than 32. */
function digest(input: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ code, 0x85ebca6b) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

/** The build token binding a manifest to the CSS generated from it.
 *  CSS-identifier-safe (`askl1-` + lowercase hex) so it can sit inside an
 *  attribute selector without escaping. */
export function computeSsrManifestIntegrity(manifest: AutoSkeletonSSRManifest): string {
  return `${TOKEN_PREFIX}-${digest(canonicalize(manifest))}`;
}

/** Build-time guard for CI or a consumer's own build step: throws when a
 *  manifest's recorded `integrity` does not match its actual content, i.e.
 *  when someone edited `manifest.json` by hand without re-running the capture
 *  CLI. This is the LOUD half of the failure story; the structural selector
 *  binding is the quiet half that keeps a page from painting wrong geometry
 *  when nobody wired this in. */
export function assertSsrManifestIntegrity(manifest: AutoSkeletonSSRManifest): void {
  const actual = computeSsrManifestIntegrity(manifest);
  if (manifest.integrity !== actual) {
    throw new Error(
      `[autoskeleton] SSR manifest integrity mismatch: the manifest records "${manifest.integrity}" ` +
        `but its own contents hash to "${actual}". The manifest was edited by hand, or only one of ` +
        'manifest.json / bundle.css was regenerated. Re-run the capture CLI so both artifacts are ' +
        'written together.',
    );
  }
}
