// examples/vite/src/demos/HiddenContent.tsx
//
// The gap this demo exists to make visible, before it is fixed.
//
// `leafShape()` in `src/web/dom-sensor.ts` already refuses to shape a leaf
// whose computed `opacity` is `0` — covering something the user cannot see
// with an opaque block draws a shape over empty space. It does not look at
// `visibility`, which appears nowhere in that file.
//
// A `visibility: hidden` element still occupies layout and still reports a
// real `getBoundingClientRect()`, so it is measured exactly like a visible
// one. The badge slot below is reserved in the layout and painted by nobody,
// and the skeleton covers it anyway.
//
// WHY THE SHAPE COUNT IS THE ASSERTION, not the screenshot. The block lands on
// a region that is empty in BOTH states, so "before" and "after" look almost
// identical while the card is loading — the honest signal is the readout: the
// hidden badge contributes a shape it should not, and the count drops by one
// when it stops.
//
// The toggle is here so the two cases sit side by side in one demo rather than
// requiring you to remember what the other one looked like.

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
