// examples/vite/src/demos/CacheReplay.tsx
//
// REQ-NAV-1: navigate away, come back, and the skeleton is drawn from the
// snapshot measured the first time — no traversal at all. The store is
// module-level and shared, so it outlives the wrapper that filled it; the
// entry is keyed by `skeletonKey` + width bucket + font scale + direction +
// platform, which is why a rotation or a font-size preference change
// correctly misses instead of replaying somebody else's geometry.
//
// The panel below really is unmounted while it is closed — this is a mount,
// not a hidden div — so the second open goes through exactly the path a
// client-side route change goes through.
//
// Note where the hit/miss decision lives: it is made once, when a wrapper
// first sees a cache key, and does not change for the life of that mounted
// component. That is why this demo unmounts, and why the refresh demo's
// repeated cycles keep reporting the value they were given at mount.

import { useState } from 'react'
import { AutoSkeleton, type OnMetrics } from 'autoskeleton'
import { MetricsLine } from './MetricsLine'
import { useLastMetrics } from './useLastMetrics'

const FETCH_MS = 900

function Panel({ isLoading, onMetrics }: { isLoading: boolean; onMetrics: OnMetrics }) {
  return (
    <AutoSkeleton isLoading={isLoading} skeletonKey="cache-replay" onMetrics={onMetrics}>
      <article className="demo-card">
        <div className="demo-avatar" />
        <div className="demo-card-body">
          <h3 className="demo-card-title">Project Kestrel</h3>
          <p className="demo-card-meta">Updated 4 minutes ago by three people</p>
          <div className="demo-card-action">Open</div>
        </div>
      </article>
    </AutoSkeleton>
  )
}

export function CacheReplay() {
  const [open, setOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const { metrics, onMetrics } = useLastMetrics()

  function openPanel() {
    setOpen(true)
    setIsLoading(true)
    window.setTimeout(() => setIsLoading(false), FETCH_MS)
  }

  return (
    <>
      <div className="demo-stage-inner" data-testid="cache-replay-slot">
        {open ? (
          <Panel isLoading={isLoading} onMetrics={onMetrics} />
        ) : (
          <p className="demo-metrics demo-metrics-idle">The panel is unmounted.</p>
        )}
      </div>

      <div className="demo-controls">
        <button
          type="button"
          className="counter"
          data-testid="cache-replay-open"
          disabled={open}
          onClick={openPanel}
        >
          Open the panel
        </button>
        <button
          type="button"
          className="counter"
          data-testid="cache-replay-close"
          disabled={!open}
          onClick={() => setOpen(false)}
        >
          Close it
        </button>
      </div>
      <MetricsLine metrics={metrics} idle="Open the panel to record its first, cold measurement." />
      <p className="demo-note">
        Open, close, open again: the second cycle reports <code>cache HIT</code> and a{' '}
        <code>0.00 ms</code> traversal, and the skeleton is on screen from its first frame.
      </p>
    </>
  )
}
