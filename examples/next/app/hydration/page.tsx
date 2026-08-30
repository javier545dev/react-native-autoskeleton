// examples/next/app/hydration/page.tsx
//
// REQ-SSR-4 — zero hydration mismatch — is the library's headline SSR claim
// and the one nothing in this app has ever SHOWN. The test suite proves it
// three ways; a reader has had to take it on trust.
//
// The problem with demonstrating it is that the evidence is an absence. So
// this route ships an instrument and a control: the recorder is installed
// before hydration starts and reports what React said, and `?mismatch=1` adds
// a deliberately broken sibling that makes the same recorder fill up
// immediately. Same page, same recorder, one element changed.
//
// The skeleton itself is a real `<Suspense>` boundary with a long fallback
// window, so the recording happens while a server-rendered skeleton is
// genuinely on screen and genuinely hydrating — not before the interesting
// part or after it.

import { Suspense } from 'react';
import { AutoSkeletonSSR } from 'autoskeleton/ssr';
import { manifest } from '../../generated/autoskeleton-ssr';
import { DemoShell, DemoStage } from '../_demo/DemoShell';
import { DeliberateMismatch } from './DeliberateMismatch';
import { HydrationConsole } from './HydrationConsole';

export const dynamic = 'force-dynamic';

/** Long enough that the skeleton is still on screen while React hydrates the
 *  page around it, which is the window the claim is actually about. */
const FALLBACK_WINDOW_MS = 6000;

async function SettledContent() {
  await new Promise((resolve) => setTimeout(resolve, FALLBACK_WINDOW_MS));
  return (
    <div className="rounded-lg border border-black/[.08] p-4 dark:border-white/[.145]">
      <h3 className="text-base font-medium">Content, finally</h3>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        The boundary resolved on the server and this replaced the skeleton above.
      </p>
    </div>
  );
}

export default async function HydrationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = (await searchParams).mismatch;
  const showMismatch = (Array.isArray(raw) ? raw[0] : raw) === '1';

  return (
    <DemoShell href="/hydration">
      <DemoStage
        label="What React said"
        note="Recorded from a client chunk that runs before hydrateRoot, and kept at module scope so a hydration failure cannot erase its own evidence."
      >
        <HydrationConsole />
      </DemoStage>

      {showMismatch ? (
        <DemoStage
          label="The control (deliberately broken)"
          note="A component that renders different text on the server and the client. Not the library — the point is that the recorder catches it."
        >
          <DeliberateMismatch />
        </DemoStage>
      ) : (
        <DemoStage
          label="The control"
          note="Not currently mounted. Append ?mismatch=1 to add a component that genuinely mismatches, and watch the recorder above fill up."
        >
          <p className="text-sm text-zinc-500">No control mounted.</p>
        </DemoStage>
      )}

      <DemoStage
        label="A real server-rendered skeleton, hydrating"
        note={`<AutoSkeleton.SSR skeletonKey="dashboard"> as a Suspense fallback, held for ${FALLBACK_WINDOW_MS} ms.`}
      >
        <Suspense fallback={<AutoSkeletonSSR skeletonKey="dashboard" manifest={manifest} direction="ltr" />}>
          <SettledContent />
        </Suspense>
      </DemoStage>

      <p className="mt-10 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
        The reason the skeleton contributes nothing to that list is structural rather than careful:{' '}
        <code className="font-mono">&lt;AutoSkeleton.SSR&gt;</code> has no hooks, no effects and reads nothing
        from the DOM or the environment. It is a pure function of its props, so the server render and the
        client&apos;s pre-hydration render compute the same output because there is nothing else either of them
        could consult. The geometry arrives entirely through CSS the browser selects afterwards.
      </p>
    </DemoShell>
  );
}
