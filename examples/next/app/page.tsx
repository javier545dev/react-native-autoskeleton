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
// literally the sentence they see on the page.
//
// The four routes `test/ssr/dashboard.spec.ts` drives — /dashboard,
// /dashboard-rtl, /uncaptured and the capture route /dashboard-capture — are
// deliberately untouched by everything added around them. New demos are new
// routes.
//
// Plain `<a>` rather than `next/link`, on purpose: a client-side navigation
// would arrive after React is already running, and the whole subject here is
// the document the SERVER sent. A full page load is what you want to look at.

import { DEMOS } from './_demo/registry';

export default function Home() {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">autoskeleton on the server</h1>
      <p className="mt-4 text-base leading-7 text-zinc-600 dark:text-zinc-400">
        A skeleton that is measured from real layout has a problem on the server: there is no layout. The
        answer is to measure once, at build time, in a real browser — the capture CLI walks each registered
        route, writes a manifest of snapshots plus a <code>@media</code>-bucketed CSS bundle, and{' '}
        <code>&lt;AutoSkeleton.SSR&gt;</code> replays that geometry as a Suspense fallback. The client then
        hydrates onto identical markup.
      </p>
      <p className="mt-4 text-base leading-7 text-zinc-600 dark:text-zinc-400">
        {DEMOS.length} demos of the parts of that story that only exist on the server. The client-side
        demos — per-line text, images, hints, theming, reduced motion, the refresh policy — have their own app
        in <code className="font-mono text-sm">examples/vite</code>.
      </p>

      <ul className="mt-12 space-y-10">
        {DEMOS.map((demo) => (
          <li key={demo.href} className="border-t border-black/[.08] pt-8 dark:border-white/[.145]">
            <h2 className="text-xl font-medium">
              <a href={demo.href} className="underline underline-offset-4">
                {demo.title}
              </a>
            </h2>
            <p className="mt-1 font-mono text-sm text-zinc-500">{demo.href}</p>
            <p className="mt-3 text-base leading-7 text-zinc-600 dark:text-zinc-400">{demo.shows}</p>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
              {demo.check.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            {demo.control ? (
              <p className="mt-4 text-sm">
                <a href={demo.control.href} className="underline underline-offset-4">
                  {demo.control.label} →
                </a>
              </p>
            ) : null}
          </li>
        ))}
      </ul>

      <section className="mt-12 border-t border-black/[.08] pt-8 dark:border-white/[.145]">
        <h2 className="text-xl font-medium">Where the geometry comes from</h2>
        <p className="mt-3 text-base leading-7 text-zinc-600 dark:text-zinc-400">
          <code className="font-mono text-sm">/dashboard-capture</code> is the route the capture CLI
          measures for the <code className="font-mono text-sm">dashboard</code> key. It is build-time
          tooling rather than a demo: it renders the dashboard&apos;s loading shape inside{' '}
          <code className="font-mono text-sm">#autoskeleton-capture-root</code>, which is the element the
          injected DOM sensor traverses. Its output lands in{' '}
          <code className="font-mono text-sm">generated/autoskeleton-ssr/</code>, is imported once by{' '}
          <code className="font-mono text-sm">app/layout.tsx</code>, and is printed back at{' '}
          <a href="/manifest" className="underline underline-offset-4">
            /manifest
          </a>
          .
        </p>
      </section>
    </div>
  );
}
