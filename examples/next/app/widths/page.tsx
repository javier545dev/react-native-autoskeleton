// examples/next/app/widths/page.tsx
//
// REQ-SSR-3, made visible: one server-rendered payload that is correct at
// every width. The server emits exactly the same markup no matter who asked;
// the CSS bundle carries one `@media` block per captured width bucket, and the
// BROWSER selects. That is the whole reason the server never has to guess a
// viewport, and it is the mechanism REQ-SSR-4's zero-hydration-mismatch claim
// rests on — a server that guessed would sometimes guess wrong.
//
// The specimen below is rendered DIRECTLY rather than as a `<Suspense>`
// fallback. Same component, same attributes, same CSS rule; the only
// difference is that nothing swaps it out, which is what makes it possible to
// drag the window and watch the same element re-shape. `/dashboard` is the
// real Suspense-boundary route.

import { AutoSkeletonSSR } from 'autoskeleton/ssr';
import { manifest } from '../../generated/autoskeleton-ssr';
import { DemoShell, DemoStage } from '../_demo/DemoShell';
import { WidthReadout } from './WidthReadout';

export const dynamic = 'force-dynamic';

export default function WidthsPage() {
  // Read straight off the manifest this app imports, never a transcription:
  // if a capture run changes the buckets, this table changes with it.
  const ltrEntries = [...manifest.entries]
    .filter((entry) => entry.direction === 'ltr')
    .sort((a, b) => a.widthBucket - b.widthBucket);

  return (
    <DemoShell href="/widths">
      <DemoStage
        label="The specimen"
        note="One <AutoSkeleton.SSR skeletonKey=&quot;dashboard&quot;>, server-rendered once. Resize the window."
      >
        <AutoSkeletonSSR skeletonKey="dashboard" manifest={manifest} direction="ltr" />
      </DemoStage>

      <DemoStage
        label="Measured in your browser"
        note="Read from getComputedStyle on the element above, so these are the numbers the cascade actually resolved — not numbers this page was told to print."
      >
        <WidthReadout />
      </DemoStage>

      <DemoStage
        label="What was captured"
        note="Every LTR entry in the manifest. The frame is the real geometry the DOM sensor measured on /dashboard-capture at that viewport, in a real headless browser."
      >
        <table className="mt-3 w-full border-collapse text-left font-mono text-xs">
          <thead>
            <tr className="border-b border-black/[.08] dark:border-white/[.145]">
              <th className="py-2 pr-4 font-medium text-zinc-500">width bucket</th>
              <th className="py-2 pr-4 font-medium text-zinc-500">captured frame</th>
              <th className="py-2 font-medium text-zinc-500">cache key</th>
            </tr>
          </thead>
          <tbody>
            {ltrEntries.map((entry) => (
              <tr key={entry.widthBucket} className="border-b border-black/[.04] dark:border-white/[.08]">
                <td className="py-2 pr-4">{entry.widthBucket}px</td>
                <td className="py-2 pr-4">
                  {entry.snapshot.frame[0]} × {entry.snapshot.frame[1]}
                </td>
                <td className="break-all py-2 text-zinc-500">{entry.snapshot.key}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-4 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          The ranges are contiguous and cover every width: the smallest captured bucket owns everything at or
          below it, the largest owns everything above it, and each bucket in between owns the band up to its
          own value. That mirrors the runtime&apos;s own bucketing rule — &ldquo;the smallest bucket at least as
          wide as you&rdquo; — so a browser 200 px wider than the largest capture still gets that
          capture&apos;s geometry rather than nothing at all.
        </p>
      </DemoStage>
    </DemoShell>
  );
}
