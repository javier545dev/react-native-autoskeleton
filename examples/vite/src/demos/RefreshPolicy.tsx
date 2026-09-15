// examples/vite/src/demos/RefreshPolicy.tsx
//
// REQ-PTR-1, the rule that surprises people: once real content has been
// shown, a LATER `isLoading` does not draw a skeleton over it. Pull to
// refresh a feed you are already reading and the library keeps the stale
// content on screen (stale-while-revalidate) instead of blanking it out.
//
// `skeletonOnRefresh` opts out per wrapper. Both panels below get the exact
// same prop sequence at the exact same time; the only difference is that one.
//
// The suppressed side emits no metrics at all, and that is the contract, not
// an omission: no skeleton was shown, so there is no skeleton lifecycle to
// report.

import { useState } from 'react'
import { AutoSkeleton } from 'autoskeleton'
import { MetricsLine } from './MetricsLine'
import { useLastMetrics } from './useLastMetrics'

const REFRESH_MS = 1600

function Row() {
  return (
    <article className="demo-card">
      <div className="demo-avatar" />
      <div className="demo-card-body">
        <h3 className="demo-card-title">Inbox</h3>
        <p className="demo-card-meta">3 new messages · updated just now</p>
      </div>
    </article>
  )
}

export function RefreshPolicy() {
  // Starts at `false`: this demo is about what happens to content that has
  // ALREADY been shown, so there is no first-load skeleton here by design.
  const [isLoading, setIsLoading] = useState(false)
  const def = useLastMetrics()
  const optedIn = useLastMetrics()

  function refresh() {
    setIsLoading(true)
    window.setTimeout(() => setIsLoading(false), REFRESH_MS)
  }

  return (
    <>
      <div className="demo-pair">
        <figure className="demo-pair-item">
          <figcaption>Default — content stays</figcaption>
          <div data-testid="refresh-default">
            <AutoSkeleton isLoading={isLoading} skeletonKey="refresh-default" onMetrics={def.onMetrics}>
              <Row />
            </AutoSkeleton>
          </div>
          <MetricsLine metrics={def.metrics} idle="Nothing reported — the cycle was suppressed." />
        </figure>

        <figure className="demo-pair-item">
          <figcaption>
            <code>skeletonOnRefresh</code> — skeleton returns
          </figcaption>
          <div data-testid="refresh-opted-in">
            <AutoSkeleton
              isLoading={isLoading}
              skeletonKey="refresh-opted-in"
              skeletonOnRefresh
              onMetrics={optedIn.onMetrics}
            >
              <Row />
            </AutoSkeleton>
          </div>
          <MetricsLine metrics={optedIn.metrics} idle="Refresh to record a cycle." />
        </figure>
      </div>

      <div className="demo-controls">
        <button
          type="button"
          className="counter"
          data-testid="refresh-both"
          disabled={isLoading}
          onClick={refresh}
        >
          {isLoading ? `Refreshing for ${REFRESH_MS} ms…` : 'Refresh both'}
        </button>
      </div>
      <p className="demo-note">
        The left panel reports nothing however many times you refresh it. Its cycle is suppressed, so there is
        no skeleton lifecycle to measure — which is also how you can tell the content you are looking at was
        never covered.
      </p>
    </>
  )
}
