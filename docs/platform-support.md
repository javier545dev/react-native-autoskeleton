# Platform support and known limitations

This page is the single honest answer to "does the thing I need work on the
platform I ship to". It exists because a capability table scattered across
feature pages is how a library ends up claiming something works where it
does not — which has happened in this repository twice, both caught by a
reviewer rather than by us.

Read this before you adopt. Every row below was verified against the
implementation, and the "how it was verified" column says how.

---

## 1. Targets

| Target | Status |
|---|---|
| Bare React Native, New Architecture (Fabric) | Supported. **RN 0.77+**, New Architecture on — see §1a for why that is the floor and what you have to do per version. |
| Expo with a development build (`expo prebuild` / EAS dev build) | Supported. **Expo SDK 53+ in practice**, one RN minor above the bare floor — see §1a. |
| **Expo Go** | **Not supported, and never will be.** See §2. |
| Expo Web / `react-native-web` | Supported for the `<AutoSkeleton>` surface. Two large gaps — see §3. |
| Plain web (Vite, webpack, Next.js client) | Supported. |
| Next.js server rendering (`autoskeleton/ssr`) | Supported, via a build-time capture step. See [`ssr-capture-cli.md`](./ssr-capture-cli.md). |
| React Native old architecture (Paper) | Not supported on any RN version. No code path for it exists in this library. |

### 1a. Why the floor is RN 0.77, and what "New Architecture" costs you per version

The floor is not about when React Native retired the legacy architecture. It is
about when the two registration mechanisms this package uses landed — two
independent constraints, either of which would set 0.77 on its own:

- **iOS.** `codegenConfig.ios.componentProvider` (in this package's
  `package.json`) feeds `RCTThirdPartyComponentsProvider.mm`, which does not
  exist before RN 0.77.0. `ios/AutoskeletonOverlayView.mm` documents the same
  mechanism at its call site.
- **Android.** `AutoskeletonPackage.kt` constructs `ReactModuleInfo` with Kotlin
  named arguments, and those parameter names were renamed in RN 0.77.0.

Below 0.77 the package does not register. That is a missing native module, not a
degraded skeleton.

The New-Architecture requirement is a *separate* thing from the floor, and it is
only free further up the range:

| RN range | What you must do |
|---|---|
| 0.77 – 0.81 | **Keep the New Architecture on.** It has been the default since 0.76, but `newArchEnabled=false` still works here, and with it off this library has no code path to run. |
| 0.82+ | Nothing. React Native refuses `newArchEnabled=false`, so the platform satisfies the requirement for you. |

(For the record, the surrounding RN timeline: New Architecture opt-in from 0.68,
default from 0.76, the only architecture from 0.82, and from 0.83 React Native
starts removing the legacy architecture *classes* — the interop layers stay.)

**React comes from your RN release, not from us.** RN 0.77 requires react
`^18.2.0`; 0.78 and 0.79 require `^19.0.0`; 0.80 and 0.81 require `^19.1.0`; 0.87
requires `^19.2.3` — each read from that release's own `peerDependencies` on npm.
A reader sitting on the 0.77 floor is therefore on React 18, and this package's
`react: >=18.2.0` peer range is deliberately wide enough to say so.

**On Expo, the effective floor is SDK 53, not RN 0.77.** No Expo SDK ships RN
0.77 or 0.78: SDK 52 is RN 0.76 and SDK 53 is RN 0.79. There is no release in
between to install, so the peer range being wider changes nothing for an Expo
consumer.

**Corrected 2026-08-30.** This page previously gave the floor as "RN 0.83+ (the
old architecture was removed in 0.83, not merely deprecated)". That sentence
described React Native's timeline — imprecisely, by collapsing 0.76, 0.82 and
0.83 into one event — rather than this library's actual constraint, and it
excluded six RN minors that work. The floor is now pinned to mechanisms you can
open a file and look at. `spec.md` §4 carries the full revision record.

---

## 2. Expo Go is not supported

`autoskeleton` ships a custom native Turbo Module. Custom native modules are
absent from the prebuilt Expo Go binary by design, so no version of this
library can work there. This is not a bug to file.

What you get instead of a mystery:

- **In development**, the first use throws `AutoskeletonNativeModuleUnavailableError`,
  a named error whose message points at the development-build requirement.
- **In production**, it fails open: `children` render unwrapped (no skeleton,
  no crash) and `onMetrics` reports `degraded: ['native-module-unavailable']`,
  so a stray Expo Go install shows up in telemetry rather than silently.

Both are exported for you to check against:
`AutoskeletonNativeModuleUnavailableError` and
`AUTOSKELETON_NATIVE_MODULE_UNAVAILABLE_DOCS_URL` from the native entry.

## 3. Expo Web: two real gaps

Expo Web genuinely works for the core component. Two APIs do not cross over,
and one of them fails in a way TypeScript will not catch.

### 3a. The virtualized-list API is native-only, and its absence on web is a runtime `undefined`

`SkeletonList`, `SkeletonListFooter`, `SkeletonCell`, `useSkeletonCell` and
`templateTraversalCounter` are exported **only** from the native entry
(`src/index.native.ts`). The web entry does not export them.

The trap is that a universal Expo app gets **no compile error**:
`expo/tsconfig.base.json` sets `customConditions: ['react-native']` with no
platform variation, and TypeScript has no notion of a build platform, so one
tsconfig typechecks your whole app against the native declarations. Metro then
bundles the web build against the web entry, where the name does not exist.

**Verified by running, 2026-08-30**, in `examples/expo`:

- `npx tsc --noEmit -p tsconfig.json` over a file importing
  `{ SkeletonList, useSkeletonCell } from 'autoskeleton'` — **exit 0, zero errors**.
- `npx expo export --platform web` of an entry containing that same import —
  **bundled successfully**, and the emitted code is a plain property read on
  the web module object, i.e. `undefined` at runtime.

If you ship a universal app, keep every list-API call behind a
`Platform.OS !== 'web'` branch or in a `.native.tsx` file. Nothing else will
tell you.

### 3b. `autoskeleton/uniwind` is native-only, and fails loudly

The `autoskeleton/uniwind` subpath imports the native `<AutoSkeleton>`, which
reaches `react-native/Libraries/Utilities/codegenNativeComponent`. A web build
fails at bundle time with `Importing native-only module ... on web`.

That is the correct failure mode — loud, at build time, naming the module.
`examples/expo` splits `App.web.tsx` from `App.tsx` precisely because of it.

If you need themed skeletons on web, use CSS custom properties or Tailwind v4
`@theme` tokens; see [`theming.md`](./theming.md).

---

## 4. Feature availability by platform

Legend: **yes** = implemented and reachable from the public API;
**no** = not implemented on that platform today.

| Capability | Web | iOS | Android |
|---|---|---|---|
| `<AutoSkeleton>` cold measurement + cached replay | yes | yes | yes |
| `<AutoSkeleton.Ignore>` | yes | yes | yes (caveat §5c) |
| `<AutoSkeleton.Hint id radius>` | yes | yes | yes (caveat §5c) |
| `<AutoSkeleton.Hint lines>` | **no** (not a prop on web) | yes (caveat §5a) | yes (caveat §5a) |
| Per-line text skeletons | **yes, per line box** | only for collapsed text (§5a) | only for collapsed text (§5a) |
| Per-instance theme props (`shimmerBaseColor` etc.) | **no** | yes | yes |
| CSS-variable / Tailwind theming | yes | n/a | n/a |
| `autoskeleton/uniwind` | **no** (§3b) | yes | yes (radius caveat §5d) |
| Virtualized-list API | **no** (§3a) | yes | yes |
| `debugOverlay` draws | yes | **no** (§5b) | **no** (§5b) |
| Automatic successor-paint detection (`expectsPlaceholder`) | yes | **no** | **no** |
| Clipping to scrollable / `overflow` ancestors | yes | **no** (§5e) | **no** (§5e) |
| Tier-2 Skia renderer | n/a | yes (opt-in) | yes (opt-in) |
| `autoskeleton/ssr` build-time replay | yes | n/a | n/a |

---

## 5. Known limitations, stated plainly

Each of these is confirmed against the implementation. None of them is a
"coming soon".

### 5a. Per-line text skeletons are a web capability

On web, `src/web/dom-sensor.ts` uses `Range.getClientRects()` and produces one
bar per real laid-out line box, ragged last line included.

On native, a `<Text>` is a single leaf and normally produces **one rectangle**.
The line-synthesis path exists but is gated on a *collapsed* text node:
`AutoskeletonSensor.kt` and `AutoskeletonSensor.swift` both enter it only when
`frame.height < options.defaultLineHeight`, and `defaultLineHeight` is a
compiled constant of **20** (dp on Android, points on iOS) that the bridge does
not carry from JS. A normal multi-line `<Text>` is taller than 20, so it never
takes that branch, and the `lines` hint never fires for it either.

Practically: do not expect a native multi-line paragraph to become several
bars. It becomes one block the size of the paragraph.

### 5b. `debugOverlay` draws on web only

The prop is accepted on all three platforms. Only the web implementation draws.

- **Android**: `AutoskeletonOverlayView.kt` declares `var debugOverlay` and
  `AutoskeletonOverlayViewManager.setDebugOverlay` assigns it. **No code reads
  the field.** `AutoskeletonDebugOverlayFactory.createIfDebug` has no
  production call site — only tests.
- **iOS**: `AutoskeletonOverlayViewHost.mountOrUpdate` takes a
  `debugOverlay: Bool` parameter and never references it in the body.
  `AutoskeletonDebugOverlay.swift` likewise has no production caller.
- Under the **tier-2 Skia** renderer the prop is not even forwarded to the
  overlay component.

Both native classes are implemented and unit-tested. Neither is wired. A blank
overlay on iOS or Android is our gap, not your mistake. Tracked as
[#31](https://github.com/javier545dev/react-native-autoskeleton/issues/31).

An earlier version of `docs/observability.md` claimed the overlay was "fully
wired on web and Android" and framed iOS as the only gap. That was exactly
backwards and is corrected here and there.

### 5c. `<AutoSkeleton.Ignore>` and `<AutoSkeleton.Hint>` clone props onto their child

Both are `cloneElement` wrappers, not wrapping views — deliberately, so they
stay layout-neutral. The consequence is a real API constraint:

- Both accept **exactly one element child** (`React.Children.only`).
- `Ignore` stamps `nativeID` **and** `testID` with a fixed sentinel. Whatever
  the child had for either is **overwritten**.
- `Hint` stamps `nativeID` with your `id`, **overwriting** any `nativeID` the
  child had. It stamps `testID` too **only when the child set none** — a
  consumer `testID` wins, the hint is additionally registered under it so the
  iOS lookup still resolves, and a `__DEV__` warning fires once per conflict.
- Because the mechanism is a cloned prop, the child **must be a host element**
  (or a composite component that forwards `nativeID`/`testID` down to one).
  Wrap a composite that swallows them and `Ignore` **silently does nothing** —
  the sensor has no marker to find and shapes get drawn over the content you
  asked to exclude.

Why the asymmetry: on Android the JS `nativeID` prop reaches the tag the
sensor reads; on iOS it is `testID` that reaches `accessibilityIdentifier`,
which is what the iOS sensor reads. `Ignore`'s value is a fixed sentinel both
sensors compare against literally, so there is no alias to register and
preserving a consumer `testID` would make `Ignore` stop working on iOS
entirely. Closing that needs a second native marker channel; it is tracked, not
fixed.

Tracked as [#28](https://github.com/javier545dev/react-native-autoskeleton/issues/28).

### 5d. On Android, `defaultRadius` does not fill in a missing radius

Android's radius ladder is R0 (typed `radius` hint) → R1 (`Drawable.getOutline`)
→ R3 (`defaultRadius`, with `radius-unavailable` raised). R1 answers
**definitively** for a view with no background at all: it returns
`radius = 0, source = 'measured'`. Most RN views have no background drawable,
so they resolve at R1 with a hard 0 and R3 is never reached — meaning
`SkeletonProvider`'s `defaultRadius`, the per-instance `defaultRadius` prop,
and the `rounded-*` class that `autoskeleton/uniwind` maps onto it have no
visible effect on those views.

Use `<AutoSkeleton.Hint radius={n}>` for rounded content on Android. It is R0
and always wins. iOS reads `layer.cornerRadius` directly and is unaffected.

R2, the raster corner probe, exists (`AutoskeletonRasterProbe`) but production
uses `AutoskeletonPublicApiRadiusResolver`, which does not include it — so
`radiusSource: 'raster-probe'` is unreachable in a shipped Android build.

### 5e. Neither native sensor clips to scroll containers

The web sensor intersects each shape against every `overflow`-clipping ancestor
up to the traversal root, so a horizontally scrollable carousel does not emit
full-size frames for its off-screen items.

Neither native sensor does this. Android accounts for ancestor `scrollX`/`scrollY`
offsets when computing a frame, but never intersects with the scroll
container's box. iOS does neither. A wide native scroll row inside an
`<AutoSkeleton>` can therefore contribute shapes that extend past the visible
region.

Tracked as [#30](https://github.com/javier545dev/react-native-autoskeleton/issues/30).

### 5e-bis. A sized but transparent container contributes no shape — on every platform

Not a limitation of one platform; a deliberate rule all three implement
identically. A container emits its own shape only when its subtree has no
detectable leaf **and** it has a non-transparent background. A `<View>` that
reserves layout space but paints nothing of its own contributes nothing, so a
loading branch written as `{data !== null && <Image />}` measures zero shapes
and paints no skeleton.

Reviewed as a possible defect on 2026-08-30 and kept: a non-transparent
background is the only observable difference between a box that is content and
a box that is structure, and transparent sized boxes are how layouts express
spacers, flex fillers, safe-area padding and gap shims. The consumer-side
answer is an always-mounted opaque slot —
[`image-pipeline.md` §3a](./image-pipeline.md) has the worked example and the
full argument. Gated by the shared `container-rule-sized-but-transparent`
fixture across the iOS, Android and web sensors.

### 5f. `handoffFadeMs` is a delay, not a fade

Nothing on either platform's teardown path animates opacity. The overlay is
retained for `handoffFadeMs` after the successor is considered painted (or the
timeout elapses), then removed outright. Raising it keeps a **fully opaque**
skeleton on screen for longer; it does not dissolve it.

The name survived a cross-fade design that was never built. Corrected
2026-08-30; `src/core/handoff.ts`'s own header now says so.

### 5g. Native `onMetrics` has constant fields

See [`observability.md` §`onMetrics`](./observability.md) for the full per-field
table. Summary: on iOS and Android, `traversalMs` is always `0`,
`radiusSourceHistogram` is always all-zeros, and `degraded` is always `[]`
except for `['native-module-unavailable']`.

Tracked as [#24](https://github.com/javier545dev/react-native-autoskeleton/issues/24).

### 5h. `onMetrics.cacheHit` and `traversalMs` are decided once per mounted instance

Both are latched when a wrapper first resolves its cache key and do not change
for the life of that mounted component. A component that loads, shows content,
then loads again **without unmounting** reports the first cycle's cache verdict
on the second. To observe a genuine cached serve, unmount and remount.

### 5i. Tier-2 skeletons are not in phase with tier-1 skeletons

Both tiers share one **period** (`resolveSharedShimmerPeriodMs`, arbitrated in
JS). They do not share a phase **origin**:

- Tier-1 reads the native `AutoskeletonShimmerClock`'s `startedAt` and hands
  CoreAnimation / Choreographer a negative begin offset.
- Tier-2 runs entirely in JS/Reanimated and has **no route to that value** —
  the Turbo Module surface is `getShapes` and `evictShapes` only, and
  `startedAt` is never exposed. It uses its own module-scope
  `TIER2_SHIMMER_ORIGIN_MS = Date.now()`.

So tier-2 instances are in phase **with each other**, and tier-1 instances are
in phase with each other, and the two groups run at the same speed with an
arbitrary fixed offset between them. A screen mixing renderers will not look
broken, but it is not one wave.

The README previously claimed "both renderers share one shimmer clock". That
was wrong; corrected 2026-08-30.

### 5j. Per-shape stagger is not implemented

`staggerDelayForIndex` is exported from `autoskeleton/skia` and unit-tested,
and **nothing calls it**. `SkiaShimmerOverlay` draws one union path under one
gradient, so there is no per-shape node to delay. Tier-1 has no stagger either.
Kept exported rather than deleted so the dropped requirement stays visible.

### 5k. The native shape cache is unbounded for the process lifetime

`AutoskeletonNativeShapeCache` (Android) is a plain `ConcurrentHashMap` with no
size bound and no LRU. It is emptied only by `evictShapes`, which is only
reachable from `evictNativeShapes` in `src/native/wire-bridge.ts` — and
**`evictNativeShapes` has no production caller**; only tests call it. The JS
`MemoryShapeStore` does have LRU eviction, so the two can diverge, and the
native side only ever grows.

The entries are small (a `[VERSION, x, y, w, h, r] × N` array of doubles per
distinct cache key, and a cache key includes a bucketed width, so the key space
is bounded by your distinct `skeletonKey`/`itemType` values × buckets × 2
directions). It is not an unbounded-per-frame leak. It is still unbounded.

Tracked as [#25](https://github.com/javier545dev/react-native-autoskeleton/issues/25).

### 5l. `Sensor.observe()` does nothing on native

The native `Sensor.observe()` is a documented no-op returning a stable
unsubscribe. Invalidation is driven instead by the composite cache key
(`useWindowDimensions`, `I18nManager`, `PixelRatio.getFontScale()`), so a
rotation or font-scale change produces a cache miss and a fresh traversal
without any observer. The web sensor does implement `observe()` with
`ResizeObserver`/`MutationObserver`, but nothing in `src/web/AutoSkeleton.tsx`
calls it either.

Consequence you can observe: on web the font-scale probe is measured **once
per session and cached**, so a mid-session browser default-font-size change is
not picked up (the browser exposes no event for one).

### 5m. NFR-1's tier-2 120 Hz claim is untested

`spec.md` NFR-1 asks tier-2 to sustain 120 Hz on ProMotion displays. There is
no benchmark that measures it. `benchmarks.yml`'s `bench-ios-traversal` job is
marked "AUTHORED ONLY" in its own header, and the frame-drop job that does
exist is Android. Treat the 120 Hz figure as a design target, not a measured
result.

---

## 6. What is deliberately out of scope

- **NativeWind.** Not a gap — an evidence-backed exclusion. NativeWind 4.2.6
  hard-requires Tailwind v3 and this project's theming story is Tailwind v4;
  the two cannot share one `node_modules` tree. See
  [`theming.md`](./theming.md).
- **Phase 2 of the image pipeline** (blurhash/thumbhash placeholder decoding).
  Owned by your image component. See [`image-pipeline.md`](./image-pipeline.md).
- **Per-corner radii.** `ShapeInfo.r` is a single uniform radius.
- **Rotation on web.** `getBoundingClientRect()` is axis-aligned, so a rotated
  leaf reports a box larger than itself. Uniform, non-uniform and `zoom`
  scaling *are* supported.
- **Closed shadow roots on web.** Open roots are traversed. Closed roots are
  not merely untraversable, they are undetectable, so there is not even an
  honest degradation flag to raise.
