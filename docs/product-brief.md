# autoskeleton — Product Brief (SDD input, v1)

> Single source of truth for the SDD phases of change `auto-skeleton-v1`.
> Every phase agent (propose / spec / design / tasks) MUST read this file before working.
> Written in English per the artifact-language contract.

## 1. Product

**Package name: `autoskeleton`** (npm, unscoped, verified available 2026-08-27).

The original working name `auto-skeleton` is TAKEN on npm (v1.4.12, a puppeteer-based
skeleton generator, last published 2021-04-26, abandoned). Do not use it anywhere.
Related occupied names: `react-auto-skeleton`, `auto-skeleton-react-and-native`,
`react-native-auto-skeleton`.

A library of **automatic** skeleton loaders. You wrap existing UI with
`<AutoSkeleton isLoading>` and the library detects content shapes (text, images,
inputs, containers with a background) from the real rendered layout, then renders
faithful shimmer placeholders. No manually authored skeleton layouts.

One package serves:
- **Bare React Native** iOS/Android (Fabric / new architecture) — a first-class,
  co-equal target, not a footnote
- **Expo** (requires a development build / prebuild; see the Expo Go constraint below)
  and Expo Web
- React web (DOM), including SSR with Next.js and `<Suspense>` fallback

Bare React Native and Expo are BOTH first-class. They are not the same target: they use
two different autolinking mechanisms (section 3b) and must both be proven in CI.

### Differentiators vs existing ecosystem

Measured against `react-native-auto-skeleton`, `react-native-skeleton-placeholder`,
`react-loading-skeleton`, and `auto-skeleton-react-and-native`:

1. Native sensor with deep traversal and coordinate conversion (not just direct children).
2. Snapshot caching of real layouts by composite key, so repeat loads draw a faithful
   skeleton from the first frame.
3. Virtualized lists (FlatList/FlashList) as a first-class case, not an accident.
4. Built-in observability and debug tooling (review-blocking — see section 7).
5. First-class Tailwind v4 / Uniwind theming (NativeWind explicitly excluded as a non-goal —
   see §9).
6. SSR + Suspense on web.

`auto-skeleton-react-and-native` (npm v1.0.3) is a direct competitor with near-identical
positioning and API shape. Differentiation must be demonstrable, not asserted.

## 2. Verified ground truth (from the exploration phase)

These were checked against current documentation and source. Do not re-derive them;
do not contradict them without new evidence.

### Confirmed correct
- iOS coordinate conversion via `convert(rect:to:)`.
- Android coordinate accumulation via `offsetDescendantRectToMyCoords` (scrollX/scrollY
  must be subtracted).
- Shimmer clocks: `CADisplayLink` + `preferredFrameRateRange` (iOS, ProMotion 120 Hz);
  `Choreographer` + `postInvalidateOnAnimation` (Android).
- Translating a `LinearGradient` via `Matrix.setTranslate` + `Shader.setLocalMatrix`
  without reallocating the shader.
- Driving Skia drawing from Reanimated shared values without React re-renders.
  Reanimated 4 is New-Architecture-only and requires `react-native-worklets`.
- iOS Fabric component view classes `RCTParagraphComponentView`,
  `RCTImageComponentView`, `RCTTextInputComponentView` exist.
- jsdom does NOT implement `getClientRects()` geometry (jsdom issues #653, #3729),
  so per-line text measurement cannot be unit-tested in jsdom. Playwright is required.
- `ResizeObserver` / `MutationObserver` availability and cost are acceptable.
- Tailwind v4 `@theme` syntax; Uniwind `withUniwind`; NativeWind `cssInterop`
  (current in v4, deprecated in unreleased v5).
- `os_signpost` / `OSSignposter`; Android `Trace.beginSection` has a 127-character name
  limit and requires same-thread nesting.
- `performance.mark` / `performance.measure` integrate with RUM tooling.
- **RN old architecture is REMOVED as of 0.83** (not merely deprecated). This makes
  Fabric-only v1 the only possible scope, not a simplification.
- `clip-path: path()` is the reliable current cross-browser mechanism for a union of
  rounded rects. CSS `shape()` reached Baseline Feb 2026 but has a shorter support
  tail — do not rely on it alone.
- FlashList v2 deprecated `estimatedItemSize` in favour of automatic
  progressive-refinement measurement.
- Nitro Modules: real zero-copy ArrayBuffer and synchronous methods, requires RN >= 0.75,
  Swift 5.9 / Xcode 16.4, NDK 27+.

### Corrected — the original architecture prompt was wrong here
- **`background-position` does NOT animate on the compositor thread.** Only `transform`
  and `opacity` do. The "shimmer survives a blocked main/JS thread" requirement depends
  on `transform` being the ONLY animated property. `background-position` is removed
  from the animation path entirely.
- **Android corner-radius extraction via background drawables is NOT viable as public
  API. Verified against React Native 0.87.1 source.** This is worse than the original
  prompt assumed and is now a design fork, not a mechanism detail.
  1. **`CSSBackgroundDrawable` no longer exists.** The prompt's `instanceof` chain named
     a removed class. The full current contents of
     `com.facebook.react.uimanager.drawable` are: `BackgroundDrawable`,
     `BackgroundImageDrawable`, `BorderDrawable`, `BoxShadowBorderRadius`,
     `CompositeBackgroundDrawable`, `InsetBoxShadowDrawable`, `OutlineDrawable`,
     `OutsetBoxShadowDrawable`.
  2. **Both relevant classes are Kotlin `internal`** —
     `CompositeBackgroundDrawable.kt:27` and `BackgroundDrawable.kt:27`. They are not
     public API. A third-party library cannot `instanceof` them from Kotlin at all;
     reaching them from Java or reflection depends on bytecode visibility that React
     Native does not guarantee and may restructure in any minor release.
  3. **`Drawable.getOutline()` is a dead end for radius.** Reading
     `CompositeBackgroundDrawable.getOutline` (lines 185-224): when the view has rounded
     borders it builds a Path with `addRoundRect` and calls `outline.setPath(path)`
     (API 30+) or the deprecated `setConvexPath`; otherwise `outline.setRect(bounds)`.
     So in exactly the rounded case, `Outline.getRadius()` returns `RADIUS_UNDEFINED`
     (-1) and `Outline` exposes no public path getter. The public API says "this is
     rounded" and refuses to say by how much.
  The runtime capability probe still beats a version matrix, but it probes private
  implementation detail. `plan.md` MUST resolve this with an ADR choosing between:
  (a) `instanceof`/reflection on internal classes — works today, unsupported, degrades
      silently to radius 0 on any RN restructure;
  (b) reading corner radius from the Fabric props / shadow node — this promotes spike S5
      from an upside to the leading candidate for the PRIMARY mechanism;
  (c) falling back to the already-specified public surface: the typed `radius` hint prop
      plus `SkeletonProvider.defaultRadius` — degraded but honest, zero private API.
  Whichever is chosen, probe-miss telemetry is MANDATORY, because every failure mode
  here is silent.
- **Metro resolves `.native` on WEB too. RESOLVED — verified from source, and the
  original architecture prompt was wrong.**
  Evidence (metro 0.87.0, @expo/metro-config 57.0.11):
  - `metro/src/node-haste/DependencyGraph.js:153` sets `preferNativePlatform: true`
    UNCONDITIONALLY, for every platform including `web`.
  - `metro-resolver/src/resolve.js:587-601` (`resolveSourceFileForAllExts`) expands in
    this order: (1) `.${platform}${ext}`, (2) `.native${ext}` when
    `preferNativePlatform` is set, (3) bare `${ext}`.
  - **None of** `metro-config` 0.87.0, `@expo/metro-config` 57.0.11, or
    `@react-native/metro-config` 0.87.1 (the BARE RN config) overrides
    `preferNativePlatform`. The finding therefore holds identically across bare RN,
    Expo, and Expo Web — the explicit entry pair is the correct and sufficient mechanism
    for all three.
  Consequence: with the originally specified layout (`src/index.ts` for web +
  `src/index.native.ts`), **Expo Web would resolve `index.native.ts`** and pull the
  native layer — and its Skia/Reanimated imports — into a browser bundle.
  **Required mechanism (not optional hardening):** ship an explicit
  `index.web.ts` / `index.native.ts` pair so step (1) wins on web before step (2) can
  fire, PLUS package.json `exports` conditions (`react-native`, `browser`, `default`)
  for Vite/Next/webpack, which do not apply platform extensions at all and resolve
  through `exports` only. The published build must therefore emit
  `dist/index.web.js`, `dist/index.native.js`, and `dist/index.js`, because Metro
  applies the same extension expansion to the RESOLVED dist path, not just to src.
- Nitro ArrayBuffer reuse across synchronous calls is NOT unconditionally safe:
  non-owning (JS-created) buffers are valid only until the sync call returns, and
  buffers are explicitly not thread-safe.
- **`ReactTextView` / `ReactImageView` / `ReactEditText` are CONFIRMED** in React
  Native 0.87.1 at `views/text/ReactTextView.java`, `views/image/ReactImageView.kt`,
  and `views/textinput/ReactEditText.kt`. Note the language split: `ReactTextView` is
  still Java, the other two are Kotlin.

## 3. Package structure (firm)

- One publishable npm package, `autoskeleton`.
- Platform resolution by EXPLICIT extension pair plus `exports` conditions:
  `src/index.web.ts` and `src/index.native.ts`. Never rely on a bare `src/index.ts`
  fallback — Metro would resolve `.native` on web and pull the native layer into a
  browser bundle (proven in section 2).
- Internal layout:
  - `src/core/` — pure TypeScript, zero platform dependencies. Owns the `ShapeInfo`
    model, snapshot cache, cache-key composition and invalidation, metrics, line-synthesis
    heuristics, and the `Sensor` / `Renderer` / `ShapeStore` contracts.
  - `src/native/` — JSI sensor, Skia/Reanimated renderer, native shimmer fallback.
  - `src/web/` — DOM sensor, CSS renderer.
  - Optional tree-shakeable subpath export: `autoskeleton/uniwind` — the sole theming
    interop (§9; NativeWind is an explicit non-goal).
- `@shopify/react-native-skia` and `react-native-reanimated` are OPTIONAL peer
  dependencies. The default native mode works without them (native fallback renderer).
  They are never imported on web.
- TypeScript strict. Workspace with one publishable package plus FOUR example apps:
  **bare React Native (native, CLI autolinking)**, Expo (native, Expo autolinking),
  Vite (web SPA), and Next.js (SSR/Suspense). The bare app is not optional — it is the
  only one that exercises `@react-native-community/cli` autolinking.
- Scaffold: `create-react-native-library` (Callstack), new-architecture template,
  Kotlin/Swift. Library build via `react-native-builder-bob`. Whether that toolchain
  supports a package that also ships a distinct web entry point is UNCONFIRMED and is
  a spike; custom build tooling may be required.
- Fabric-first. Old RN architecture is out of scope (it no longer exists).
- The `getShapes` bridge mechanism is an OPEN DECISION that `plan.md` must resolve with
  an ADR comparing:
  (a) Nitro Modules — zero-copy ArrayBuffer and synchronous methods, at the cost of a
      `react-native-nitro-modules` peer dependency and stricter ownership/threading rules.
  (b) Turbo Module with codegen — no extra dependency, but codegen has NO typed-array
      support (only boxed number arrays), so serialization cost is real.
  (c) Hand-written JSI binding for that one method — zero dependencies, highest
      maintenance burden.
  Evaluate against the zero-dependency requirement of the default mode and the
  serialization budget.

## 3b. Autolinking: bare RN and Expo are two different mechanisms

A single published artifact must satisfy both. They are not interchangeable:

| Target | Mechanism | Reads |
|---|---|---|
| Bare React Native | `@react-native-community/cli` autolinking | `react-native.config.js`, the `.podspec`, `build.gradle` |
| Expo | `expo-modules-autolinking` | its own resolution over the package manifest |

Requirements:

- The package must be installable and buildable in a bare RN app with NO Expo packages
  present, and in an Expo development build, from the same published tarball.
- `create-react-native-library`'s default output is BELIEVED to satisfy both, but this
  must be VERIFIED and cited, not assumed. The bare example app building in CI is the
  proof; a claim in a README is not.
- **Expo Go cannot run this library.** A custom native module is not present in the Expo
  Go binary. Expo users need a development build / prebuild. This must be a documented
  constraint with a clear user-facing guidance path — not a silent failure the user has
  to debug.
- RISK: the CLI autolinking path and the Expo autolinking path can drift independently
  across versions. Detection signal: the bare example app must build in CI on every
  supported RN version in the matrix.

## 4. Native layer (iOS/Android)

### Layout sensor
Deep traversal of the native view tree, post-Yoga-layout.

- **iOS**: recursion using `convert(rect:to:)` to bring each frame into the root
  coordinate system. Leaf detection by component view class
  (`RCTParagraphComponentView`, `RCTImageComponentView`, `RCTTextInputComponentView`)
  plus views with a non-transparent backgroundColor. Radius from `layer.cornerRadius`.
- **Android**: recursion over ViewGroups accumulating offsets with
  `offsetDescendantRectToMyCoords` (subtracting scrollX/scrollY). Leaves:
  `ReactTextView`, `ReactImageView`, `ReactEditText`, and views with a background.
  Border radius read via the runtime capability probe described in section 2.
- **Container rule**: if a container with a background has content leaves in its subtree,
  draw the leaves and omit the container. The container's own shape is used only when
  its subtree has no detectable leaves.
- `<AutoSkeleton.Ignore>` subtrees are excluded (channel: nativeID /
  accessibilityIdentifier on native, `data-*` on DOM).

  **VERIFIED 2026-08-28 — the two platforms do NOT share one prop.** JS `nativeID` reaches Android's lookup tag (`view.setTag(R.id.view_tag_native_id)`) correctly, but on iOS it reaches an unrelated `.nativeId` property the sensor never reads. It is **`testID`** that reaches iOS's `accessibilityIdentifier`, which is what the iOS sensor actually reads. `<AutoSkeleton.Ignore>` therefore stamps BOTH props. Anyone building the typed-hint channel (R0 `radius`, `lines`) will hit this same asymmetry — setting only `nativeID` silently no-ops on iOS.
- **Collapsed text** (data not loaded yet): if a text node measures less than one line,
  synthesize N line rects (height = font lineHeight; width 60–85% varying per line)
  using the `lines` hint when present.

### JSI bridge
`getShapes(cacheKey)` returns a flat `Float32Array` laid out as `[x, y, w, h, r] x N`.
Never an array of objects — object churn across JSI in list contexts is the thing being
avoided. A schema version occupies the first slot for future evolution. Buffer reuse
must respect Nitro's ownership rules (section 2).

### Renderers
- **Default (zero dependencies): fully native shimmer.**
  - iOS: a single layer (CAShapeLayer + gradient) masked with the combined path of
    rounded rects; animation driven by CoreAnimation on the render server.
  - Android: a single draw pass — a `Path` with the union of rects, `canvas.clipPath`,
    and one rect painted with a `LinearGradient` shader created ONCE and translated per
    frame with `Matrix.setTranslate` + `setLocalMatrix`. Rebuilding the shader per frame
    is forbidden. Invalidation via `postInvalidateOnAnimation`.
- **Advanced (opt-in): Skia overlay** consuming the shapes, with Reanimated driving
  shared values (shimmer, per-shape stagger via `withDelay`, shape→content morph on data
  arrival). Animation NEVER passes through React state: shared values → Skia or animated
  native props only.

### Shared shimmer clock
One clock (CADisplayLink / Choreographer in fallback mode; a single shared value in
Reanimated mode) that every instance reads, so the wave crosses the screen or list in
phase. Honour `preferredFrameRateRange` / frame clock for 120 Hz on ProMotion with no
code changes.

Mutating view state (visibility, alpha) inside `dispatchDraw` / the draw pass is
forbidden. Hide/restore happens on the `isLoading` transition, with state saved in a way
that is safe for recycled cells.

## 5. Web layer (DOM)

- **DOM sensor**: TreeWalker over the subtree; leaves = text nodes, `img`, `input`,
  `button`, elements with a background. Frames via `getBoundingClientRect` relative to
  the wrapper root. Radius via `getComputedStyle().borderRadius`. Faithful multi-line
  via `element.getClientRects()` (one rect per line box — no hints needed). Automatic
  invalidation with `ResizeObserver` + `MutationObserver`.
- **Pure CSS renderer — CanvasKit/wasm is forbidden**: a single overlay using
  `clip-path: path()` (union of rounded rects) with the shimmer animating `transform`
  ONLY (compositor thread, so it keeps running at 60fps with the main thread blocked).
  `prefers-reduced-motion` degrades to pulse or static.

### SSR / Suspense — RESOLVED SCOPE DECISION

The user's decision: **the functionality must be complete from the start.** Cold SSR
skeletons are IN SCOPE for v1.

The constraint that forced this decision: a `<Suspense>` fallback renders BEFORE its
children exist, so live layout detection cannot apply to it — there is no layout to
sense, on the server (no layout engine) or on the client. Live auto-detection for a
Suspense fallback is architecturally impossible, not merely hard.

**Therefore SSR is REPLAY, never live detection**, and v1 ships the mechanism that makes
replay work from cold:

- A **build-time snapshot capture CLI**: runs the app in headless Chromium across
  N viewport-width buckets x RTL directions, captures real snapshots, and emits a
  serializable snapshot bundle the server imports.
- The bundle is emitted as **CSS with `@media` blocks per captured width bucket**, so a
  single server-rendered payload is correct at every width. The server does not need to
  know the viewport; the browser selects. This gives zero hydration mismatch by
  construction.
- The CLI requires a developer-declared registry mapping `skeletonKey` to a route to
  visit. This ergonomic cost is real and must be documented, not hidden.
- It reuses the Playwright harness the testing strategy already needs.

**Residual limits that MUST appear in the spec as explicit constraints:**
1. Accessibility `fontScale` is not knowable server-side. Absorb it with `rem`-relative
   sizing where possible; where not, a cold skeleton may differ from the content for
   users with enlarged fonts.
2. A `skeletonKey` never captured at build time has no cold snapshot. Define the
   documented behaviour for that case (server and client must render the SAME thing so
   there is no mismatch).

## 6. Snapshot cache

- When real data loads, the sensor captures the content frames and persists them. The
  next load of the same screen or cell type shows the skeleton with the real shapes from
  the first frame (hot path, no traversal).
- **Composite key is mandatory:**
  `skeletonKey + itemType + viewportWidth + fontScale + RTL direction (+ platform)`.
  Rotation / split-screen, accessibility font size, and RTL changes all invalidate.
- In-memory persistence in v1. The `ShapeStore` interface is designed to allow disk
  persistence later (out of scope for v1) and must use a SERIALIZABLE snapshot format,
  since the build-time capture CLI depends on it.

## 7. Virtualized lists (FlatList / FlashList) — first-class

Three sub-cases requiring explicit design:

1. **Initial load (empty list)**: no cells to measure. Render N synthetic skeleton rows
   using cached shapes for the `itemType`. First time ever in the app's life: render ONE
   invisible template cell (mock data or style dimensions), measure it once outside the
   interaction frame, cache it. Provide a helper component/hook
   (`<SkeletonList itemType estimatedCount />` or equivalent).
2. **Pagination / infinite scroll**: skeleton rows in `ListFooterComponent` using the
   same cached shapes.
3. **Per-cell loading** (image, item refetch): a per-cell wrapper with a hard rule of
   ZERO TRAVERSAL ON BIND — synchronous cache lookup by `itemType`. Traversal runs only
   the first time an `itemType` is seen, deferred with `runAfterInteractions`.

Also: shimmer phase shared across cells (single clock); hide/restore state immune to
recycling; pull-to-refresh with existing data does NOT show a skeleton
(stale-while-revalidate is the default behaviour, with explicit opt-out).

Note: FlashList v2 removed `estimatedItemSize` in favour of automatic
progressive-refinement measurement — the list helper's sizing story must account for that.

## 8. Hints and API

- Hints via TYPED PROPS, never by parsing className (Uniwind transforms className at
  build time): `lines`, `radius`, `ignore`. Core translates them to the per-platform
  channel (nativeID on native, `data-*` on DOM).
- Minimum public API:
  `<AutoSkeleton isLoading skeletonKey animation="shimmer|pulse|none" delay onMetrics debugOverlay>`,
  `<AutoSkeleton.Ignore>`, list helpers, and `SkeletonProvider` for global defaults
  (colors, speed, shared clock).
- `delay` (ms) to avoid skeleton flash on fast loads.

## 9. Theming — Tailwind v4 / Uniwind

- CSS-variable contract: `--skl-base`, `--skl-highlight` (dark mode by cascade on web;
  definable with Tailwind v4 `@theme`).
- Native: a `withUniwind` interop mapping className to skeleton props
  (`backgroundColor -> shimmerBaseColor`, `color -> shimmerHighlightColor`,
  `borderRadius -> defaultRadius`), as an optional subpath export
  (`autoskeleton/uniwind`) — the sole theming interop.
- The sensor is agnostic to the styling system (it reads rendered frames / computed
  styles). Document this explicitly.

### NON-GOAL: NativeWind (maintainer decision, 2026-08-28)

NativeWind is explicitly NOT supported, and this is a verified incompatibility, not
neglect:

- **Measured reason**: NativeWind 4.2.6 hard-requires Tailwind CSS v3. Verified
  independently from the published tarball: `dist/metro/tailwind/index.js` and
  `src/metro/tailwind/index.ts` each throw `"NativeWind only supports Tailwind CSS v3"`
  at two call sites, gated on an `isV3` check.
- This project's entire theming story is Tailwind v4 (`@theme`, CSS custom properties,
  cascade-driven dark mode — see this section above). A NativeWind user is, by
  construction, a Tailwind v3 user; our story is v4. The two are incompatible at the
  root.
- `uniwind` and `nativewind` also cannot share one `node_modules` tree — conflicting
  Tailwind majors — so the two interops could never have coexisted in one app anyway,
  independent of this decision.
- See `spec.md` §1.9 / §4 / §5, and `plan.md` ADR-17 for the full evidence trail and
  the architectural decision record.

## 9b. Image loading pipeline: skeleton -> placeholder -> image

This was requested in the original kickoff as a DOCUMENTED PIPELINE and was accidentally
omitted when this brief was first consolidated. It is restored here.

The three-phase contract:

1. **Skeleton phase** — no data yet. There is no image URL, no dimensions, and nothing to
   decode. `autoskeleton` owns this phase exclusively and renders the shimmer shape.
2. **Placeholder phase** — the image URL and its blurhash/thumbhash have arrived, but the
   full image has not decoded. `autoskeleton` does NOT own this phase and does NOT
   implement, decode, or manage blurhash.
3. **Image phase** — decode complete, the real image is on screen. Not owned by
   `autoskeleton`.

**Decision: `autoskeleton` cedes control at the 1 -> 2 boundary.** When `isLoading`
becomes false, the underlying image component's own placeholder mechanism takes over
(`expo-image`'s `placeholder` prop, `react-native-fast-image`, a web `<img>` with its own
LQIP, etc.).

Rationale, and why this is not a scope dodge:
- Bundling a blurhash decoder would duplicate functionality `expo-image` already ships,
  and would blow the NFR-6 gzip web bundle budget (brief section 12) on its own.
- Owning phase 2 would force `autoskeleton` to take a hard dependency on a specific image
  component, which contradicts the "agnostic to the styling and component system"
  positioning.

What v1 DOES owe, and what the spec and design must specify:
- The transition from 1 to 2 must not flash: define the handoff so the skeleton does not
  unmount before the placeholder can paint.
- The `onMetrics` `displayDurationMs` field must measure ONLY phase 1, not phases 2-3, or
  the perceived-performance metric becomes meaningless.
- Documentation must show the full three-phase pipeline end to end with a worked
  `expo-image` example, so a user is not left to discover the handoff themselves.

## 9c. MEASURED LIMITATION — Android corner radius (2026-08-27)

On-device measurement (API 36, RN 0.87.1) proved that no public Android API can recover the
corner radius of a rounded React Native view:

| requested radius | rung | value |
|---|---|---|
| 0 | R1 `Outline` | 0.0 exact |
| 4 / 12 / 24 / 9999 | R3 `default` | 0.0 |

R1 works only for the square case. R2 (raster probe) attempted zero probes because
`CompositeBackgroundDrawable.getConstantState()` returns `null` on a real device, and ships
disabled by default behind a tested opt-in.

**Consequence:** the typed `radius` hint is the PRIMARY radius mechanism on Android for rounded
content, not a fallback. "Faithful shapes with no manual annotation" holds fully on web and iOS
and is degraded on Android for rounded elements without a hint or a global `defaultRadius`.
Document this asymmetry prominently; do not bury it.

The ADR-2 degradation ladder behaved exactly as designed: it anticipated that R2 might not work
and specified a collapse to R0 -> R1 -> R3, which turned out to be a real, tested path behind a
config flip rather than a reassuring paragraph.

## 10. Accessibility

- Content hidden during loading: `accessibilityElementsHidden` /
  `importantForAccessibility="no-hide-descendants"` on native; `aria-busy="true"` +
  `role="status"` on web. Loading state announced to screen readers.
- Reduce-motion (iOS/Android/web) degrades the animation to pulse or static.

## 11. Observability and debug — VITAL, review-blocking

This is a PHASE-1 implementation requirement, not a final add-on. No feature task counts
as done unless it emits its metrics and instrumentation.

1. **Per-instance metrics callback:**
   ```ts
   onMetrics?: (m: {
     traversalMs: number;       // scan cost
     shapeCount: number;
     cacheHit: boolean;
     ttfsMs: number;            // time-to-first-skeleton-frame
     displayDurationMs: number; // how long the user saw the skeleton
     platform: 'ios' | 'android' | 'web';
     renderer: 'native' | 'skia' | 'css';
   }) => void
   ```
   Designed to forward to RUM (Datadog/Sentry) as custom spans. `displayDurationMs`
   aggregated per screen is the perceived-performance metric.

2. **Native profiler markers**: `os_signpost` (Instruments) on iOS and
   `Trace.beginSection`/`endSection` (Perfetto/Systrace) on Android around traversal,
   JSI serialization, and draw. `performance.mark`/`measure` on web. Respect the
   127-character `Trace` name limit and its same-thread nesting requirement.

3. **`debugOverlay` (dev only)**: draws the outlines of detected shapes with index,
   source type (text/image/background/synthetic), and a cache hit/miss badge — a layout
   inspector. Essential for answering "why did it not detect this node".

4. **Dev budget warnings**: traversal > 2 ms or > 60 shapes per screen emits a warning
   with an actionable suggestion. Budgets are configurable.

5. **CI benchmarks**: a reproducible suite measuring traversal (30/60-shape screens),
   JSI serialization cost, and shimmer frame drops while scrolling a 50-cell list.
   Budget regressions fail the pipeline.

## 12. Non-functional requirements (measurable)

- Shimmer stable at 60 fps on mid-range devices; 120 Hz on ProMotion in Reanimated mode.
  The native fallback shimmer must survive a blocked JS thread.
- Native traversal < 2 ms for a typical screen (<= 60 shapes); synchronous cache lookup
  < 0.2 ms.
- Zero per-frame allocations on the animation path (Android: shader created once;
  JSI: reusable Float32Array, subject to Nitro ownership rules).
- Web bundle (entry `.`, no interops) **< 9 kB gzip** — REVISED TWICE (see spec.md NFR-6 for
  the full record; a third revision must argue against this precedent):
  1. 5 kB → 8 kB (2026-08-27), after Phase 2 measured 7566 B; the 5 kB figure was never
     validated against an implementation and the dominant cost was product code, not bloat.
  2. 8 kB → 9 kB (2026-08-28), by maintainer decision, to buy back one typed-hint API across
     web and native (`<AutoSkeleton.Hint>`) instead of shipping a per-platform API divergence
     at 8185/8192 B — 7 bytes of headroom is not a passing gate, and the asymmetry is a worse
     outcome than ~250 bytes for a library whose entire proposition is "one package, all
     platforms".
  Hard failing gate. No runtime dependencies beyond React on web.
- Zero React re-renders caused by the animation.
- No memory leaks under list recycling (verified by a stress test).

## 13. Out of scope for v1 (must be declared in the spec)

- Old RN architecture (pre-Fabric) — it no longer exists as of RN 0.83.
- Disk persistence of the cache.
- Per-corner border-radius detection on Android.
- Vue/Svelte/other frameworks.
- **NativeWind theming interop (maintainer decision, 2026-08-28)** — verified
  incompatible with this project's Tailwind-v4 theming story (§9). `uniwind` is the
  sole theming interop.

## 14. Required spikes (unresolved, must not be presented as settled)

1. ~~Metro `.native.ts` vs `.ts` resolution under Expo Web~~ — **RESOLVED from source**,
   see section 2. Metro tries `.native` on web as well; the explicit `.web.ts` entry and
   `exports` conditions are mandatory. No spike remains; this is now a design constraint.
2. ~~Actual Android background-drawable class per targeted RN build~~ — **INVESTIGATED,
   and the answer disqualifies the approach.** See section 2: the classes are Kotlin
   `internal`, `CSSBackgroundDrawable` is gone, and `getOutline()` cannot yield a radius.
   This is no longer a spike; it is an ADR that `plan.md` must decide.
3. ~~Exact Android view class names~~ — **RESOLVED, all three confirmed** in RN 0.87.1.
   See section 2.
4. ~~Whether `react-native-builder-bob` can ship a package with a distinct web entry
   point~~ — **RESOLVED, YES, no custom tooling needed.** Verified against
   react-native-builder-bob 0.43.0:
   - Its targets are `commonjs`, `module`, `typescript`, `codegen`, `custom`. There is no
     platform-aware target and therefore nothing to fight.
   - `lib/src/utils/compile.js:11` globs `**/*` and line 38 writes each output to
     `path.join(output, path.relative(source, filepath))` — it is a FILENAME-PRESERVING
     per-file Babel transpile, not a bundler. So `src/index.web.ts` emits
     `lib/module/index.web.js` and `src/index.native.ts` emits `lib/module/index.native.js`
     automatically.
   - CAVEAT: the `exports` conditions must be hand-authored. `lib/src/init.js:182-223`
     generates a default `exports` field with no platform conditions and, if one already
     exists, PROMPTS TO REPLACE IT. Decline that prompt, or repair `package.json` after
     running init.
   - CAVEAT: because builder-bob is not a bundler, the NFR-6 gzip web bundle budget must
     be measured on a consumer bundle (Vite/Next build), never on builder-bob output.
5. Reading corner radius from the Fabric props / shadow node instead of the background
   drawable. **PROMOTED**: no longer an upside spike, it is now the leading candidate for
   the primary Android radius mechanism (see the ADR required in section 2).

## 15. SDD session parameters

- change name: `auto-skeleton-v1`
- execution_mode: `auto`
- artifact_store: `engram` (plus the three explicit file deliverables below)
- delivery_strategy: `auto-chain`
- review_budget_lines: 800
- strict_tdd: true (no test runner configured yet — the first implementation task must
  configure Vitest before any source is written)
- receipt-driven development: OFF for this clone; delivery follows ordinary repository
  policy.

### File deliverables (in addition to Engram persistence)
- `spec.md` at repo root — phase 1
- `plan.md` at repo root — phase 2
- `tasks.md` at repo root — phase 3

### Process rules
- No implementation code during the planning phases.
- Each phase ends with a summary of decisions made and open questions.
- If a constraint in this brief proves technically infeasible, STOP and propose
  alternatives with trade-offs rather than silently deviating.
