// cli/route-safety.ts
//
// plan.md §8 threat matrix — "Capture-CLI subprocess & route handling" is the
// change's real process boundary: the capture CLI (task 8.1) spawns headless
// Chromium and navigates developer-declared route strings, then writes files.
// This module is the design response named in that row:
//   "Routes are resolved against a single configured baseURL and rejected if
//    the resolved origin differs. Output paths are resolved and asserted to
//    stay inside the configured output directory."
// Both functions are pure (no I/O, no subprocess), which is what makes them
// independently testable ahead of `cli/capture.ts`'s Playwright-driven tests.

import { resolve, sep } from 'node:path';

/** Resolves a developer-declared route string against `baseURL`, rejecting
 *  anything that would navigate Chromium off-origin. `URL`'s own resolution
 *  algorithm (never string concatenation) handles every escape shape
 *  uniformly: an absolute third-party URL, a protocol-relative `//host/...`
 *  origin swap, and a `../` sequence that `URL` normalizes away are all
 *  caught by the SAME origin comparison below — no case-by-case pattern
 *  matching, which is what makes this exhaustive rather than a denylist. */
export function resolveCaptureUrl(baseURL: string, route: string): URL {
  const base = new URL(baseURL);
  // Explicit, defense-in-depth rejection of a literal `../` sequence in the
  // RAW route string (plan.md §8's own threat-matrix row lists this as a
  // distinct case from the cross-origin check below). `URL`'s own resolution
  // already normalizes `../` harmlessly within a single origin — this check
  // exists so a malformed/adversarial registry entry is refused outright
  // rather than silently normalized, matching the row's explicit RED test.
  if (route.includes('../')) {
    throw new Error(
      `Capture route "${route}" contains a "../" traversal sequence — refusing to resolve it.`,
    );
  }
  const resolved = new URL(route, base);
  if (resolved.origin !== base.origin) {
    throw new Error(
      `Capture route "${route}" resolves to a different origin (${resolved.origin}) than the ` +
        `configured baseURL (${base.origin}) — refusing to navigate cross-origin.`,
    );
  }
  return resolved;
}

/** Resolves a CLI-configured relative output path inside `outDir`, rejecting
 *  anything that would write outside it (a `../` escape, or an absolute path
 *  that happens to fall elsewhere). Uses `path.resolve`'s own normalization
 *  plus a prefix check against the resolved, normalized `outDir` — never a
 *  raw string `startsWith` on the UNresolved input, which `../../foo-evil`
 *  style paths can defeat. */
export function resolveOutputFile(outDir: string, relativePath: string): string {
  const resolvedOutDir = resolve(outDir);
  const resolvedTarget = resolve(resolvedOutDir, relativePath);
  const withSep = resolvedOutDir.endsWith(sep) ? resolvedOutDir : resolvedOutDir + sep;
  if (resolvedTarget !== resolvedOutDir && !resolvedTarget.startsWith(withSep)) {
    throw new Error(
      `Capture output path "${relativePath}" resolves outside the configured output directory ` +
        `(${outDir}) — refusing to write outside it.`,
    );
  }
  return resolvedTarget;
}
