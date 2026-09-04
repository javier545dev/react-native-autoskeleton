// examples/vite/src/demos/ImageHandoff.tsx
//
// An `<img>` is the case where "hide the skeleton when loading ends" is the
// wrong rule: `isLoading` flips false the moment the URL is known, but the
// browser has not decoded or painted the bitmap yet, so hiding immediately
// leaves a frame with neither the skeleton nor the image on screen.
//
// `expectsPlaceholder` (ADR-16) switches the wrapper to reveal-before-hide:
// the real element is mounted UNDERNEATH the still-painted skeleton, and the
// skeleton is removed only once the successor has actually painted —
// detected with a double-`requestAnimationFrame` plus `img.decode()`
// heuristic, with a timeout so a never-painting successor cannot strand the
// skeleton forever. Which of the two happened is reported back as
// `handoffReason`, printed below.
//
// The 1500 ms simulated fetch is the only way to make this observable on
// localhost, where a cached image arrives in the same tick as the click. The
// `?v=` bump forces a genuinely new request rather than a memory-cache hit.
// `skeletonOnRefresh` is what lets the skeleton come back at all: without it,
// REQ-PTR-1 suppresses every loading state after the first.

import { useState } from 'react'
import { AutoSkeleton } from 'autoskeleton'
import heroImg from '../assets/hero.png'
import { MetricsLine } from './MetricsLine'
import { useLastMetrics } from './useLastMetrics'

const FETCH_MS = 1500

export function ImageHandoff() {
  const [isLoading, setIsLoading] = useState(true)
  const [version, setVersion] = useState(0)
  const { metrics, onMetrics } = useLastMetrics()

  function reload() {
    setIsLoading(true)
    // The new URL only arrives when the "fetch" resolves. Until then the
    // skeleton covers the image that is already on screen.
    window.setTimeout(() => setVersion((v) => v + 1), FETCH_MS)
  }

  return (
    <>
      <AutoSkeleton
        isLoading={isLoading}
        skeletonKey="image-handoff"
        expectsPlaceholder
        skeletonOnRefresh
        onMetrics={onMetrics}
      >
        <img
          src={version === 0 ? heroImg : `${heroImg}?v=${version}`}
          className="demo-hero"
          width="170"
          height="179"
          alt=""
          onLoad={() => setIsLoading(false)}
          onError={() => setIsLoading(false)}
        />
      </AutoSkeleton>

      <div className="demo-controls">
        <button
          type="button"
          className="counter"
          data-testid="image-replay"
          disabled={isLoading}
          onClick={reload}
        >
          {isLoading ? 'Fetching…' : `Reload the image (${FETCH_MS} ms fetch)`}
        </button>
      </div>
      <MetricsLine metrics={metrics} idle="Waiting for the first image load to finish." />
      <p className="demo-note">
        <code>handoffReason</code> on the last cycle: <strong>{metrics ? metrics.handoffReason : '—'}</strong>.{' '}
        <code>successor-painted</code> means the image really did paint before the skeleton was taken away;{' '}
        <code>timeout</code> means it did not and the guard fired.
      </p>
    </>
  )
}
