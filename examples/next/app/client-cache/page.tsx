// examples/next/app/client-cache/page.tsx
//
// The other half of the SSR story, and the one nothing else in this app shows.
//
// `app/layout.tsx` mounts `<AutoSkeleton.SSRHydrate manifest={manifest} />`
// once, globally. On the client it imports every build-time-captured snapshot
// into the RUNTIME ShapeStore — the same store a live `<AutoSkeleton>` reads.
// So a client-side navigation later in the session that mounts a live
// `<AutoSkeleton skeletonKey="dashboard">` does not walk the DOM: the
// measurement already arrived with the page.
//
// The panel is mounted by a button rather than server-rendered, and that is
// the honest framing, not a convenience. `cacheHit` is decided during RENDER,
// and the hydration bridge fills the store in an EFFECT — so a skeleton
// rendered in the same first pass as the bridge would legitimately miss. The
// case this demonstrates is the one the architecture actually claims: a mount
// that happens after hydration, which is what a client-side route change is.

import { manifest } from '../../generated/autoskeleton-ssr';
import { DemoShell } from '../_demo/DemoShell';
import { DemoStage } from '../_demo/ui';
import { ClientCachePanel } from './ClientCachePanel';

export const dynamic = 'force-dynamic';

export default function ClientCachePage() {
  const capturedBuckets = [...new Set(manifest.entries.map((entry) => entry.widthBucket))].sort(
    (a, b) => a - b,
  );

  return (
    <DemoShell href="/client-cache">
      <DemoStage
        label="A live AutoSkeleton, mounted after hydration"
        live="<AutoSkeleton>"
        note="The runtime component, not the SSR one — same skeletonKey, reading the store the hydration bridge already filled."
      >
        <ClientCachePanel capturedBuckets={capturedBuckets} capturedKeys={[...manifest.capturedKeys]} />
      </DemoStage>
    </DemoShell>
  );
}
