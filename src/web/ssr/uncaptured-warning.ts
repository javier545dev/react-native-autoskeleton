// src/web/ssr/uncaptured-warning.ts
//
// tasks.md 8.3 (Observability line) / RISK-4: "dev-mode console warning
// naming each uncaptured `skeletonKey`, surfaced at runtime by 8.3" — the
// runtime half of RISK-4's detection signal (`cli/capture.ts`'s
// `CaptureReport` is the BUILD-TIME half). Mirrors `core/metrics.ts`'s
// `formatXWarning`/`emitXWarning` split: a pure formatter (trivially
// testable, no environment dependency) plus a thin emit wrapper the caller
// gates to dev builds only — `<AutoSkeleton.SSR>` itself stays a plain,
// side-effect-light function component; this module is what it calls.

/** REQ-SSR §1.8 / RISK-4 scenario: an uncaptured `skeletonKey` is a silent,
 *  by-design degradation (the neutral block, ADR-12) — this message is what
 *  keeps it from being an INVISIBLE one. Actionable: names the exact key and
 *  the fix (add it to the capture registry). */
export function formatUncapturedSkeletonKeyWarning(skeletonKey: string): string {
  return (
    `[autoskeleton] <AutoSkeleton.SSR skeletonKey="${skeletonKey}"> has no captured snapshot — ` +
    'rendering the neutral generic block (ADR-12). Add this skeletonKey to the capture CLI\'s ' +
    'registry (cli/capture.ts) to replay real geometry here instead.'
  );
}

/** `process.env.NODE_ENV !== 'production'` matches this codebase's existing
 *  dev-gate convention (`web/AutoSkeleton.tsx`'s `devWarningsEnabled()`).
 *  Safe to call from a Server Component render body: on the server this
 *  runs once per request in dev, and identically again on the client during
 *  hydration — both are the SAME environment check, so it never fires only
 *  on one side (which would itself be a mismatch-adjacent inconsistency,
 *  though `console.warn` has no bearing on React's hydration diffing). */
export function emitUncapturedSkeletonKeyWarning(skeletonKey: string): void {
  if (typeof process !== 'undefined' && process.env?.['NODE_ENV'] === 'production') {
    return;
  }
  console.warn(formatUncapturedSkeletonKeyWarning(skeletonKey));
}
