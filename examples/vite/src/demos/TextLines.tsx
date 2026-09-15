// examples/vite/src/demos/TextLines.tsx
//
// The one place where a skeleton either looks right or looks obviously fake.
// A wrapped paragraph is ONE element with ONE bounding box, so a sensor that
// stops at `getBoundingClientRect` draws a single tall slab over it. The DOM
// sensor instead fragments the text node's `Range` via
// `Range.getClientRects()`, which returns one rect per LINE BOX the browser
// actually laid out — including the short last line, which is what makes the
// result read as text rather than as a block.
//
// This is also why the web suite is Playwright-only: jsdom implements no
// `getClientRects()` geometry at all (jsdom #653, #3729), so this behaviour
// is unobservable in a unit test.
//
// The paragraph's width is pinned in CSS (`.demo-prose`) so the line count is
// a property of the demo, not of your window. Resizing the window while the
// skeleton is on screen does NOT re-measure it — nothing subscribes to a
// resize on this path — so the count you can check is the one measured when
// the loading state began.

import { useState } from 'react'
import { AutoSkeleton } from 'autoskeleton'
import { MetricsLine } from './MetricsLine'
import { useLastMetrics } from './useLastMetrics'

export function TextLines() {
  const [isLoading, setIsLoading] = useState(true)
  const { metrics, onMetrics } = useLastMetrics()

  return (
    <>
      <AutoSkeleton isLoading={isLoading} skeletonKey="text-lines" onMetrics={onMetrics}>
        <p className="demo-prose">
          Count the bars above, then resolve: the shape count printed below is one shape per line box the
          browser laid out, measured from this paragraph's own text range. The last line is short because the
          text is short, not because a placeholder was authored that way.
        </p>
      </AutoSkeleton>

      <div className="demo-controls">
        <button
          type="button"
          className="counter"
          data-testid="text-lines-resolve"
          disabled={!isLoading}
          onClick={() => setIsLoading(false)}
        >
          {isLoading ? 'Resolve' : 'Resolved — reload to measure again'}
        </button>
      </div>
      <MetricsLine metrics={metrics} idle="Resolve to compare the bar count against the measured shape count." />
    </>
  )
}
