// examples/vite/src/demos/CssVariableTheme.tsx
//
// The theming contract, at its lowest level: two CSS custom properties,
// `--skl-base` and `--skl-highlight`, read through the normal cascade.
//
// The renderer writes NO inline colour while the theme is still the library's
// default — it leaves the properties alone so the stylesheet's
// `var(--skl-base, #e2e2e2)` fallback, and anything you declared above it,
// resolves the colour. That is why scoping the variables to a wrapper is
// enough here: no prop, no provider, no re-render, no renderer call.
//
// (An inline style set by the renderer would beat any stylesheet rule, which
// is exactly what happens if you DO customise the theme through
// `SkeletonProvider`. The two mechanisms are deliberate opposites: the
// cascade for CSS-driven themes, an inline override for JS-driven ones.)

import type { CSSProperties } from 'react'
import { useState } from 'react'
import { AutoSkeleton } from 'autoskeleton'

// `--*` custom properties are not part of `CSSProperties`, so the cast is the
// standard way to write them from React.
const OCEAN = { '--skl-base': '#0f3d5c', '--skl-highlight': '#7fd4ff' } as CSSProperties
const EMBER = { '--skl-base': '#5c1f0f', '--skl-highlight': '#ffb37f' } as CSSProperties

export function CssVariableTheme() {
  const [isLoading, setIsLoading] = useState(true)

  return (
    <>
      <div className="demo-pair">
        <figure className="demo-pair-item" style={OCEAN} data-testid="theme-scope-ocean">
          <figcaption>
            <code>--skl-base: #0f3d5c</code>
          </figcaption>
          <AutoSkeleton isLoading={isLoading} skeletonKey="css-var-ocean" skeletonOnRefresh>
            <div className="demo-swatch" />
          </AutoSkeleton>
        </figure>

        <figure className="demo-pair-item" style={EMBER} data-testid="theme-scope-ember">
          <figcaption>
            <code>--skl-base: #5c1f0f</code>
          </figcaption>
          <AutoSkeleton isLoading={isLoading} skeletonKey="css-var-ember" skeletonOnRefresh>
            <div className="demo-swatch" />
          </AutoSkeleton>
        </figure>

        <figure className="demo-pair-item" data-testid="theme-scope-default">
          <figcaption>No scoped variables — inherits :root</figcaption>
          <AutoSkeleton isLoading={isLoading} skeletonKey="css-var-default" skeletonOnRefresh>
            <div className="demo-swatch" />
          </AutoSkeleton>
        </figure>
      </div>

      <div className="demo-controls">
        <button
          type="button"
          className="counter"
          data-testid="css-var-toggle"
          onClick={() => setIsLoading((v) => !v)}
        >
          {isLoading ? 'Show the real cards' : 'Show the skeletons'}
        </button>
      </div>
      <p className="demo-note">
        Three identical components, three different skeleton colours, zero props. The only difference between
        them is which element they are nested inside. The third card declares nothing of its own, so it
        inherits whatever <code>:root</code> says — in this app that is the Tailwind token from the theming
        demo, not the library's own <code>#e2e2e2</code> default.
      </p>
    </>
  )
}
