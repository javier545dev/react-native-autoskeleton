// examples/next/app/page.tsx
//
// The index for this app's SSR demos. Everything interesting here happens on
// the SERVER, which is why each entry says how to look at it rather than
// giving you a button: by the time the browser has JavaScript, the Suspense
// fallback has already been replaced. The `?delay=` links are the honest
// control — they make the server take longer, which is the only thing that
// can hold a server-rendered skeleton on screen.
//
// The demo routes themselves are deliberately untouched by this page.
// `test/ssr/dashboard.spec.ts` drives `/dashboard`, `/dashboard-rtl`,
// `/uncaptured` and the capture route `/dashboard-capture` against a real
// production build, so this index links to them and explains them instead of
// restructuring them.
//
// Plain `<a>` rather than `next/link`, on purpose: a client-side navigation
// would arrive after React is already running, and the whole subject here is
// the document the SERVER sent. A full page load is what you want to look at.

const DEMOS = [
  {
    href: '/dashboard',
    title: 'Captured key, replayed on the server',
    shows:
      'The Suspense fallback is <AutoSkeleton.SSR skeletonKey="dashboard">. The geometry it paints was measured at build time by the capture CLI — the server does no layout detection at request time, because it has no layout.',
    check: [
      'Open it with JavaScript disabled: the served HTML already carries data-askl-ssr-key="dashboard" and a real clip-path arrives in the CSS bundle.',
      'One payload is correct at every width. The bundle has an @media block per captured bucket, so the server never has to guess the viewport.',
    ],
    slow: '/dashboard?delay=8000',
  },
  {
    href: '/dashboard-rtl',
    title: 'The same key, captured right-to-left',
    shows:
      'Layout mirrors under direction: rtl, so the capture runs both directions and the replay picks the one the document is in. Same manifest, different entry.',
    check: ['View source and compare data-askl-ssr-dir="rtl" against the LTR route.'],
    slow: '/dashboard-rtl',
  },
  {
    href: '/uncaptured',
    title: 'An uncaptured key: the ADR-12 neutral block',
    shows:
      'A skeletonKey that is not in the capture registry does not fail the build and does not render nothing. Both the server and the client render the same neutral generic block, produced by the same pure function, so there is no hydration mismatch to flash.',
    check: [
      'The fallback carries data-askl-ssr-neutral="true" and no data-askl-ssr-key at all.',
      'Refusing to maintain the registry is therefore degraded, not broken — which is the point of the decision.',
    ],
    slow: '/uncaptured',
  },
];

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
        The manifest and the stylesheet are bound together by an integrity token stamped into both, so a
        stale pair cannot paint the wrong geometry — the qualified CSS rule simply stops selecting, and the
        neutral block is shown instead.
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
            <p className="mt-4 text-sm">
              <a href={demo.slow} className="underline underline-offset-4">
                Hold the server-rendered skeleton on screen →
              </a>
            </p>
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
          <code className="font-mono text-sm">generated/autoskeleton-ssr/</code> and is imported by the
          routes above.
        </p>
        <p className="mt-3 text-base leading-7 text-zinc-600 dark:text-zinc-400">
          Everything the library does on the CLIENT — per-line text measurement, images, hints, theming,
          reduced motion, the refresh policy — has its own app in{' '}
          <code className="font-mono text-sm">examples/vite</code>.
        </p>
      </section>
    </div>
  );
}
