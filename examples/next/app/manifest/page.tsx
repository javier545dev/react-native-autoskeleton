// examples/next/app/manifest/page.tsx
//
// Where the geometry comes from, read back from the artifact itself.
//
// Everything on this page is derived from the same `manifest.json` the demo
// routes import — not a transcription of it — so it cannot describe a capture
// that is not actually committed. If somebody re-runs the CLI with different
// buckets, this page says so without being edited.
//
// It also states the ergonomic cost openly (RISK-4): the CLI needs a declared
// `skeletonKey -> route` registry, and a route that renders the loading shape
// you want measured. That cost is real, and hiding it in a README is how a
// team discovers it at the worst possible moment.

import { manifest } from '../../generated/autoskeleton-ssr';
import { DemoShell } from '../_demo/DemoShell';
import { DemoStage, DemoReadout, DemoReadoutRow } from '../_demo/ui';

export const dynamic = 'force-dynamic';

/** The wire layout is one leading schema-version slot followed by
 *  `[x, y, w, h, r]` per shape (brief §4). Reported rather than decoded: this
 *  page is an artifact inspector, and re-implementing the decoder here would
 *  be a second copy of a format with one owner. */
const WIRE_HEADER_SLOTS = 1;
const WIRE_SLOTS_PER_SHAPE = 5;

function shapeCount(dataLength: number): number {
  return (dataLength - WIRE_HEADER_SLOTS) / WIRE_SLOTS_PER_SHAPE;
}

export default function ManifestPage() {
  const entries = [...manifest.entries].sort(
    (a, b) =>
      a.skeletonKey.localeCompare(b.skeletonKey) ||
      a.direction.localeCompare(b.direction) ||
      a.widthBucket - b.widthBucket,
  );

  return (
    <DemoShell href="/manifest">
      <DemoStage label="The artifact" live="manifest.json">
        <DemoReadout>
          <DemoReadoutRow label="schema version" value={String(manifest.v)} />
          <DemoReadoutRow label="build token" value={manifest.integrity} />
          <DemoReadoutRow label="width buckets" value={manifest.widthBuckets.join(', ')} />
          <DemoReadoutRow label="captured keys" value={manifest.capturedKeys.join(', ')} />
          <DemoReadoutRow label="entries" value={String(manifest.entries.length)} />
        </DemoReadout>
      </DemoStage>

      <DemoStage
        label="Every captured entry"
        live="manifest.entries"
        note="One row per skeletonKey × width bucket × direction. The frame and the shapes were measured by the real production DOM sensor in headless Chromium, not synthesised."
      >
        <table className="mt-3 w-full border-collapse text-left font-mono text-xs">
          <thead>
            <tr className="border-b border-ui-line">
              <th className="py-2 pr-4 font-medium text-ui-ink-3">key</th>
              <th className="py-2 pr-4 font-medium text-ui-ink-3">bucket</th>
              <th className="py-2 pr-4 font-medium text-ui-ink-3">dir</th>
              <th className="py-2 pr-4 font-medium text-ui-ink-3">frame</th>
              <th className="py-2 font-medium text-ui-ink-3">shapes</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr
                key={`${entry.skeletonKey}-${entry.widthBucket}-${entry.direction}`}
                className="border-b border-ui-line"
              >
                <td className="py-2 pr-4">{entry.skeletonKey}</td>
                <td className="py-2 pr-4">{entry.widthBucket}</td>
                <td className="py-2 pr-4">{entry.direction}</td>
                <td className="py-2 pr-4">
                  {entry.snapshot.frame[0]} × {entry.snapshot.frame[1]}
                </td>
                <td className="py-2">{shapeCount(entry.snapshot.data.length)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </DemoStage>

      <DemoStage
        label="How it was produced"
        live="npm run capture"
        note="The registry is committed next to this app as autoskeleton.capture-registry.json, and npm run capture is the command."
      >
        <pre className="mt-3 overflow-x-auto rounded-lg bg-ui-code-bg p-4 font-mono text-xs leading-6">
          {`# examples/next/autoskeleton.capture-registry.json
{ "dashboard": "/dashboard-capture" }

# with the dev server up on :3000 (npm run dev)
npm run capture`}
        </pre>
        <p className="ui-note">
          The CLI drives real headless Chromium, so it needs the optional peer{' '}
          <code className="font-mono">@playwright/test</code> and its browser binary. It writes{' '}
          <code className="font-mono">manifest.json</code> and <code className="font-mono">bundle.css</code>{' '}
          together, in one run — they are two halves of one artifact bound by the build token above, and{' '}
          <a href="/drift" className="underline underline-offset-4">
            regenerating only one of them
          </a>{' '}
          is a case the library handles rather than a case it trusts you to avoid.
        </p>
        <p className="ui-note">
          The ergonomic cost is the registry itself: one declared route per key, and that route has to render
          the loading shape you want measured (see{' '}
          <a href="/dashboard-capture" className="underline underline-offset-4">
            /dashboard-capture
          </a>
          ). There is no route auto-discovery. A key nobody declares is not a build failure — it renders{' '}
          <a href="/uncaptured" className="underline underline-offset-4">
            the neutral block
          </a>{' '}
          — so skipping the work is degraded, not broken.
        </p>
      </DemoStage>
    </DemoShell>
  );
}
