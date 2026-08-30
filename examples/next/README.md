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

## Routes

| Route | What it makes obvious |
| --- | --- |
| `/dashboard` | A `<Suspense>` fallback of `<AutoSkeletonSSR skeletonKey="dashboard">`, replaying geometry captured at build time. `?delay=8000` holds it on screen. |
| `/dashboard-rtl` | The same key captured with `direction: 'rtl'` — the replay side of the both-directions capture. |
| `/uncaptured` | ADR-12: a key that is not in the registry renders a neutral generic block, identical on server and client, so there is no hydration mismatch. |
| `/dashboard-capture` | Build-time tooling, not a demo: the route the capture CLI measures, wrapped in `#autoskeleton-capture-root`. |

There is no button to bring the SSR skeleton back. The fallback is resolved on
the SERVER, before the browser has any JavaScript, so the only honest control is
how long the server takes — hence `?delay=`.

## Generated artifacts

`generated/autoskeleton-ssr/` is committed build output: `manifest.json` (the
captured snapshots), `bundle.css` (one `@media` block per width bucket) and
`index.ts`. `app/layout.tsx` imports both once, globally, so a single
server-rendered payload is correct at every width without the server guessing a
viewport.

The manifest and the stylesheet are bound by an integrity token stamped into
both. A stale pair cannot paint the wrong geometry — the qualified CSS rule
stops selecting and the neutral block is shown instead. If you change what is
captured, regenerate BOTH together; `test/web/ssr-drift.spec.ts` guards the
binding, and `capturedAt` in `manifest.json` is rewritten by any capture run.

## Gated surface

`test/ssr/dashboard.spec.ts` runs a two-phase setup against this app: capture
under `next dev`, then verify under a fresh `next build && next start`. It
depends on the four route paths above, on `DashboardContent`'s
`Q3 Revenue Dashboard` heading and its 1200 ms default fetch, and on the
`data-askl-ssr-*` attributes in the served markup. `app/page.tsx` is the index
and is not part of that gate.
