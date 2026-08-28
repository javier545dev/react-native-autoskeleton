// examples/next/app/uncaptured/page.tsx
//
// tasks.md 8.3 / ADR-12: a `skeletonKey` that is NEVER in the capture
// registry (`autoskeleton.capture-registry.json` only declares "dashboard").
// Proves the "uncaptured skeletonKey" scenario (spec §1.8): the server
// renders the neutral generic block, the client renders the identical
// neutral generic block before any client-side traversal, and no hydration
// mismatch occurs because both rendered the SAME fallback.

import { Suspense } from 'react';
import { AutoSkeletonSSR } from 'autoskeleton/ssr';
import { manifest } from '../../generated/autoskeleton-ssr';
import { DashboardContent } from '../dashboard/DashboardContent';

// See ../dashboard/page.tsx's doc comment for why this is required.
export const dynamic = 'force-dynamic';

export default function UncapturedPage() {
  return (
    <Suspense fallback={<AutoSkeletonSSR skeletonKey="never-captured" manifest={manifest} />}>
      <DashboardContent />
    </Suspense>
  );
}
