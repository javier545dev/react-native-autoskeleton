// examples/next/app/page.tsx
//
// The index for this app's SSR demos. Everything interesting here happens on
// the SERVER, which is why each entry says how to look at it rather than
// giving you a button: by the time the browser has JavaScript, the Suspense
// fallback has already been replaced. The `?delay=` links are the honest
// control — they make the server take longer, which is the only thing that
// can hold a server-rendered skeleton on screen.
//
// The list itself lives in `_demo/registry.ts`, and every demo route renders
// its own entry from the same file, so the sentence a reader sees here is
// literally the sentence they see on the page. The grouping is the taxonomy
// all four example apps share, derived from each entry's `group` rather than
// from the order of this file.
//
// The four routes `test/ssr/dashboard.spec.ts` drives — /dashboard,
// /dashboard-rtl, /uncaptured and the capture route /dashboard-capture — are
// deliberately untouched by everything added around them. New demos are new
// routes.
//
// Plain `<a>` rather than `next/link`, on purpose: a client-side navigation
// would arrive after React is already running, and the whole subject here is
// the document the SERVER sent. A full page load is what you want to look at.

import { IdentityBand } from './_demo/DemoShell';
import { DEMOS, groupedDemos } from './_demo/registry';

/** The routes the SSR spec drives. They render their specimen and nothing
 *  else, which the index has to say out loud — otherwise the first thing a
 *  visitor clicks looks like a broken page rather than a deliberate one. */
const CHROMELESS = ['/dashboard', '/dashboard-rtl', '/uncaptured'];

export default function Home() {
  return (
    <div className="ui-shell">
      <IdentityBand />

      <main className="ui-main">
        <div className="ui-page">
          <p className="ui-kicker">autoskeleton · server rendering</p>
          <h1 className="ui-hero-title">A skeleton measured at build time, replayed by the server</h1>

          <p className="ui-lede">
            A skeleton that is measured from real layout has a problem on the server: there is no layout. The
            answer is to measure once, at build time, in a real browser — the capture CLI walks each registered
            route, writes a manifest of snapshots plus a <code className="font-mono">@media</code>-bucketed CSS
            bundle, and <code className="font-mono">&lt;AutoSkeleton.SSR&gt;</code> replays that geometry as a
            Suspense fallback. The client then hydrates onto identical markup.
          </p>
          <p className="ui-lede">
            {DEMOS.length} demos of the parts of that story that only exist on the server. The client-side
            demos — per-line text, images, hints, theming, reduced motion, the refresh policy — have their own
            app in <code className="font-mono">examples/vite</code>.
          </p>

          <div className="ui-actions">
            <a className="ui-cta" href="/dashboard?delay=8000">
              Watch it live — 8 s of real skeleton
            </a>
            <a className="ui-cta-secondary" href="/manifest">
              See what was captured
            </a>
          </div>

          <p className="ui-note">
            Three of the routes below —{' '}
            {CHROMELESS.map((href, index) => (
              <span key={href}>
                {index > 0 ? ', ' : ''}
                <code className="font-mono">{href}</code>
              </span>
            ))}{' '}
            — deliberately render their specimen and nothing else: no band, no navigation, no prose. They are
            the exact documents <code className="font-mono">test/ssr/dashboard.spec.ts</code> asserts against,
            so chrome around them would be chrome the spec has to reason about. Use the browser&apos;s back
            button to return here.
          </p>

          {groupedDemos().map(({ group, demos }) => (
            <section className="ui-group" key={group.id}>
              <h2 className="ui-group-title">{group.title}</h2>
              <p className="ui-group-lede">{group.lede}</p>

              <div className="ui-cards">
                {demos.map((demo) => (
                  <a key={demo.href} className="ui-card" href={demo.href}>
                    <h3 className="ui-card-title">{demo.title}</h3>
                    <p className="ui-card-path">{demo.href}</p>
                    <p className="ui-card-shows">{demo.shows}</p>
                    {demo.control ? <p className="ui-card-control">{demo.control.label} →</p> : null}
                  </a>
                ))}
              </div>
            </section>
          ))}

          <section className="ui-footnote">
            <h2 className="ui-group-title">Where the geometry comes from</h2>
            <p className="ui-lede">
              <code className="font-mono">/dashboard-capture</code> is the route the capture CLI measures for
              the <code className="font-mono">dashboard</code> key. It is build-time tooling rather than a
              demo: it renders the dashboard&apos;s loading shape inside{' '}
              <code className="font-mono">#autoskeleton-capture-root</code>, which is the element the injected
              DOM sensor traverses. Its output lands in{' '}
              <code className="font-mono">generated/autoskeleton-ssr/</code>, is imported once by{' '}
              <code className="font-mono">app/layout.tsx</code>, and is printed back at{' '}
              <a href="/manifest" className="underline underline-offset-4">
                /manifest
              </a>
              .
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
