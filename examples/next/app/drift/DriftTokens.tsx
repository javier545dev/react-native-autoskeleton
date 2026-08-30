'use client';

// examples/next/app/drift/DriftTokens.tsx
//
// The three tokens involved, and what the cascade actually did with them.
//
// The stylesheet's own token is read from the `--askl-ssr-build` custom
// property it publishes on `:root` — the same value `<AutoSkeleton.SSRHydrate>`
// reads in dev builds to NAME a drift instead of leaving a developer to bisect
// why their skeleton turned into a grey rectangle. The two specimen heights
// are read back from `getComputedStyle`, so the "it degraded" claim on this
// page is a measurement, not an assertion.

import { useSyncExternalStore } from 'react';
import { DemoReadout, DemoReadoutRow } from '../_demo/DemoShell';

interface CascadeReading {
  readonly cssToken: string;
  readonly matchedHeight: string;
  readonly matchedClipPath: string;
  readonly driftedHeight: string;
  readonly driftedClipPath: string;
}

const NOT_MEASURED: CascadeReading = {
  cssToken: '—',
  matchedHeight: '—',
  matchedClipPath: '—',
  driftedHeight: '—',
  driftedClipPath: '—',
};

let current: CascadeReading = NOT_MEASURED;
const listeners = new Set<() => void>();

function readSpecimen(name: string): { height: string; clipPath: string } {
  const el = document.querySelector(`[data-specimen="${name}"] .askl-overlay`);
  if (!el) {
    return { height: '—', clipPath: '—' };
  }
  const style = getComputedStyle(el);
  return { height: style.height, clipPath: style.clipPath };
}

function measure(): CascadeReading {
  const matched = readSpecimen('matched');
  const drifted = readSpecimen('drifted');
  return {
    cssToken:
      getComputedStyle(document.documentElement)
        .getPropertyValue('--askl-ssr-build')
        .trim()
        .replace(/^["']|["']$/g, '') || '<none>',
    matchedHeight: matched.height,
    matchedClipPath: matched.clipPath === 'none' ? 'none' : `path(…) ${matched.clipPath.length} chars`,
    driftedHeight: drifted.height,
    driftedClipPath: drifted.clipPath === 'none' ? 'none' : `path(…) ${drifted.clipPath.length} chars`,
  };
}

function subscribe(onChange: () => void): () => void {
  const handler = () => {
    current = measure();
    listeners.forEach((listener) => listener());
  };
  listeners.add(onChange);
  window.addEventListener('resize', handler);
  current = measure();
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('resize', handler);
  };
}

export function DriftTokens({ matchedToken, driftedToken }: { matchedToken: string; driftedToken: string }) {
  const reading = useSyncExternalStore(
    subscribe,
    () => current,
    () => NOT_MEASURED,
  );

  return (
    <div className="mt-10 border-t border-black/[.08] pt-8 dark:border-white/[.145]">
      <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">The three tokens</h2>
      <DemoReadout>
        <DemoReadoutRow label="bundle.css (:root)" value={reading.cssToken} />
        <DemoReadoutRow label="matched manifest" value={matchedToken} />
        <DemoReadoutRow label="drifted manifest" value={driftedToken} />
      </DemoReadout>

      <h2 className="mt-8 text-sm font-medium uppercase tracking-wide text-zinc-500">
        What the cascade resolved
      </h2>
      <DemoReadout>
        <DemoReadoutRow label="matched height" value={reading.matchedHeight} />
        <DemoReadoutRow label="matched clip-path" value={reading.matchedClipPath} />
        <DemoReadoutRow label="drifted height" value={reading.driftedHeight} />
        <DemoReadoutRow label="drifted clip-path" value={reading.driftedClipPath} />
      </DemoReadout>
    </div>
  );
}
