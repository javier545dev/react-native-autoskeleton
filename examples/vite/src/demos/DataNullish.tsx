// examples/vite/src/demos/DataNullish.tsx
//
// What `data` actually means (docs/api.md §2.1). The rule is one line —
//
//     loading = isLoading is provided ? isLoading : data == null
//
// — and `== null` is loose ON PURPOSE: it is exactly nullish, `null` and
// `undefined` and nothing else. `0`, `''`, `false` and `NaN` are ordinary
// loaded values. That is the single thing about this API that is easiest to
// get wrong, and it is what this demo exists to make checkable: press
// "Deliver 0" and the skeleton leaves, because an empty cart is an answer.
//
// The child here is a plain node, not a function, which §2.1 explicitly
// allows ("use it when your content can render before the value arrives").
// That choice is load-bearing: because the content stays mounted through the
// loading state, the sensor has something real to traverse and the skeleton
// you see is measured from it — no `fallback` needed. The function-child form
// is the case that needs one, and `#/cold-fallback` is where that is the
// subject rather than the fine print.
//
// `skeletonOnRefresh` is here only so the demo is replayable. Without it,
// REQ-PTR-1 would keep the content on screen for every cycle after the first
// and there would be nothing to press twice (see `#/refresh`).

import { useState } from 'react'
import { AutoSkeleton } from 'autoskeleton'
import { MetricsLine } from './MetricsLine'
import { useLastMetrics } from './useLastMetrics'

export function DataNullish() {
  const [count, setCount] = useState<number | null>(null)
  const { metrics, onMetrics } = useLastMetrics()

  return (
    <>
      <div data-testid="data-nullish-stage">
        <AutoSkeleton
          data={count}
          skeletonKey="data-nullish"
          skeletonOnRefresh
          onMetrics={onMetrics}
        >
          <article className="demo-card">
            <div className="demo-avatar" />
            <div className="demo-card-body">
              <h3 className="demo-card-title">Your cart</h3>
              <p className="demo-card-meta" data-testid="data-nullish-line">
                {count === null ? 'Counting your items…' : `${count} items ready to check out`}
              </p>
              <div className="demo-card-action">Checkout</div>
            </div>
          </article>
        </AutoSkeleton>
      </div>

      <div className="demo-controls">
        <button
          type="button"
          className="counter"
          data-testid="data-nullish-zero"
          onClick={() => setCount(0)}
        >
          Deliver 0
        </button>
        <button
          type="button"
          className="counter"
          data-testid="data-nullish-three"
          onClick={() => setCount(3)}
        >
          Deliver 3
        </button>
        <button
          type="button"
          className="counter"
          data-testid="data-nullish-null"
          onClick={() => setCount(null)}
        >
          Back to null
        </button>
      </div>

      <p className="demo-readout" data-testid="data-nullish-readout">
        <code>data</code> = <strong>{count === null ? 'null' : String(count)}</strong> ·{' '}
        <code>data == null</code> → <strong>{String(count == null)}</strong> ·{' '}
        {count == null ? 'skeleton' : 'content'}
      </p>
      <MetricsLine metrics={metrics} idle="Deliver a count to complete a cycle and record it." />
      <p className="demo-note">
        <strong>Deliver 0</strong> and <strong>Deliver 3</strong> do the same thing to this component:
        both end the loading state. A truthiness test would have left the cart on a skeleton forever
        the moment it emptied, which is why the library tests for nullish and nothing else.
      </p>
    </>
  )
}
