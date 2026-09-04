# API reference

Every name below was checked against `src/index.native.ts`, `src/index.web.ts`,
`src/index.ssr.ts`, `src/index.skia.ts`, `src/interop/uniwind.ts` and
`package.json#exports` — not from memory. Where a symbol exists on one platform
only, the table says so.

For *why* a gap exists and what it costs you, see
[`platform-support.md`](./platform-support.md).

---

## 1. Entry points

`package.json#exports` publishes five subpaths. The root (`.`) resolves to a
**different file per platform condition**, which is why the exported set is not
the same everywhere.

| Import specifier | Condition | Resolves to | Exports |
|---|---|---|---|
| `autoskeleton` | `react-native` | `index.native.js` | Core + virtualized-list API + native error types |
| `autoskeleton` | `browser` | `index.web.js` | Core + `IGNORE_ATTRIBUTE` |
| `autoskeleton` | `default` | `index.js` | Re-exports the web entry verbatim |
| `autoskeleton/skia` | any | `index.skia.js` | Tier-2 opt-in factory. **Native only** |
| `autoskeleton/uniwind` | any | `interop/uniwind.js` | `ThemedAutoSkeleton`. **Native only** |
| `autoskeleton/ssr` | any | `index.ssr.js` | Server-render replay. **Web only** |
| `autoskeleton/cli` | any | `dist-cli/index.js` | Build-time capture API |

There is also a binary: `autoskeleton-capture`.

### What each entry exports

**`autoskeleton` (web / default)**

```ts
export { AutoSkeleton, SkeletonProvider, IGNORE_ATTRIBUTE };
export type {
  AutoSkeletonProps, SkeletonProviderProps,
  AnimationKind, DegradationFlag, HandoffReason, OnMetrics, Platform,
  RadiusSource, RendererKind, ShapeInfo, ShapeSnapshot, ShapeSource,
  SkeletonMetrics,
};
```

**`autoskeleton` (react-native)** — everything above except `IGNORE_ATTRIBUTE`,
plus:

```ts
export { SkeletonList, SkeletonListFooter, SkeletonCell, useSkeletonCell };
export { AutoskeletonNativeModuleUnavailableError,
         AUTOSKELETON_NATIVE_MODULE_UNAVAILABLE_DOCS_URL };
export { templateTraversalCounter }; // dev/test seam, not a stable API
export type {
  SkeletonListProps, SkeletonListFooterProps, SkeletonCellProps,
  UseSkeletonCellOptions, UseSkeletonCellResult,
  SkeletonOverlayComponent, SkeletonOverlayProps,
};
```

**`autoskeleton/skia`**

```ts
export { createSkiaOverlay, staggerDelayForIndex,
         TIER2_SHIMMER_ORIGIN_MS, tier2PhaseAt };
export type { SkiaModule, ReanimatedModule, Tier2Peers,
              SkeletonOverlayComponent, SkeletonOverlayProps };
```

**`autoskeleton/uniwind`**

```ts
export { ThemedAutoSkeleton };
export type { AutoSkeletonProps };
```

**`autoskeleton/ssr`**

```ts
export { AutoSkeletonSSR, AutoSkeletonSSRHydrate };
export { isReplayableManifest, SSR_MANIFEST_VERSION };
export { assertSsrManifestIntegrity, computeSsrManifestIntegrity,
         SSR_BUILD_ATTRIBUTE, SSR_BUILD_CSS_VARIABLE };
export type { AutoSkeletonSSRProps, AutoSkeletonSSRHydrateProps,
              AutoSkeletonSSRManifest, AutoSkeletonSSRManifestEntry };
```

**`autoskeleton/cli`**

```ts
export { runCapture, CaptureFailedError };
export { isReplayableManifest, SSR_MANIFEST_VERSION };
export { assertSsrManifestIntegrity, computeSsrManifestIntegrity,
         SSR_BUILD_ATTRIBUTE, SSR_BUILD_CSS_VARIABLE };
export { bucketRanges, buildSsrCssBundle };
export type { CaptureRegistry, RunCaptureOptions, RunCaptureResult,
              CaptureReport, AutoSkeletonSSRManifest,
              AutoSkeletonSSRManifestEntry, BucketRange,
              BuildSsrCssBundleOptions };
```

> **Two types are not exported and you will notice.** `SkeletonTheme` (the
> shape of `SkeletonProvider`'s `theme` prop) and `Direction` (the type of
> `AutoSkeletonSSR`'s `direction` prop) are internal. Pass an object literal
> and a `'ltr'`/`'rtl'` string literal respectively; both infer correctly. This
> is a real gap in the published type surface, not a design intent.

---

## 2. `<AutoSkeleton>`

The one component you need for the simple case. Wrap the subtree whose loading
state you want to skeletonize.

```tsx
<AutoSkeleton skeletonKey="product-card" data={product} fallback={<CardSkeleton />}>
  {(product) => <ProductContent product={product} />}
</AutoSkeleton>
```

The older form still works, unchanged, and is still the right one whenever
loading is not simply "the value has not arrived":

```tsx
<AutoSkeleton isLoading={isFetching} skeletonKey="product-card">
  <ProductContent product={product} />
</AutoSkeleton>
```

**You must provide `isLoading` or `data`.** Providing neither is a compile
error, not a component that renders as permanently loaded — see §2.1.

### Props

| Prop | Type | Default | Platforms | Notes |
|---|---|---|---|---|
| `isLoading` | `boolean` | — | all | Required unless `data` is given. Wins over `data` when both are. |
| `data` | `T` | — | all | Required unless `isLoading` is given. **Nullish** (`null`/`undefined`) means loading; nothing else does. |
| `fallback` | `ReactNode` | — | all | Rendered only on a cold miss. **Read §2.2 before assuming when that is.** |
| `skeletonKey` | `string` | required | all | Identifies the cached geometry. Part of the composite cache key. |
| `itemType` | `string` | — | all | Second cache-key segment. Use it when one `skeletonKey` covers several shapes of content. |
| `animation` | `'shimmer' \| 'pulse' \| 'none'` | `'shimmer'` | all | See [`animation.md`](./animation.md). |
| `delay` | `number` (ms) | `0` | all | Withholds the skeleton until `delay` has elapsed in this loading cycle. A load that resolves sooner never shows one. |
| `skeletonOnRefresh` | `boolean` | `false` | all | Opts out of the REQ-PTR-1 default. **Read §2.3 — this surprises everyone.** |
| `onMetrics` | `(m: SkeletonMetrics) => void` | — | all | Fires once per *completed, non-suppressed* cycle. |
| `debugOverlay` | `boolean` | `false` | **web only draws** | Accepted everywhere; only web renders it. Also gated on a non-production build. |
| `expectsPlaceholder` | `boolean` | `false` | all | Tells the handoff there is a successor visual to wait for. |
| `onSuccessorPainted` | `() => void` | — | web fires it | On native nothing calls it today. |
| `shimmerBaseColor` | `string` | — | **native only** | Per-instance theme override. |
| `shimmerHighlightColor` | `string` | — | **native only** | Per-instance theme override. |
| `defaultRadius` | `number` | — | **native only** | Per-instance theme override. See the Android caveat in [`platform-support.md` §5d](./platform-support.md). |
| `children` | `ReactNode`, or `(value: NonNullable<T>) => ReactNode` with `data` | — | all | The function form is only available in the `data` form. |

The three theme-override props are declared on the **native**
`AutoSkeletonProps` only. The web `AutoSkeletonProps` does not have them — on
web you theme through CSS custom properties or the `SkeletonProvider` theme.

`isLoading`, `data`, `fallback` and the function child are identical in name
and in behaviour on web and native. `AutoSkeletonSSR` does **not** have any of
them; its fallback story is the captured manifest (§6).

### 2.1 `data`, and which prop decides "loading"

```
loading = isLoading is provided ? isLoading : data == null
```

- **Only nullish data means loading.** `null` and `undefined`, and nothing
  else. `0`, `''`, `false` and `NaN` are ordinary loaded values —
  `<AutoSkeleton data={cartItemCount}>` must not sit on a skeleton the moment
  the cart empties. This is the one rule here that is easy to get wrong.
- **`isLoading` always wins.** It is the escape hatch for everything `data`
  cannot express: an `isFetching` flag from a data library, a state derived
  from several sources, a skeleton shown deliberately. Passing both is legal
  but discouraged — `data` then decides only what the function child receives.
- **Providing neither does not compile.** `AutoSkeletonProps` is a
  discriminated union, so `<AutoSkeleton skeletonKey="x">…</AutoSkeleton>` is
  a type error rather than a component that is loading forever.

The function child is invoked **only** when `data` is non-nullish, and
receives `NonNullable<T>`. That narrowing is the whole point of the form: it
removes the second, inverted copy of the condition that
`{product !== null && <ProductContent product={product} />}` forced you to
write. Inference is automatic — you never write `<AutoSkeleton<Product> …>`.

A plain `ReactNode` child is still accepted with `data`. Use it when your
content can render before the value arrives.

### 2.2 `fallback` — and what actually happens on a cold start

`fallback` is rendered when **this cycle would paint a skeleton and there is
no usable measured geometry for the cache key** — no snapshot at all, or a
snapshot that yields zero shapes.

That second half is the important one, and it explains why you probably need
this prop. The sensor measures the wrapper's **children**, and it only looks
**while the skeleton is up**. So:

- If your children **stay mounted** during loading (they render placeholder
  or previous values), the sensor measures them on the first cycle, the
  measured skeleton appears, and `fallback` disappears and never returns.
- If your children are **conditional** — the function child form, or the
  older `{product !== null && …}` — then during every loading cycle there is
  *nothing mounted to measure*. The traversal records an **empty** snapshot,
  which paints zero shapes. Empty results are re-measured for a bounded
  number of cycles (`MAX_EMPTY_MEASUREMENTS`) and then become permanent for
  that key. Without `fallback`, that subtree paints **nothing, ever** — not
  "nothing on the first cycle".

So: conditional children need a `fallback`, and it is not a temporary measure
for them. It is also the migration ramp — put your existing hand-authored
skeleton in `fallback`, and consumers whose children stay mounted get the
measured one from the first cycle onward.

Three further facts, all deliberate:

- **It is never measured.** The fallback is wrapped in the same ignore channel
  as `<AutoSkeleton.Ignore>` (`data-autoskeleton-ignore` on web, the marker
  `nativeID`/`testID` on native), so the library can never cache a skeleton of
  your skeleton.
- **It is hidden from assistive technology.** It is decorative; the
  `role="status"` "Loading" element (web) / the `accessibilityLabel="Loading"`
  sibling (native) is what a screen-reader user gets.
- **It obeys `delay` and the refresh policy below.** It does not appear during
  the `delay` window, and on a suppressed refresh cycle (§2.3) it does not
  appear at all — covering content the reader is still looking at is exactly
  what that policy exists to prevent. Pass `skeletonOnRefresh` if you want
  both back on every load.

Omitting `fallback` leaves every render path exactly as it was.

### 2.3 The refresh policy (REQ-PTR-1) — read this one

**By default, once content has been shown, setting `isLoading` back to `true`
does NOT bring the skeleton back.** The already-rendered content stays on
screen instead.

```
skeletonSuppressed = everShownContent && props.skeletonOnRefresh !== true
```

This is deliberate: a pull-to-refresh should not blank out the list the reader
is currently looking at. It is also the single most common "why is my skeleton
not showing" report, because the first load works perfectly and every load
after it appears to do nothing.

Two further consequences of a suppressed cycle, both intentional:

- **`onMetrics` does not fire.** No skeleton was shown, so there is no
  skeleton-to-content lifecycle to report.
- **`aria-busy` is still set on web.** A screen-reader user gets the "refreshing"
  cue that the absent skeleton would have given a sighted one.

To get a skeleton on every load:

```tsx
<AutoSkeleton isLoading={isLoading} skeletonKey="feed" skeletonOnRefresh>
```

### 2.4 Statics

```tsx
<AutoSkeleton.Ignore>{/* exactly one element child */}</AutoSkeleton.Ignore>
<AutoSkeleton.Hint id="avatar" radius={24} lines={3}>{/* one child */}</AutoSkeleton.Hint>
```

`AutoSkeleton.Ignore` and `AutoSkeleton.Hint` exist on both platforms. There is
**no** `AutoSkeleton.SSR` or `AutoSkeleton.SSRHydrate` — those are separate
named exports from `autoskeleton/ssr` (§6).

#### `<AutoSkeleton.Ignore>`

Removes a subtree from detection.

- **Web**: renders a `<div data-autoskeleton-ignore="true" style={{display:'contents'}}>`.
  Layout-neutral, any children.
- **Native**: `cloneElement`s its **single element child**, stamping both
  `nativeID` and `testID` with a fixed sentinel. Whatever the child had for
  either is overwritten. **If the child is a composite component that does not
  forward `nativeID`/`testID` to a host element, this silently does nothing.**

The web attribute is also exported as `IGNORE_ATTRIBUTE` if you want to set it
by hand.

#### `<AutoSkeleton.Hint>`

| Prop | Type | Web | Native |
|---|---|---|---|
| `id` | `string`, required | stamps `data-autoskeleton-id` | stamps `nativeID` (**overwrites** any existing one), and `testID` only if the child set none |
| `radius` | `number` | stamps `data-autoskeleton-radius` | R0 of the Android radius ladder; overrides `layer.cornerRadius` on iOS |
| `lines` | `number` | **not a prop at all** | read by both native sensors, but only reachable for a collapsed text leaf — see [`platform-support.md` §5a](./platform-support.md) |

`radius` on Android is the mechanism that actually works — see
[`platform-support.md` §5d](./platform-support.md).

If the child already has a `testID` different from `id`, native `Hint` keeps
the child's `testID`, registers the hint under it as well so the iOS lookup
still resolves, and warns once in `__DEV__`. Silence it by using the same
string for both:

```tsx
<AutoSkeleton.Hint id="checkout-button" radius={12}>
  <Pressable testID="checkout-button" />
</AutoSkeleton.Hint>
```

---

## 3. `<SkeletonProvider>`

Optional. There is a module-level default store and theme, so a plain
`<AutoSkeleton>` works with no provider at all. Use the provider to override a
store (test isolation), a theme, the budgets, or to opt into tier-2.

| Prop | Type | Default | Platforms |
|---|---|---|---|
| `store` | `MemoryShapeStore` | module-level shared store | all |
| `theme` | `Partial<{ baseColor; highlightColor; defaultRadius; speedMs }>` | see below | all |
| `budgetMs` | `number` | `2` | all |
| `maxShapes` | `number` | `60` | all |
| `handoffTimeoutMs` | `number` | `250` | all |
| `handoffFadeMs` | `number` | `120` | all — **a delay, not a fade** |
| `radiusFallbackShare` | `number` | `0.3` | **web only** |
| `overlay` | `SkeletonOverlayComponent` | — | **native only** (tier-2 opt-in) |
| `children` | `ReactNode` | — | all |

Default theme:

| Field | Web default | Native default |
|---|---|---|
| `baseColor` | `DEFAULT_BASE_COLOR` from `css-renderer.ts` | `'#e2e2e2'` |
| `highlightColor` | `DEFAULT_HIGHLIGHT_COLOR` from `css-renderer.ts` | `'#f5f5f5'` |
| `defaultRadius` | `4` | `4` |
| `speedMs` | `1400` | `1400` |

On web the defaults are imported from the renderer's own stylesheet fallbacks
so a "still untouched" theme defers to the CSS cascade — which is what makes
`--skl-base` / `--skl-highlight` theming work without any prop.

> **`speedMs` is first-writer-wins.** It is a per-theme value but there is one
> shared shimmer clock per JS context. The first period to reach a mounted
> skeleton is adopted; a later request for a *different* `speedMs` is refused,
> with a dev warning naming both values, once per distinct refused value.
> Identical on all three platforms.

---

## 4. The virtualized-list API — **native only**

Not exported from the web entry. See
[`platform-support.md` §3a](./platform-support.md) for why TypeScript will not
catch a misuse, and [`lists.md`](./lists.md) for how to use these.

### `<SkeletonList>`

| Prop | Type | Default |
|---|---|---|
| `itemType` | `string` | required |
| `estimatedCount` | `number` | required |
| `skeletonKey` | `string` | defaults to `itemType` |
| `renderTemplate` | `() => ReactNode` | — |
| `animation` | `AnimationKind` | `'shimmer'` |
| `reducedMotion` | `boolean` | reads the platform preference |
| `rowSpacing` | `number` | — |

### `<SkeletonListFooter>`

Same props as `SkeletonList`. Intended as a `ListFooterComponent` during
pagination.

### `<SkeletonCell>`

| Prop | Type | Default |
|---|---|---|
| `itemType` | `string` | required |
| `skeletonKey` | `string` | defaults to `itemType` |
| `renderTemplate` | `() => ReactNode` | — |
| `animation` | `AnimationKind` | `'shimmer'` |
| `reducedMotion` | `boolean` | reads the platform preference |

### `useSkeletonCell(options)`

The hook `<SkeletonCell>` is built on, for when you need to render the cell
yourself.

```ts
const {
  snapshot,            // ShapeSnapshot | null — the real measured geometry on a hit
  cacheHit,            // boolean
  isFallback,          // true while resolving via the generic fallback block
  cacheKey,            // string
  pendingTemplateNode, // render this somewhere invisible while measuring
  templateRef,
  onTemplateLayout,
} = useSkeletonCell({ itemType, skeletonKey?, renderTemplate? });
```

The only synchronous work on bind is a cache read. No sensor call is reachable
from the bind path — that is the point of the API.

---

## 5. Tier-2: `autoskeleton/skia`

```tsx
import * as Skia from '@shopify/react-native-skia';
import {
  Easing, cancelAnimation, useDerivedValue, useSharedValue,
  withDelay, withRepeat, withSequence, withTiming,
} from 'react-native-reanimated';
import { SkeletonProvider } from 'autoskeleton';
import { createSkiaOverlay } from 'autoskeleton/skia';

// Call ONCE at module scope. A component identity that changes per render
// remounts the whole Skia canvas.
const overlay = createSkiaOverlay({
  skia: Skia,
  reanimated: {
    useSharedValue, useDerivedValue, withRepeat, withTiming,
    withSequence, withDelay, cancelAnimation, Easing,
  },
});

<SkeletonProvider overlay={overlay}>…</SkeletonProvider>
```

`createSkiaOverlay(peers): SkeletonOverlayComponent`

You pass the modules in rather than letting the library import them because
Metro builds a **static** dependency graph. An import written in your file is
resolved and bundled; an import the library only reaches conditionally either
becomes a hard dependency for everyone or does not resolve at all. Installing
the peers is deliberately **not** enough to turn tier-2 on — React Navigation
requires Reanimated, so "you happen to have it installed" says nothing about
which renderer you want.

`onMetrics.renderer` reports `'skia'` under that provider and `'native'`
elsewhere, so you can confirm which one drew.

Also exported: `staggerDelayForIndex` (**not wired** — see
[`platform-support.md` §5j](./platform-support.md)), `TIER2_SHIMMER_ORIGIN_MS`
and `tier2PhaseAt` (the tier-2 phase origin; see §5i there for why it is not
tier-1's).

---

## 6. Server rendering: `autoskeleton/ssr`

The components are named exports, **not** statics on `AutoSkeleton`.

### `<AutoSkeletonSSR>`

| Prop | Type | Default |
|---|---|---|
| `skeletonKey` | `string` | required |
| `manifest` | `AutoSkeletonSSRManifest` | required — you import the capture output and pass it |
| `direction` | `'ltr' \| 'rtl'` | `'ltr'` |

```tsx
import { Suspense } from 'react';
import { AutoSkeletonSSR } from 'autoskeleton/ssr';
import { manifest } from '../generated/autoskeleton-ssr';

<Suspense fallback={<AutoSkeletonSSR skeletonKey="dashboard" manifest={manifest} direction="ltr" />}>
  <DashboardContent />
</Suspense>
```

It renders a geometry-*less* overlay carrying `data-askl-ssr-key` /
`data-askl-ssr-dir`; the actual shape comes from the `@media`-bucketed CSS
bundle you import globally. That is what makes one server payload correct at
every viewport width.

An uncaptured key, or a manifest this build cannot replay, renders a neutral
generic block — byte-identical on server and client, so there is nothing to
mismatch on.

### `<AutoSkeletonSSRHydrate>`

| Prop | Type | Default |
|---|---|---|
| `manifest` | `AutoSkeletonSSRManifest` | required |
| `store` | `ShapeStore` | the same default store `<AutoSkeleton>` reads from |

Renders `null`. Imports the manifest's snapshots into the runtime cache once
per mount, so a client-side `<AutoSkeleton>` for the same key gets a real cache
hit instead of a cold traversal. Mount it once, in your root layout.

### Integrity helpers

```ts
import { assertSsrManifestIntegrity } from 'autoskeleton/ssr'; // or 'autoskeleton/cli'
assertSsrManifestIntegrity(manifest); // throws on manifest/CSS drift
```

See [`ssr-capture-cli.md`](./ssr-capture-cli.md) for the capture step and the
build-token binding.

---

## 7. Theming interop: `autoskeleton/uniwind` — **native only**

```tsx
import { ThemedAutoSkeleton } from 'autoskeleton/uniwind';

<ThemedAutoSkeleton className="bg-slate-200 rounded-lg" isLoading={isLoading} skeletonKey="card" />
```

One `className` resolves three different style properties onto three different
props. See [`theming.md`](./theming.md).

---

## 8. Types

`SkeletonMetrics` is the payload of `onMetrics`:

```ts
interface SkeletonMetrics {
  traversalMs: number;
  shapeCount: number;
  cacheHit: boolean;
  ttfsMs: number;
  displayDurationMs: number;
  handoffMs: number;
  handoffReason: 'successor-painted' | 'timeout' | 'no-successor' | 'error';
  platform: 'ios' | 'android' | 'web';
  renderer: 'native' | 'skia' | 'css';
  radiusSourceHistogram: Readonly<Record<RadiusSource, number>>;
  degraded: readonly DegradationFlag[];
  cacheKey: string;
}
```

**Several of these fields are constant on native.** See
[`observability.md`](./observability.md) for the per-platform table before you
build a dashboard on them.

Supporting unions:

```ts
type AnimationKind   = 'shimmer' | 'pulse' | 'none';
type RendererKind    = 'native' | 'skia' | 'css';
type Platform        = 'ios' | 'android' | 'web';
type RadiusSource    = 'measured' | 'outline' | 'raster-probe' | 'hint' | 'default'
                     | 'style';
type ShapeSource     = 'text' | 'image' | 'input' | 'background'
                     | 'synthetic-line' | 'container';
type HandoffReason   = 'successor-painted' | 'timeout' | 'no-successor' | 'error';
type DegradationFlag =
  | 'radius-unavailable' | 'radius-probe-failed' | 'leaf-class-unmatched'
  | 'budget-exceeded'    | 'shape-cap-reached'   | 'clientrects-empty'
  | 'snapshot-version-mismatch' | 'native-module-unavailable'
  | 'depth-cap-reached';
```

`ShapeInfo` is one placeholder rectangle in the wrapper's coordinate space, in
CSS px (web) or density-independent points (native). `r` is a single uniform
corner radius; per-corner radii are out of scope. `source` and `radiusSource`
are dev-build sidecars and are absent in production snapshots.

---

## 9. The composite cache key

You never build this yourself, but knowing what is in it explains every cache
miss you will see:

`skeletonKey` · `itemType` · bucketed viewport width · quantized font scale ·
text direction · platform.

Width buckets are `[320, 375, 414, 768, 1024, 1280, 1536]` (smallest bucket
`>= px`, clamped at both ends). Font scale is quantized to two decimals. A
rotation, a font-size preference change or an RTL flip therefore produces a
different key — which is exactly how invalidation happens, since there is no
observer wired on either platform.
