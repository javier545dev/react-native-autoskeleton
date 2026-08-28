# SSR: the build-time capture CLI

`<AutoSkeleton.SSR>` replays a **build-time capture**, never live server-side
detection — a Suspense fallback renders before its children exist, so live
detection is architecturally impossible both server- and client-side
(`plan.md` ADR-11). The capture CLI is what produces the data
`<AutoSkeleton.SSR>` replays. This document covers running it and the one
real ergonomic cost it has (RISK-4), stated openly rather than glossed over.

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
