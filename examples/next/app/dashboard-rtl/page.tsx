// examples/next/app/dashboard-rtl/page.tsx
//
// tasks.md 8.3: the RTL variant of `../dashboard/page.tsx`, proving REQ-SSR-4
// (zero hydration mismatch) holds for the `direction: 'rtl'` capture too —
// spec REQ-SSR-2 requires the capture CLI to run both directions, and this
// route is what proves the REPLAY side of that pair, not just the capture
// side (which `cli/capture.test.ts` already covers).

import { Suspense } from 'react';
import { AutoSkeletonSSR } from 'autoskeleton/ssr';
import { manifest } from '../../generated/autoskeleton-ssr';
import { DashboardContent } from '../dashboard/DashboardContent';

// See ../dashboard/page.tsx's doc comment for why this is required.
export const dynamic = 'force-dynamic';

export default function DashboardRtlPage() {
  return (
    <Suspense fallback={<AutoSkeletonSSR skeletonKey="dashboard" manifest={manifest} direction="rtl" />}>
      <DashboardContent />
    </Suspense>
  );
}
