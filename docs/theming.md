# Theming

`autoskeleton` ships **one** theming interop: `autoskeleton/uniwind`. This
document explains what it does, and why NativeWind is an explicit,
documented non-goal rather than a "coming soon" gap.

## The core sensor is styling-agnostic, always

`src/core/` never imports a styling library and never parses a `className`
string — this is statically asserted by
`test/packaging/core-styling-agnostic.test.ts` (spec REQ-THEME-3). Every
theming interop operates purely at the React **props** layer, upstream of
`<AutoSkeleton>`'s own render path. You can theme `autoskeleton` with zero
interop at all, just by passing `shimmerBaseColor` /
`shimmerHighlightColor` / `defaultRadius` directly:

```tsx
<AutoSkeleton
  isLoading={isLoading}
  skeletonKey="product-card"
  shimmerBaseColor="#1e293b"
  shimmerHighlightColor="#334155"
  defaultRadius={12}
/>
```

`autoskeleton/uniwind` exists purely to let you set those same three props
from ONE Tailwind `className` instead.

## `autoskeleton/uniwind`

```tsx
import { ThemedAutoSkeleton } from 'autoskeleton/uniwind';

<ThemedAutoSkeleton
  className="bg-slate-200 rounded-lg"
  isLoading={isLoading}
  skeletonKey="product-card"
/>;
```

`ThemedAutoSkeleton` wraps the native `<AutoSkeleton>` with `uniwind`'s
`withUniwind(Component, options)` manual-mapping API, resolving:

| Resolved from `className` | Style property | Mapped prop |
|---|---|---|
| `bg-*` | `backgroundColor` | `shimmerBaseColor` |
| `text-*` | `color` | `shimmerHighlightColor` |
| `rounded-*` | `borderRadius` | `defaultRadius` |

This mapping was verified on a real Android emulator (task 7.2): the
rendered shimmer gradient genuinely matched `bg-slate-400`/`text-cyan-300`,
not the library's JS defaults.

**Requirements**: `uniwind` (>= 1.11.0, `uni-stack/uniwind`) and
`tailwindcss` v4 (`@theme` CSS-first syntax) as peer dependencies. Neither
is a hard dependency of `autoskeleton` itself — `autoskeleton/uniwind` is an
optional subpath export; if you never import it, you never need `uniwind`
installed at all.

## NativeWind — explicit non-goal, not a gap

`autoskeleton` does **not** support NativeWind, and this is a deliberate,
evidence-backed decision (plan.md ADR-17), not an oversight:

1. **NativeWind 4.2.6 hard-requires Tailwind CSS v3.** Verified directly
   from the published package: it throws `"NativeWind only supports
   Tailwind CSS v3"` at Metro config load if Tailwind v4 is installed —
   unconditional, not a configuration mistake you can work around.
2. This project's entire theming story is Tailwind **v4** (`@theme`,
   CSS custom properties). A NativeWind consumer is, by construction, a
   Tailwind v3 consumer — the two are incompatible at the root.
3. **`uniwind` and `nativewind` cannot even share one `node_modules` tree**
   — they require conflicting Tailwind CSS majors. A project using
   NativeWind for the rest of its UI cannot install `autoskeleton/uniwind`
   alongside it without a broken build.

If your app already uses NativeWind, use `autoskeleton`'s prop-level API
directly (`shimmerBaseColor`/`shimmerHighlightColor`/`defaultRadius`) —
those props work with any styling approach, since they are plain React
props with no interop involved. If a future NativeWind major drops the
Tailwind v3 requirement, this decision should be revisited (ADR-17 says so
explicitly) — it is a measured-fact decision, not a permanent ideological
one.

## `uniwind` is not NativeWind's engine

One easy mix-up: `uniwind` (`uni-stack/uniwind`, from the Unistyles team)
and NativeWind are two **independent, competing** projects — `uniwind` is
not "NativeWind under a different name," and NativeWind's own engine is a
separate package, `react-native-css`. `autoskeleton/uniwind` integrates
with `uniwind` specifically.
