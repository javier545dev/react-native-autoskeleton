// src/web/ssr/manifest-warning.ts
//
// The dev-build voice for the two ways an SSR replay can be wrong about its
// own inputs. Mirrors `core/metrics.ts` / `uncaptured-warning.ts`: a pure
// `formatXWarning` (trivially testable, no environment dependency) plus a thin
// emit wrapper that gates itself to non-production and latches once, so a
// re-render storm cannot turn one build mistake into a console flood.
//
// Why a warning at all, when both failures already degrade structurally to the
// ADR-12 neutral block: because the degradation is CORRECT but INVISIBLE. A
// developer whose skeleton quietly turned into a grey rectangle needs to be
// told the manifest is stale, not left to bisect it.

import { SSR_MANIFEST_VERSION } from './manifest';

/** A manifest whose `v` this build cannot replay. Names the exact remedy —
 *  re-run the capture CLI — because a manifest is a GENERATED artifact and
 *  regenerating it is always the fix, never hand-editing `v`. */
export function formatManifestVersionWarning(manifestVersion: number): string {
  return (
    `[autoskeleton] <AutoSkeleton.SSR> received an SSR manifest with v=${manifestVersion}, but this ` +
    `build replays v=${SSR_MANIFEST_VERSION}. Rendering the neutral generic block (ADR-12) instead of ` +
    'replaying geometry that may no longer match this version. Re-run the capture CLI ' +
    '(`autoskeleton-capture`) to regenerate manifest.json and bundle.css together.'
  );
}

/** `manifest.json` and `bundle.css` were generated from different captures.
 *  Detected client-side by comparing the manifest's token against the one the
 *  stylesheet publishes on `:root` — the structural selector binding has
 *  ALREADY prevented the wrong geometry from painting by the time this runs;
 *  this only explains why. */
export function formatManifestCssDriftWarning(manifestToken: string, cssToken: string): string {
  return (
    '[autoskeleton] The SSR manifest and the generated CSS bundle come from different capture runs ' +
    `(manifest.json: "${manifestToken}", bundle.css: "${cssToken || '<none>'}"). Skeletons fell back to ` +
    'the neutral generic block rather than replaying geometry the CSS no longer matches. Regenerate ' +
    'BOTH files with the capture CLI — and commit them together.'
  );
}

const emitted = new Set<string>();

function emitOnce(latchKey: string, message: string): void {
  // Bare `process.env.NODE_ENV` (no `typeof process` guard) so a bundler's
  // define folds this to `false` and drops the message text from a production
  // build. `web/AutoSkeleton.tsx`'s `devWarningsEnabled()` relies on the same
  // shape; every consumer of this module is a React web build that has one.
  if (process.env['NODE_ENV'] === 'production' || emitted.has(latchKey)) {
    return;
  }
  emitted.add(latchKey);
  console.warn(message);
}

export function emitManifestVersionWarning(manifestVersion: number): void {
  emitOnce(`v:${manifestVersion}`, formatManifestVersionWarning(manifestVersion));
}

export function emitManifestCssDriftWarning(manifestToken: string, cssToken: string): void {
  emitOnce(`drift:${manifestToken}:${cssToken}`, formatManifestCssDriftWarning(manifestToken, cssToken));
}

/** TEST SEAM ONLY — the latch is module-scope process state by design. */
export function __resetManifestWarningsForTests(): void {
  emitted.clear();
}
