// examples/next/app/drift/page.tsx
//
// The manifest <-> CSS integrity binding, shown rather than described.
//
// `manifest.json` and `bundle.css` are two halves of one artifact. Regenerate
// one without the other and the page would, before this binding existed,
// replay geometry that no longer corresponded to the CSS it shipped with —
// silently, at every viewport. A skeleton with subtly wrong geometry is worse
// than one that does not render, because the wrong one ships.
//
// The binding is structural: the build token is baked into the generated CSS
// *selector* and stamped onto the server-rendered element. A drifted pair
// therefore cannot select, and the bundle's drift-fallback rule paints the
// ADR-12 neutral block instead.
//
// The right-hand specimen below is a REAL drifted manifest, not a mock: this
// page takes the manifest the app actually imports, changes the captured
// geometry the way a fresh capture run would, and recomputes the token with
// the library's own exported `computeSsrManifestIntegrity`. That is exactly
// the input a `manifest.json` regenerated without its `bundle.css` produces.

import { AutoSkeletonSSR, computeSsrManifestIntegrity, type AutoSkeletonSSRManifest } from 'autoskeleton/ssr';
import { manifest } from '../../generated/autoskeleton-ssr';
import { DemoShell } from '../_demo/DemoShell';
import { DemoStage } from '../_demo/ui';
import { DriftTokens } from './DriftTokens';

export const dynamic = 'force-dynamic';

/** How much taller the "newly captured" content got. Any change to the
 *  captured geometry produces a different token; 40 px is simply a value large
 *  enough to be obviously not a rounding artefact. */
const DRIFTED_HEIGHT_DELTA_PX = 40;

/** Simulates "somebody re-ran the capture, and committed only manifest.json".
 *  Same skeletonKey, same direction, same width buckets — everything the CSS
 *  selector matched on BEFORE the binding is unchanged, which is exactly why
 *  the old selector matched a stale pair happily. Only the geometry differs,
 *  and the token is a function of the geometry. */
function driftManifest(source: AutoSkeletonSSRManifest): AutoSkeletonSSRManifest {
  const entries = source.entries.map((entry) => ({
    ...entry,
    snapshot: {
      ...entry.snapshot,
      frame: [entry.snapshot.frame[0], entry.snapshot.frame[1] + DRIFTED_HEIGHT_DELTA_PX] as const,
    },
  }));
  const withoutToken: AutoSkeletonSSRManifest = { ...source, integrity: '', entries };
  return { ...withoutToken, integrity: computeSsrManifestIntegrity(withoutToken) };
}

export default function DriftPage() {
  const drifted = driftManifest(manifest);

  return (
    <DemoShell href="/drift">
      <DemoStage
        label="Matched pair"
        live="<AutoSkeleton.SSR>"
        note="The manifest this app imports, replayed against the bundle.css generated from it in the same capture run."
      >
        <div data-specimen="matched">
          <AutoSkeletonSSR skeletonKey="dashboard" manifest={manifest} direction="ltr" />
        </div>
      </DemoStage>

      <DemoStage
        label="Drifted pair"
        live="<AutoSkeleton.SSR>"
        note="Identical element, identical key and direction, one difference: its build token belongs to a manifest this stylesheet was not generated from."
      >
        <div data-specimen="drifted">
          <AutoSkeletonSSR skeletonKey="dashboard" manifest={drifted} direction="ltr" />
        </div>
      </DemoStage>

      <DriftTokens matchedToken={manifest.integrity} driftedToken={drifted.integrity} />

      <p className="ui-note">
        Note what did <em>not</em> happen. The drifted specimen did not paint the old shapes, did not stretch
        them to the new frame, and did not collapse to nothing. It fell through to the same neutral block an
        uncaptured key renders — 80 px tall, 8 px radius, no clip-path — because the drift fallback in the
        generated bundle is written with the neutral block&apos;s own dimensions rather than a second set of
        numbers that could disagree with it.
      </p>
      <p className="ui-note">
        Nothing had to be wired up for that. A consumer who never calls{' '}
        <code className="font-mono">assertSsrManifestIntegrity</code> still cannot ship the wrong geometry; the
        assertion is the loud, opt-in half that fails a build early, and this is the quiet half that holds
        regardless.
      </p>
    </DemoShell>
  );
}
