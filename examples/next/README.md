# autoskeleton — SSR demos (Next.js)

A Next.js App Router app that installs `autoskeleton` from the packed tarball
(`file:../../.tarball/autoskeleton-0.1.0.tgz`), never a workspace symlink, and
demonstrates the server-rendering path. The client-side demos — per-line text,
images, hints, theming, reduced motion, the refresh policy — live in
`examples/vite`.

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # next build
npm run start    # next start
```

Start at `/`, which indexes the routes below and says what to look for in each.
Nine demos, one per route, all rendered by the same list in
`app/_demo/registry.ts` so the sentence on the index is the sentence on the
page.

## Routes

| Route | What it makes obvious |
| --- | --- |
| `/dashboard` | A `<Suspense>` fallback of `<AutoSkeletonSSR skeletonKey="dashboard">`, replaying geometry captured at build time. `?delay=8000` holds it on screen. |
| `/widths` | REQ-SSR-3 live: one served payload, and the browser picks the `@media` block for its own width bucket. Resize and the computed width, height and `clip-path` change with no request. |
| `/streaming` | Three `<Suspense>` boundaries in one response, resolving at 0.8 s / 2.6 s / 4.4 s. The third uses an uncaptured key, so both ADR-12 branches are on screen at once. |
| `/drift` | The manifest ↔ CSS integrity binding. Two identical elements; the one stamped with a token the served `bundle.css` was not generated from cannot select a geometry rule and degrades to the neutral block. |
| `/dashboard-rtl` | The same key captured with `direction: 'rtl'` — the replay side of the both-directions capture. |
| `/uncaptured` | ADR-12: a key that is not in the registry renders a neutral generic block, identical on server and client, so there is no hydration mismatch. |
| `/client-cache` | `<AutoSkeletonSSRHydrate>` imports the captured snapshots into the runtime store, so a live `<AutoSkeleton>` mounted afterwards reports `cache HIT` with a `0.00 ms` traversal. |
| `/hydration` | Zero hydration mismatch, with a control that fires: React's complaints are recorded on both channels it uses, and `?mismatch=1` adds a deliberately broken sibling so the instrument is visibly working. |
| `/manifest` | The committed capture read back — schema version, build token, buckets, keys, and one row per captured entry — plus the registry and the command that produced it. |
| `/dashboard-capture` | Build-time tooling, not a demo: the route the capture CLI measures, wrapped in `#autoskeleton-capture-root`. |

There is no button to bring an SSR skeleton back. The fallback is resolved on
the SERVER, before the browser has any JavaScript, so the only honest control
is how long the server takes — hence `?delay=`. Where a route has no such
control, the index does not pretend it has one.

## What these demos deliberately do NOT claim

`prefers-reduced-motion` is honoured on the pre-hydration path — the generated
bundle's `@media (prefers-reduced-motion: reduce)` block does stop the sweep
with zero JavaScript — but the degraded result is a **static** block, not the
pulse the spec describes: the pulse keyframes animate `.askl-overlay-base`,
which has no background of its own, while the visible colour lives on the
parent `.askl-overlay`. Rather than stage a demo around a preference a visitor
cannot toggle in-page and an animation that does not currently appear, there
is no reduced-motion route here.

## Regenerating the capture

```bash
npm run dev        # in one shell, serving :3000
npm run capture    # in another
```

`npm run capture` runs the published `autoskeleton-capture` binary against
`autoskeleton.capture-registry.json` and rewrites `generated/autoskeleton-ssr/`.
It drives real headless Chromium, so it needs the optional peer
`@playwright/test` plus `npx playwright install chromium` (see
`docs/ssr-capture-cli.md`). Note that the CLI captures every entry in the
library's `WIDTH_BUCKETS` table, whereas the committed pair here is the
two-bucket subset (`375`, `1280`) that `test/ssr/dashboard.spec.ts` captures —
so running it locally will legitimately produce a larger manifest than the one
in the tree.

## Generated artifacts

`generated/autoskeleton-ssr/` is committed build output: `manifest.json` (the
captured snapshots), `bundle.css` (one `@media` block per width bucket) and
`index.ts`. `app/layout.tsx` imports both once, globally, so a single
server-rendered payload is correct at every width without the server guessing a
viewport.

The manifest and the stylesheet are bound by an integrity token stamped into
both. A stale pair cannot paint the wrong geometry — the qualified CSS rule
stops selecting and the neutral block is shown instead; `/drift` shows exactly
that, side by side, using a real drifted manifest built from the committed one.
If you change what is captured, regenerate BOTH together;
`test/web/ssr-drift.spec.ts` guards the binding, and `capturedAt` in
`manifest.json` is rewritten by any capture run.

## Gated surface

`test/ssr/dashboard.spec.ts` runs a two-phase setup against this app: capture
under `next dev`, then verify under a fresh `next build && next start`. It
depends on the four route paths `/dashboard`, `/dashboard-rtl`, `/uncaptured`
and `/dashboard-capture`, on `DashboardContent`'s `Q3 Revenue Dashboard`
heading and its 1200 ms default fetch, and on the `data-askl-ssr-*` attributes
in the served markup. None of those are touched by the demos added around
them — every demo is a new route. That spec's `next build` is also what keeps
the new routes honest structurally: a demo route that stops compiling fails it.

`test/web/ssr-hydrate.spec.ts` gates the claim `/client-cache` makes, in a real
browser and without a Next build: bridge first, live `<AutoSkeleton>` second,
`cacheHit: true` with a zero traversal, plus two negative controls (a snapshot
captured for a different width bucket, and a manifest this build cannot
replay).
