// examples/vite/src/demos/ColdLoad.tsx
//
// The base case: a card this library has never seen. There is no skeleton
// markup anywhere below — the shapes come from a real DOM traversal of the
// children's own laid-out geometry (`getBoundingClientRect` /
// `getComputedStyle`), performed on the first frame of the loading state.
//
// One-way on purpose. Once the content has been shown, REQ-PTR-1's
// stale-while-revalidate default suppresses the skeleton for every later
// load of the same wrapper, so there is no honest "replay" button here;
// reload the page to see the cold path again. The refresh demo is where that
// rule is the subject rather than the fine print.

import { useState } from 'react'
import { AutoSkeleton } from 'autoskeleton'
import { MetricsLine } from './MetricsLine'
import { useLastMetrics } from './useLastMetrics'

export function ColdLoad() {
  const [isLoading, setIsLoading] = useState(true)
  const { metrics, onMetrics } = useLastMetrics()

  return (
    <>
      <AutoSkeleton isLoading={isLoading} skeletonKey="cold-load" onMetrics={onMetrics}>
        <article className="demo-card">
          <div className="demo-avatar" />
          <div className="demo-card-body">
            <h3 className="demo-card-title">Ada Lovelace</h3>
            <p className="demo-card-meta">Analytical Engine · 1843</p>
            <div className="demo-card-action">Follow</div>
          </div>
        </article>
      </AutoSkeleton>

      <div className="demo-controls">
        <button
          type="button"
          className="counter"
          data-testid="cold-load-resolve"
          disabled={!isLoading}
          onClick={() => setIsLoading(false)}
        >
          {isLoading ? 'Resolve' : 'Resolved — reload the page to see it cold again'}
        </button>
      </div>
      <MetricsLine metrics={metrics} idle="Resolve to see what the traversal actually measured." />
    </>
  )
}
