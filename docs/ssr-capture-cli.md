# SSR: the build-time capture CLI

`<AutoSkeleton.SSR>` replays a **build-time capture**, never live server-side
detection — a Suspense fallback renders before its children exist, so live
detection is architecturally impossible both server- and client-side
(`plan.md` ADR-11). The capture CLI is what produces the data
`<AutoSkeleton.SSR>` replays. This document covers running it and the one
real ergonomic cost it has (RISK-4), stated openly rather than glossed over.

## Install

The CLI drives a real headless browser, so it needs `@playwright/test` —
an **optional peer dependency** of `autoskeleton`, not installed for you
automatically (RISK-5: a regular consumer who never touches the CLI
installs nothing extra). Install it once, alongside the Chromium binary it
drives:

```bash
npm install @playwright/test
npx playwright install chromium
```

If you run the CLI without it, `runCapture`/`autoskeleton-capture` throws a
named, actionable error telling you exactly this — never a raw
`MODULE_NOT_FOUND` (`cli/peer-dependency.ts`).

## What it does

`cli/capture.ts` launches headless Chromium (Playwright), navigates a
developer-declared `skeletonKey -> route` registry, runs the REAL
production DOM sensor against each route at every entry in `WIDTH_BUCKETS`
× `['ltr', 'rtl']`, and writes two files:

- `manifest.json` — the captured `Float32Array` wire snapshots per key
  (`src/web/ssr/manifest.ts`'s `AutoSkeletonSSRManifest` shape).
- `bundle.css` — one `@media` block per width bucket (task 8.2), so a
  single served payload is correct at every captured width without the
  server ever needing to know the viewport.

```bash
node cli/capture.js registry.json https://your-dev-server.example ./generated/autoskeleton-ssr
```

`registry.json` is plain JSON:

```json
{
  "dashboard": "/dashboard-capture",
  "product-card": "/product-card-capture"
}
```

Each route renders the loading-state markup you want captured, wrapped in
an element matching `#autoskeleton-capture-root` (configurable via
`rootSelector`). See `examples/next/app/dashboard-capture/page.tsx` for a
real, working capture route.

## The two files are bound together, and they check each other

`manifest.json` and `bundle.css` are two halves of ONE artifact. Regenerate
one without the other — including by hand-reverting a noisy `manifest.json`
diff — and the page would previously have replayed geometry that no longer
corresponded to the CSS actually shipped, silently, at every viewport. A
skeleton with subtly wrong geometry is worse than one that does not render,
because the wrong one ships.

Both files therefore carry a **build token** (`manifest.integrity`, and the
same value baked into every geometry rule's selector in the CSS):

- **A mismatched pair cannot paint the wrong thing.** The CSS geometry rules
  only select an element stamped with their own token, so a stale pair falls
  through to a drift-fallback rule that renders the same neutral generic
  block an uncaptured key renders. This needs no wiring from you.
- **A dev build tells you why.** `<AutoSkeleton.SSRHydrate>` compares the
  manifest's token against the one the stylesheet publishes on `:root`
  (`--askl-ssr-build`) and warns, naming both, in non-production builds only.
- **You can fail the build instead**, which is the loudest and earliest
  option:

  ```ts
  import { assertSsrManifestIntegrity } from 'autoskeleton/cli';
  import manifest from './generated/autoskeleton-ssr/manifest.json';

  assertSsrManifestIntegrity(manifest); // throws if it was hand-edited
  ```

The token deliberately **ignores the `capturedAt` timestamps**, which churn
on every capture run. Re-running the capture with unchanged geometry produces
the same token, so reverting timestamp-only noise in a `manifest.json` diff
stays safe and never produces a false mismatch.

## Manifest schema version

`manifest.json` carries a `v` field, and `<AutoSkeleton.SSR>` **validates it
on read**. A manifest written by a different `autoskeleton` version renders
the neutral generic block (with a dev-build warning naming both versions)
rather than replaying geometry this version may no longer interpret the same
way — and `<AutoSkeleton.SSRHydrate>` refuses to import its snapshots into
the runtime cache for the same reason.

The current schema is **v2** (`SSR_MANIFEST_VERSION`). A `v1` manifest
captured before the build token existed is not replayable: re-run the capture
CLI. This is regeneration of a build artifact, never a hand-edit of `v`.

## All-or-nothing writes

If ANY registry key fails to capture (navigation timeout, missing capture
root, etc.), `runCapture` throws `CaptureFailedError` naming the failed
key(s) and writes **nothing** — a previously-good `manifest.json`/
`bundle.css` in your output directory is never overwritten by a partial
capture. A capture either fully succeeds or leaves your last good build
artifacts untouched.

## RISK-4, named openly: the registry is a real ergonomic tax

The registry is a **declared list you maintain by hand** — there is no
route auto-discovery. This is a real, deliberate trade-off
(`plan.md` §9 RISK-4), not an oversight, and it has a real cost that grows
with your app: every new SSR'd loading state needs a registry entry, or it
silently falls back to `<AutoSkeleton.SSR>`'s neutral generic block (see
below) instead of its real captured shape. At 3 routes this is a minor
chore; **the ergonomics genuinely get painful as your app grows past a
handful of routes** — this is the honest reason `examples/next` exists as
more than a toy: it is the ergonomics proof, not just a demo.

Mitigations that exist today:

- **Uncaptured keys degrade safely, never incorrectly.** A `skeletonKey`
  missing from the manifest renders the same neutral generic block on both
  server and client (byte-identical — zero hydration mismatch by
  construction, ADR-12). Forgetting a registry entry produces a plainer
  fallback, never a mismatch or a crash.
- **A dev-mode runtime warning names every uncaptured key**, fired from
  `<AutoSkeleton.SSR>`'s own render body (`src/web/ssr/uncaptured-warning.ts`),
  gated to non-production so it never reaches your users.
- **`runCapture`'s own `report`** (`{ capturedKeys, failedKeys }`) is the
  build-time coverage signal — print it in your capture script to see
  exactly what did and didn't get captured on each run.

What does **not** exist yet: a repo-wide static scan for "keys referenced
in JSX but never captured" (would need parsing consumer source for
`<AutoSkeleton.SSR skeletonKey={...}>` usages — a separate, larger
static-analysis feature, explicitly out of scope for this CLI).

## Programmatic API

For a build script (rather than the CLI entrypoint), `runCapture` is a
plain async function:

```ts
import { runCapture } from 'autoskeleton/cli'; // see package.json exports['./cli']

const { manifest, report } = await runCapture({
  baseURL: 'http://localhost:3000',
  registry: { dashboard: '/dashboard-capture' },
  outDir: './generated/autoskeleton-ssr',
});

console.log(`Captured: ${report.capturedKeys.join(', ')}`);
if (report.failedKeys.length > 0) {
  console.error(`Failed: ${report.failedKeys.join(', ')}`);
}
```

## When to run it

The capture CLI is a **dev dependency / build-time tool** — it never enters
your runtime bundle (see `docs/ssr-capture-cli.md`'s own packaging note:
`autoskeleton`'s runtime entries never import `cli/`). Run it as a step
before your production build, against a temporary dev server serving your
capture routes — see `examples/next`'s two-phase setup (`next dev` for
capture, then `next build && next start` for the real production
verification) for a concrete, tested pattern.
