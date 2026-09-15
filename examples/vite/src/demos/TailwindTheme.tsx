// examples/vite/src/demos/TailwindTheme.tsx
//
// tasks.md 7.1 (spec REQ-THEME-1), app-level complement to
// `test/web/theme-cascade.spec.ts`: that suite proves the Tailwind v4
// COMPILER contract against a synthetic harness page; this section proves the
// same contract inside a REAL consuming app, so
// `test/web/tailwind-app-theme.spec.ts` can gate it against this app's own
// `vite build` output — PAINTED PIXELS, at every phase of the shimmer.
//
// GATED SURFACE — do not rename without updating that spec. It navigates to
// `/`, scrolls `[data-testid="themed-card"]` into view, samples the single
// `.askl-overlay` inside `[data-testid="themed-demo"]`, and clicks
// `[data-testid="toggle-theme"]`. It also asserts the built CSS still
// contains `.rounded-xl`, which is why that utility class stays on the card:
// only the real Tailwind compiler, having scanned this file, could have
// emitted it.
//
// The skeleton below receives NO colour prop of any kind and no
// `SkeletonProvider` — every colour it paints comes from the Tailwind v4
// `@theme` tokens in `src/tailwind-theme.css`, aliased onto the library's
// `--skl-base`/`--skl-highlight` contract at `:root`, and re-aliased under
// `.dark`. The theme button flips a class on `<html>`: no React prop change,
// no remount, no renderer method call.

import { useState } from 'react'
import { AutoSkeleton } from 'autoskeleton'

export function TailwindTheme() {
  const [isLoading, setIsLoading] = useState(true)
  const [dark, setDark] = useState(false)

  function toggleTheme() {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
  }

  return (
    <div className="themed-demo" data-testid="themed-demo">
      <AutoSkeleton isLoading={isLoading} skeletonKey="vite-themed-card" skeletonOnRefresh>
        {/* A single opaque block: the DOM sensor resolves it to exactly one
            shape, so the overlay's clip-path is a plain rounded rect and the
            gate has an unambiguous sampling target at its centre. */}
        <div data-testid="themed-card" className="themed-card rounded-xl" />
      </AutoSkeleton>

      <div className="demo-controls">
        <button
          type="button"
          className="counter"
          data-testid="toggle-themed-loading"
          onClick={() => setIsLoading((v) => !v)}
        >
          {isLoading ? 'Show the real card' : 'Show the skeleton'}
        </button>
        <button type="button" className="counter" data-testid="toggle-theme" onClick={toggleTheme}>
          {dark ? 'Light theme' : 'Dark theme'}
        </button>
      </div>
      <p className="demo-note">
        Tailwind v4 only preserves NAMESPACED custom properties out of an <code>@theme</code> block, so the
        tokens are declared as <code>--color-skl-base</code> and aliased onto the library's contract names at{' '}
        <code>:root</code>. See <code>src/tailwind-theme.css</code>.
      </p>
    </div>
  )
}
