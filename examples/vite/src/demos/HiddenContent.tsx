// examples/vite/src/demos/HiddenContent.tsx
//
// `visibility: hidden` content is not measured, and the shape count is how you
// see it.
//
// `leafShape()` in `src/web/dom-sensor.ts` refuses to shape a leaf whose
// computed `opacity` is `0` — covering something the reader cannot see with an
// opaque block draws a shape over empty space. `visibility` is the same mistake
// by a different property, and until recently it was not checked at all: a
// hidden element keeps its box and reports a real `getBoundingClientRect()`, so
// it was measured exactly like a visible one.
//
// WHY THE COUNT IS THE ASSERTION AND NOT THE SCREENSHOT. The badge's slot is
// empty in both states, so the two look nearly identical while the card loads.
// The honest signal is the readout: hidden gives one shape fewer than visible.
// Toggle it and watch the number move.
//
// THIS DEMO IS ALSO THE REASON THE FIX IS COMPLETE. Guarding only `leafShape`
// left the hidden badge still counted here, because `traverse` sends text
// leaves to `textLeafShapes` before `leafShape` is ever reached and the badge is
// a `<span>`. Reading the diff did not show that; running this page did. Both
// paths are guarded now, and `test/web/visibility-hidden.spec.ts` gates each
// one separately so neither can be dropped quietly.
//
// One leaf-level check per path is complete and needs no container-level
// counterpart: `visibility` inherits and `getComputedStyle` resolves that
// before the sensor reads it, so a leaf inside a hidden container computes
// `hidden` too — while a leaf that sets `visibility: visible` inside one still
// computes `visible` and is still shaped, which is asserted.

import { useState } from 'react'
import { AutoSkeleton } from 'autoskeleton'
import { MetricsLine } from './MetricsLine'
import { useLastMetrics } from './useLastMetrics'

interface Person {
  readonly name: string
  readonly meta: string
}

const PERSON: Person = { name: 'Ada Lovelace', meta: 'Analytical Engine · 1843' }

export function HiddenContent() {
  const [isLoading, setIsLoading] = useState(true)
  const [hideBadge, setHideBadge] = useState(true)
  const { metrics, onMetrics } = useLastMetrics()

  // Remounting on every toggle is deliberate: REQ-PTR-1 suppresses the
  // skeleton for a wrapper that has already shown content, so without a fresh
  // `skeletonKey` the second measurement would never happen and the readout
  // would be stale rather than wrong — which is a far more confusing way to
  // fail than showing the real number.
  const key = `hidden-content-${hideBadge ? 'hidden' : 'visible'}`

  return (
    <>
      <AutoSkeleton key={key} skeletonKey={key} isLoading={isLoading} onMetrics={onMetrics}>
        <article className="demo-card">
          <div className="demo-avatar" />
          <div className="demo-card-body">
            <h3 className="demo-card-title">{PERSON.name}</h3>
            <p className="demo-card-meta">{PERSON.meta}</p>
            {/* Not conditional rendering: the element is always in the tree and
                always occupies its box. `visibility` is the only difference,
                which is exactly the case the sensor does not consider. */}
            <span
              data-testid="hidden-badge"
              className="demo-badge"
              style={{ visibility: hideBadge ? 'hidden' : 'visible' }}
            >
              verified
            </span>
          </div>
        </article>
      </AutoSkeleton>

      <div className="demo-controls">
        <button
          type="button"
          className="counter"
          data-testid="hidden-content-resolve"
          disabled={!isLoading}
          onClick={() => setIsLoading(false)}
        >
          {isLoading ? 'Resolve' : 'Resolved — toggle the badge to measure again'}
        </button>
        <button
          type="button"
          className="counter"
          data-testid="hidden-content-toggle"
          onClick={() => {
            setHideBadge(v => !v)
            setIsLoading(true)
          }}
        >
          {hideBadge ? 'Badge is visibility: hidden' : 'Badge is visible'}
        </button>
      </div>

      <MetricsLine
        metrics={metrics}
        idle="Resolve to see how many shapes the traversal measured."
      />
    </>
  )
}
