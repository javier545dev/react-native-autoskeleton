# Tasks: `autoskeleton` v1 (`auto-skeleton-v1`)

> Phase 3 deliverable. Source of truth: `spec.md` (phase 1) and `plan.md` (phase 2, AMENDED —
> autolinking §3b, image pipeline §9b, ADR-14/15/16). Package identifier: `autoskeleton`.
> `execution_mode: auto`, `delivery_strategy: auto-chain`, `review_budget_lines: 800`,
> `strict_tdd: true`. Repository is greenfield — no source exists yet.
>
> **Deviation note**: this session's brief mandates a fixed 0–9 task ordering, a three-part
> Definition of Done filled in concretely per task (not boilerplate), explicit dependencies,
> complexity, and example-app mapping for all ~55 tasks. That explicit, detailed instruction
> supersedes the generic 530-word tasks-artifact budget for this run.

---

## Review Workload Forecast

This session's `review_budget_lines` is **800**, not the tooling default of 400. The literal
guard line below (`400-line budget risk`) is fixed protocol text for downstream automation;
read its value as "risk against the 800-line session budget," not literally 400.

| Field | Value |
|---|---|
| Estimated changed lines | ~5,000–8,000 authored lines across the full v1 surface (native Swift/Kotlin, TS core, web, CLI, tests, docs). Generated scaffolding (`create-react-native-library` output, Turbo Module codegen) adds thousands more lines that are NOT authored risk and are excluded from the budget per the review-workload guard, but they still land in the repo and must be called out to reviewers. |
| 400-line budget risk (session budget: 800) | **High** — several single phases (Android radius ladder + on-device validation, the Turbo Module bridge + codegen wiring, native sensors with golden-fixture harnesses) plausibly exceed 800 authored lines on their own. |
| Chained PRs recommended | Yes |
| Suggested split | 10 PRs, one per mandated phase (0→9), stacked to `main` in order — see Suggested Work Units below. |
| Delivery strategy | `auto-chain` |
| Chain strategy | `stacked-to-main` — greenfield, unpublished package (plan.md §10: "no consumer is exposed until the first npm publish"); every phase is already an independently revertible slice by the user's mandated ordering, so stacking each phase's PR directly to `main` is lower-ceremony than a tracker branch and matches "auto-chain" (no per-slice user gate). |

```text
Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High
```

`auto-chain` resolves `Decision needed before apply` to `No`: the orchestrator proceeds directly
into Phase 0 using `stacked-to-main`, but **any individual PR whose authored diff exceeds 800
lines** (most likely: Phase 4 Android radius ladder + R2 on-device validation, and Phase 5
bridge/codegen) must be further split by task ID before merge rather than merged as
`size:exception` without asking — `auto-chain` removes the per-slice question, it does not
waive the budget itself.

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|
| 0 | Test runners + scaffold + RISK-5 detector (RED) | PR 1 | `vitest run test/packaging/entries.test.ts` | N/A — no runnable app yet; scaffold-only | Delete `src/`, `ios/`, `android/`, example scaffolds; no downstream code exists yet |
| 1 | Core: contracts, wire, cache, handoff, metrics | PR 2 | `vitest run src/core` | N/A — pure TS, no example app depends on it yet | Revert `src/core/**`; nothing else references it until PR 3 |
| 2 | Web sensor + CSS renderer + web debugOverlay | PR 3 | `vitest run test/packaging/web-bundle.test.ts && playwright test test/web` | `examples/vite` dev server, manual `isLoading` toggle | Revert `src/web/**`, `src/index.web.ts`; core (PR 2) unaffected |
| 3 | iOS sensor + tier-1 renderer + iOS debugOverlay | PR 4 | `xcodebuild test -scheme Autoskeleton` | `examples/bare-rn` iOS build + boot in simulator | Revert `ios/**`; Android (PR 5) and web (PR 3) unaffected |
| 4 | Android sensor + radius ladder + tier-1 renderer + debugOverlay | PR 5 | `./gradlew testDebugUnitTest connectedAndroidTest` | `examples/bare-rn` Android build + boot in emulator | Revert `android/**`; R2 rung individually feature-flaggable to R0/R1/R3 without reverting the PR |
| 5 | `getShapes` Turbo Module bridge + tier-2 Skia renderer + Expo Go guidance | PR 6 | `vitest run test/native/wire-bridge.test.ts && xcodebuild test && ./gradlew connectedAndroidTest` | `examples/bare-rn` + `examples/expo`, both native builds | Revert `src/native/**`; tier-1 renderers (PR 4/5) still function since tier-2 is opt-in |
| 6 | Virtualized lists (3 sub-cases) + recycling safety | PR 7 | native E2E: 50-cell scroll + recycle-stress suite | `examples/bare-rn` FlashList screen | Revert `src/native/list/**`; whole-screen `AutoSkeleton` (PR 6) unaffected |
| 7 | Theming interops (Uniwind/NativeWind) | PR 8 | `vitest run test/packaging/interop-exports.test.ts` + native E2E | `examples/expo` themed screen | Revert `src/interop/**`; default entries untouched (verified by 7.4) |
| 8 | SSR capture CLI + `@media` bundle + hydration bridge + web handoff | PR 9 | `vitest run cli` + `playwright test test/ssr` | `examples/next` build + serve, JS-disabled load | Revert `cli/**`, `src/web/ssr/**`; client runtime (PR 3) unaffected |
| 9 | CI benchmarks + ADR-14 build-matrix gate + docs | PR 10 | `node benchmarks/run.js` | full CI matrix across all four example apps | Revert `benchmarks/**`, docs; no runtime code depends on this PR |

---

## Legend

**Deps** = task IDs that must merge first. **Complexity**: S/M/L. **Example app**: `bare RN` |
`Expo` | `Vite` | `Next.js` | `none/unit-only`. Every task's Definition of Done has three
required parts — **Tests** (named, RED-first), **Observability** (concrete emission or an
explicit exemption), **Performance** (a cited `spec.md` §3 NFR number + how it is measured, or
an explicit "not applicable here").

---

## Phase 0: Prerequisite — test runners + scaffold (strict TDD blocker)

No production code may exist before this phase lands (strict TDD, no runner exists yet —
plan.md §7 preamble).

- [x] **0.1** Scaffold the package with `create-react-native-library` (new-architecture template,
      Kotlin/Swift, package name `autoskeleton` — never `auto-skeleton`).
      **Tests**: none — this task creates the tree that later tests run against; exempt because
      no logic exists yet. **Observability**: N/A, scaffold emits nothing. **Performance**: N/A.
      Deps: none. Complexity: M. Example app: none/unit-only.
- [x] **0.2** Configure Vitest for `src/core/` — `vitest.config.ts` (node env, no DOM), strict
      `tsconfig.json`, `package.json` test script.
      **Tests**: `core/__tests__/smoke.test.ts` proving the runner executes and reports a
      failure correctly; deleted once 1.1 lands. **Observability**: N/A, build tooling.
      **Performance**: N/A. Deps: 0.1. Complexity: S. Example app: none/unit-only.
- [x] **0.3** Configure Playwright: `playwright.config.ts`, pinned browser build in the lockfile,
      `mcr.microsoft.com/playwright` CI container reference, self-hosted test font `.woff2`,
      shared JSON hierarchy fixture directory `test/fixtures/hierarchies/`.
      **Tests**: smoke test loading a blank page and asserting `document.fonts.ready`.
      **Observability**: N/A. **Performance**: N/A. Deps: 0.1. Complexity: M. Example app:
      none/unit-only.
- [x] **0.4** Scaffold native test targets: iOS XCTest target (`SyntheticHierarchyBuilder`
      skeleton, empty) and Android JUnit+Robolectric module + instrumented `androidTest` module.
      **Tests**: one placeholder passing test per platform proving the harness runs in CI.
      **Observability**: N/A. **Performance**: N/A. Deps: 0.1. Complexity: L. Example app:
      bare RN (only app that builds/runs these native targets in CI).
- [x] **0.5** Hand-author `package.json` `exports` conditions (`react-native`, `browser`,
      `default`) per ADR-3 — decline or repair `create-react-native-library`'s default
      no-condition `exports` output (`init.js:182-223`); set builder-bob targets (`commonjs`,
      `module`, `typescript`, `codegen`). Resolves spec Open Question 9 (build tooling), already
      answered by plan.md ADR-3 (`react-native-builder-bob` 0.43.0 emits the entry triple
      natively — verified from source, no custom tooling needed).
      **Tests**: none yet — 0.6 is the test for this. **Observability**: N/A. **Performance**:
      N/A. Deps: 0.1. Complexity: S. Example app: none/unit-only.
- [x] **0.6** **RISK-5 detector, written FIRST per plan.md ordering.** RED packaging test
      `test/packaging/entries.test.ts` (Vitest) asserting against a `npm pack` build: the three
      entries (`index.web.js`, `index.native.js`, `index.js`, plus `lib/commonjs` equivalents)
      exist; `exports` resolves under all three conditions; a Metro resolution simulation for
      `platform:'web'` selects `index.web.js`; the transitive import graph of web-facing files
      excludes `react-native`/Skia/Reanimated specifiers; the tarball contains the root
      `*.podspec`, `android/`, `react-native.config.js`; no `expo-*` in
      `dependencies`/`peerDependencies`. **Stays RED until 5.6 closes it** — this is deliberate.
      **Tests**: the test IS the deliverable. **Observability**: N/A, packaging test.
      **Performance**: N/A. Deps: 0.5. Complexity: M. Example app: none/unit-only.
- [x] **0.7** Scaffold `examples/bare-rn`, `examples/expo`, `examples/vite`, `examples/next`,
      each installing the local package from `npm pack` output via a `file:` tarball reference
      (never a workspace symlink — ADR-14). Wire build-only CI jobs, no assertions yet.
      **Tests**: each app's own boot smoke script. **Observability**: N/A. **Performance**: N/A.
      Deps: 0.5. Complexity: L. Example app: all four.

## Phase 1: Core + contracts + snapshot cache, with tests

- [ ] **1.1** RED→GREEN `src/core/cache-key.ts` — `bucketWidth` against `WIDTH_BUCKETS`,
      `quantizeFontScale` (2 decimals), `composeCacheKey`/`parseCacheKey` round-trip with `|`
      percent-escaping, `keyMatches`.
      **Tests**: `cache-key.test.ts` (Vitest, no DOM). **Observability**: N/A — pure key algebra
      on no lifecycle path; exempt. **Performance**: feeds NFR-4 indirectly but not measured
      standalone here — measured in 1.3 and authoritatively in 9.1. Deps: 0.2. Complexity: M.
      Example app: none/unit-only.
- [ ] **1.2** RED→GREEN `src/core/wire.ts` — `[VERSION,x,y,w,h,r]xN` Float32Array codec, modulus
      check, version negotiation (reject newer, forward-migrate older, raise
      `snapshot-version-mismatch`), `byteOffset===0` assertion.
      **Tests**: `wire.test.ts` — round-trip N=0/1/60; malformed-length rejection; version
      mismatch path. **Observability**: produces the `snapshot-version-mismatch` flag consumed by
      `onMetrics.degraded` (assembled in 1.8) — no emission call here. **Performance**: not
      measured here (pure codec); covered by Phase 9.1 CI benchmark. Deps: 1.1. Complexity: M.
      Example app: none/unit-only.
- [ ] **1.3** RED→GREEN `src/core/snapshot.ts` — `serializeSnapshot`/`deserializeSnapshot`
      (dev sidecars stripped in prod) + `MemoryShapeStore` (sync `get`/`has`/`set`/`delete`/
      `invalidate`/`clear`/`export`/`import`/`subscribe`, LRU cap 128 default per ASSUMPTION
      plan.md §11.6).
      **Tests**: `snapshot.test.ts` + `memory-shape-store.test.ts` (LRU eviction order, invalidate
      predicate, subscribe notifications, import/export round-trip). **Observability**: N/A
      directly; underlies `onMetrics.cacheHit` correctness downstream. **Performance**: NFR-4
      (<0.2 ms p95 sync lookup) — a Vitest micro-benchmark (1000-iteration p95) as a fast local
      guard; authoritative gate is 9.1. Deps: 1.2. Complexity: L. Example app: none/unit-only.
- [ ] **1.4** RED→GREEN `src/core/lines.ts` — collapsed-text line synthesis (N rects, height =
      lineHeight, width 60–85% variance, `lines` hint honored).
      **Tests**: `lines.test.ts` — no-hint default, hinted count, width bounds, height equality.
      **Observability**: tags synthesized shapes `source:'synthetic-line'` in the dev sidecar
      (§4.4). **Performance**: N/A standalone; folded into traversal budget once called from
      sensors (Phase 2–4). Deps: 1.2. Complexity: S. Example app: none/unit-only.
- [ ] **1.5** RED→GREEN `src/core/clip-path.ts` — union-of-rounded-rects → SVG `path()` string,
      reused by the web renderer (2.2) and the capture CLI (8.1).
      **Tests**: `clip-path.test.ts` — single rect, overlapping rects, `r=-1`→`defaultRadius`
      substitution, RTL mirroring. **Observability**: N/A, pure geometry. **Performance**: N/A
      here; contributes to NFR-6, verified in 2.5. Deps: 1.2. Complexity: M. Example app:
      none/unit-only.
- [ ] **1.6** RED→GREEN `src/core/metrics.ts` — budget checks (`budgetMs` default 2,
      `maxShapes` default 60, both configurable), dev-warning formatter with actionable
      suggestion text, `onMetrics` payload shape per spec §2.1/§3.7.
      **Tests**: `metrics.test.ts` — REQ-OBS-BUDGET-1 scenarios (3.4 ms/2 ms warning text,
      74/60-shape warning text), all 7 base `onMetrics` fields typed, `radiusSourceHistogram`
      shape. **Observability**: this module emits `onMetrics`/REQ-OBS-BUDGET-1 warnings — this
      task IS the observability deliverable. **Performance**: NFR-3 threshold (2 ms) and
      shape-cap (60) asserted as constants matching spec §3 exactly. Deps: 1.3. Complexity: M.
      Example app: none/unit-only.
- [ ] **1.7** RED→GREEN `src/core/handoff.ts` — `HandoffController` state machine
      (`skeleton→placeholder→content`), `requestHandoff()` stamps `displayDurationMs`
      immediately, idempotent `notifyPainted()`, `handoffTimeoutMs`/`handoffFadeMs` defaults
      250/120 (ASSUMPTION §11.8), `ImageLeafDescriptor`/`HandoffOptions`/`HandoffReason` (ADR-16).
      **Tests**: `handoff.test.ts` with **fake timers** — successor-painted, timeout,
      no-successor-immediate-fade, idempotency, `displayDurationMs` stamped at `requestHandoff()`
      not at teardown; 100% branch coverage (plan.md §7 unit-table gate). **Observability**: emits
      the `handoffMs`/`handoffReason` split consumed by `onMetrics` (wired in 1.8) — makes REQ-
      IMG-2/ADR-16 testable before any renderer exists. **Performance**: the
      `displayDurationMs + handoffMs ≈ wall time` invariant asserted here under fake-timer
      control. Deps: 1.6. Complexity: L. Example app: none/unit-only. **Resolves spec Open
      Question 6** (image pipeline hand-off) at the type/state-machine level; behavioral no-flash
      proof is Phase 8.4/9.
- [ ] **1.8** RED→GREEN `src/core/contracts.ts` — finalize `Sensor<TTarget>`,
      `Renderer<TSurface>`, `ShimmerClock`, `HintRegistry`, `SensorOptions`/`SensorResult` (types
      only; platform layers implement in Phases 2–5). Add `assembleMetrics(...)` in `metrics.ts`
      composing all `onMetrics` fields from the other core modules.
      **Tests**: `contracts.test.ts` (`expectTypeOf` compile assertions) +
      `assemble-metrics.test.ts` covering REQ-OBS-METRICS-1's cold-load and hot-load scenarios.
      **Observability**: this task IS the metrics-assembly module. **Performance**: N/A, pure
      composition. Deps: 1.7. Complexity: M. Example app: none/unit-only.
- [ ] **1.9** Consolidate `src/core/types.ts` (`ShapeInfo`, `ShapeSnapshot`,
      `SerializedShapeSnapshot`, `DegradationFlag`, `RadiusSource`, `ShapeSource`) — no new logic.
      **Tests**: `types.test.ts` asserting `DegradationFlag` enumerates all 8 documented flags
      (drift guard). **Observability**: N/A. **Performance**: N/A. Deps: 1.8. Complexity: S.
      Example app: none/unit-only.

## Phase 2: DOM sensor + CSS renderer + web `debugOverlay`

- [ ] **2.1** RED→GREEN `src/web/dom-sensor.ts` (`Sensor<HTMLElement>`) — `TreeWalker`
      traversal, leaf detection (text/`img`/`input`/`button`/background), `getBoundingClientRect`
      framing, `getComputedStyle().borderRadius`, `element.getClientRects()` per-line text,
      `ResizeObserver`+`MutationObserver` `observe()` (REQ-NAV-1 invalidation channel), `Ignore`
      via `data-*`, container rule.
      **Tests**: Playwright `test/web/dom-sensor.spec.ts` against shared fixtures, 0.5 px
      tolerance — multi-line 1/2/5-line-box, justify, RTL; container rule both branches; Ignore
      subtree; **jsdom explicitly banned** (plan.md §7.3). **Observability**: `performance.mark`/
      `performance.measure` around traversal (REQ-OBS-PROFILE-1 web); dev sidecars populated when
      `collectDebugSidecars`. **Performance**: NFR-3 (<2 ms, ≤60 shapes) measured here as a local
      guard on web; authoritative gate is 9.1. Deps: 1.9. Complexity: L. Example app: Vite.
- [ ] **2.2** RED→GREEN `src/web/css-renderer.ts` (`Renderer<HTMLElement>`) — single
      `clip-path: path()` overlay (reuses 1.5), shimmer animates `transform` ONLY (ADR-6 — lint
      rule + CSS-output assertion banning `background-position` anywhere in the codebase),
      `prefers-reduced-motion`→pulse/static, `ShimmerClock` CSS driver via negative
      `animation-delay` from `startedAt`.
      **Tests**: Playwright — `clip-path` text-snapshot; ADR-6 `background-position` ban
      assertion; reduced-motion pixel diff with `maxDiffPixelRatio`, masked animation region (the
      one deliberate pixel test in the suite); NFR-2 proxy — CSS animation keeps running with the
      JS thread synchronously blocked. **Observability**: `performance.mark` around draw (REQ-OBS-
      PROFILE-1); `debugOverlay` itself is 2.4. **Performance**: NFR-1 (60 fps proxy) and NFR-7
      (zero React re-renders from animation, asserted via a React DevTools profiler hook showing
      no commit during a shimmer cycle). Deps: 2.1. Complexity: L. Example app: Vite.
- [ ] **2.3** RED→GREEN `<AutoSkeleton>` web component — `src/index.web.ts`,
      `src/web/AutoSkeleton.tsx`: `isLoading`, `skeletonKey`, `animation`, `delay`, `onMetrics`,
      `debugOverlay`; a11y (`aria-busy="true"`, `role="status"`, real content `aria-hidden`);
      `SkeletonProvider`; `<AutoSkeleton.Ignore>`.
      **Tests**: Playwright — REQ-SIMPLE-1 cold-load scenario; REQ-A11Y-1/2 scenarios; REQ-PTR-1
      default-stale + opt-out scenarios; **REQ-NAV-1** hot-path scenario (`cacheHit:true`,
      `traversalMs:0` on revisit) and composite-key rotation-invalidation scenario (viewport width
      change → new key → re-traversal). **Observability**: wires `onMetrics` from 1.8, fires
      exactly once per REQ-OBS-METRICS-1; `ttfsMs` measured from `isLoading→true` to first paint.
      **Performance**: NFR-6 — this is the web entry point; gzip measured on the Vite consumer
      build in 2.5, never on builder-bob output (ADR-3 caveat). Deps: 2.2. Complexity: L. Example
      app: Vite.
- [ ] **2.4** RED→GREEN web `debugOverlay` — outline every detected shape with index, `source`
      type, cache hit/miss badge (REQ-OBS-OVERLAY-1), dev-build only.
      **Tests**: Playwright — outline count == shape count with correct annotations; verifies the
      "missed node" diagnostic scenario. **Observability**: this task IS REQ-OBS-OVERLAY-1's web
      deliverable. **Performance**: N/A, dev-only, tree-shaken from production (verified by 2.5).
      Deps: 2.3. Complexity: M. Example app: Vite.
- [ ] **2.5** RED→GREEN web packaging — Vite consumer bundle build, `<5 kB gzip` assertion
      (NFR-6, spec Open Question 5 assumption: **failing gate**) measured on the built bundle;
      extend 0.6's packaging test to assert `index.web.js`'s transitive graph excludes native/Skia
      /Reanimated specifiers (closes the web-entry portion of the RISK-5 detector).
      **Tests**: `test/packaging/web-bundle.test.ts` (Vitest, reads Vite build output).
      **Observability**: N/A, packaging test. **Performance**: NFR-6, hard failing CI gate.
      Deps: 2.4, 0.6. Complexity: M. Example app: Vite.

## Phase 3: iOS native sensor + native fallback renderer + iOS `debugOverlay`

- [ ] **3.1** RED→GREEN `ios/AutoskeletonSensor.swift` — recursive traversal via
      `convert(rect:to:)`, leaf detection (`RCTParagraphComponentView`,
      `RCTImageComponentView`, `RCTTextInputComponentView`) + non-transparent-background
      containers, radius via `layer.cornerRadius`, container rule, `Ignore` via
      `accessibilityIdentifier`, collapsed-text synthesis, `observe()` for orientation/fontScale/
      RTL (REQ-NAV-1 invalidation channel).
      **Tests**: XCTest `SyntheticHierarchyBuilderTests.swift` against shared fixtures at 0.5 pt
      tolerance — nested offsets, scrolled `UIScrollView` ancestor, container rule both branches,
      Ignore subtree, collapsed text, transformed ancestor, RTL, REQ-NAV-1 rotation-invalidation.
      **Observability**: `os_signpost`/`OSSignposter` intervals around traversal (REQ-OBS-
      PROFILE-1), asserted by a dedicated XCTest. **Performance**: NFR-3 local guard here;
      authoritative gate is 9.1. Deps: 1.9, 0.4. Complexity: L. Example app: bare RN (CLI
      autolinking proof) + Expo.
- [ ] **3.2** RED→GREEN `ios/AutoskeletonRendererTier1.swift` — single `CAShapeLayer` masked
      with the combined rounded-rect path + gradient, CoreAnimation-driven shimmer, shared
      `ShimmerClock` via `CADisplayLink` + `preferredFrameRateRange` (120 Hz ProMotion).
      **Tests**: XCTest — mask-path geometry matches expected union; signpost-based test proving
      the animation is CoreAnimation-driven with no per-frame JS/JSI call; NFR-2 proxy — block the
      JS thread synchronously ≥500 ms, assert layer animation timing unaffected.
      **Observability**: `os_signpost` around draw/mount. **Performance**: NFR-1 (60 fps/120 Hz),
      NFR-2 (blocked-thread resilience), NFR-5 proxy (layer/path instance reuse across ≥120
      invalidations, mirrors the Android draw-pass invariant in 4.4). Deps: 3.1. Complexity: L.
      Example app: bare RN + Expo.
- [ ] **3.3** RED→GREEN iOS `debugOverlay` — outline sublayer per shape, index/source/hit-miss
      badge, dev-only.
      **Tests**: XCTest — sublayer count == shape count with correct annotations (REQ-OBS-
      OVERLAY-1). **Observability**: this task IS the iOS overlay deliverable. **Performance**:
      N/A, dev-only, stripped from release (asserted by a release-configuration build test).
      Deps: 3.2. Complexity: M. Example app: bare RN + Expo.
- [ ] **3.4** RED→GREEN iOS a11y — `accessibilityElementsHidden` on the real subtree while
      `isLoading`, `UIAccessibility.isReduceMotionEnabled` degrading tier-1 shimmer to
      pulse/static.
      **Tests**: XCTest — REQ-A11Y-1 (content excluded from accessibility tree), REQ-A11Y-3
      (reduce-motion → pulse, no CoreAnimation transform sweep). **Observability**: REQ-A11Y-2
      announcement verified via `UIAccessibility.post(notification:)` call assertion.
      **Performance**: N/A. Deps: 3.2. Complexity: S. Example app: bare RN + Expo.

## Phase 4: Android sensor + fallback renderer + Android `debugOverlay`

- [ ] **4.1** RED→GREEN `android/.../AutoskeletonSensor.kt` — traversal over `ViewGroup`s with
      `offsetDescendantRectToMyCoords` (scrollX/scrollY subtraction), leaf detection
      (`ReactTextView`/`ReactImageView`/`ReactEditText` — **confirmed present in RN 0.87.1**, spec
      Open Question 4 already resolved by this ground truth), container rule, `Ignore` via
      `nativeID`, collapsed-text synthesis, `observe()` for orientation/fontScale/RTL.
      **Tests**: JUnit+Robolectric `AutoskeletonSensorTest.kt` — explicit `view.layout(l,t,r,b)` +
      `scrollTo` (Robolectric has no real layout pass), shared fixtures at 0.5 dp tolerance: offset
      accumulation, scroll subtraction, container rule both branches, Ignore filtering, leaf
      classification, collapsed text, RTL, REQ-NAV-1 rotation-invalidation.
      **Observability**: `Trace.beginSection`/`endSection` around traversal (REQ-OBS-PROFILE-1/2 —
      name ≤127 chars, same-thread nesting, asserted by a dedicated test). **Performance**: NFR-3
      local guard here; authoritative gate is 9.1. Deps: 1.9, 0.4. Complexity: L. Example app:
      bare RN (CLI autolinking proof) + Expo.
- [ ] **4.2** RED→GREEN ADR-2 radius ladder rungs R0/R1/R3 (public-API only) —
      `AutoskeletonRadiusResolver.kt`: R0 typed `radius` hint via `nativeID`; R1
      `drawable.getOutline(outline)` on a copy, use `outline.getRadius()` when ≥0; R3
      `SkeletonProvider.defaultRadius` with `r=-1` and `radius-unavailable` flag. **Resolves spec
      Open Question 7** (Android radius mechanism) per ADR-2. R2 (raster probe) is deliberately
      excluded here — see 4.3.
      **Tests**: JUnit+Robolectric — R0 hint precedence; R1 exact-radius characterization for the
      square case and `RADIUS_UNDEFINED` characterization for the rounded case (documents current
      RN behavior so a future RN fix is caught, plan.md §7.2b); R3 fallback + flag emission;
      `radiusSourceHistogram` correctness for every rung — **mandatory in every rung** per this
      session's brief. **Observability**: `radiusSourceHistogram` for `hint`/`outline`/`default`;
      dev warning when `default` exceeds 30% of a screen's shapes. **Performance**: N/A directly —
      resolution runs inside 4.1's already-budgeted traversal. Deps: 4.1. Complexity: M. Example
      app: bare RN + Expo.
- [ ] **4.3** **R2 on-device validation task (gated, proposal not fact).** Raster corner probe
      `Sensor.refine()`: copy `getConstantState().newDrawable().mutate()`, draw into a
      library-owned 48×48 `ARGB_8888` `Bitmap`, diagonal alpha-transition scan, memoized by
      `(ConstantState identity, bounds)`, capped `maxProbesPerTraversal=8`.
      **Tests**: instrumented `androidTest` on a real emulator/device matrix (RN 0.83–0.87) — real
      RN views with known radii (0, 4, 12, 24, 9999/pill) at several densities. **Pass criterion**:
      R1 exact for square / `RADIUS_UNDEFINED` for rounded, R2 recovers each radius within ±2 px,
      `radiusSourceHistogram` matches the expected rung per case. **This suite is the gate deciding
      whether R2 ships enabled by default** (plan.md §7.2b). **Defined fallback if validation
      fails**: the ladder collapses to R0→R1→R3 exactly as shipped by 4.2 — the library still
      ships, degraded but honest, no re-plan required, only a config flip (plan.md §6 ADR-2, §10).
      **Observability**: `radiusSourceHistogram` `raster-probe` bucket; `radius-probe-failed` flag
      on unclassifiable drawables. **Performance**: runs off the interaction frame in `refine()`,
      never counted against NFR-3 — asserted by a test proving R2 never executes synchronously
      inside `measure()`. Deps: 4.2. Complexity: L. Example app: bare RN + Expo.
- [ ] **4.4** RED→GREEN `android/.../AutoskeletonRendererTier1.kt` — single draw pass, `Path`
      union + `canvas.clipPath`, `LinearGradient` shader created ONCE and translated via
      `Matrix.setTranslate`+`setLocalMatrix` (rebuilding per frame forbidden),
      `postInvalidateOnAnimation` via `Choreographer`, no view-state mutation inside
      `dispatchDraw`.
      **Tests**: JUnit — shader instance identity stable across ≥120 invalidations (NFR-5
      draw-pass invariant, plan.md §7.2c); lint/unit rule banning `dispatchDraw` state mutation;
      NFR-2 proxy blocking the JS thread ≥500 ms while `Choreographer`-driven shimmer continues.
      **Observability**: `Trace.beginSection`/`endSection` around draw. **Performance**: NFR-1
      (60 fps), NFR-2 (blocked-thread resilience), NFR-5 (zero per-frame allocation — shader-reuse
      test is the direct proof). Deps: 4.2. Complexity: L. Example app: bare RN + Expo.
- [ ] **4.5** RED→GREEN Android `debugOverlay` — outline per shape, index/source/hit-miss badge,
      **plus the ADR-2-mandated radius-rung badge**, dev-only.
      **Tests**: JUnit/Robolectric — overlay draw count == shape count with correct annotations
      including the rung badge. **Observability**: this task IS the Android REQ-OBS-OVERLAY-1
      deliverable plus ADR-2's per-shape rung badge requirement. **Performance**: N/A, dev-only,
      stripped from release (asserted by a release-build test). Deps: 4.4. Complexity: M. Example
      app: bare RN + Expo.
- [ ] **4.6** RED→GREEN Android a11y — `importantForAccessibility="no-hide-descendants"` while
      `isLoading`, reduce-motion via animator-duration-scale detection degrading to pulse/static.
      **Tests**: JUnit — REQ-A11Y-1/REQ-A11Y-3 scenarios. **Observability**: REQ-A11Y-2
      announcement verified via `AccessibilityEvent` assertion. **Performance**: N/A. Deps: 4.4.
      Complexity: S. Example app: bare RN + Expo.

## Phase 5: Bridge (`getShapes` Turbo Module, ADR-1) + Skia/Reanimated tier-2 renderer

- [ ] **5.1** RED→GREEN Turbo Module TS spec `src/native/NativeAutoskeleton.ts`
      (`codegenConfig` in `package.json`) declaring sync `getShapes(cacheKey): Array<number>` per
      ADR-1; iOS/Android codegen'd implementations calling into 3.1/4.1's sensors.
      **Tests**: `test/native/wire-bridge.test.ts` (Vitest, mocked native module) — `wire.ts`'s
      `Float32Array.from` conversion runs exactly once per cache miss per mount, never per frame,
      never on list-cell bind (proves REQ-LIST-CELL-1 at the bridge layer); iOS XCTest + Android
      JUnit smoke tests that codegen compiles and is callable from both the CLI-autolinked bare
      app and the Expo-autolinked app. **Observability**: wraps the boxing call with
      `os_signpost`/`Trace` intervals distinct from traversal and draw — the JSI-serialization
      phase named in REQ-OBS-PROFILE-1, reported as a **separate line item** (ADR-1 exit
      criterion requires this). **Performance**: ADR-1 exit criterion — p95 serialization on the
      60-shape reference screen must stay <25% of the 2 ms traversal budget; local guard here,
      authoritative in 9.1. **If it fails**: re-open ADR-1, implement the hand-written JSI escape
      hatch — this is **spec Open Question 8**, flagged blocked if the exit criterion trips.
      Deps: 3.1, 4.1, 0.6. Complexity: L. Example app: bare RN + Expo.
- [ ] **5.2** RED→GREEN `NativeShapeCache` (native-side authority, ADR-9) keyed by the same
      composite-key string, written only for a traversal JS requested; `store.invalidate(...)` →
      native `evict(keys)` consistency wiring with the JS `ShapeStore` (1.3).
      **Tests**: iOS XCTest + Android JUnit consistency test — native cache and JS `ShapeStore`
      never diverge after `set`/`invalidate`/`evict` (ADR-9's explicit consequence).
      **Observability**: N/A directly; surfaces via `onMetrics.cacheHit` correctness.
      **Performance**: NFR-4 applies to the native `NativeShapeCache.get` path — local guard.
      Deps: 5.1. Complexity: M. Example app: bare RN + Expo.
- [ ] **5.3** RED→GREEN Expo Go guidance path (ADR-15) — native accessor returns `null` when
      absent (never throws at import time); `__DEV__` throws a named actionable error naming
      Expo Go and the dev-build fix; production fails open (`children` rendered unwrapped,
      `onMetrics.degraded:['native-module-unavailable']`).
      **Tests**: Expo E2E (Detox/Maestro) — dev-mode named-error assertion; production fail-open
      assertion (children render, no crash, degradation flag present). **Observability**:
      `onMetrics.degraded` carries `native-module-unavailable` in production — the field RISK-10
      names as the field-visibility signal for an Expo Go install. **Performance**: N/A, error/
      fallback path. Deps: 5.1. Complexity: M. Example app: Expo (only app exercising the
      absent-module condition).
- [ ] **5.4** RED→GREEN `src/native/tier2/SkiaRenderer.tsx` — opt-in Skia overlay, Reanimated
      shared values driving shimmer/per-shape `withDelay` stagger/shape→content morph,
      `Renderer.isAvailable()` returns false when Skia/Reanimated peers are absent or
      version-mismatched (silent tier-1 fallback). **Resolves spec Open Question 3** (tier-2
      opt-in, never the documented default) per ADR-5/RISK-8.
      **Tests**: iOS+Android native tests asserting zero React re-renders attributable to
      animation (NFR-7, shared-value-only path); Expo CI matrix building **with and without** the
      optional peers, asserting `onMetrics.renderer:'native'` in the without-peers build
      (RISK-8's detection signal). **Observability**: `onMetrics.renderer:'skia'` when active;
      per-shape stagger indices verified against wire shape order. **Performance**: NFR-1
      (120 Hz ProMotion via Reanimated), NFR-5 (shared values, zero per-frame JS allocation),
      NFR-7 (zero animation-driven re-renders). Deps: 5.2, 3.2, 4.4. Complexity: L. Example app:
      Expo (peers installed) + bare RN (peers-absent fallback proof).
- [ ] **5.5** RED→GREEN native public `<AutoSkeleton>` — `src/native/AutoSkeleton.tsx`,
      `src/index.native.ts` — wires 3.x/4.x sensors + 3.2/4.4/5.4 renderers + `SkeletonProvider`,
      tier-selection logic, `delay` prop.
      **Tests**: iOS+Android native E2E — REQ-SIMPLE-1 full cold-load, and REQ-NAV-1 hot-path +
      rotation-invalidation end to end through the Turbo Module. **Observability**: full
      `onMetrics` emission verified end-to-end on both platforms. **Performance**: NFR-3/NFR-4
      end-to-end (traversal + bridge + cache) — local guard. Deps: 5.4, 5.3, 3.4, 4.6.
      Complexity: L. Example app: bare RN + Expo.
- [ ] **5.6** Close the RISK-5 packaging detector's native portion — extend 0.6/2.5's test
      asserting `index.native.js` exists in `lib/module` and `lib/commonjs`, native specifiers
      correctly present there; run the full RISK-5 suite GREEN for the first time.
      **Tests**: `test/packaging/entries.test.ts` fully GREEN (started RED in 0.6).
      **Observability**: N/A, packaging test. **Performance**: N/A. Deps: 5.5, 2.5. Complexity:
      S. Example app: none/unit-only.

## Phase 6: Virtualized lists (all three sub-cases)

- [ ] **6.1** RED→GREEN `<SkeletonList itemType estimatedCount />` — sub-case 1: N synthetic
      rows from cached `itemType` shapes; first-ever render measures ONE invisible template cell
      deferred via `Sensor.refine`/`runAfterInteractions`, persists before further rows use it.
      **Tests**: native E2E — REQ-LIST-EMPTY-1 scenario (first-ever `feedCard`, deferred
      measurement, 6 synthetic rows) and REQ-LIST-EMPTY-2 repeat-render scenario (no traversal,
      immediate cache render). **Observability**: `onMetrics` reports `cacheHit:false` on
      first-ever render, `cacheHit:true` on repeats; template-measurement `traversalMs` isolated
      via a timing assertion proving it never blocks the interaction frame. **Performance**:
      NFR-3 for the one-time measurement; deferred/non-blocking property asserted via a frame-
      budget test. Deps: 5.5. Complexity: L. Example app: bare RN + Expo.
- [ ] **6.2** RED→GREEN pagination footer — sub-case 2: `ListFooterComponent` skeleton rows from
      cached `itemType` shapes, no re-traversal of existing rendered rows.
      **Tests**: native E2E — REQ-LIST-PAGE-1 fetching-next-page scenario (footer from cache,
      existing rows unaffected/no flicker) and page-load-completes scenario (footer replaced, no
      traversal for newly appended real rows of a known `itemType`). **Observability**:
      `onMetrics.traversalMs:0`/`cacheHit:true` for footer rows; a dev-only traversal counter
      proves zero traversal calls during pagination. **Performance**: NFR-4 per footer row; zero
      NFR-3 traversal is asserted as an explicit count. Deps: 6.1. Complexity: M. Example app:
      bare RN + Expo.
- [ ] **6.3** RED→GREEN `useSkeletonCell(itemType)` — sub-case 3: **ZERO TRAVERSAL ON BIND**,
      synchronous cache lookup only; unseen `itemType` renders a fallback generic skeleton
      immediately and schedules traversal via `runAfterInteractions`.
      **Tests**: native E2E — REQ-LIST-CELL-1 known-`itemType` rebind scenario (traversal-call
      counter must stay 0 across N rebinds — the direct proof of the ADR-13/RISK-3 zero-
      traversal-on-bind hard rule) and unseen-`itemType` scenario (immediate fallback, deferred
      traversal, subsequent zero-traversal binds). **Observability**: per-bind `onMetrics`
      reports `traversalMs:0`/`cacheHit:true` for known types; fallback path reports
      `cacheHit:false` with a distinguishable dev-sidecar flag. **Performance**: NFR-4 is the
      entire bind-path budget — asserted per bind in the 50-cell scroll scenario reused from 9.1.
      Deps: 6.1. Complexity: L. Example app: bare RN + Expo.
- [ ] **6.4** RED→GREEN shared shimmer phase across cells + recycling-safe hide/restore state
      (ADR-8/ADR-13) — keyed by item identity, not view instance; reset on bind.
      **Tests**: native E2E — 50-cell scroll asserting all visible cells stay in phase (single
      clock); recycling-stress test (RISK-3 detection signal) — repeated mount/unmount over N
      cycles, no stale skeleton after 10 recycle cycles, no retained-memory growth (NFR-8).
      **Observability**: traversal counter stays flat across 10 recycle cycles (RISK-3's explicit
      assertion). **Performance**: NFR-8 (no memory leak under recycling) — authoritative proof,
      not deferred. Deps: 6.3. Complexity: M. Example app: bare RN + Expo.
- [ ] **6.5** RED→GREEN pull-to-refresh stale-while-revalidate default + opt-out (REQ-PTR-1),
      applied to both whole-screen `AutoSkeleton` and list contexts.
      **Tests**: native E2E — default scenario (existing content stays visible, no skeleton
      overlay) and explicit-opt-out scenario (skeleton renders over stale content).
      **Observability**: `onMetrics` NOT fired for the default no-skeleton PTR path (no
      skeleton-to-content lifecycle occurred) — asserted as an explicit non-call. **Performance**:
      N/A, behavioral gate. Deps: 5.5. Complexity: S. Example app: bare RN + Expo.

## Phase 7: Theming interops (Uniwind / NativeWind)

- [ ] **7.1** RED→GREEN `--skl-base`/`--skl-highlight` CSS-variable contract wired into 2.2's
      renderer, Tailwind v4 `@theme` cascade, dark mode via cascade with no prop change
      (REQ-THEME-1).
      **Tests**: Playwright — Tailwind v4 theme-variable scenario and dark-mode-toggle-via-cascade
      scenario. **Observability**: N/A, styling resolution only. **Performance**: N/A;
      contributes to NFR-6 only via CSS custom properties, re-verified in 7.4. Deps: 2.2.
      Complexity: S. Example app: Vite.
- [ ] **7.2** RED→GREEN `autoskeleton/uniwind` subpath export — `src/interop/uniwind.ts` mapping
      resolved className values (`backgroundColor→shimmerBaseColor`,
      `color→shimmerHighlightColor`, `borderRadius→defaultRadius`) via `withUniwind`; core
      sensor stays agnostic (REQ-THEME-2/3).
      **Tests**: native E2E (Expo, `withUniwind` active) — REQ-THEME-2 scenario (className-driven
      values resolve with no separate developer-supplied props); a grep-level static assertion
      that `src/core/` never imports/parses a className string. **Observability**: N/A, theming
      resolution only. **Performance**: N/A. Deps: 7.1, 5.5. Complexity: M. Example app: Expo.
- [ ] **7.3** RED→GREEN `autoskeleton/nativewind` subpath export — `src/interop/nativewind.ts`,
      `cssInterop` equivalent mapping (current/stable v4; v5 migration documented as a future
      risk, not a v1 blocker).
      **Tests**: native E2E (Expo, NativeWind v4 active) — same mapping scenario as 7.2 adapted
      to `cssInterop`. **Observability**: N/A. **Performance**: N/A. Deps: 7.2. Complexity: M.
      Example app: Expo.
- [ ] **7.4** Packaging: both interops as tree-shakeable subpath exports (`./uniwind`,
      `./nativewind`), never imported by default entries; extend the RISK-5 packaging test to
      assert core `index.*` entries have zero transitive dependency on either interop module.
      **Tests**: `test/packaging/interop-exports.test.ts` — subpath resolves independently;
      default entries' import graph excludes interop modules. **Observability**: N/A, packaging
      test. **Performance**: NFR-6 — confirms interops add zero weight to the default web entry
      (re-checks 2.5's gzip budget unchanged). Deps: 7.3, 5.6. Complexity: S. Example app:
      none/unit-only.

## Phase 8: SSR — build-time snapshot capture CLI + `@media`-bucketed CSS bundle

- [ ] **8.1** RED→GREEN `cli/capture.ts` — Playwright-driven capture over `WIDTH_BUCKETS`
      (shared table from 1.1) × LTR/RTL, developer-declared `skeletonKey→route` registry
      (ASSUMPTION §11.1, **spec Open Question 1**: declared registry, no route auto-discovery),
      reuses 2.1's DOM sensor inside `page.evaluate`, `serializeSnapshot` output. **Threat-matrix
      RED tests written FIRST** (plan.md §8, the one applicable row): cross-origin route
      rejected; `../` route rejected; output-path-escape rejected; metacharacter route passed
      through inertly via a Playwright argument array (never a shell string); navigation timeout
      → non-zero exit naming the offending `skeletonKey`; empty/partial capture never overwrites
      a previously good bundle. Then functional tests: registry-driven capture over 3 routes ×
      [360,768,1280] × [ltr,rtl].
      **Observability**: CLI `--report` summary of covered vs. referenced keys (RISK-4 detection
      signal); dev-mode console warning naming each uncaptured `skeletonKey`, surfaced at runtime
      by 8.3. **Performance**: N/A — build-time tool, not part of any runtime NFR. Deps: 2.1,
      1.5, 1.1. Complexity: L. Example app: Next.js.
- [ ] **8.2** RED→GREEN `@media`-bucketed CSS bundle — one block per captured width bucket +
      `[dir]` selectors, using 1.5's `clip-path.ts` (REQ-SSR-3).
      **Tests**: Vitest — bundle emits exactly one `@media` block per `WIDTH_BUCKETS` entry; CI
      check that runtime `WIDTH_BUCKETS` and the CSS-baked bucket list stay identical (RISK-2's
      drift-guard detection signal). **Observability**: N/A, build artifact generation.
      **Performance**: N/A. Deps: 8.1. Complexity: M. Example app: Next.js.
- [ ] **8.3** RED→GREEN `<AutoSkeleton.SSR skeletonKey>` server component + client hydration
      bridge — `ShapeStore.import()` on the client, uncaptured-key neutral generic block produced
      by the same pure function server AND client (ADR-12, **spec Open Question 2**), zero live
      layout detection inside `<Suspense>` (REQ-SSR-1).
      **Tests**: Next.js E2E — REQ-SSR-4 byte-identical server/client markup + zero hydration
      mismatch for every width bucket × direction with JS disabled first; uncaptured-key
      byte-identical-neutral-block scenario; fails on **any** React hydration console warning
      (RISK-2's authoritative signal) plus a pre/post-hydration DOM-equality check.
      **Observability**: dev-mode console warning naming each uncaptured `skeletonKey` at
      runtime (RISK-4). **Performance**: N/A — SSR correctness gate; `fontScale`-unknowable-
      server-side residual limit (spec §1.8 scenario) documented, not fixed, via `rem`-relative
      sizing where geometrically possible. Deps: 8.2, 1.3. Complexity: L. Example app: Next.js.
- [ ] **8.4** RED→GREEN web image-handoff wiring — extend 1.7's `HandoffController` into 2.3's
      `<AutoSkeleton>` and the Next.js example, no-flash reveal-before-hide (ADR-16) proven with a
      real `<img>` successor.
      **Tests**: Playwright frame-capture across `isLoading→false` with an artificially slow
      placeholder, asserting **no frame exists where neither the skeleton nor a successor is
      painted** (RISK-11's authoritative test — not a "skeleton disappeared" check); metric-
      boundary assertion (`displayDurationMs` stops at `isLoading===false`; `handoffMs`/
      `handoffReason:'timeout'` captures the wait; with `onSuccessorPainted` wired,
      `handoffReason:'successor-painted'` and `handoffMs` shrinks); `displayDurationMs +
      handoffMs ≈ wall time` invariant. **Observability**: closes REQ-IMG-1/2's runtime proof and
      ADR-16's telemetry contract end to end on web. **Performance**: N/A, correctness gate.
      Deps: 8.3, 2.3, 1.7. Complexity: M. Example app: Vite + Next.js.

## Phase 9: CI benchmarks + docs

- [ ] **9.1** CI benchmark suite `benchmarks/` — native traversal (30/60-shape reference
      screens/platform), bridge serialization as a separate line item (ADR-1 exit criterion),
      synchronous cache lookup, shimmer frame drops over a 50-cell scroll, web sensor cost +
      consumer-bundle gzip; `benchmarks/budgets.json` (traversal p95 <2 ms, cache p95 <0.2 ms,
      serialization <25% of traversal budget, dropped frames = 0/5 s scroll, web entry <5 kB
      gzip); same-CI-job baseline-vs-candidate ratio comparison + pinned-image absolute assertion.
      **Tests**: this harness IS the authoritative test — REQ-OBS-CI-1 traversal-regression and
      frame-drop-regression scenarios (fail CI citing baseline/measured/exceeded budget).
      **Observability**: the CI benchmark deliverable itself (REQ-OBS-CI-1); promotes every
      earlier "local guard" note in Phases 1–8 to an authoritative gate. **Performance**:
      authoritative closure of NFR-1 through NFR-6. Deps: 3.1, 4.1, 5.1, 2.1, 2.5, 6.4.
      Complexity: L. Example app: bare RN + Vite (runners execute against built examples).
- [ ] **9.2** ADR-14 verification closure — bare example builds in CI on iOS AND Android from
      `npm pack` output with zero Expo packages in the dependency tree (RISK-5's authoritative
      signal); Expo example builds in parallel from the same tarball; both matrices run across
      every supported RN version (0.83+). **This is the RED-until-green detector plan.md §6
      ADR-14 names explicitly** and **closes spec Open Question 9's verification** and plan.md's
      explicitly-not-yet-verified ADR-14 claim.
      **Tests**: a CI job assertion, not a unit test — see above. **Observability**: N/A,
      build/CI gate. **Performance**: N/A. Deps: 0.7, 5.5, 5.6. Complexity: L. Example app: bare
      RN + Expo (both, by definition).
- [ ] **9.3** NFR-8 memory-leak CI gate — promote 6.4's local recycling-stress test to the CI
      benchmark harness with a fixed retained-heap tolerance.
      **Tests**: CI job failing on monotonic retained-heap growth across N mount/unmount cycles.
      **Observability**: N/A, memory-profiler pass. **Performance**: NFR-8, authoritative CI
      closure. Deps: 9.1, 6.4. Complexity: M. Example app: bare RN.
- [ ] **9.4** Documentation — README install (bare RN + Expo instructions, Expo Go constraint
      documented adjacent to the install command per ADR-15, not buried in troubleshooting); full
      three-phase image-pipeline doc with a worked `expo-image` example (ADR-16, closes brief
      §9b's documentation obligation); theming interop docs; `debugOverlay`/budget-warning usage
      guide; capture-CLI registry ergonomics doc naming the RISK-4 cost openly (plan.md §9).
      **Tests**: a doc-example compile/typecheck job — the `expo-image` worked example runs as an
      actual snippet against built types, not hand-typed prose (the proportional check for this
      content: structural readback for passive prose, compile check for the one active code
      sample). **Observability**: N/A, documentation. **Performance**: N/A. Deps: 9.2, 8.4, 7.3.
      Complexity: M. Example app: none/unit-only (docs reference 8.4's worked example).
- [ ] **9.5** Final RISK-5 close-out — run the complete `test/packaging/*` suite (0.6, 2.5, 5.6,
      7.4) against a real `npm pack` of the fully assembled package, and the complete
      threat-matrix suite (8.1) against the finished CLI, as the last gate before release-ready.
      **Tests**: full packaging + threat-matrix suites GREEN in one CI run. **Observability**:
      N/A, final gate. **Performance**: N/A. Deps: 9.1, 9.2, 9.3, 9.4. Complexity: S. Example
      app: all four (final cross-check).

---

## Open Questions carried from `spec.md` §6 — task mapping

| # | Question | Status here |
|---|---|---|
| 1 | Capture-CLI ergonomics | Exercised in **8.1**; declared-registry assumption is load-bearing there, flagged per RISK-4. |
| 2 | Uncaptured-key SSR behavior | Implemented in **8.3** per ADR-12. |
| 3 | Tier-2 Skia positioning | Resolved opt-in in **5.4** per ADR-5/RISK-8. |
| 4 | Android leaf-class spike-failure policy | Moot — ground truth (brief §2) confirms all three classes present in RN 0.87.1; referenced in **4.1**. |
| 5 | Web bundle size gate | Failing gate, verified in **2.5** and closed authoritatively in **9.1**. |
| 6 | Image pipeline hand-off | Type/state-machine in **1.7**; behavioral proof in **8.4**. |
| 7 | Android corner-radius mechanism | Resolved by ADR-2's ladder, **4.2/4.3**. |
| 8 | Native bridge choice for `getShapes` | Resolved by ADR-1 (Turbo Module), **5.1**; exit-criterion re-open trigger noted there. |
| 9 | Build tooling for dual web/native entry | Resolved by ADR-3 (builder-bob, verified from source), **0.5**; CI-verified in **9.2**. |
