// examples/vite/src/App.tsx
//
// The showcase shell: an identity band, a grouped sidebar, and one section
// per demo from `src/demos/registry.ts`. Every demo lives in its own file so
// that "where is the code for this?" has a one-line answer, and each section
// can show that file verbatim underneath it.
//
// Routing is `location.hash`, read through `useSyncExternalStore` rather than
// an effect. `#/<id>` focuses a single demo; no hash renders all of them, and
// that is load-bearing rather than a default: `test/web/tailwind-app-theme
// .spec.ts` navigates to `/` and expects the Tailwind theming demo to be
// mounted there. A router that hid it behind a hash would silently take that
// gate offline.
//
// The index renders the demos GROUPED (`registry.ts`'s `group` field), each
// group in taxonomy order and each demo in registry order inside it. Every
// demo still renders at `/`; what the grouping changes is that a reader lands
// on six answers to "what kind of thing is this?" instead of eleven
// undifferentiated sections.
//
// There is exactly ONE navigation list in the DOM. Below 880px it stops being
// a sidebar and becomes a fixed overlay panel driven by `navOpen` — moved by
// CSS rather than rendered twice, because a second copy would duplicate every
// `data-testid="nav-*"` and make those selectors ambiguous.

import { useState, useSyncExternalStore } from 'react'
import { DEMOS, GROUPS, type Demo } from './demos/registry'
import './App.css'

const REPO_EXAMPLES = 'https://github.com/javier545dev/react-native-autoskeleton/tree/main/examples'

/** Groups that actually have a demo here, in taxonomy order. */
const PRESENT_GROUPS = GROUPS.filter((group) => DEMOS.some((demo) => demo.group === group.id))

function demosIn(groupId: string): readonly Demo[] {
  return DEMOS.filter((demo) => demo.group === groupId)
}

function groupTitle(demo: Demo): string {
  return GROUPS.find((group) => group.id === demo.group)?.title ?? ''
}

function subscribeToHash(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

function DemoSection({
  demo,
  kicker,
  heading,
}: {
  demo: Demo
  /** Only set when no group header precedes this section — see `App()`. */
  kicker?: string
  heading: 'h2' | 'h3'
}) {
  const Component = demo.Component
  const Heading = heading
  return (
    <section className="demo" id={demo.id} data-testid={`demo-${demo.id}`}>
      {kicker ? <p className="demo-kicker">{kicker}</p> : null}
      <Heading className="demo-title">
        <a href={`#/${demo.id}`}>{demo.title}</a>
      </Heading>
      <p className="demo-claim">{demo.shows}</p>

      {/* The stage. Its header row is a real element in the flow, never an
          absolutely positioned corner label: this is the one panel in the app
          where an overlapping element would change what a screenshot — or the
          theming gate's single sampled pixel — reads back. */}
      <div className="demo-stage">
        <div className="demo-stage-head">
          <span className="demo-stage-live">Live</span>
          <span className="demo-stage-api">{demo.title}</span>
        </div>
        <Component />
      </div>

      <details className="demo-source">
        <summary>
          Source · <code>{demo.file}</code>
        </summary>
        <pre>
          <code>{demo.source}</code>
        </pre>
      </details>
    </section>
  )
}

function DemoNav({ selectedId, onNavigate }: { selectedId: string; onNavigate: () => void }) {
  return (
    <nav aria-label="Demos">
      <a
        href="#/"
        className="nav-link nav-all"
        aria-current={selectedId ? undefined : 'page'}
        data-testid="nav-all"
        onClick={onNavigate}
      >
        All demos
      </a>
      {PRESENT_GROUPS.map((group) => (
        <div key={group.id}>
          <p className="nav-group">{group.title}</p>
          {demosIn(group.id).map((demo) => (
            <a
              key={demo.id}
              href={`#/${demo.id}`}
              className="nav-link"
              aria-current={selectedId === demo.id ? 'page' : undefined}
              data-testid={`nav-${demo.id}`}
              onClick={onNavigate}
            >
              {demo.title}
            </a>
          ))}
        </div>
      ))}
    </nav>
  )
}

export default function App() {
  const hash = useSyncExternalStore(
    subscribeToHash,
    () => window.location.hash,
    () => '',
  )
  const [navOpen, setNavOpen] = useState(false)
  const selectedId = hash.startsWith('#/') ? hash.slice(2) : ''
  const selected = DEMOS.find((demo) => demo.id === selectedId)

  return (
    <div className="app">
      <a className="skip-link" href="#demos">
        Skip to the demos
      </a>

      <header className="band">
        <div className="band-inner">
          {/* A plain `<img>`, never an inlined `<svg>`. The file declares
              about twenty gradient, clip and filter `id`s in its own `<defs>`;
              inlined, every one of them would land in the DOCUMENT's global id
              namespace, where a second copy of the mark — or an id the
              library's runtime writes — would silently repaint it. Inside an
              `<img>` that namespace stays sealed in the resource.

              `width`/`height` are explicit so the box exists before the file
              has loaded. That matters here specifically: below 880px this band
              is sticky and `.demo` clears it with `scroll-margin-top: 72px`,
              so a mark that grew the band after paint would move what
              `scrollIntoViewIfNeeded()` lands on in the theming gate. It does
              not: measured against the production build, the band is 57.14px
              at 600px and up and 65.19px at 360-400px (where the wordmark
              already wrapped), IDENTICAL with and without this 28px mark — the
              "Demos" button and the wrapped wordmark set that height, and 28px
              fits inside it. Both are still under the 72px clearance. */}
          <a className="band-mark" href="#/">
            <img
              className="band-logo"
              src="/autoskeleton-logo.svg"
              alt=""
              width={28}
              height={28}
              decoding="async"
            />
            <span className="band-mark-text">
              autoskeleton
              <span className="band-mark-sub">web demos</span>
            </span>
          </a>

          <div className="renderers">
            <span className="renderer" aria-current="true">
              Web
            </span>
            <a className="renderer" href={`${REPO_EXAMPLES}/next`}>
              Server
            </a>
            <a className="renderer" href={`${REPO_EXAMPLES}/bare-rn`}>
              Native
            </a>
            <span className="renderer-urls">web :5173 · server :3000</span>
          </div>

          <button
            type="button"
            className="band-menu"
            aria-expanded={navOpen}
            aria-controls="demo-nav"
            onClick={() => setNavOpen((open) => !open)}
          >
            Demos
          </button>
        </div>
      </header>

      {navOpen ? (
        <button type="button" className="nav-scrim" aria-label="Close the demo list" onClick={() => setNavOpen(false)} />
      ) : null}

      <div className="shell">
        <aside id="demo-nav" className={navOpen ? 'sidebar is-open' : 'sidebar'}>
          <div className="sidebar-head">
            <span className="sidebar-title">Demos</span>
            <button type="button" className="counter" onClick={() => setNavOpen(false)}>
              Close
            </button>
          </div>
          <DemoNav selectedId={selectedId} onNavigate={() => setNavOpen(false)} />
        </aside>

        <div className="content">
          {selected ? (
            <a className="back-link" href="#/">
              ← All {DEMOS.length} demos
            </a>
          ) : (
            <section className="hero">
              <p className="hero-kicker">The library, running in a browser</p>
              <h1 className="hero-title">Loading states measured from the UI you already wrote.</h1>
              <p className="hero-claim">
                Wrap a component in <code>&lt;AutoSkeleton&gt;</code> and it traverses the real, laid-out DOM
                underneath to paint the loading state from that geometry — so there is no hand-drawn skeleton
                to keep in sync with the thing it stands in for.
              </p>
              <p className="hero-meta">
                {DEMOS.length} demos, grouped below. Every one of them is a real consuming app importing{' '}
                <code>autoskeleton</code> from the packed tarball, not a test fixture — pick one from the list,
                or scroll through all of them.
              </p>
            </section>
          )}

          <main className="app-main" id="demos">
            {selected ? (
              <DemoSection demo={selected} kicker={groupTitle(selected)} heading="h2" />
            ) : (
              PRESENT_GROUPS.map((group) => (
                <section className="group" key={group.id} aria-labelledby={`group-${group.id}`}>
                  <header className="group-head">
                    <h2 className="group-title" id={`group-${group.id}`}>
                      {group.title}
                    </h2>
                    <p className="group-line">{group.line}</p>
                  </header>
                  {demosIn(group.id).map((demo) => (
                    <DemoSection key={demo.id} demo={demo} heading="h3" />
                  ))}
                </section>
              ))
            )}
          </main>

          <footer className="app-footer">
            <p>
              Server-side rendering has its own app: <code>examples/next</code> covers the SSR replay path, the
              RTL capture and the neutral block for an uncaptured key.
            </p>
            <p>
              Native has two: <code>examples/bare-rn</code> (bare React Native, including the Tier 2 Skia
              renderer) and <code>examples/expo</code> (Expo + uniwind). Neither runs in a browser.
            </p>
          </footer>
        </div>
      </div>
    </div>
  )
}
