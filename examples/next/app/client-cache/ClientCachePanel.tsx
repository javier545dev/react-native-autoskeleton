'use client';

// examples/next/app/client-cache/ClientCachePanel.tsx
//
// Mounts a LIVE `<AutoSkeleton>` (the runtime component, from the `.` entry —
// not `<AutoSkeleton.SSR>`) for the same `skeletonKey` the capture CLI
// measured, and prints what `onMetrics` reports. A hit means the snapshot the
// server shipped inside `manifest.json` was found in the runtime store and
// replayed with no traversal at all.
//
// The wrapped content is deliberately the same shape `/dashboard-capture`
// presents to the capture CLI — a heading bar, a hero, two text lines, inside
// a 640 px column with 24 px of padding. A cached snapshot replays the
// geometry of the route it was measured on, so wrapping content of some other
// shape would replay a skeleton that does not fit it, and the demo would be
// quietly lying about how faithful the replay is.

import { useState } from 'react';
import { AutoSkeleton, type OnMetrics, type SkeletonMetrics } from 'autoskeleton';
import { DemoReadout, DemoReadoutRow } from '../_demo/ui';

const FETCH_MS = 2500;

function CapturedShapeContent() {
  return (
    <div style={{ padding: 24, maxWidth: 640 }}>
      <div style={{ width: 220, height: 32, marginBottom: 16 }}>
        <h3 style={{ fontSize: 24, lineHeight: '32px', margin: 0 }}>Q3 Revenue</h3>
      </div>
      <div style={{ width: '100%', height: 160, background: '#4f46e5', borderRadius: 8, marginBottom: 16 }} />
      <div style={{ width: '90%', height: 16, marginBottom: 8, background: '#e4e4e7', borderRadius: 4 }} />
      <div style={{ width: '70%', height: 16, background: '#e4e4e7', borderRadius: 4 }} />
    </div>
  );
}

export function ClientCachePanel({
  capturedBuckets,
  capturedKeys,
}: {
  capturedBuckets: readonly number[];
  capturedKeys: readonly string[];
}) {
  const [mounted, setMounted] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [metrics, setMetrics] = useState<SkeletonMetrics | null>(null);

  const onMetrics: OnMetrics = (m) => setMetrics(m);

  function mountPanel() {
    setMetrics(null);
    setMounted(true);
    setIsLoading(true);
    window.setTimeout(() => setIsLoading(false), FETCH_MS);
  }

  return (
    <>
      <div className="min-h-[320px]" data-testid="client-cache-slot">
        {mounted ? (
          <AutoSkeleton isLoading={isLoading} skeletonKey="dashboard" onMetrics={onMetrics}>
            <CapturedShapeContent />
          </AutoSkeleton>
        ) : (
          <p className="text-sm text-ui-ink-3">The panel is unmounted. Nothing has read the store yet.</p>
        )}
      </div>

      <div className="mt-6 flex gap-3">
        <button
          type="button"
          data-testid="client-cache-mount"
          disabled={mounted}
          onClick={mountPanel}
          className="rounded-full border border-ui-line-strong px-4 py-2 font-mono text-xs text-ui-ink hover:border-ui-accent hover:text-ui-accent disabled:opacity-40"
        >
          Mount the live panel
        </button>
        <button
          type="button"
          data-testid="client-cache-unmount"
          disabled={!mounted}
          onClick={() => setMounted(false)}
          className="rounded-full border border-ui-line-strong px-4 py-2 font-mono text-xs text-ui-ink hover:border-ui-accent hover:text-ui-accent disabled:opacity-40"
        >
          Unmount it
        </button>
      </div>

      <p className="ui-note">
        {mounted && metrics === null
          ? `Waiting for the ${FETCH_MS} ms cycle to finish — onMetrics reports displayDurationMs, so it fires once, when the skeleton is done, never at mount.`
          : 'onMetrics, as reported by the live panel above.'}
      </p>
      <DemoReadout>
        <DemoReadoutRow
          label="cache"
          value={
            metrics === null ? '—' : <span data-testid="client-cache-verdict">{metrics.cacheHit ? 'HIT' : 'MISS'}</span>
          }
        />
        <DemoReadoutRow
          label="traversalMs"
          value={metrics === null ? '—' : metrics.traversalMs.toFixed(2)}
        />
        <DemoReadoutRow label="shapeCount" value={metrics === null ? '—' : String(metrics.shapeCount)} />
        <DemoReadoutRow label="renderer" value={metrics === null ? '—' : metrics.renderer} />
        <DemoReadoutRow label="captured keys" value={capturedKeys.join(', ')} />
        <DemoReadoutRow label="captured width buckets" value={capturedBuckets.join(', ')} />
      </DemoReadout>

      <p className="ui-note">
        A <strong>MISS</strong> here is a correct answer, not a broken demo. The store is keyed by{' '}
        <code className="font-mono">skeletonKey</code> plus width bucket, font scale, direction and platform,
        and this app&apos;s committed capture only covers the buckets listed above. A window whose width rounds
        up to a bucket nobody captured misses, and the library measures your actual layout instead of replaying
        somebody else&apos;s — which is the whole reason the key is composite. Narrow or widen the window until
        it lands on a captured bucket, reload, and mount the panel again to see the hit.
      </p>
      <p className="ui-note">
        Note also that <code className="font-mono">onMetrics</code> reports{' '}
        <code className="font-mono">renderer: &quot;css&quot;</code>. The runtime path and the SSR path share
        one stylesheet and one shimmer implementation; the hydration bridge moves data between them, never a
        second renderer.
      </p>
    </>
  );
}
