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

// `dir="rtl"` wraps BOTH halves, and that is the whole point of this route.
//
// It was missing, and the result was the exact defect this library exists to
// prevent, on the page whose job is to disprove it: `AutoSkeletonSSR` replayed
// genuinely mirrored geometry — `cli/capture.ts` sets
// `document.documentElement.dir` before measuring, so the stored snapshot really
// is right-to-left — while `<DashboardContent />`, the same component the LTR
// route renders, laid out left-to-right. The skeleton sat on the right and the
// real card appeared on the left.
//
// `AutoSkeletonSSR` cannot fix this for you and says so: its `direction` prop
// selects which captured snapshot to replay, and its own doc comment records
// that a component cannot infer the request-time locale direction on its own.
// Adopting the direction is the consuming page's job — which is precisely what
// this route is meant to demonstrate.
//
// `test/ssr/dashboard.spec.ts` now asserts the CONTENT computes to `rtl`, not
// only that the skeleton carries `data-askl-ssr-dir="rtl"`. The old assertions
// passed throughout, because a correctly wired replay and a page that never
// adopts the direction are independent facts.
export default function DashboardRtlPage() {
  return (
    <div dir="rtl">
      <Suspense fallback={<AutoSkeletonSSR skeletonKey="dashboard" manifest={manifest} direction="rtl" />}>
        <DashboardContent />
      </Suspense>
    </div>
  );
}
