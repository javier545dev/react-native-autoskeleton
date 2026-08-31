// examples/next/app/streaming/page.tsx
//
// Three `<Suspense>` boundaries in one document, resolving at different times,
// in a response that is still streaming. This is the case that only exists on
// the server: the browser is painting skeletons the server sent, replacing
// them as later chunks of the SAME response arrive, before any of it has
// hydrated. There is no client-side state machine here to look at, and no
// button that could reproduce it.
//
// The third boundary deliberately uses a skeletonKey that is NOT in the
// capture registry, so both halves of ADR-12 are on screen simultaneously:
// two captured replays and one neutral generic block, all server-rendered,
// all in the same stream.
//
// `?delay=<ms>` shifts every boundary by the same amount — the honest control
// (see ../dashboard/DashboardContent.tsx). A client button could not hold
// these on screen: by the time the browser has JavaScript, the swaps are done.

import { Suspense } from 'react';
import { AutoSkeletonSSR } from 'autoskeleton/ssr';
import { manifest } from '../../generated/autoskeleton-ssr';
import { DemoShell } from '../_demo/DemoShell';
import { DemoStage } from '../_demo/ui';

// Without this Next resolves every boundary AT BUILD TIME and serves finished
// HTML, which would make this route unable to show a single thing it claims.
export const dynamic = 'force-dynamic';

const MAX_EXTRA_DELAY_MS = 15_000;

const BOUNDARIES = [
  { skeletonKey: 'dashboard', label: 'Revenue', delayMs: 800 },
  { skeletonKey: 'dashboard', label: 'Pipeline', delayMs: 2600 },
  { skeletonKey: 'stream-uncaptured', label: 'Forecast (uncaptured key)', delayMs: 4400 },
] as const;

/** Clamped: this is a demo control, not a way to pin a server thread open. */
function resolveExtraDelayMs(raw: string | string[] | undefined): number {
  const value = Number(Array.isArray(raw) ? raw[0] : raw);
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.min(value, MAX_EXTRA_DELAY_MS);
}

async function StreamedPanel({ label, delayMs }: { label: string; delayMs: number }) {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  return (
    <div className="rounded-lg border border-ui-line p-4">
      <h3 className="text-base font-medium">{label}</h3>
      <p className="mt-1 text-sm text-ui-ink-2">
        This chunk finished on the server after {delayMs} ms and was streamed into the boundary above.
      </p>
    </div>
  );
}

export default async function StreamingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const extraMs = resolveExtraDelayMs((await searchParams).delay);

  return (
    <DemoShell href="/streaming">
      {BOUNDARIES.map((boundary) => (
        <DemoStage
          key={boundary.label}
          label={boundary.label}
          live="<AutoSkeleton.SSR>"
          note={`Resolves after ${boundary.delayMs + extraMs} ms · skeletonKey="${boundary.skeletonKey}"`}
        >
          <Suspense
            fallback={<AutoSkeletonSSR skeletonKey={boundary.skeletonKey} manifest={manifest} direction="ltr" />}
          >
            <StreamedPanel label={boundary.label} delayMs={boundary.delayMs + extraMs} />
          </Suspense>
        </DemoStage>
      ))}

      <p className="ui-note">
        Every skeleton above arrived in the first flush of the response and was replaced by a later flush of the
        same response. Nothing on this page decides when to show a skeleton — the boundary does, and the
        boundary is resolved by the server.
      </p>
    </DemoShell>
  );
}
