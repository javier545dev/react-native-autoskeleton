// examples/vite/src/demos/HintRadius.tsx
//
// `<AutoSkeleton.Hint>` is the typed-prop hint channel — never a parsed
// `className` (REQ-THEME-3), because a Tailwind/Uniwind transform can rewrite
// a class list before the sensor ever sees it.
//
// On web the sensor already measures the true corner radius from
// `getComputedStyle`, so `radius` here OVERRIDES a known-correct value rather
// than filling a gap (that is Android's ADR-2 problem, not the DOM's). Both
// cards below are the same 4 px-cornered square; only the right one is
// wrapped in a Hint, and only the right one's skeleton is a pill.
//
// The component is sugar, not a separate mechanism: it clones its single
// child and stamps `data-autoskeleton-radius`, exactly the attribute you can
// set by hand on your own element. `id` is required for symmetry with the
// native Hint; the DOM sensor does not key any lookup off it today.
//
// `lines` is deliberately absent from the web Hint. The sensor's line
// synthesis never consults it, so a `lines` prop here would be a silent
// no-op — see `src/web/Hint.tsx` in the library for the full account.
//
// Both wrappers set `skeletonOnRefresh` for one reason only: the toggle below
// has to be able to bring the skeleton BACK. Without it, REQ-PTR-1 suppresses
// every loading state after the first, and the button would appear broken.

import { useState } from 'react'
import { AutoSkeleton } from 'autoskeleton'

export function HintRadius() {
  const [isLoading, setIsLoading] = useState(true)

  return (
    <>
      <div className="demo-pair">
        <figure className="demo-pair-item">
          <figcaption>No hint — measured radius (4 px)</figcaption>
          <AutoSkeleton isLoading={isLoading} skeletonKey="hint-measured" skeletonOnRefresh>
            <div className="demo-swatch" data-testid="hint-measured-target" />
          </AutoSkeleton>
        </figure>

        <figure className="demo-pair-item">
          <figcaption>
            <code>&lt;AutoSkeleton.Hint radius=&#123;40&#125;&gt;</code>
          </figcaption>
          <AutoSkeleton isLoading={isLoading} skeletonKey="hint-overridden" skeletonOnRefresh>
            <AutoSkeleton.Hint id="pill-card" radius={40}>
              <div className="demo-swatch" data-testid="hint-overridden-target" />
            </AutoSkeleton.Hint>
          </AutoSkeleton>
        </figure>
      </div>

      <div className="demo-controls">
        <button
          type="button"
          className="counter"
          data-testid="hint-toggle"
          onClick={() => setIsLoading((v) => !v)}
        >
          {isLoading ? 'Show the real cards' : 'Show the skeletons'}
        </button>
      </div>
      <p className="demo-note">
        Both cards keep their own 4 px corners when the real content is shown — the hint moves the SKELETON's
        geometry, not the element's.
      </p>
    </>
  )
}
