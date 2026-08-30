// examples/vite/src/demos/MetricsLine.tsx
//
// The readout every demo shares. It prints the REAL `SkeletonMetrics` object
// the library handed back — shape count, traversal time, cache hit — so a
// claim like "this measured your layout" is something you can check rather
// than something this app asserts.

import type { SkeletonMetrics } from 'autoskeleton'

export function MetricsLine({
  metrics,
  idle = 'No completed loading cycle yet.',
}: {
  metrics: SkeletonMetrics | null
  idle?: string
}) {
  if (!metrics) {
    return <p className="demo-metrics demo-metrics-idle">{idle}</p>
  }
  return (
    <p className="demo-metrics">
      <strong>{metrics.shapeCount}</strong> shapes ·{' '}
      <strong>{metrics.traversalMs.toFixed(2)} ms</strong> traversal ·{' '}
      <strong>{metrics.cacheHit ? 'cache HIT' : 'cache MISS'}</strong> ·{' '}
      {metrics.renderer} renderer
    </p>
  )
}
