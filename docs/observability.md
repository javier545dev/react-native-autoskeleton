# Observability: `onMetrics`, `debugOverlay`, warnings and profiler markers

`autoskeleton` treats observability as a phase-1 requirement, not a final
add-on. This page covers the four developer-facing channels:

1. [`onMetrics`](#1-onmetrics) — the programmatic payload, **with a
   per-platform table of which fields are real**.
2. [`debugOverlay`](#2-debugoverlay) — the visual one. **Web only.**
3. [Dev warnings](#3-dev-warnings) — budgets, radius fallback, shimmer period,
   hint conflicts, SSR drift.
4. [Native profiler markers](#4-native-profiler-markers) — signposts and trace
   sections.

---

## 1. `onMetrics`

```tsx
<AutoSkeleton
  isLoading={isLoading}
  skeletonKey="product-card"
  onMetrics={(m) => analytics.track('skeleton', m)}
/>
```

Fires **once per completed loading cycle**, after the handoff settles — never
while the skeleton is up.

It does **not** fire for a cycle suppressed by the refresh policy (REQ-PTR-1),
because no skeleton-to-content lifecycle visually occurred. A missing event on
a pull-to-refresh is that, not a dropped callback. See
[`api.md` §2.3](./api.md).

### 1.1 Which fields are real, per platform

This table is the important part of this page. Several fields are constants on
native, and a dashboard built on them would be measuring nothing.

| Field | Web | iOS | Android |
|---|---|---|---|
| `traversalMs` | real (`0` on a cache hit) | **always `0`** | **always `0`** |
| `shapeCount` | real | real | real |
| `cacheHit` | real, but latched — see §1.2 | same | same |
| `ttfsMs` | real | real | real |
| `displayDurationMs` | real | real | real |
| `handoffMs` | real | real | real |
| `handoffReason` | real; `'successor-painted'` reachable | real, but `'timeout'` whenever `expectsPlaceholder` is set — see §1.3 | same as iOS |
| `platform` | `'web'` | `'ios'` | `'android'` |
| `renderer` | `'css'` | `'native'` or `'skia'` | `'native'` or `'skia'` |
| `radiusSourceHistogram` | real (dev sidecar present) | **always all-zeros** | **always all-zeros** |
| `degraded` | real | **always `[]`**, except `['native-module-unavailable']` | same as iOS |
| `cacheKey` | real | real | real |

Why, precisely:

- **`traversalMs`.** `src/native/AutoSkeleton.tsx` calls `assembleMetrics` with
  a literal `traversalMs: 0`, and `src/native/sensor.ts` returns `0` too.
  Native traversal cost is reported through `os_signpost` / `Trace` intervals
  (§4) and never crosses the bridge. There is no wall-clock timing around the
  bridge call either — an older comment in `sensor.ts` claims there is; there
  is not.
- **`radiusSourceHistogram`.** The histogram is tallied from
  `snapshot.radiusSources`, a dev-only sidecar. The native `getShapes` wire is
  `[VERSION, x, y, w, h, r] × N` with no sidecar slots, and the JS caller
  passes `collectDebugSidecars: false` anyway. Web builds the sidecar in
  process, so its histogram is genuine.
- **`degraded`.** Native sensors *do* raise degradation flags internally
  (`radius-unavailable`, `budget-exceeded`, `shape-cap-reached`, …) and use
  them for their own dev warnings, but nothing carries them across the Turbo
  Module boundary. The only flag JS can produce on native is
  `native-module-unavailable`, set when the module is missing (Expo Go).

### 1.2 `cacheHit` and `traversalMs` are latched per mounted instance

Both are decided when a wrapper first resolves its cache key and do **not**
change for the life of that mounted component. A component that loads, shows
content, then loads again without unmounting reports the **first** cycle's
cache verdict on the second.

To observe a genuine cached serve, unmount and remount — which is exactly why
`examples/vite`'s `cache-replay` demo unmounts rather than toggling a boolean.

One nuance that *is* handled: a cycle that re-traverses because the cached
snapshot was empty reports `cacheHit: false` with a real `traversalMs`, rather
than claiming a hit alongside a real traversal.

### 1.3 `handoffReason` on native

The automatic successor-paint heuristic (double `requestAnimationFrame` after
commit, plus `img.decode()`/`load` for a same-origin `<img>`) is **web only**.

On native, nothing feeds `onSuccessorPainted` from a real paint signal, so
every handoff with `expectsPlaceholder` falls through to the
`handoffTimeoutMs` timeout path — even when your image loaded instantly — and
reports `'timeout'`. Worst case is a slightly longer skeleton, never a flash
and never wrong content. See [`image-pipeline.md` §4](./image-pipeline.md).

### 1.4 Reading it end to end

```ts
// Total wall time a reader spent looking at a loading state:
const total = m.displayDurationMs + m.handoffMs;
```

`displayDurationMs` deliberately stops the instant `isLoading` flips `false`,
so it never accidentally measures your image component. The tail is reported
separately as `handoffMs` + `handoffReason`.

---

## 2. `debugOverlay`

```tsx
<AutoSkeleton isLoading={isLoading} skeletonKey="product-card" debugOverlay={__DEV__} />
```

When enabled **and** the build is not production, the overlay draws the outline
of every detected shape, annotated with its index in traversal order, its
source type (`text` / `image` / `input` / `background` / `synthetic-line` /
`container`), and a cache hit/miss badge.

It is the tool for "why did it not detect this node" without reading source.

### 2.1 Current status: **web only**

On **both** native platforms the prop is accepted and stored and nothing reads
it:

- **Android** — `AutoskeletonOverlayView.kt` declares `var debugOverlay` and
  `AutoskeletonOverlayViewManager.setDebugOverlay` assigns it. No code path
  reads the field. `AutoskeletonDebugOverlayFactory.createIfDebug` has no
  production call site; only tests call it.
- **iOS** — `AutoskeletonOverlayViewHost.mountOrUpdate` accepts a
  `debugOverlay: Bool` and never references it.
  `AutoskeletonDebugOverlay.swift` likewise has no production caller.
- Under the **tier-2 Skia** renderer the prop is not forwarded to the overlay
  component at all.

Both native classes are implemented and unit-tested. Neither is wired.
`spec.md`'s REQ-OBS-OVERLAY-1 asks for the overlay to draw, so this is an open
requirement on native, not a resolved one.

> This paragraph previously said the overlay was "fully wired on web and
> Android" and named iOS as the only gap — "an open item, not a silent gap".
> That was exactly backwards, and worse than an undocumented gap: a reader with
> a blank overlay on Android would have concluded the fault was theirs.
> Corrected 2026-08-30 after a fresh-eyes review.

### 2.2 Dev-only by construction

The `process.env.NODE_ENV !== 'production'` guard is written so a production
bundler (Vite/webpack/Metro) dead-code-eliminates the whole `DebugOverlay`
component via its own `production` literal replacement — asserted by
`test/packaging/web-bundle.test.ts`, which checks the string
`askl-debug-overlay` never appears in a production web bundle.

You do not need to strip `debugOverlay` props before shipping.

---

## 3. Dev warnings

All warnings are gated to non-production builds. **Where they appear differs by
platform**, which is easy to miss:

| Platform | Destination |
|---|---|
| Web | `console.warn` |
| Android | `Log.w` with tag `Autoskeleton` — **logcat, not the Metro console** |
| iOS | `os.Logger(subsystem: "com.autoskeleton", category: "AutoskeletonSensor")` — **Console.app / Xcode, not the Metro console** |

### 3.1 Traversal-time and shape-count budgets

| Budget | Default | Configured via | Crosses the native bridge? |
|---|---|---|---|
| Traversal time | 2 ms (NFR-3) | `SkeletonProvider budgetMs` | yes |
| Shape count | 60 shapes | `SkeletonProvider maxShapes` | yes |

```tsx
<SkeletonProvider budgetMs={2} maxShapes={60}>
  <App />
</SkeletonProvider>
```

```
[autoskeleton] traversal took 3.1ms, exceeding the configured 2ms budget.
Consider reducing subtree depth or wrapping expensive branches in
<AutoSkeleton.Ignore>.
```

```
[autoskeleton] detected 74 shapes, exceeding the configured 60-shape
budget. Consider <AutoSkeleton.Ignore> on decorative subtrees, or raise
maxShapes via SkeletonProvider.
```

These are the same two budgets `benchmarks/budgets.json`'s
`traversalP95Ms`/`shapeCount` gates enforce in CI, so a warning you see locally
is the same threshold that would fail a regression benchmark.

### 3.2 Radius-fallback warning

Fires when more than `radiusFallbackShare` of a screen's shapes resolve their
corner radius through the lowest rung of the ADR-2 ladder — meaning
`autoskeleton` could not determine the real corner radius for most of your
rounded views. The actionable remedy is a typed `radius` hint on the affected
views.

```
[autoskeleton] 23/60 shapes (38%) resolved their corner radius through the
'default' fallback rung, exceeding the configured 30% threshold. Supply a
radius hint on the affected views, or set SkeletonProvider.defaultRadius to
match your design.
```

Fires on all three platforms. **The threshold is configurable on web only**:
`SkeletonProvider`'s `radiusFallbackShare` prop exists on the web provider and
not the native one, and the native `getShapes` config does not carry it — both
native sensors use their own compiled default of `0.3`.

This matters most on Android, whose ladder is the only one with a fallback
rung at all. Since rung R1b it recovers a uniform styled `borderRadius`
exactly (reported as `radiusSource: 'style'`), so the share that reaches
`'default'` should now be small; four independent corner radii are the case
that still lands there. See
[`platform-support.md` §5d](./platform-support.md) for the full ladder and for
why `defaultRadius` still does not help a view with no background drawable.

When aggregating `radiusSourceHistogram` across platforms, group the buckets
with `isExactRadiusSource` rather than reading one bucket name: the same
rounded view reports `'measured'` on iOS and web but `'style'` on Android.

### 3.3 Shared-shimmer-period warning (all platforms)

Every skeleton on screen shares ONE clock so they shimmer in phase. `speedMs`
is that clock's period and is a per-theme value, so two `<AutoSkeleton>` trees
under two different `SkeletonProvider` themes can ask for two different
periods. Only one can be honoured.

**The first period to reach a mounted skeleton wins**, identically on iOS,
Android and web. A later request for a different `speedMs` is refused and a
dev-build warning fires **once per distinct refused value**, naming the ignored
value, the value in effect, and the two ways out. Nothing is silently
discarded.

Before this rule, all three platforms behaved differently and none of them said
anything: iOS ended up running two periods at once (already-mounted skeletons
bake the duration in at their own mount, so they drifted permanently out of
phase), Android retuned the live clock and visibly jumped every skeleton's
phase, and on web `speedMs` reached nothing at all.

> This arbitration covers the shared **period**. It does not put tier-1 and
> tier-2 skeletons in the same **phase** — see
> [`platform-support.md` §5i](./platform-support.md).

### 3.4 `<AutoSkeleton.Hint>` `testID` conflict (native)

```
[autoskeleton] <AutoSkeleton.Hint id="avatar"> wraps a <View> that already
sets testID="profile-avatar". Keeping YOUR testID — it is the handle your
e2e suite matches on, and overwriting it would silently break tests that
already pass. …
```

Fires once per distinct conflict, never per render. See §5 below for the full
mechanism.

### 3.5 SSR manifest warnings (web)

Two more, both latched once, from `src/web/ssr/manifest-warning.ts`:

- **Schema version** — a `manifest.json` this build cannot replay renders the
  neutral generic block instead, naming both versions.
- **Manifest/CSS drift** — `manifest.json` and `bundle.css` came from different
  capture runs, so skeletons fell back to the neutral block rather than
  replaying geometry the CSS no longer matches. Names both build tokens so you
  can tell which artifact is stale.

Plus a dev-mode warning naming every **uncaptured** `skeletonKey`, fired from
`<AutoSkeletonSSR>`'s own render body. See
[`ssr-capture-cli.md`](./ssr-capture-cli.md).

---

## 4. Native profiler markers

Both native sensors and the tier-1 renderer emit real intervals, so you can
measure traversal and draw cost in the platform profiler rather than through
`onMetrics` (which reports `traversalMs: 0` on native — §1.1).

| Marker | iOS | Android |
|---|---|---|
| Traversal | `os_signpost` interval `AutoskeletonTraversal` | `Trace` section `AutoskeletonTraversal` |
| Renderer mount | `AutoskeletonRendererMount` | `AutoskeletonRendererMount` |
| Draw pass | — | `AutoskeletonDraw` |
| JS→native serialization | — | — (JS-side section `AutoskeletonJsiSerialization`, emitted only when a tracing implementation is injected) |

On iOS the signposts go to `OSSignposter(subsystem: "com.autoskeleton",
category: "AutoskeletonSensor")`, so they appear in Instruments' **Points of
Interest** track, distinguishable from system noise. On Android use
Perfetto/`systrace` and filter on the section names above.

---

## 5. Typed hints: `<AutoSkeleton.Hint>` — one API, one known asymmetry

`<AutoSkeleton.Hint>` exists on **both** native (`src/native/Hint.tsx`) and web
(`src/web/Hint.tsx`).

```tsx
<AutoSkeleton.Hint id="avatar" radius={24}>
  <RoundedAvatar />
</AutoSkeleton.Hint>
```

| Prop | Native | Web |
|---|---|---|
| `id` (required) | stamps `nativeID` (**overwriting any existing one**), and `testID` only when the child set none | stamps `data-autoskeleton-id` |
| `radius` | top rung of Android's ladder (ADR-2 R0), and the answer for the cases rung R1b cannot recover — per-corner radii; overrides `layer.cornerRadius` on iOS | stamps `data-autoskeleton-radius`, the same self-sufficient attribute you could already set by hand |
| `lines` | consulted by both native sensors, but only reachable for a collapsed text leaf ([§5a](./platform-support.md)) | **not a prop on web at all — a real, documented gap** |

### 5.1 Your `testID` is never overwritten (native)

Wrapping an element in `<AutoSkeleton.Hint>` **keeps whatever `testID` that
element already had.** `testID` is the handle Detox, Maestro, Appium and argent
match on (Android: `R.id.react_test_id` plus the plain view tag; iOS:
`accessibilityIdentifier`), so overwriting it would silently break e2e tests
that already pass — a failure that gets misattributed, because nothing points
back at us.

The conflict is real rather than cosmetic: on iOS the sensor reads
`accessibilityIdentifier`, which is *exactly* what `testID` sets. When they
differ, both are kept working:

- your `testID` stays untouched;
- `nativeID` carries the hint `id` (Android's lookup channel; no e2e tool reads
  `nativeID`) — **whatever `nativeID` the child had is replaced**;
- the hint values are **also** registered under your `testID`, so the iOS
  sensor still resolves them;
- a `__DEV__` warning fires once per distinct conflict, naming both ids and the
  element.

Silence it by keying the hint off the value already there:

```tsx
<AutoSkeleton.Hint id="checkout-button" radius={12}>
  <Pressable testID="checkout-button" />
</AutoSkeleton.Hint>
```

### 5.2 Known gaps in the hint/ignore channel

- **`<AutoSkeleton.Ignore>` still overwrites both `nativeID` and `testID`**,
  because its channel value is a fixed sentinel both native sensors compare
  against literally — there is no alias to register, so preserving a consumer
  `testID` would make `Ignore` silently stop working on iOS. Closing it needs a
  native-side second marker channel.
- **Both components `cloneElement` their single element child**, so the child
  must be a host element or forward `nativeID`/`testID` to one. A composite
  child that swallows them makes `Ignore` a **silent no-op**. See
  [`troubleshooting.md`](./troubleshooting.md).

### 5.3 Why web has no `lines` prop

Web's DOM sensor never calls `hints.linesFor()` anywhere in its traversal. Its
one theoretical consultation point — the `textLeafShapes` `clientrects-empty`
fallback, which only runs when `Range.getClientRects()` returns zero rects for
a text leaf — was live-probed in Playwright (`display:none`, zero-font-size,
zero-width-overflow-hidden constructions) and found genuinely unreachable under
non-degenerate geometry given the module's current `isTextLeaf` gate: any
construction that drives `getClientRects()` to empty also makes the element's
own frame degenerate.

Wiring a `lines` prop through to an unreachable branch would be a silent no-op,
not a fix, so it was deliberately left out rather than shipped as dead code.
Making it reachable would require redesigning `isTextLeaf` itself — real
surgery, and tracked as an open item.

Web does not need it for the ordinary case anyway: per-line text on web comes
from `Range.getClientRects()` and is real line-box geometry, not a synthesized
count.
