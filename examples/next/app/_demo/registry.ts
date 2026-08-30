// examples/next/app/_demo/registry.ts
//
// One entry per SSR demo, in reading order, and the single source of truth
// for what each one claims. The index (`app/page.tsx`) renders this list, and
// each demo route renders its OWN entry for its heading — so the sentence a
// reader saw on the index is literally the sentence they see on the page,
// rather than two copies free to drift apart.
//
// `_demo` is an App Router PRIVATE folder: the leading underscore keeps it
// out of routing, so this shared module cannot accidentally become a page.
//
// Every claim below was checked in a real browser against this app's own
// `next build && next start` output. Nothing here describes a capability the
// library does not actually have.

export interface SsrDemo {
  /** Route path. Also the key used to look an entry back up from its page. */
  readonly href: string;
  readonly title: string;
  /** The single thing this demo is supposed to make obvious. */
  readonly shows: string;
  /** How to look at it. Server-rendered things do not have buttons. */
  readonly check: readonly string[];
  /** The one control the route actually has, if it has one. Server-rendered
   *  things do not get buttons: a client button cannot bring a Suspense
   *  fallback back, because by the time the browser has JavaScript the swap
   *  has already happened. What is left is changing what the SERVER does. */
  readonly control?: { readonly href: string; readonly label: string };
}

export const DEMOS: readonly SsrDemo[] = [
  {
    href: '/dashboard',
    title: 'Captured key, replayed on the server',
    shows:
      'The Suspense fallback is <AutoSkeleton.SSR skeletonKey="dashboard">. The geometry it paints was measured at build time by the capture CLI — the server does no layout detection at request time, because it has no layout.',
    check: [
      'Open it with JavaScript disabled: the served HTML already carries data-askl-ssr-key="dashboard" and a real clip-path arrives in the CSS bundle.',
      'One payload is correct at every width. The bundle has an @media block per captured bucket, so the server never has to guess the viewport.',
    ],
    control: { href: '/dashboard?delay=8000', label: 'Hold the server-rendered skeleton on screen for 8 s' },
  },
  {
    href: '/widths',
    title: 'One payload, correct at every width',
    shows:
      'The same served HTML at every viewport. Resize the window and the skeleton changes shape with no request, no re-render and no measurement — the browser picks the @media block for its own width bucket, which is the whole reason the server never has to know the viewport.',
    check: [
      'Drag the window narrower and watch the readout: the served markup is unchanged, but the computed width and height jump between the captured buckets.',
      'The Network panel stays silent while you resize. Nothing is fetched, because everything for every bucket was already in the one payload.',
    ],
  },
  {
    href: '/streaming',
    title: 'Three boundaries, three arrival times',
    shows:
      'One document, three <Suspense> boundaries resolving at 0.8 s, 2.6 s and 4.4 s. Each skeleton is replaced by its own content as that chunk arrives, in a response that is still streaming — the third boundary uses an uncaptured key, so both halves of ADR-12 are on screen at once.',
    check: [
      'The panels fill in one at a time, top to bottom, before the page has finished loading.',
      'The first two are the captured dashboard geometry; the third is the neutral generic block, because "stream-uncaptured" is not in the capture registry.',
    ],
    control: { href: '/streaming?delay=6000', label: 'Push every boundary 6 s later' },
  },
  {
    href: '/drift',
    title: 'A stale manifest cannot paint stale geometry',
    shows:
      'Two identical <AutoSkeleton.SSR> elements, side by side, differing only in which manifest they were given. The second one carries the build token of a manifest the served bundle.css was NOT generated from — so the geometry rule does not select it at all, and it degrades to the neutral block instead of painting shapes that are quietly wrong.',
    check: [
      'The left specimen is the real captured geometry. The right one is 80 px tall with no clip-path: that is the drift fallback, not a coincidence.',
      'The two build tokens are printed underneath, next to the one the stylesheet publishes on :root. The right token matches neither.',
    ],
  },
  {
    href: '/dashboard-rtl',
    title: 'The same key, captured right-to-left',
    shows:
      'Layout mirrors under direction: rtl, so the capture runs both directions and the replay picks the one the document is in. Same manifest, different entry.',
    check: ['View source and compare data-askl-ssr-dir="rtl" against the LTR route.'],
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
  },
  {
    href: '/client-cache',
    title: 'The captured snapshots become a runtime cache hit',
    shows:
      '<AutoSkeleton.SSRHydrate> imports the build-time snapshots into the runtime store once, on the client. Mount a live <AutoSkeleton> for the same key afterwards and it reports cache HIT with a 0.00 ms traversal — it never walks the DOM, because the measurement already shipped with the page.',
    check: [
      'The panel is mounted by a button, on purpose: that is the client-side navigation case, after hydration has already filled the store.',
      'The reading appears when the loading cycle ends, not when it starts — displayDurationMs is part of what onMetrics reports, so it cannot be known any earlier.',
      'A MISS here is not a failure. The snapshot is keyed by width bucket, so a window whose bucket was never captured correctly measures instead of replaying somebody else’s geometry.',
    ],
  },
  {
    href: '/hydration',
    title: 'Zero hydration mismatch, with a control that fires',
    shows:
      'A detector that never fires proves nothing, so this page ships one that does. React’s own complaints are recorded on both the channels it uses — console in a dev build, an uncaught minified error in this production one — starting before hydration. The server-rendered skeleton produces none of them; ?mismatch=1 adds a deliberately broken sibling that produces one immediately.',
    check: [
      'The default page reports zero hydration failures while a real server-rendered skeleton is on screen and hydrating.',
      'Add ?mismatch=1 and the same recorder catches React error #418 — same page, same recorder, one element changed.',
    ],
    control: { href: '/hydration?mismatch=1', label: 'Mount the deliberately broken control' },
  },
  {
    href: '/manifest',
    title: 'What the capture CLI actually wrote',
    shows:
      'The committed build output, read back and printed: schema version, build token, width buckets, captured keys, and one row per captured (key × bucket × direction) with the frame it measured and how many shapes it found.',
    check: [
      'This is the real generated/autoskeleton-ssr/manifest.json this app imports, not a transcription of it.',
      'The registry and the exact command that produced it are at the bottom — including the ergonomic cost, which is a declared route per key.',
    ],
  },
];

/** Looks an entry back up from a demo page, so a route never restates its own
 *  description. Throws rather than rendering a page with no heading: a missing
 *  entry is an authoring mistake, and a silent blank is how it survives. */
export function demoFor(href: string): SsrDemo {
  const demo = DEMOS.find((entry) => entry.href === href);
  if (!demo) {
    throw new Error(`No demo registry entry for ${href} — add one to app/_demo/registry.ts.`);
  }
  return demo;
}
