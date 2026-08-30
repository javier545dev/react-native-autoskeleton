'use client';

// examples/next/app/hydration/DeliberateMismatch.tsx
//
// A component that is WRONG on purpose, and is not part of the library.
//
// It renders one string on the server and a different one on the client, which
// is the textbook hydration mismatch. It exists so the recorder next to it has
// something to catch: proving an absence requires showing the instrument works.
//
// This is exactly what `<AutoSkeleton.SSR>` is built not to do. That component
// is a pure function of `(skeletonKey, manifest, direction)` with no hooks, no
// effects and no DOM or environment reads — so there is nothing it could read
// that would differ between the two renders. This file reads the one thing
// that always differs.

export function DeliberateMismatch() {
  const renderedOn = typeof window === 'undefined' ? 'the server' : 'the client';
  return (
    <p
      data-testid="deliberate-mismatch"
      className="rounded-lg border border-red-500/40 bg-red-500/[.08] p-4 text-sm"
    >
      This sentence was rendered on <strong>{renderedOn}</strong>. It is a deliberately broken control, not
      library behaviour — the recorder above should be reporting it.
    </p>
  );
}
