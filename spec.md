# Specification: autoskeleton v1

> Change: `auto-skeleton-v1` — SDD phase 1 (spec).
> Package identifier: `autoskeleton` (never `auto-skeleton`).
> Source of truth: `docs/product-brief.md`. Upstream: `sdd/auto-skeleton-v1/proposal`, `sdd/auto-skeleton-v1/explore`.
> This document describes WHAT the system must do. It does not prescribe implementation.

## Scope note

Ten new capabilities are in scope for v1 (greenfield repository, no existing behavior to modify):
`shape-detection`, `snapshot-cache`, `skeleton-rendering`, `virtualized-lists`, `ssr-cold-snapshot`,
`component-api`, `theming-interop`, `accessibility-and-motion`, `observability`, `package-distribution`.
All requirements below are ADDED requirements against a greenfield baseline.

---

## 1. User Stories

### 1.1 Simple screen (single wrapped view, cold cache)

As a developer, I want to wrap a screen with `<AutoSkeleton isLoading>` and get a faithful
placeholder derived from the real layout, with no manually authored skeleton.

**REQ-SIMPLE-1**: The system MUST traverse the wrapped subtree's rendered layout (native view
tree post-Yoga, or DOM boxes) when no cached snapshot exists for the composite key, and MUST
render shimmer placeholders matching the detected frames before the first paint of loading state.

#### Scenario: Cold load, no prior cache entry
- GIVEN a screen wrapped in `<AutoSkeleton isLoading skeletonKey="profile">` with `isLoading=true`
  and no snapshot cached for `profile` at the current `viewportWidth + fontScale + RTL + platform`
- WHEN the screen mounts
- THEN the sensor traverses the real subtree and derives one or more `ShapeInfo` rects
- AND the renderer draws shimmer placeholders at those exact frames (position, size, radius)
- AND the derived snapshot is persisted to the `ShapeStore` under the composite key

#### Scenario: The shimmer moves the HIGHLIGHT, never the placeholders (G.18)
- GIVEN a painted skeleton whose placeholders sit at the detected frames
- WHEN the shimmer animation runs through a complete period
- THEN the region the skeleton covers is identical at every phase of that period
- AND every point inside a placeholder is opaquely painted at every phase, including
  both extremes of the sweep, so the real content is never exposed mid-cycle
- AND only the highlight band's position within that stationary region changes

#### Scenario: Container-vs-leaf resolution
- GIVEN a container view with a non-transparent background that contains one or more detectable
  leaf nodes (text, image, input) in its subtree
- WHEN the sensor traverses that subtree
- THEN the leaves are rendered as individual shapes and the container's own shape is omitted
- AND if the subtree contains no detectable leaves, the container's own shape is rendered instead

#### Scenario: Android corner radius — RESOLVED BY ON-DEVICE MEASUREMENT (2026-08-27)
- GIVEN a native Android view with a rounded background
- WHEN the sensor detects that view as a shape
- THEN the rendered skeleton rect MUST use the view's actual corner radius when the runtime can
  determine it, via the ADR-2 ladder R0 (typed `radius` hint) -> R1 (`Outline.getRadius()`) ->
  R3 (`SkeletonProvider.defaultRadius`)
- AND WHEN the radius cannot be determined, the system MUST degrade to the defined fallback and
  MUST record the rung in `radiusSourceHistogram` — silent radius-0 degradation with no signal
  is a defect

**MEASURED LIMITATION — Android cannot recover the radius of a rounded RN view through any
public API.** Instrumented on a real device (API 36, density 2.625, RN 0.87.1) against the
production `BackgroundStyleApplicator`:

| requested radius | rung that resolved | value |
|---|---|---|
| 0 | R1 `Outline` | 0.0 exact |
| 4 | R3 `default` | 0.0 |
| 12 | R3 `default` | 0.0 |
| 24 | R3 `default` | 0.0 |
| 9999 (pill) | R3 `default` | 0.0 |

R1 succeeds ONLY for the square case: `getOutline()` calls `outline.setPath(...)` for rounded
views, leaving `Outline.getRadius()` at `RADIUS_UNDEFINED` (`Float.NEGATIVE_INFINITY`) with no
public path getter. R2 (raster corner probe) attempted zero probes because
`CompositeBackgroundDrawable.getConstantState()` returns `null` on a real device; it ships
DISABLED by default with a tested opt-in.

- Scenario: rounded Android view WITHOUT a `radius` hint
  - GIVEN an Android view with a 12 dp corner radius and no `radius` hint
  - WHEN the sensor measures it
  - THEN the shape resolves through R3 to `SkeletonProvider.defaultRadius`
  - AND `radiusSourceHistogram.default` is incremented for that shape
  - AND a development warning fires once the `default` rung exceeds the configured share of a
    screen's shapes (REQ-OBS-BUDGET-2)
- Scenario: rounded Android view WITH a `radius` hint
  - GIVEN the same view with `radius={12}`
  - WHEN the sensor measures it
  - THEN the shape resolves through R0 with the exact hinted radius
  - AND `radiusSourceHistogram.hint` is incremented

**CONSEQUENCE FOR THE PRODUCT PROMISE:** "faithful shapes with no manual annotation" holds fully
on web and iOS. On Android it is DEGRADED for rounded content unless the developer supplies a
`radius` hint or sets a global `SkeletonProvider.defaultRadius`. The typed `radius` hint is
therefore the PRIMARY radius mechanism on Android for rounded content, not a fallback. This
asymmetry MUST be documented prominently in the README, not buried in an API table.

### 1.2 Virtualized lists — sub-case 1: initial load (empty list)

As a developer, I want a skeleton to render before any list data exists, using synthetic rows
sized from a cached or freshly measured template cell.

**REQ-LIST-EMPTY-1**: The system MUST render N synthetic skeleton rows for an empty/loading list
using cached shapes for the declared `itemType`, without requiring any real row to exist yet.

**REQ-LIST-EMPTY-2**: On the first-ever render of a given `itemType` in the app's lifetime (no
cache entry exists), the system MUST render exactly one invisible template cell, measure it once
outside the interaction frame (deferred, non-blocking), and persist the result before any further
synthetic rows use it.

#### Scenario: First-ever render of an itemType
- GIVEN a `<SkeletonList itemType="feedCard" estimatedCount={6} />` with no cache entry for
  `feedCard`
- WHEN the list mounts with `isLoading=true`
- THEN one invisible template cell is measured once, deferred so it does not block the interaction
  frame
- AND the measured shapes are cached under `itemType="feedCard"`
- AND 6 synthetic skeleton rows render using those shapes

#### Scenario: Repeat render, cache present
- GIVEN a cache entry already exists for `itemType="feedCard"`
- WHEN a different screen renders `<SkeletonList itemType="feedCard" estimatedCount={4} />`
- THEN no template cell is measured and no traversal runs
- AND 4 synthetic rows render immediately from the cached shapes

### 1.3 Virtualized lists — sub-case 2: pagination / infinite scroll

As a developer, I want a loading indicator for the next page of a list that matches the real row
shape, rendered via `ListFooterComponent`.

**REQ-LIST-PAGE-1**: The system MUST render skeleton rows inside `ListFooterComponent` using the
same cached shapes as the list's `itemType`, without re-traversing the already-rendered cells.

#### Scenario: Fetching next page
- GIVEN a FlatList/FlashList with real rows already rendered for `itemType="feedCard"` and a cache
  entry present
- WHEN `onEndReached` fires and the next page is loading
- THEN `ListFooterComponent` renders skeleton rows sized from the cached `feedCard` shapes
- AND existing rendered rows are unaffected (no re-traversal, no flicker)

#### Scenario: Page load completes
- GIVEN skeleton footer rows are visible during pagination
- WHEN the next page's data resolves
- THEN the footer skeleton rows are replaced by real rows
- AND no traversal occurs for the newly appended real rows unless they belong to an unseen
  `itemType`

### 1.4 Virtualized lists — sub-case 3: per-cell loading (ZERO-TRAVERSAL-ON-BIND)

As a developer, I want individual cells (e.g. refetching an image or item) to show a skeleton
without any per-bind traversal cost.

**REQ-LIST-CELL-1**: The system MUST resolve a per-cell skeleton via a synchronous cache lookup by
`itemType` on every bind. Traversal MUST NOT run on bind. Traversal MUST run only the first time a
given `itemType` is seen, and MUST be deferred with `runAfterInteractions`.

#### Scenario: Cell rebind with known itemType
- GIVEN `itemType="feedCard"` has a cached snapshot
- WHEN a recycled cell rebinds with `isLoading=true` for `itemType="feedCard"`
- THEN the skeleton shapes resolve via a synchronous cache lookup only
- AND no view-tree traversal is triggered during the bind call

#### Scenario: Cell rebind with unseen itemType
- GIVEN `itemType="promoCard"` has never been measured
- WHEN a cell first binds with `isLoading=true` for `itemType="promoCard"`
- THEN a fallback generic skeleton renders immediately for that bind
- AND traversal for `promoCard` is scheduled via `runAfterInteractions`, not run synchronously on
  bind
- AND subsequent binds of `promoCard` use the now-cached shapes with zero traversal

### 1.5 Pull-to-refresh with existing data

As a user, I want pull-to-refresh to keep showing my existing content by default, not replace it
with a skeleton.

**REQ-PTR-1**: The system MUST NOT show a skeleton during a pull-to-refresh of a screen/list that
already has rendered data, unless the developer explicitly opts out of this default.

#### Scenario: Default stale-while-revalidate behavior
- GIVEN a screen with data already rendered and `<AutoSkeleton isLoading={false}>`
- WHEN the user triggers pull-to-refresh and `isLoading` becomes `true` while stale data is still
  present
- THEN the existing content remains visible (no skeleton overlay)
- AND when fresh data resolves, content updates in place

#### Scenario: Explicit opt-out
- GIVEN the developer has set the documented opt-out flag for a given `<AutoSkeleton>` instance
- WHEN pull-to-refresh sets `isLoading=true` over existing data
- THEN the skeleton renders over/instead of the stale content as it would on a cold load

### 1.6 Navigation between screens (cache hot path)

As a user, I want a screen I've visited before to show its skeleton with the correct shapes from
the very first frame.

**REQ-NAV-1**: The system MUST serve a cached snapshot synchronously (no traversal) when a screen
with a matching composite key (`skeletonKey + itemType + viewportWidth + fontScale + RTL +
platform`) has been previously measured.

#### Scenario: Returning to a previously visited screen
- GIVEN screen `profile` was previously measured and cached at the current composite key
- WHEN the user navigates back to `profile` with `isLoading=true`
- THEN the skeleton renders with the cached shapes on the first frame
- AND `onMetrics` reports `cacheHit: true` and `traversalMs: 0`

#### Scenario: Composite key invalidation on rotation
- GIVEN a cached snapshot exists for `profile` at `viewportWidth=390`
- WHEN the device rotates and `viewportWidth` changes to `844`
- THEN the previous cache entry is not served
- AND the sensor traverses again and persists a new snapshot under the new composite key

### 1.7 Images: skeleton → placeholder → image pipeline

As a developer, I want the skeleton for an image to hand off cleanly to whatever progressive
loading the underlying image component provides, without fighting it.

**REQ-IMG-1**: The system MUST detect image nodes as leaf shapes (native image component classes,
or `img`/background-image elements on web) and render a skeleton for them while `isLoading=true`.

**REQ-IMG-2**: The system MUST relinquish control of the visual once `isLoading` transitions to
`false`; it MUST NOT manage or interfere with any subsequent placeholder-to-full-image transition
(e.g. a low-resolution placeholder) performed by the underlying image component itself.

#### Scenario: Image skeleton to real image, no intermediate placeholder
- GIVEN an image leaf detected inside a wrapped subtree, `isLoading=true`
- WHEN `isLoading` transitions to `false`
- THEN the skeleton unmounts and the underlying image component renders as it normally would
- AND autoskeleton renders no further state for that node

#### Scenario: Image skeleton to real image, with a low-res placeholder
- GIVEN the underlying image component (e.g. an image library supporting a low-resolution
  placeholder) is configured with its own placeholder mechanism
- WHEN `isLoading` transitions to `false`
- THEN the skeleton unmounts immediately
- AND the placeholder-to-full-image transition is owned entirely by the image component, not by
  autoskeleton
- (See Open Questions — this pipeline hand-off is a working assumption, not a brief-sourced fact.)

### 1.8 SSR / Suspense — cold-path replay

As a developer using Next.js, I want a server-rendered skeleton fallback that never mismatches on
hydration, without live layout detection being attempted inside `<Suspense>`.

**REQ-SSR-1**: The system MUST NOT attempt live layout detection inside a `<Suspense>` fallback.
SSR skeleton rendering MUST be replay of a build-time-captured snapshot.

**REQ-SSR-2**: A build-time capture CLI MUST run the target app in headless Chromium across N
declared viewport-width buckets and both RTL directions (LTR/RTL), using a developer-declared
`skeletonKey → route` registry, and MUST emit a serializable snapshot bundle.

**REQ-SSR-3**: The captured bundle MUST be emitted as CSS with one `@media` block per captured
width bucket, so a single server-rendered payload is correct at every width without the server
knowing the viewport.

**REQ-SSR-4**: A server-rendered `<Suspense>` fallback using a captured `skeletonKey` MUST produce
byte-identical markup to what the client renders for the same key before hydration completes
(zero hydration mismatch).

#### Scenario: Server render of a captured skeletonKey
- GIVEN `skeletonKey="dashboard"` was captured by the CLI at width buckets `[360, 768, 1280]` in
  both LTR and RTL
- WHEN a Next.js route server-renders `<Suspense fallback={<AutoSkeleton.SSR skeletonKey="dashboard" />}>`
- THEN the server emits one markup payload with the `@media`-bucketed CSS bundle inlined or linked
- AND the browser at any of the captured widths displays the shapes for its matching bucket with
  no client-side re-measurement
- AND React reports zero hydration mismatch warnings for that fallback

#### Scenario: Uncaptured skeletonKey (residual limit, not a defect)
- GIVEN `skeletonKey="new-widget"` was never captured by the CLI
- WHEN the server renders a `<Suspense>` fallback for `new-widget`
- THEN the server renders a defined neutral generic block for that key
- AND the client renders the identical neutral generic block before any client-side traversal
- AND no hydration mismatch occurs, because server and client rendered the same fallback

#### Scenario: fontScale is unknowable server-side (residual limit, not a defect)
- GIVEN a user has an enlarged system font scale
- WHEN the server renders a captured cold skeleton without knowledge of that user's `fontScale`
- THEN the served skeleton uses `rem`-relative sizing to absorb scale where geometrically possible
- AND the specification acknowledges the skeleton MAY still differ from final rendered content
  for that user; this is a documented constraint, not a bug to be fixed in v1
- AND (2026-08-29) the CLIENT now reads that user's real scale, so their runtime cache key no longer
  matches the captured one and they take a cold measurement rather than a captured hit — a miss that
  measures their layout, in preference to a hit that measures somebody else's. See §4's fontScale row.

### 1.9 Theming via Tailwind v4 / Uniwind

As a developer using a Tailwind-based styling system, I want the skeleton's colors and radius to
follow my theme without extra configuration.

**REQ-THEME-1**: The system MUST expose a CSS-variable contract (`--skl-base`, `--skl-highlight`)
that is themeable via Tailwind v4, and MUST support dark mode via cascade on web.

**REQ-THEME-2**: The system MUST offer an optional subpath export (`autoskeleton/uniwind`) that
maps className-driven values (`backgroundColor`, `color`, `borderRadius`) to skeleton props
(`shimmerBaseColor`, `shimmerHighlightColor`, `defaultRadius`). `uniwind` is the sole theming
interop — see the NON-GOAL below.

**REQ-THEME-3**: The core sensor MUST remain agnostic to the active styling system — it reads
rendered frames and computed styles only, never className strings.

> **NON-GOAL (maintainer decision, 2026-08-28): NativeWind is explicitly NOT supported.**
> NativeWind 4.2.6 hard-requires Tailwind CSS v3 — verified from the published package:
> `dist/metro/tailwind/index.js` and `src/metro/tailwind/index.ts` each throw
> `"NativeWind only supports Tailwind CSS v3"`, gated on an `isV3` check, at two call sites.
> This project's entire theming story is Tailwind v4 (`@theme`, CSS custom properties,
> cascade-driven dark mode; REQ-THEME-1 above). A NativeWind consumer is therefore, by
> construction, a Tailwind v3 consumer — the two are incompatible at the root, not merely
> unsupported by oversight. `uniwind` and `nativewind` also cannot share one `node_modules`
> tree (conflicting Tailwind majors), so the two interops were never simultaneously viable
> in one app regardless of this decision. See §4 (Compatibility Matrix) and §5 (Out of
> Scope) for the full evidence trail, and `plan.md` ADR-17 for the architectural decision
> record.

#### Scenario: Tailwind v4 theme variables
- GIVEN a web app defines `--skl-base` and `--skl-highlight` inside `@theme` or `:root`
- WHEN `<AutoSkeleton>` renders its shimmer overlay
- THEN the shimmer gradient colors resolve from those CSS variables
- AND toggling a dark-mode class changes the shimmer colors via cascade, with no prop change

#### Scenario: Uniwind interop maps className to skeleton props
- GIVEN a native component uses `className="bg-slate-200 rounded-lg"` under `withUniwind`
- WHEN `autoskeleton/uniwind` interop is active
- THEN `shimmerBaseColor` and `defaultRadius` are derived from the resolved className values
- AND the developer supplies no separate skeleton-specific color/radius props

### 1.10 Accessibility

As a user of assistive technology, I want loading content hidden from the accessibility tree and
announced, and I want the shimmer to respect reduced-motion settings.

**REQ-A11Y-1**: While `isLoading=true`, the system MUST hide the underlying real content from
assistive technology (`accessibilityElementsHidden` / `importantForAccessibility="no-hide-descendants"`
on native; `aria-busy="true"` + `role="status"` on web).

**REQ-A11Y-2**: The system MUST announce the loading state to screen readers.

**REQ-A11Y-3**: When the platform's reduce-motion setting is enabled, the system MUST degrade the
shimmer animation to a pulse or static presentation.

#### Scenario: Screen reader hides real content during load
- GIVEN a screen wrapped in `<AutoSkeleton isLoading>` with a screen reader active
- WHEN `isLoading=true`
- THEN the real content subtree is excluded from the accessibility tree
- AND the container carries `role="status"` / equivalent native semantics
- AND a loading announcement is emitted

#### Scenario: Reduce-motion degrades animation
- GIVEN the platform reduce-motion setting is enabled
- WHEN a skeleton with `animation="shimmer"` renders
- THEN the rendered animation is a pulse or static presentation instead of the traveling shimmer
- AND no `transform`-based shimmer sweep is applied

#### Scenario: Reduce-motion is honoured BEFORE hydration on the SSR path
- GIVEN the platform reduce-motion setting is enabled
- AND a server-rendered `<AutoSkeleton.SSR>` skeleton (captured key or ADR-12 neutral block) has
  painted, with no client JavaScript having run yet
- WHEN the first frame is presented
- THEN no `transform`-based shimmer sweep is applied
- AND the degraded presentation is the same opacity pulse the runtime renderer degrades to

The runtime web path satisfies REQ-A11Y-3 in JavaScript (`reducedMotionPreferred()` +
`effectiveAnimation()`), which by construction cannot run pre-hydration: `<AutoSkeleton.SSR>` and
`NeutralSkeletonBlock` are hook-free, DOM-read-free pure functions BECAUSE that purity is
REQ-SSR-4's zero-hydration-mismatch mechanism. The generated SSR CSS bundle
(`cli/media-bundle.ts`) therefore carries a `@media (prefers-reduced-motion: reduce)` block scoped
to the SSR marker attributes — the only mechanism that can express the preference with zero
JavaScript, which is the entire point when nothing has hydrated. It is scoped by specificity
(0,3,0) rather than source order, because a live `<AutoSkeleton>` injects the runtime stylesheet
into `<head>` later and would otherwise win.

---

## 2. Observability Stories

Per brief section 11, observability is a phase-1 requirement: no feature capability is complete
without emitting its metrics and instrumentation. Each capability below is independently
verifiable — "metrics are emitted" alone is not an acceptable acceptance criterion.

### 2.1 `onMetrics` callback

**REQ-OBS-METRICS-1**: Every `<AutoSkeleton>` instance with an `onMetrics` prop MUST invoke it
exactly once per completed skeleton-to-content lifecycle (mount-to-hide transition), with all
seven fields populated as specified below.

| Field | Type | Emitted when / correct value |
|---|---|---|
| `traversalMs` | number | Wall-clock time of the sensor traversal call for this instance. `0` on a cache hit (no traversal ran); `> 0` and `< 2` for a typical (<=60 shape) cold traversal per the NFR budget. |
| `shapeCount` | number | Count of `ShapeInfo` entries produced for this instance, whether from traversal or cache. Never negative; `0` only if the subtree had no detectable content. |
| `cacheHit` | boolean | `true` if the composite key resolved a persisted snapshot without traversal; `false` if traversal ran (cold path, including a first-ever template-cell measurement). |
| `ttfsMs` | number | Elapsed time from `isLoading` becoming `true` to the first skeleton frame being painted. Must be `>= 0`; near-`0` on a cache hit, larger on a cold traversal. |
| `displayDurationMs` | number | Elapsed time the skeleton was visibly shown, from first paint to the `isLoading=false` transition (or content-hide-to-restore). Must reflect wall-clock display time, not traversal time. |
| `platform` | `'ios' \| 'android' \| 'web'` | Matches the runtime platform the instance executed on; never a fourth value. |
| `renderer` | `'native' \| 'skia' \| 'web'` | Matches the renderer tier actually used for this instance (tier-1 native fallback, tier-2 Skia overlay, or the CSS web renderer). |

#### Scenario: Cold load reports traversal cost
- GIVEN a first-ever cold load for `skeletonKey="profile"` with 12 detected shapes
- WHEN the skeleton-to-content lifecycle completes
- THEN `onMetrics` fires once with `cacheHit: false`, `shapeCount: 12`, `traversalMs > 0`, and
  `renderer`/`platform` matching the executing environment

#### Scenario: Hot load reports zero traversal cost
- GIVEN a cached snapshot exists for `skeletonKey="profile"` at the current composite key
- WHEN the same screen mounts again
- THEN `onMetrics` fires once with `cacheHit: true` and `traversalMs: 0`
- AND `ttfsMs` is measurably smaller than the cold-load `ttfsMs` for the same key

### 2.2 Native profiler markers

**REQ-OBS-PROFILE-1**: The system MUST emit `os_signpost` intervals (iOS) and
`Trace.beginSection`/`endSection` (Android) around traversal, JSI serialization, and draw, and
MUST emit `performance.mark`/`performance.measure` around the equivalent phases on web.

**REQ-OBS-PROFILE-2**: Every Android trace section name MUST be <= 127 characters and MUST obey
same-thread begin/end nesting.

#### Scenario: iOS traversal visible in Instruments
- GIVEN a cold traversal runs on iOS
- WHEN captured in Instruments' `os_signpost` / Points of Interest instrument
- THEN a signpost interval labeled for traversal is present, with a nested or adjacent interval
  for JSI serialization, and one for draw

#### Scenario: Android trace section respects the name limit
- GIVEN a traversal runs on Android with Perfetto/Systrace capture active
- WHEN the trace section is opened via `Trace.beginSection`
- THEN the section name is <= 127 characters
- AND `endSection` is called on the same thread before the traversal call returns

### 2.3 `debugOverlay`

**REQ-OBS-OVERLAY-1**: In development builds, setting `debugOverlay` on `<AutoSkeleton>` MUST draw
the outline of every detected shape, annotated with its index, source type
(`text | image | background | synthetic`), and a cache hit/miss badge.

#### Scenario: Debugging a missed node
- GIVEN a developer suspects a text node was not detected
- WHEN `debugOverlay` is enabled and the screen re-renders in loading state
- THEN every detected shape shows its outline, index, source type, and hit/miss badge
- AND the absence of an outline over the suspected node is itself the diagnostic signal

### 2.4 Dev budget warnings

**REQ-OBS-BUDGET-1**: In development builds, the system MUST emit a warning with an actionable
suggestion when traversal exceeds the configured time budget (default 2 ms) or when shape count
exceeds the configured budget (default 60 shapes per screen). Budgets MUST be configurable.

The warning MUST be emitted from the real measurement path. A formatter that is unit-tested in
isolation but never invoked by a sensor does NOT satisfy this requirement: the acceptance
criterion is that a developer running the example app actually sees the warning.

**REQ-OBS-BUDGET-2** (added 2026-08-27, driven by the Android measurement in §1.1): In
development builds, the system MUST emit a warning with an actionable suggestion when the
`default` rung of `radiusSourceHistogram` exceeds a configurable share of a screen's shapes
(default 30%). The suggestion MUST name the remedy — supply `radius` hints, or set
`SkeletonProvider.defaultRadius` to match the design.

This is not a nice-to-have. On Android the `default` rung will account for essentially every
rounded shape, so this warning is the only mechanism that turns an invisible visual degradation
into something the developer can see and act on.

#### Scenario: radius fallback exceeds the configured share
- GIVEN an Android screen where 18 of 20 detected shapes resolve through the `default` rung
- WHEN traversal completes in a development build
- THEN a development-only warning is logged citing 18/20 (90%), the 30% threshold, and the
  actionable remedy
- AND the warning does NOT fire when the share is at or below the threshold

#### Scenario: Traversal exceeds the default time budget
- GIVEN a screen traversal takes 3.4 ms with default budgets
- WHEN the traversal completes
- THEN a development-only warning is logged citing the measured time, the 2 ms budget, and an
  actionable suggestion (e.g. reduce subtree depth, use `<AutoSkeleton.Ignore>`)

#### Scenario: Shape count exceeds the default budget
- GIVEN a screen produces 74 detected shapes with default budgets
- WHEN traversal completes
- THEN a development-only warning is logged citing the measured count, the 60-shape budget, and
  an actionable suggestion

### 2.5 CI benchmark suite

**REQ-OBS-CI-1**: A reproducible CI benchmark suite MUST measure traversal time for 30-shape and
60-shape reference screens, JSI serialization cost, and shimmer frame drops while scrolling a
50-cell list, and MUST fail the pipeline on budget regression.

#### Scenario: Traversal regression fails CI
- GIVEN the 60-shape reference screen benchmark has a recorded baseline of 1.6 ms
- WHEN a change increases measured traversal time to 2.3 ms
- THEN the CI benchmark job fails with the baseline, the measured value, and the exceeded budget

#### Scenario: Frame-drop regression fails CI
- GIVEN the 50-cell scroll benchmark has a recorded baseline frame-drop count
- WHEN a change increases dropped frames beyond the configured tolerance while scrolling
- THEN the CI benchmark job fails, citing the baseline and measured frame-drop counts

---

## 3. Non-Functional Requirements (measurable)

| # | Requirement | Pass/fail criterion |
|---|---|---|
| NFR-1 | Shimmer frame rate | Tier-1 (native fallback) sustains 60 fps on mid-range devices; tier-2 (Reanimated) sustains 120 Hz on ProMotion displays. Fails if measured fps drops below target for more than 5% of sampled frames in the CI scroll benchmark. |
| NFR-2 | Blocked-thread resilience | Tier-1 shimmer continues animating (measurable via frame capture) while the JS thread is synchronously blocked for >= 500 ms. Fails if the shimmer freezes during the block. |
| NFR-3 | Traversal cost | Native traversal completes in < 2 ms for a screen with <= 60 shapes (CI benchmark, p95). Fails if p95 >= 2 ms. |
| NFR-4 | Cache lookup cost | Synchronous cache lookup by composite key completes in < 0.2 ms (CI benchmark, p95). Fails if p95 >= 0.2 ms. |
| NFR-5 | Zero per-frame allocations | The animation path allocates no new objects per frame (Android: shader created once and reused via `Matrix.setTranslate`; JSI: `Float32Array` reused per Nitro ownership rules). Fails if a memory-profiler pass shows per-frame allocation growth during a steady-state shimmer loop. |
| NFR-6 | Web bundle size | The web entry (`.`, no theming interops) is **under a measured gzip budget (7933 B as of 2026-08-29)** with no runtime dependency beyond React. Fails if a production consumer app build of that entry exceeds the budget. **REVISED TWICE — this row is the authoritative record of both revisions; a third revision needs to argue against this precedent, not just raise the number again:**<br>**1. 5 kB → 8 kB (2026-08-27)**, by maintainer decision, after first measurement. The original 5 kB came from the kickoff prompt and was never validated against an implementation. Measured reality at the end of Phase 2 was 7566 B gzip, and the dominant cost was product code (AutoSkeleton, dom-sensor, css-renderer), not incidental bloat — removing the `ShapeStore` serialization methods recovered roughly 1 kB of the 2446 that 5 kB would have required, so the remainder could only have come from cutting real functionality.<br>**2. 8 kB → 9 kB (2026-08-28)**, by maintainer decision. The 8 kB gate did its job — it forced a design decision instead of letting the bundle grow silently — but the decision it forced was a per-platform API divergence: giving web a typed hint channel meant either reusing native's id+registry mechanism (measured 8390 B, over budget) or shipping web with no `<AutoSkeleton.Hint>` component at all, only a raw `data-autoskeleton-radius` attribute (measured 8185 B, 7 bytes of headroom against the 8192 B gate). A user reading the docs would learn two different mechanisms for one concept, in a library whose entire proposition is "one package, all platforms" — a worse outcome than ~250 bytes, and 7 bytes of headroom is not a passing gate but one that fails on the next commit. Raised deliberately to buy back API symmetry (`src/web/Hint.tsx`, mirroring `src/native/Hint.tsx`), not because the gate was inconvenient.<br>**3. MEASUREMENT CORRECTED, budget NOT relaxed (2026-08-29).** The gate was not measuring what this row says it measures. Its own doc comment has always required a *real consumer bundle, tree-shaken and minified*, but it built through Vite's **library** mode, which deliberately keeps `minifyWhitespace: false` so `/* @__PURE__ */` annotations survive for the consumer's own bundler. Identifiers were mangled; every newline, indent and doc comment shipped into the measured artifact — 910 lines of it. The gate was charging this package for its own documentation, at roughly **200 gzip bytes per 370 characters of English prose**, which is a direct tax on commenting the code well and a number no consumer has ever downloaded. A consumer runs an *app* build, not a library build; the gate now models one (rollup bundles and tree-shakes, esbuild minifies for real), with a synthetic entry pinning the whole public namespace so the before/after numbers stay comparable. On identical input: **9023 B as a library, 8209 B via esbuild alone, 7474 B as an app.** **The budget was re-derived so the gate is exactly as strict as before and this buys zero room**: the last library-mode run measured 8995 B against 9216, i.e. 221 B of real headroom, so the new budget is 7475 + 221 = **7696 B**. Verified able to fail: 326 B of reachable public code took it to 7801 and the gate went red. Spending those 221 bytes remains a deliberate maintainer act — they are simply now 221 bytes a consumer actually pays.<br>**4. 7696 B → 7933 B (2026-08-29), by maintainer decision — A RELAXATION, not another correction.** Entry 3 was the ruler being wrong; this is the budget genuinely moving, and a fifth change must argue against BOTH precedents. It buys two real user-facing defects, neither of which had a gate. **(a)** A snapshot measured before its content had layout — an `<img>` with a 0×0 box — was cached with ZERO shapes, and because a replay reuses the same cache key, that empty skeleton replayed forever. Measured against the real component: cold `shapes: 0`; then a real 170×179 box; then replay still `shapes: 0`, `clip-path: none`. A zero-shape result IS sometimes legitimate (a fully `<AutoSkeleton.Ignore>`d subtree), and nothing observable at measurement time separates that from "not ready", so the fix follows G.10's precedent: empty is provisional for a bounded, INSPECTABLE number of attempts (`MAX_EMPTY_MEASUREMENTS`, `emptyMeasurementsFor(key)`), paced by loading cycle rather than frame. **(b)** `useOverlayRenderer` destroyed its handle only on UNMOUNT, so after a completed handoff the handle pointed at a detached subtree and every later cycle announced loading — `aria-busy`, `role="status"`, content `aria-hidden` — while painting nothing. Never caught because the `skeletonOnRefresh` opt-out test starts at `isLoading: false` and so never mounts the overlay a second time; the whole second-cycle path was ungated. **Cost 99 B (7613 → 7712). The budget is set to 7712 + 221, restoring the same working headroom the corrected gate began with, NOT to the measured need**: 7712 exactly would be a gate with zero headroom that fails on the next commit, which is the argument revision 2 already made against accepting 7 bytes and which applies here unchanged.<br>The budget is a measured, defensible number and remains a **HARD FAILING GATE**. |
| NFR-7 | Zero animation-driven re-renders | No React re-render is attributable to the shimmer animation. Fails if a React DevTools Profiler / render-count instrumentation pass records a re-render caused by an animation frame tick. |
| NFR-8 | No memory leaks under recycling | A list-recycling stress test (repeated mount/unmount of skeleton cells over N cycles) shows no retained-memory growth beyond a fixed tolerance. Fails if retained heap size grows monotonically across cycles. |

---

## 4. Compatibility Matrix

| Dependency | Minimum / requirement | Source |
|---|---|---|
| React Native (bare) | 0.83+ (Fabric-only; old architecture removed as of 0.83, not merely deprecated). **Bare RN is a first-class, co-equal target with Expo**, proven by a dedicated bare example app in CI. | Brief §1, §2, §3b |
| React | 19 | Brief §15 (proposal dependencies) |
| Architecture | New Architecture (Fabric) only — old architecture unsupportable, no code path exists on current RN | Brief §2 |
| Expo | Supported via a development build / prebuild. Exact minimum Expo SDK: **to be pinned during implementation**. | Brief §1, §3b |
| Expo Go | **NOT SUPPORTED.** A custom native module is absent from the Expo Go binary. This MUST surface as documented guidance pointing the user to a development build, never as a silent failure. | Brief §3b |
| `react-native-web` / Expo Web | **SUPPORTED for the `<AutoSkeleton>` surface, at `~0.21.0`** (Expo SDK 57's own `bundledNativeModules` pin; `react-dom` `19.2.3`). Proven, not declared, by two gates that were each shown to fail: `test/web/react-native-web.spec.ts` (the DOM sensor against real RNW output) and `test/web/expo-web-export.spec.ts` (a real `expo export --platform web` of `examples/expo`, served and hit-tested in Chromium). **NOT supported on web: the virtualized-list API** (`SkeletonList`, `SkeletonListFooter`, `SkeletonCell`, `useSkeletonCell`, `templateTraversalCounter`) and **the `autoskeleton/uniwind` theming subpath**. See the EXPO WEB CONSTRAINTS block below — the list API's absence is a RUNTIME `undefined`, never a compile error. | Measured 2026-08-29, tasks.md G.17 |
| Autolinking | Two distinct mechanisms must BOTH be satisfied by one published artifact: `@react-native-community/cli` (bare — reads `react-native.config.js`, `.podspec`, `build.gradle`) and `expo-modules-autolinking` (Expo). Whether `create-react-native-library`'s default output satisfies both must be VERIFIED in CI, not assumed. | Brief §3b |
| Metro resolution | `preferNativePlatform: true` is set unconditionally by Metro core (`DependencyGraph.js:153`) and is overridden by NONE of `metro-config` 0.87.0, `@expo/metro-config` 57.0.11, or `@react-native/metro-config` 0.87.1. The explicit `index.web.ts`/`index.native.ts` pair plus `exports` conditions is therefore required and sufficient across bare RN, Expo, and Expo Web alike. | Brief §2 |
| Nitro Modules (if selected by the bridge ADR) | `react-native-nitro-modules` >= 0.37; requires RN >= 0.75, Swift 5.9 / Xcode 16.4 (iOS), NDK 27+ / compileSdk 34+ (Android) | Brief §2 |
| `react-native-reanimated` (tier-2, optional peer) | v4+; New-Architecture-only; requires `react-native-worklets` as an additional peer, version-matched to the Reanimated release | Brief §2, explore §B.6 |
| `@shopify/react-native-skia` (tier-2, optional peer) | >= 2.10 pairs with Reanimated v4+ | Explore §B.6 |
| Tailwind v4 | `@theme` CSS-first syntax; `--skl-base`/`--skl-highlight` declared as plain CSS custom properties (not a recognized Tailwind namespace) | Brief §2, §9; explore §D |
| Uniwind | **v1.11.0** (corrected 2026-08-28 from ~1.2.6). From `uni-stack/uniwind` — a COMPETING project by the Unistyles team, NOT NativeWind's engine (NativeWind's own engine is `react-native-css`). `withUniwind` manual-mapping API confirmed real and matching our assumptions. Pairs with Tailwind v4. | Verified from package source |
| NativeWind | **v4.2.6. INCOMPATIBLE WITH TAILWIND v4** — verified from the published package: `dist/metro/tailwind/index.js` throws `"NativeWind only supports Tailwind CSS v3"` at two call sites, gated on an `isV3` check. A NativeWind consumer is therefore a Tailwind **v3** consumer, and this project's theming story is Tailwind v4. **EXCLUDED (maintainer decision, 2026-08-28) — see §1.9 NON-GOAL / §5 Out of Scope / `plan.md` ADR-17.** The `autoskeleton/nativewind` subpath export and `src/interop/nativewind.ts` have been removed; `uniwind` is the sole theming interop. | Verified from package source |
| Browsers (web renderer) | `clip-path: path()` — Chrome 88+, Edge 88+, Firefox 71+, Safari 15.4+. `shape()` reached Baseline Feb 2026 but is NOT relied upon alone (shorter support tail). `ResizeObserver` — Chrome 64+, Firefox 69+, Edge 79+, Safari 13.1+. `MutationObserver` — near-universal. | Brief §2; explore §C |
| Shadow DOM (web sensor) | **OPEN roots are SUPPORTED** — traversed alongside the light DOM, so a custom-element design system produces shapes instead of a hole. A slotted light child is still shaped exactly once (it is reached through `host.children`; the shadow `<slot>` itself paints nothing). **CLOSED roots are NOT supported and CANNOT be reported.** They are not merely untraversable: they are undetectable. `host.shadowRoot` is `null` for a closed host and for an ordinary element alike, `children.length` and `textContent` agree too, and the only observation that distinguishes them (`attachShadow` throwing) requires mutating the consumer's DOM, which a read-only sensor must never do. There is therefore no honest `DegradationFlag` to raise — a flag would have to be either unraisable or a guess. | Measured 2026-08-29, `test/web/shadow-dom.spec.ts` |
| Scaled ancestors (web sensor) | **SUPPORTED for uniform and non-uniform scaling**, by all three CSS mechanisms that produce it: `transform: scale()`, the independent `scale` property (for which computed `transform` is the string `'none'`), and `zoom` (whose computed value appears on the ancestor, never on the measured root). The sensor reports the traversal root's OWN coordinate space, which is what `ShapeInfo` documents and what the overlay — mounted inside that same scaled subtree — is drawn in. The accumulated factor is derived per axis from the root's composed rect against its layout box, and a difference of at most 1 px is treated as `offsetWidth` integer rounding rather than a transform, so an unscaled tree measures bit-identically to before. A scale applied BELOW the traversal root is real visual geometry and is deliberately left untouched. **ROTATION is NOT supported** — `getBoundingClientRect()` returns an axis-aligned bounding box under rotation, so a rotated leaf already reported a box larger than itself before this and still does; it is out of scope for v1, not silently handled. | Measured 2026-08-29, `test/web/dom-sensor.spec.ts`, `test/web/auto-skeleton.spec.ts` |
| Text scale / `fontScale` (web) | **A web analogue DOES exist and is now read** (corrected 2026-08-29; the previous row here claimed the opposite and was wrong). A `font-size: medium` probe resolves to the browser's own default-font-size preference, so it reports what the READER chose; the document root does not, because the author's stylesheet can set it and the `html { font-size: 62.5% }` reset is common. Measured through CDP's real preference surface: default → root 16 px, probe 16 px, text height 54; preference 24 → root 24 px, probe 24 px, text height **112**; preference 24 with the page resetting its own root to 62.5% → root 15 px, probe **24 px**, text height 34. The text a skeleton must match genuinely doubles, so this belongs in the cache key. `src/web/AutoSkeleton.tsx` reads it once per session and caches it (attaching a probe costs a style recalc, and it is called during render); a mid-session preference change is therefore not picked up, and the browser exposes no event for one. Quantized through the SAME `quantizeFontScale` native uses, so both platforms bucket identically. Cost: **138 B gzip** of NFR-6's 221 B of real headroom, spent by maintainer decision. Page zoom, the closest thing a web user reaches for, does not change CSS-pixel geometry, so it has nothing to invalidate. **CONSEQUENCE, stated rather than discovered later:** the SSR capture CLI writes the neutral `1` because the preference is unknowable server-side, so a reader with an enlarged default font now MISSES every captured SSR entry and takes a cold measurement instead. That is the intended trade — a miss yields geometry measured for that reader, where a hit would have yielded geometry measured for somebody else. | Measured 2026-08-29, `test/web/font-scale.spec.ts` |
| Test tooling | Vitest (core, unit); Playwright (layout-sensitive tests and the SSR capture CLI) — jsdom cannot perform real layout (jsdom #653, #3729) | Brief §2, §15 |
| Build tooling | `create-react-native-library` + `react-native-builder-bob` 0.43.0. **S4 is RESOLVED: a distinct web entry IS supported, no custom tooling needed** — builder-bob's `compile.js` is a filename-preserving per-file Babel transpile (globs `**/*`, writes `path.join(output, path.relative(source, filepath))`), so `src/index.web.ts` emits `index.web.js` automatically. Two caveats: `exports` conditions must be hand-authored (`init.js:182-223` generates a default without them and PROMPTS TO REPLACE an existing one — decline it), and the NFR-6 gzip budget must be measured on a consumer bundle, never on builder-bob output. | Brief §14 |

---

**EXPO WEB CONSTRAINTS (measured 2026-08-29, tasks.md G.17).** Every claim below was measured
against `react-native-web@0.21.2` in a real browser or against a real `expo export --platform web`;
none of it is inferred from reading RNW's source alone.

1. **The DOM sensor is correct against react-native-web output.** This was the open question, because
   RNW emits none of the semantic markup the sensor was written against: a `<View>` is a `<div>` with
   `display:flex` and `background-color: rgba(0,0,0,0)`, and a top-level `<Text>` is ALSO a `<div>`
   (a `<span>` when nested), not a text-bearing tag. `isTextLeaf` does not require a text-bearing
   tag — it requires zero element children and non-empty `textContent`, which an RNW `<Text>` div
   satisfies exactly — so text still resolves per line box via `Range.getClientRects()`, `<View>`
   backgrounds and radii resolve from computed style, and `<TextInput>` renders a real `<input>`.

2. **`<Image>` is the one real asymmetry with native.** RNW attaches `background-image` (and renders
   its hidden accessibility `<img>`) only once `ImageLoader` reports LOADED. Until then the whole
   `<Image>` is a transparent box that paints nothing, so there is nothing for the sensor to shape —
   whereas a native sensor shapes the image view's leaf class regardless. Mitigation, verified by a
   test: give the `<Image>` a `backgroundColor`, and its own box is shaped. A loaded `<Image>`
   produces exactly ONE shape (the hidden `opacity: 0` `<img>` is skipped — see NFR-6 note below).

3. **Mixed-content text loses the unwrapped run.** `<Text>Outer <Text>inner</Text></Text>` shapes only
   `inner`. This is pre-existing and platform-agnostic (identical for `<p>Hello <b>x</b></p>`), not
   an RNW regression; it follows from `isTextLeaf` requiring zero element children.

4. **`autoskeleton/uniwind` is native-only.** It imports `src/native/AutoSkeleton`, so a web build
   fails hard at bundle time with `Importing native-only module
   "react-native/Libraries/Utilities/codegenNativeComponent" on web`. That is a loud, correct
   failure, and `examples/expo` splits `App.web.tsx` from `App.tsx` because of it.

5. **The virtualized-list API is a native-only NON-GOAL, and its absence on web is a RUNTIME
   `undefined` — NOT a compile error.** Do not assume the type system catches this. Expo's own
   `expo/tsconfig.base.json` sets `customConditions: ['react-native']` with no platform variation,
   and TypeScript has no notion of a build platform, so one tsconfig typechecks a universal app for
   iOS, Android AND web at once against the NATIVE declarations. Measured: `tsc --noEmit` reports
   zero errors for `import { SkeletonList } from 'autoskeleton'`, `expo export --platform web`
   bundles successfully, and the served page reports `SkeletonList=undefined` with no page error.
   `test/packaging/entries.test.ts` now pins both halves of that asymmetry so it cannot drift.
   **The supported pattern is a `.native.tsx` file split**, exactly as `examples/expo` does for its
   own screen.

   Why native-only rather than a web implementation or a graceful degradation: the API's contract is
   virtualized-cell recycling amortisation (measure a template once, replay the cached snapshot into
   every recycled cell, count the traversals that actually ran). Web has no recycling and no bridge,
   so `useSkeletonCell`'s `cacheHit`/`isFallback`/`pendingTemplateNode`/`templateRef`/
   `onTemplateLayout` and `templateTraversalCounter` have no web referent — a web export would have
   to report values that are structurally meaningless. NFR-6 then decides the rest. Measured against
   the 9216 B budget, from an 8862 B baseline (354 B headroom):
   throwing native-only stubs **9097 B** (+235); a stub-level graceful degradation **9108 B** (+246);
   a degradation with a truthful cache key and store read **9152 B** (+290, 64 B left). Every option
   consumes 66–82 % of all remaining headroom — for reference, the last two real web fixes cost 24 B
   and 12 B each — so shipping one is materially the same decision as revising the budget, which is
   the maintainer's call and not taken here.

**THEMING CONSTRAINT (measured 2026-08-28):** `uniwind` and `nativewind` CANNOT share one
`node_modules` tree — they require conflicting Tailwind CSS majors (v4 and v3 respectively).
A consumer picks one. The two subpath interops are therefore mutually exclusive in practice,
not merely optional. Document this prominently; a user who installs both will get a broken build,
not a warning.

## 5. Out of Scope for v1

Per brief section 13:

- Old RN architecture (pre-Fabric) — it no longer exists as of RN 0.83.
- Disk persistence of the snapshot cache (the `ShapeStore` interface must permit it later; v1 is
  in-memory only).
- Per-corner border-radius detection on Android (v1 supports a single uniform radius per shape).
- Vue, Svelte, or any non-React framework.
- **NativeWind theming interop (maintainer decision, 2026-08-28).** NativeWind 4.2.6
  hard-requires Tailwind CSS v3 (`"NativeWind only supports Tailwind CSS v3"`, thrown
  unconditionally by `dist/metro/tailwind/index.js`), incompatible with this project's
  Tailwind-v4 theming story (REQ-THEME-1). A NativeWind user is a Tailwind v3 user; `uniwind`
  is the sole theming interop. See §1.9's NON-GOAL note and §4's compatibility matrix.

---

## 6. Open Questions

Execution mode is `auto`; these could not be resolved interactively. Each carries the working
assumption in force for this spec, carried over from the proposal's question round unless noted.

1. **Capture-CLI ergonomics** — is a developer-declared `skeletonKey → route` registry acceptable
   for v1, or should route auto-discovery be attempted? **Assumption: declared registry.**
2. **Uncaptured-key SSR behavior** — neutral generic block, rendered identically on server and
   client. **Assumption: confirmed in REQ-SSR / §1.8 scenario above; this is the current working
   contract, not yet user-ratified.**
3. **Tier-2 Skia positioning** — opt-in extra vs. documented default for Reanimated-equipped teams.
   **Assumption: opt-in**, per proposal.
4. **Spike-failure policy for Android leaf class names (S3)** — if `ReactTextView` /
   `ReactImageView` / `ReactEditText` prove unreliable across targeted RN builds, does v1 ship
   iOS-complete with degraded Android detection, or does Android block release? **Assumption:
   Android blocks release**, per proposal.
5. ~~**Web bundle size gate**~~ — **RESOLVED 2026-08-27, budget revised a second time 2026-08-28.**
   It is a hard failing CI gate. Revised from 5 kB to 8 kB after the first real measurement
   (7566 B), then from 8 kB to 9 kB to buy back web/native API symmetry for the typed-hint
   channel rather than ship a per-platform API divergence over ~250 bytes. See NFR-6 for the
   full two-revision history. Original question text: is the < 5 kB gzip target (NFR-6) a hard
   failing CI gate or a tracked budget? **Assumption: failing gate**, per proposal.
6. **Image pipeline hand-off (§1.7)** — the skeleton→placeholder→image transition described here
   is a working interpretation (autoskeleton owns only the "no data" phase and cedes control on
   `isLoading=false`), since neither the brief nor the exploration document a specific
   blurhash mechanism. **Assumption: autoskeleton does not implement or manage blurhash decoding
   itself; it only governs the skeleton-visible phase.** This should be confirmed or corrected
   before `plan.md` designs the image leaf contract.
7. **Android corner-radius mechanism (brief §2, §14 ADR)** — deliberately left unresolved by this
   spec, which states only the observable requirement (§1.1 scenario) and the probe-miss
   telemetry requirement. The mechanism choice among (a) internal-class reflection, (b) Fabric
   shadow-node props, (c) typed-hint fallback, is owned by `plan.md`.
8. **Native bridge choice for `getShapes`** — Nitro vs. Turbo+codegen vs. hand-written JSI is an
   ADR owed by `plan.md` (brief §3). This spec only fixes the observable contract: a flat
   `Float32Array` `[x,y,w,h,r] x N` with a schema-version slot.
9. **Build tooling for the dual web/native entry (spike S4)** — whether
   `create-react-native-library`/`react-native-builder-bob` can ship a distinct web entry point is
   unresolved. **Assumption: proceed with the standard toolchain first; fall back to custom
   build tooling if S4 resolves negatively during `plan.md`.**
