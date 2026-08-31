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
//
// `group` places each demo in the taxonomy the four example apps share, so a
// reader who learns the shape of one gallery already knows the shape of the
// others. Group ids and their ORDER are fixed across all four apps; each app
// renders only the groups it has demos for, which is why this app shows five
// of the nine.

/** The shared taxonomy's ids, in their fixed order. */
export type DemoGroupId =
  | 'start-here'
  | 'detection'
  | 'lifecycle'
  | 'control'
  | 'lists'
  | 'theming'
  | 'diagnostics'
  | 'server'
  | 'tier2';

export interface DemoGroup {
  readonly id: DemoGroupId;
  readonly title: string;
  /** Shown under the header on the index; the sidebar shows only the title. */
  readonly lede: string;
}

/** The whole taxonomy, in order, including the groups this app has no demo
 *  for — the list is shared, and a group with nothing in it simply does not
 *  render (see `groupedDemos`). Keeping the absent ones visible here is what
 *  stops the four apps' orders from drifting apart one edit at a time. */
export const DEMO_GROUPS: readonly DemoGroup[] = [
  {
    id: 'start-here',
    title: 'Start here',
    lede: 'Wrap real UI. The skeleton comes from the measured layout — you never author one.',
  },
  {
    id: 'detection',
    title: 'What gets detected',
    lede: 'Which parts of your tree become shapes, and what each leaf kind turns into.',
  },
  {
    id: 'lifecycle',
    title: 'Lifecycle',
    lede: 'When a skeleton appears, replays and leaves — the timing rules that surprise people.',
  },
  {
    id: 'control',
    title: 'Control & opt-out',
    lede: 'Steering the automatic answer: shape hints, exclusions, timing, refresh policy.',
  },
  {
    id: 'lists',
    title: 'Lists',
    lede: 'Virtualized lists are their own API surface and their own performance contract.',
  },
  {
    id: 'theming',
    title: 'Theming & motion',
    lede: 'How the skeleton looks and moves, and what happens when the reader asks for less motion.',
  },
  {
    id: 'diagnostics',
    title: 'Diagnostics',
    lede: 'What it measured, what it cached, and what actually drew.',
  },
  {
    id: 'server',
    title: 'Server rendering',
    lede: 'Geometry captured at build time and replayed as a Suspense fallback.',
  },
  { id: 'tier2', title: 'Tier 2 (opt-in)', lede: 'The upgrade path, not the default.' },
];

export interface SsrDemo {
  /** Route path. Also the key used to look an entry back up from its page. */
  readonly href: string;
  readonly title: string;
  /** Which section of the shared taxonomy this demo belongs to. */
  readonly group: DemoGroupId;
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
    group: 'start-here',
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
    group: 'detection',
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
    group: 'start-here',
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
    group: 'control',
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
    group: 'detection',
    title: 'The same key, captured right-to-left',
    shows:
      'Layout mirrors under direction: rtl, so the capture runs both directions and the replay picks the one the document is in. Same manifest, different entry.',
    check: ['View source and compare data-askl-ssr-dir="rtl" against the LTR route.'],
  },
  {
    href: '/uncaptured',
    group: 'control',
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
    group: 'lifecycle',
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
    group: 'control',
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
    group: 'diagnostics',
    title: 'What the capture CLI actually wrote',
    shows:
      'The committed build output, read back and printed: schema version, build token, width buckets, captured keys, and one row per captured (key × bucket × direction) with the frame it measured and how many shapes it found.',
    check: [
      'This is the real generated/autoskeleton-ssr/manifest.json this app imports, not a transcription of it.',
      'The registry and the exact command that produced it are at the bottom — including the ergonomic cost, which is a declared route per key.',
    ],
  },
];

/** The demos of one group, in registry order. Empty for a group this app has
 *  no demo for, which is how the index and the sidebar skip it. */
export function demosInGroup(group: DemoGroupId): readonly SsrDemo[] {
  return DEMOS.filter((demo) => demo.group === group);
}

/** The index and the sidebar both walk this: the taxonomy's fixed order, with
 *  the empty groups dropped. Derived rather than hand-maintained, so adding a
 *  demo to a group nobody has used yet makes that group appear in both places
 *  at once. */
export function groupedDemos(): readonly { group: DemoGroup; demos: readonly SsrDemo[] }[] {
  return DEMO_GROUPS.map((group) => ({ group, demos: demosInGroup(group.id) })).filter(
    (section) => section.demos.length > 0,
  );
}

/** The group an entry belongs to, for the kicker above a demo's title. */
export function groupFor(demo: SsrDemo): DemoGroup {
  const group = DEMO_GROUPS.find((entry) => entry.id === demo.group);
  if (!group) {
    throw new Error(`Unknown demo group "${demo.group}" on ${demo.href}.`);
  }
  return group;
}

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
