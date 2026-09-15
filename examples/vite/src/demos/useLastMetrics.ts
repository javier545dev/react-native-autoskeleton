// examples/vite/src/demos/useLastMetrics.ts
//
// `onMetrics` (REQ-OBS-METRICS-1) fires exactly ONCE per completed loading
// cycle, when the handoff controller settles — never while the skeleton is
// still on screen. So every readout in this app appears AFTER you resolve a
// demo, not during it. That is the real contract, not a limitation of the
// demo: a metric like `displayDurationMs` cannot exist until the display has
// ended.
//
// A suppressed cycle (REQ-PTR-1's stale-while-revalidate default) emits
// NOTHING at all, deliberately — no skeleton was shown, so there is no
// skeleton lifecycle to report. The refresh demo relies on exactly that.

import { useState } from 'react'
import type { SkeletonMetrics } from 'autoskeleton'

export function useLastMetrics(): {
  metrics: SkeletonMetrics | null
  onMetrics: (m: SkeletonMetrics) => void
} {
  const [metrics, setMetrics] = useState<SkeletonMetrics | null>(null)
  return { metrics, onMetrics: setMetrics }
}
