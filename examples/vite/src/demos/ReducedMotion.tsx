// examples/vite/src/demos/ReducedMotion.tsx
//
// Two different ways to end up with a still skeleton, and they are not
// interchangeable:
//
//   * `animation="none"` is YOUR decision, per wrapper;
//   * `prefers-reduced-motion: reduce` is the READER's decision, and the
//     library honours it without being asked.
//
// The preference cannot be flipped from JavaScript — it is an OS/browser
// setting. Emulate it in Chrome DevTools (⋮ → More tools → Rendering →
// "Emulate CSS media feature prefers-reduced-motion"), or turn on Reduce
// Motion in your OS accessibility settings. The live readout below tells you
// what the browser is currently reporting.
//
// One thing worth knowing before you try it: the preference is read ONCE,
// when the overlay mounts. Nothing re-reads it, so changing the setting does
// not restyle a skeleton that is already on screen — press Remount, which is
// what the button below does.

import { useState, useSyncExternalStore } from 'react'
import { AutoSkeleton } from 'autoskeleton'

const QUERY = '(prefers-reduced-motion: reduce)'

function subscribe(onChange: () => void): () => void {
  const list = window.matchMedia(QUERY)
  list.addEventListener('change', onChange)
  return () => list.removeEventListener('change', onChange)
}

export function ReducedMotion() {
  const [generation, setGeneration] = useState(0)
  const reduced = useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  )

  return (
    <>
      <p className="demo-readout" data-testid="reduced-motion-readout">
        <code>matchMedia('{QUERY}').matches</code> is currently{' '}
        <strong>{String(reduced)}</strong>.
      </p>

      <div className="demo-pair">
        <figure className="demo-pair-item">
          <figcaption>Default (shimmer)</figcaption>
          <AutoSkeleton key={`shimmer-${generation}`} isLoading skeletonKey="motion-default">
            <div className="demo-swatch" data-testid="motion-default-target" />
          </AutoSkeleton>
        </figure>

        <figure className="demo-pair-item">
          <figcaption>
            <code>animation="none"</code>
          </figcaption>
          <AutoSkeleton key={`none-${generation}`} isLoading skeletonKey="motion-none" animation="none">
            <div className="demo-swatch" data-testid="motion-none-target" />
          </AutoSkeleton>
        </figure>
      </div>

      <div className="demo-controls">
        <button
          type="button"
          className="counter"
          data-testid="motion-remount"
          onClick={() => setGeneration((g) => g + 1)}
        >
          Remount both (re-reads the preference)
        </button>
      </div>
      <p className="demo-note">
        With the preference on, the left panel stops sweeping and breathes instead: the highlight parks at the
        centre and only its opacity moves, once per clock period. That is <em>not</em> the same as{' '}
        <code>animation="none"</code>, which parks the highlight and animates nothing at all.
      </p>
    </>
  )
}
