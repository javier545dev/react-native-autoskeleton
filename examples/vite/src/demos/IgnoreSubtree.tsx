// examples/vite/src/demos/IgnoreSubtree.tsx
//
// The opt-out. Automatic detection is the whole proposition, so the escape
// hatch has to be equally cheap: mark a subtree and the sensor skips it and
// everything under it, leaving a hole in the skeleton where that content
// would have been.
//
// Two spellings of the SAME channel, both shown here because both are real
// public API:
//
//   * `<AutoSkeleton.Ignore>` — wraps with `display: contents`, so it adds no
//     box of its own and cannot change your layout;
//   * `IGNORE_ATTRIBUTE` — the exported attribute name
//     (`data-autoskeleton-ignore`), spread straight onto an element you
//     already own, with no wrapper at all.
//
// The sensor reads the attribute directly, so there is no registry to keep in
// sync and nothing to wire up in a provider.

import { useState } from 'react'
import { AutoSkeleton, IGNORE_ATTRIBUTE } from 'autoskeleton'
import { MetricsLine } from './MetricsLine'
import { useLastMetrics } from './useLastMetrics'

export function IgnoreSubtree() {
  const [isLoading, setIsLoading] = useState(true)
  const [ignoring, setIgnoring] = useState(true)
  const { metrics, onMetrics } = useLastMetrics()

  // A distinct key per mode: the snapshot cache is keyed by `skeletonKey`, so
  // reusing one key would replay the previous mode's geometry instead of
  // measuring the change you just asked for.
  const key = ignoring ? 'ignore-on' : 'ignore-off'

  const badges = (
    <div className="demo-badges">
      <span className="demo-badge">Live</span>
      <span className="demo-badge">Beta</span>
    </div>
  )

  return (
    <>
      <AutoSkeleton isLoading={isLoading} skeletonKey={key} skeletonOnRefresh onMetrics={onMetrics}>
        <article className="demo-card">
          <div className="demo-avatar" />
          <div className="demo-card-body">
            <h3 className="demo-card-title">Deploy status</h3>
            {ignoring ? <AutoSkeleton.Ignore>{badges}</AutoSkeleton.Ignore> : badges}
            <div className="demo-card-action" {...{ [IGNORE_ATTRIBUTE]: '' }}>
              Always ignored (raw attribute)
            </div>
          </div>
        </article>
      </AutoSkeleton>

      <div className="demo-controls">
        <button
          type="button"
          className="counter"
          data-testid="ignore-toggle-mode"
          onClick={() => setIgnoring((v) => !v)}
        >
          {ignoring ? 'Stop ignoring the badges' : 'Ignore the badges'}
        </button>
        <button
          type="button"
          className="counter"
          data-testid="ignore-toggle-loading"
          onClick={() => setIsLoading((v) => !v)}
        >
          {isLoading ? 'Show the real card' : 'Show the skeleton'}
        </button>
      </div>
      <MetricsLine
        metrics={metrics}
        idle="Show the real card to record a shape count, then flip the ignore mode and compare."
      />
      <p className="demo-note">
        The bottom row carries <code>IGNORE_ATTRIBUTE</code> directly and is never drawn in either mode. The
        badges above it are drawn only while ignoring is off — the shape count moves with them.
      </p>
    </>
  )
}
