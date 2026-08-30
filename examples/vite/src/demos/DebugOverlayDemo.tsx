// examples/vite/src/demos/DebugOverlayDemo.tsx
//
// `debugOverlay` outlines every detected shape and labels it with the source
// the sensor classified it as (`text`, `image`, `input`, `background`,
// `synthetic-line`, `container`) plus a cache HIT/MISS badge. The diagnostic
// that matters most is the ABSENCE of an outline: a node you expected to be
// drawn and is not.
//
// DEV BUILDS ONLY. `<AutoSkeleton>` gates it on
// `process.env.NODE_ENV !== 'production'`, so a real bundler drops both the
// flag and the component from a production build — which is why this section
// tells you to run the dev server instead of quietly rendering nothing when
// you are looking at `vite preview`.

import { useState } from 'react'
import { AutoSkeleton } from 'autoskeleton'

export function DebugOverlayDemo() {
  const [isLoading, setIsLoading] = useState(true)

  if (import.meta.env.PROD) {
    return (
      <p className="demo-note" data-testid="debug-overlay-unavailable">
        This is a production build, so the debug overlay has been compiled out — exactly as it would be in
        your app. Run <code>npm run dev</code> in <code>examples/vite</code> to see it.
      </p>
    )
  }

  return (
    <>
      <AutoSkeleton isLoading={isLoading} skeletonKey="debug-overlay" skeletonOnRefresh debugOverlay>
        <article className="demo-card">
          <div className="demo-avatar" />
          <div className="demo-card-body">
            <h3 className="demo-card-title">Shape sources</h3>
            <p className="demo-card-meta">Each outline is labelled with what the sensor thinks it is.</p>
            <div className="demo-card-action">Follow</div>
          </div>
        </article>
      </AutoSkeleton>

      <div className="demo-controls">
        <button
          type="button"
          className="counter"
          data-testid="debug-overlay-toggle"
          onClick={() => setIsLoading((v) => !v)}
        >
          {isLoading ? 'Show the real card' : 'Show the skeleton'}
        </button>
      </div>
      <p className="demo-note">
        The badge reports how THIS wrapper first got its snapshot, and that decision is made once, when it
        first sees the cache key — so toggling here keeps saying <code>MISS</code>. The cached-replay demo,
        which unmounts, is where you can watch it be a <code>HIT</code>.
      </p>
    </>
  )
}
