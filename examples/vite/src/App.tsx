// examples/vite/src/App.tsx
//
// The showcase shell: a nav, and one section per demo from
// `src/demos/registry.ts`. Every demo lives in its own file so that "where is
// the code for this?" has a one-line answer, and each section can show that
// file verbatim underneath it.
//
// Routing is `location.hash`, read through `useSyncExternalStore` rather than
// an effect. `#/<id>` focuses a single demo; no hash renders all of them, and
// that is load-bearing rather than a default: `test/web/tailwind-app-theme
// .spec.ts` navigates to `/` and expects the Tailwind theming demo to be
// mounted there. A router that hid it behind a hash would silently take that
// gate offline.

import { useSyncExternalStore } from 'react'
import { DEMOS, type Demo } from './demos/registry'
import './App.css'

function subscribeToHash(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

function DemoSection({ demo }: { demo: Demo }) {
  const Component = demo.Component
  return (
    <section className="demo" id={demo.id} data-testid={`demo-${demo.id}`}>
      <h2 className="demo-title">
        <a href={`#/${demo.id}`}>{demo.title}</a>
      </h2>
      <p className="demo-shows">{demo.shows}</p>
      <div className="demo-stage">
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

export default function App() {
  const hash = useSyncExternalStore(
    subscribeToHash,
    () => window.location.hash,
    () => '',
  )
  const selectedId = hash.startsWith('#/') ? hash.slice(2) : ''
  const selected = DEMOS.find((demo) => demo.id === selectedId)
  const visible = selected ? [selected] : DEMOS

  return (
    <div className="app">
      <header className="app-header">
        <h1>autoskeleton on the web</h1>
        <p>
          Eleven focused demos of what the library does in a browser. Every one of them is a real consuming app
          importing <code>autoskeleton</code> from the packed tarball, not a test fixture — pick one from the
          list, or scroll through all of them.
        </p>
      </header>

      <nav className="app-nav" aria-label="Demos">
        <a href="#/" className={selected ? undefined : 'is-active'} data-testid="nav-all">
          All demos
        </a>
        {DEMOS.map((demo) => (
          <a
            key={demo.id}
            href={`#/${demo.id}`}
            className={selected?.id === demo.id ? 'is-active' : undefined}
            data-testid={`nav-${demo.id}`}
          >
            {demo.title}
          </a>
        ))}
      </nav>

      <main className="app-main">
        {visible.map((demo) => (
          <DemoSection key={demo.id} demo={demo} />
        ))}
      </main>

      <footer className="app-footer">
        <p>
          Server-side rendering has its own app: <code>examples/next</code> covers the SSR replay path, the
          RTL capture and the neutral block for an uncaptured key.
        </p>
      </footer>
    </div>
  )
}
