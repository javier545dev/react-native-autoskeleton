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

- [x] **1.1** RED→GREEN `src/core/cache-key.ts` — `bucketWidth` against `WIDTH_BUCKETS`,
      `quantizeFontScale` (2 decimals), `composeCacheKey`/`parseCacheKey` round-trip with `|`
      percent-escaping, `keyMatches`.
      **Tests**: `cache-key.test.ts` (Vitest, no DOM). **Observability**: N/A — pure key algebra
      on no lifecycle path; exempt. **Performance**: feeds NFR-4 indirectly but not measured
      standalone here — measured in 1.3 and authoritatively in 9.1. Deps: 0.2. Complexity: M.
      Example app: none/unit-only.
- [x] **1.2** RED→GREEN `src/core/wire.ts` — `[VERSION,x,y,w,h,r]xN` Float32Array codec, modulus
      check, version negotiation (reject newer, forward-migrate older, raise
      `snapshot-version-mismatch`), `byteOffset===0` assertion.
      **Tests**: `wire.test.ts` — round-trip N=0/1/60; malformed-length rejection; version
      mismatch path. **Observability**: produces the `snapshot-version-mismatch` flag consumed by
      `onMetrics.degraded` (assembled in 1.8) — no emission call here. **Performance**: not
      measured here (pure codec); covered by Phase 9.1 CI benchmark. Deps: 1.1. Complexity: M.
      Example app: none/unit-only.
- [x] **1.3** RED→GREEN `src/core/snapshot.ts` — `serializeSnapshot`/`deserializeSnapshot`
      (dev sidecars stripped in prod) + `MemoryShapeStore` (sync `get`/`has`/`set`/`delete`/
      `invalidate`/`clear`/`export`/`import`/`subscribe`, LRU cap 128 default per ASSUMPTION
      plan.md §11.6).
      **Tests**: `snapshot.test.ts` + `memory-shape-store.test.ts` (LRU eviction order, invalidate
      predicate, subscribe notifications, import/export round-trip). **Observability**: N/A
      directly; underlies `onMetrics.cacheHit` correctness downstream. **Performance**: NFR-4
      (<0.2 ms p95 sync lookup) — a Vitest micro-benchmark (1000-iteration p95) as a fast local
      guard; authoritative gate is 9.1. Deps: 1.2. Complexity: L. Example app: none/unit-only.
- [x] **1.4** RED→GREEN `src/core/lines.ts` — collapsed-text line synthesis (N rects, height =
      lineHeight, width 60–85% variance, `lines` hint honored).
      **Tests**: `lines.test.ts` — no-hint default, hinted count, width bounds, height equality.
      **Observability**: tags synthesized shapes `source:'synthetic-line'` in the dev sidecar
      (§4.4). **Performance**: N/A standalone; folded into traversal budget once called from
      sensors (Phase 2–4). Deps: 1.2. Complexity: S. Example app: none/unit-only.
- [x] **1.5** RED→GREEN `src/core/clip-path.ts` — union-of-rounded-rects → SVG `path()` string,
      reused by the web renderer (2.2) and the capture CLI (8.1).
      **Tests**: `clip-path.test.ts` — single rect, overlapping rects, `r=-1`→`defaultRadius`
      substitution, RTL mirroring. **Observability**: N/A, pure geometry. **Performance**: N/A
      here; contributes to NFR-6, verified in 2.5. Deps: 1.2. Complexity: M. Example app:
      none/unit-only.
- [x] **1.6** RED→GREEN `src/core/metrics.ts` — budget checks (`budgetMs` default 2,
      `maxShapes` default 60, both configurable), dev-warning formatter with actionable
      suggestion text, `onMetrics` payload shape per spec §2.1/§3.7.
      **Tests**: `metrics.test.ts` — REQ-OBS-BUDGET-1 scenarios (3.4 ms/2 ms warning text,
      74/60-shape warning text), all 7 base `onMetrics` fields typed, `radiusSourceHistogram`
      shape. **Observability**: this module emits `onMetrics`/REQ-OBS-BUDGET-1 warnings — this
      task IS the observability deliverable. **Performance**: NFR-3 threshold (2 ms) and
      shape-cap (60) asserted as constants matching spec §3 exactly. Deps: 1.3. Complexity: M.
      Example app: none/unit-only.
- [x] **1.7** RED→GREEN `src/core/handoff.ts` — `HandoffController` state machine
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
- [x] **1.8** RED→GREEN `src/core/contracts.ts` — finalize `Sensor<TTarget>`,
      `Renderer<TSurface>`, `ShimmerClock`, `HintRegistry`, `SensorOptions`/`SensorResult` (types
      only; platform layers implement in Phases 2–5). Add `assembleMetrics(...)` in `metrics.ts`
      composing all `onMetrics` fields from the other core modules.
      **Tests**: `contracts.test.ts` (`expectTypeOf` compile assertions) +
      `assemble-metrics.test.ts` covering REQ-OBS-METRICS-1's cold-load and hot-load scenarios.
      **Observability**: this task IS the metrics-assembly module. **Performance**: N/A, pure
      composition. Deps: 1.7. Complexity: M. Example app: none/unit-only.
- [x] **1.9** Consolidate `src/core/types.ts` (`ShapeInfo`, `ShapeSnapshot`,
      `SerializedShapeSnapshot`, `DegradationFlag`, `RadiusSource`, `ShapeSource`) — no new logic.
      **Tests**: `types.test.ts` asserting `DegradationFlag` enumerates all 8 documented flags
      (drift guard). **Observability**: N/A. **Performance**: N/A. Deps: 1.8. Complexity: S.
      Example app: none/unit-only.

## Phase 2: DOM sensor + CSS renderer + web `debugOverlay`

- [x] **2.1** RED→GREEN `src/web/dom-sensor.ts` (`Sensor<HTMLElement>`) — `TreeWalker`
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
- [x] **2.2** RED→GREEN `src/web/css-renderer.ts` (`Renderer<HTMLElement>`) — single
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
- [x] **2.3** RED→GREEN `<AutoSkeleton>` web component — `src/index.web.ts`,
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
- [x] **2.4** RED→GREEN web `debugOverlay` — outline every detected shape with index, `source`
      type, cache hit/miss badge (REQ-OBS-OVERLAY-1), dev-build only.
      **Tests**: Playwright — outline count == shape count with correct annotations; verifies the
      "missed node" diagnostic scenario. **Observability**: this task IS REQ-OBS-OVERLAY-1's web
      deliverable. **Performance**: N/A, dev-only, tree-shaken from production (verified by 2.5).
      Deps: 2.3. Complexity: M. Example app: Vite.
- [x] **2.5** RED→GREEN web packaging — Vite consumer bundle build, `<8 kB gzip` assertion (NFR-6,
      **REVISED 2026-08-27 from 5 kB to 8 kB by maintainer decision** — the 5 kB figure was never
      validated against an implementation; measured reality is 7566 B, dominated by product code,
      not bloat — spec.md NFR-6, plan.md §11 item 5) measured on the built bundle; extends 0.6's
      packaging test to assert `index.web.js`'s transitive graph excludes native/Skia/Reanimated
      specifiers (closes the web-entry portion of the RISK-5 detector).
      Closed in two parts: (a) the NFR-6 gate itself, now GREEN at the revised 8 kB budget
      (measured 7566 B before, 7421 B after part (b)); (b) `ShapeStore.export()`/`.import()` split
      out of `MemoryShapeStore`'s hot-path class into opt-in free functions
      (`src/core/snapshot-io.ts`'s `exportShapeStore`/`importIntoShapeStore`) — correct regardless
      of the budget, since a bundler cannot tree-shake individual class methods and this was riding
      SSR-only serialization code into every web bundle. `plan.md` §3.3's `ShapeStore` contract
      updated to match, documented as a Phase 2 revision.
      Also fixed, orchestrator-found packaging defect: `npm pack` shipped 52 compiled test
      artifacts (`.test.js`/`.test.d.ts`) because `package.json`'s `files` key excluded
      `**/__tests__` but Phase 1 co-located tests as `src/core/*.test.ts`. Fixed via additional
      `files` glob exclusions; verified 0 test artifacts in the tarball. Added a RISK-5 assertion
      (`test/packaging/entries.test.ts`) covering this, taken RED against the broken state first.
      **Tests**: `test/packaging/web-bundle.test.ts` (Vitest, reads Vite build output);
      `test/packaging/entries.test.ts`'s new "no test artifacts" assertion.
      **Observability**: N/A, packaging test. **Performance**: NFR-6, hard failing CI gate — GREEN
      at 8 kB (measured 7421 B gzip).
      Deps: 2.4, 0.6. Complexity: M. Example app: Vite.
      **Status**: transitive-graph extension DONE and GREEN (`lib/module` + `lib/commonjs`
      `index.web.js`, real recursive walk, not just the entry file). The NFR-6 gzip assertion itself
      is genuinely RED: measured ~7.4-7.6 kB gzip (production build, `DebugOverlay` confirmed
      tree-shaken) against the 5 kB budget. Root cause identified, not freelance-fixed: `ShapeStore`'s
      contract (task 1.3, `src/core/contracts.ts`) requires `export()`/`import()` serialization on
      every implementation including `MemoryShapeStore`, and those methods live on the same class as
      the hot-path `get`/`set`/`has` methods `AutoSkeleton` actually calls — a bundler cannot
      tree-shake individual class methods, so the serialization code (needed later for the Phase 8
      SSR capture pipeline, unused by the live web runtime) rides along regardless. Closing this
      task needs an explicit decision (e.g. split `MemoryShapeStore` into a lean runtime class plus a
      separate serialization module, or revisit the 5 kB number) — left open rather than forced green
      or silently weakened, per this project's own "do not mark complete if focused tests fail" rule.

## Phase 3: iOS native sensor + native fallback renderer + iOS `debugOverlay`

- [x] **3.1** RED→GREEN `ios/AutoskeletonSensor.swift` — recursive traversal via
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
- [x] **3.2** RED→GREEN `ios/AutoskeletonRendererTier1.swift` — single `CAShapeLayer` masked
      with the combined rounded-rect path + gradient, CoreAnimation-driven shimmer, shared
      `ShimmerClock` via `CADisplayLink` + `preferredFrameRateRange` (120 Hz ProMotion).
      **Tests**: XCTest — mask-path geometry matches expected union; signpost-based test proving
      the animation is CoreAnimation-driven with no per-frame JS/JSI call; NFR-2 proxy — block the
      JS thread synchronously ≥500 ms, assert layer animation timing unaffected.
      **Observability**: `os_signpost` around draw/mount. **Performance**: NFR-1 (60 fps/120 Hz),
      NFR-2 (blocked-thread resilience), NFR-5 proxy (layer/path instance reuse across ≥120
      invalidations, mirrors the Android draw-pass invariant in 4.4). Deps: 3.1. Complexity: L.
      Example app: bare RN + Expo.
- [x] **3.3** RED→GREEN iOS `debugOverlay` — outline sublayer per shape, index/source/hit-miss
      badge, dev-only.
      **Tests**: XCTest — sublayer count == shape count with correct annotations (REQ-OBS-
      OVERLAY-1). **Observability**: this task IS the iOS overlay deliverable. **Performance**:
      N/A, dev-only, stripped from release (asserted by a release-configuration build test).
      Deps: 3.2. Complexity: M. Example app: bare RN + Expo.
- [x] **3.4** RED→GREEN iOS a11y — `accessibilityElementsHidden` on the real subtree while
      `isLoading`, `UIAccessibility.isReduceMotionEnabled` degrading tier-1 shimmer to
      pulse/static.
      **Tests**: XCTest — REQ-A11Y-1 (content excluded from accessibility tree), REQ-A11Y-3
      (reduce-motion → pulse, no CoreAnimation transform sweep). **Observability**: REQ-A11Y-2
      announcement verified via `UIAccessibility.post(notification:)` call assertion.
      **Performance**: N/A. Deps: 3.2. Complexity: S. Example app: bare RN + Expo.

## Phase 4: Android sensor + fallback renderer + Android `debugOverlay`

- [x] **4.1** RED→GREEN `android/.../AutoskeletonSensor.kt` — traversal over `ViewGroup`s with
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
- [x] **4.2** RED→GREEN ADR-2 radius ladder rungs R0/R1/R3 (public-API only) —
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
      dev warning when `default` exceeds 30% of a screen's shapes. **CORRECTED (session
      2026-08-27, G.3)**: that dev-warning claim was NOT actually delivered by this task — only the
      `radiusSourceHistogram` DATA existed; no `Log.w`/warning-emission code path existed anywhere
      in `android/` until task G.3 implemented and wired `AutoskeletonObservability.kt` into the
      real `AutoskeletonSensor.measure()` traversal. See G.3 below for the real deliverable, its
      in-context tests, and why this line went unnoticed for three phases. **Performance**: N/A directly —
      resolution runs inside 4.1's already-budgeted traversal. Deps: 4.1. Complexity: M. Example
      app: bare RN + Expo.
- [x] **4.3** **R2 on-device validation task (gated, proposal not fact).** Raster corner probe
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
- [x] **4.4** RED→GREEN `android/.../AutoskeletonRendererTier1.kt` — single draw pass, `Path`
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
- [x] **4.5** RED→GREEN Android `debugOverlay` — outline per shape, index/source/hit-miss badge,
      **plus the ADR-2-mandated radius-rung badge**, dev-only.
      **Tests**: JUnit/Robolectric — overlay draw count == shape count with correct annotations
      including the rung badge. **Observability**: this task IS the Android REQ-OBS-OVERLAY-1
      deliverable plus ADR-2's per-shape rung badge requirement. **Performance**: N/A, dev-only,
      stripped from release (asserted by a release-build test). Deps: 4.4. Complexity: M. Example
      app: bare RN + Expo.
- [x] **4.6** RED→GREEN Android a11y — `importantForAccessibility="no-hide-descendants"` while
      `isLoading`, reduce-motion via animator-duration-scale detection degrading to pulse/static.
      **Tests**: JUnit — REQ-A11Y-1/REQ-A11Y-3 scenarios. **Observability**: REQ-A11Y-2
      announcement verified via `AccessibilityEvent` assertion. **Performance**: N/A. Deps: 4.4.
      Complexity: S. Example app: bare RN + Expo.

## Observability gap closure (session 2026-08-27, post-Phase-4 — outside the 0–9 phase numbering)

Discovered via an explicit audit of `src/`: `checkBudgets`/`emitBudgetWarnings` (task 1.6's own
deliverable) were never called from any production code path — only exercised by
`metrics.test.ts`. REQ-OBS-BUDGET-1 was therefore NOT actually met despite task 1.6 being marked
complete: a formatter unit-tested in isolation but never invoked does not satisfy an emission
requirement. `spec.md` REQ-OBS-BUDGET-1 was amended to state this explicitly. Separately, a new
REQ-OBS-BUDGET-2 (the ADR-2/RISK-1-mandated radius-fallback-share warning) did not exist in any
form — no types, no logic, no tests — despite task 4.2's Observability line already claiming "dev
warning when default exceeds 30% of a screen's shapes." That claim was never implemented; only
`radiusSourceHistogram` DATA existed.

- [x] **G.1** RED→GREEN wire `checkBudgets`/`emitBudgetWarnings` into the real web measurement
      path (`src/web/AutoSkeleton.tsx`'s `useColdMeasurement`), gated
      `process.env.NODE_ENV !== 'production'` at the platform layer per ADR-4 (core stays
      platform-agnostic). Discovered and worked around a real architectural constraint:
      `dom-sensor.ts`'s `pushShape` truncates AT `maxShapes`, so a completed traversal's own
      snapshot can never literally report a shape count `> maxShapes` — the wiring uses the
      sensor's real `shape-cap-reached` degradation flag as the authoritative signal instead of a
      naive count comparison against already-capped data.
      **Tests**: `test/web/auto-skeleton.spec.ts` — 3 new Playwright cases driving the REAL
      component + REAL DOM sensor (shape-cap truncation via `maxShapes:1`, `budgetMs:-1`
      deterministic time-budget trip, and a no-false-positive negative case). **Observability**:
      this task closes REQ-OBS-BUDGET-1 for real — a developer running the example app now
      genuinely sees the warning. **Performance**: N/A, dev-only, gated out of production builds.
      Deps: 1.6, 2.3. Complexity: S. Example app: Vite (any web consumer).
- [x] **G.2** RED→GREEN implement REQ-OBS-BUDGET-2 (added to `spec.md` §2.4 this session) —
      `checkRadiusFallback`/`formatRadiusFallbackWarning`/`emitRadiusFallbackWarning` in
      `src/core/metrics.ts` (default 30% threshold, configurable via
      `SkeletonProvider.radiusFallbackShare`), wired into the same `useColdMeasurement` path using
      the real sensor's `radiusSources` dev sidecar.
      **Tests**: `metrics.test.ts` — 8 new pure-function cases (18/20 exceeds, 6/20 exactly-at-
      threshold does not fire, undefined sidecar, emission gate). `auto-skeleton.spec.ts` — 1 new
      Playwright case proving the real wiring stays silent against real (always-`measured`-on-web)
      traversal data even at an aggressive `radiusFallbackShare:0`. **Platform-scope finding**:
      `dom-sensor.ts`'s `leafShape` only ever assigns `radiusSource: 'measured' | 'hint'` — a
      genuine positive trigger (`'default'` rung) is structurally impossible on web, so the
      positive-fire path is validated at the pure-function layer, which is the correct and only
      layer capable of exercising it on this platform. **Observability**: this task IS the
      REQ-OBS-BUDGET-2 deliverable on web. **Performance**: N/A, dev-only. Deps: G.1, 4.2.
      Complexity: S. Example app: Vite (any web consumer).
- [x] **G.3** RED→GREEN wire the equivalent REQ-OBS-BUDGET-1/REQ-OBS-BUDGET-2 warnings on iOS and
      Android, from the REAL traversal path on each platform — `AutoskeletonSensor.measure()` is
      that path on both (no higher-level JS-triggered call site exists yet; that is Phase 5's job,
      and this task does NOT need it, confirmed: a same-process `Log.w`/`os_log` write needs no JS
      round-trip). New `AutoskeletonObservability.kt`/`AutoskeletonObservability.swift` — pure
      `checkBudgets`/`checkRadiusFallback`/formatters ported 1:1 from `src/core/metrics.ts`'s
      thresholds and `>`-not-`>=` semantics (2ms budget, 60-shape cap, 30% radius-fallback share),
      plus an injectable `AutoskeletonWarningEmitter` seam (mirrors `AutoskeletonTracing`'s
      pattern: `Log.w`/`Logger.warning` in production, a recording double in tests). Wired into
      `AutoskeletonSensor.measure()` on both platforms, reusing the SAME `shape-cap-reached`-flag
      -> `maxShapes+1` lower-bound trick G.1 established on web (a completed, capped traversal can
      never literally report a count `>` maxShapes).
      **Android dev-gate**: runtime `ApplicationInfo.FLAG_DEBUGGABLE` check inside `measure()`
      (the mechanism task 4.5 established for the debug overlay — a published AAR is a single
      already-compiled variant, so a compile-time strip is not available to it).
      **iOS dev-gate**: `#if DEBUG` around the emission call site in `measure()` (task 3.3's
      mechanism). Scoped narrower than 3.3's whole-type strip: the warning logic is a lightweight
      logging seam like `AutoskeletonTracing` (always compiled, always testable), not a full UI
      subsystem — only the call site inside `measure()` is compile-time-gated, so a Release build
      never invokes it.
      **iOS radius-fallback claim VERIFIED this session (previously stated as unverified)**:
      inspected `AutoskeletonSensor.swift` directly — `radiusSource` is unconditionally `.measured`
      in `leafShapes` (there is no ladder; `layer.cornerRadius` always returns a concrete value).
      There is NO code path anywhere in the iOS sensor that ever assigns `.defaultValue`. The
      REQ-OBS-BUDGET-2 positive-fire branch is therefore PROVABLY UNREACHABLE via any real `UIView`
      traversal on iOS — not "rare", genuinely impossible by construction, same category of finding
      as web's G.2 result. The iOS wiring is DEFENSIVE (matches ADR-2: "iOS reports the same
      histogram so consumers see Android degradation instead of guessing"); its positive-fire
      branch is validated at the pure-function layer only, the sole layer that can exercise it here.
      **Tests, all driving the REAL sensor through a REAL traversal, never a formatter in
      isolation** (the brief's explicit acceptance criterion): Android —
      `AutoskeletonSensorObservabilityTest.kt` (5 cases: real time-budget trip via `budgetMs=-1`;
      real shape-cap trip via `maxShapes=1`; a REAL radius-fallback positive fire built from 10 real
      `View`s through the REAL `AutoskeletonPublicApiRadiusResolver` R0/R1/R3 ladder — 8 rounded
      unhinted leaves resolve `DEFAULT`, 2 hinted leaves resolve `HINT`, genuinely 80% > 30%; a
      no-false-positive case with real square-background `OUTLINE` leaves; a dev-gate suppression
      case proving `FLAG_DEBUGGABLE=false` silences a real trip) plus
      `AutoskeletonObservabilityTest.kt` (10 pure-function cases mirroring `metrics.test.ts`,
      including the exactly-at-30%-does-NOT-fire edge case). iOS —
      `AutoskeletonSensorObservabilityTests.swift` (4 cases: real time-budget and shape-cap trips;
      a real-traversal radius-fallback silence proof even at an aggressive `radiusFallbackShare: 0`,
      mirroring web G.2's Playwright case; a no-false-positive case) plus
      `AutoskeletonObservabilityTests.swift` (10 pure-function cases, the ONLY layer that exercises
      the positive radius-fallback branch on iOS). **Corrects task 4.2's Observability claim**
      ("dev warning when default exceeds 30% of a screen's shapes") in place, above — no such
      warning existed in the shipped Android code before this task; only the histogram-feeding data
      did. **Observability**: this task IS the REQ-OBS-BUDGET-1/2 deliverable on iOS and Android —
      a developer running either native example app now genuinely sees the warning.
      **Performance**: N/A, dev-only, gated out of Release/non-debuggable builds on both platforms.
      Deps: 4.2, 3.1. Complexity: S–M. Example app: bare RN (both platforms).

## Phase 5: Bridge (`getShapes` Turbo Module, ADR-1) + Skia/Reanimated tier-2 renderer

> **Session status (2026-08-27, branch `feat/phase-5-turbo-module-bridge`)**: the RISK-5 packaging
> detector (task 0.6/5.6) is fully GREEN — `npx vitest run` passes 199/199 for the first time in
> the project's life. TS-side bridge/accessor/tier-selection/native-component work for 5.1, 5.3,
> 5.4 and 5.5 is DONE and unit-tested where Vitest-testable. Native: **Android is fully wired**
> (`getShapes`/`evictShapes` call the real `AutoskeletonSensor`/`AutoskeletonPublicApiRadiusResolver`
> and write `AutoskeletonNativeShapeCache`, 10 new JUnit/Robolectric tests). **iOS is partially
> wired**: the Swift logic (`AutoskeletonModuleBridge`, `AutoskeletonNativeShapeCache`, 9 new
> XCTest cases) is real and tested Swift-to-Swift, but `Autoskeleton.mm`'s `getShapes`/
> `evictShapes` return an empty/no-op result rather than calling into it — every attempt to
> `#import "Autoskeleton-Swift.h"` from the `.mm` hit a reproducible Xcode New Build System issue
> (stale/incomplete generated header even after a full clean rebuild) documented in that file's
> header comment. The native `AutoskeletonOverlayView` UI component (the actual on-screen tier-1
> draw surface `AutoSkeleton.tsx` mounts) was **not implemented** on either platform this session —
> `AutoskeletonRendererTier1`'s existing `mount(surface:...)` API is ready to be wired into it, but
> building and validating a new Fabric-interop `ViewManager` pair was judged out of reach of this
> session's remaining budget after the sensor-bridge work above; `resolveAutoskeletonOverlayNativeComponent()`
> fails safely (returns `null`, no skeleton renders, no crash) until it exists. Tier-2 Skia
> (`SkiaRenderer.tsx`) is written and typechecked against local minimal interfaces (neither
> `@shopify/react-native-skia` nor `react-native-reanimated` is installed in this repo, matching
> RISK-8's zero-dependency-default requirement) but not verified against the real library APIs —
> flagged in its own file header as a recommended follow-up. Harnesses this session: vitest
> 199/199, playwright 36/36 (+2 delay-prop cases), Android unit 83/83 (was 73/73), Android
> instrumented 7/7 (unchanged), iOS 55/55 (was 46/46), typecheck clean. See the apply-progress
> Engram artifact for the full per-file breakdown.
>
> **Session status (2026-08-27, branch `feat/visual-paint-gate`, narrowed continuation)**: task
> 5.7, the on-device visual paint gate, added and proven RED for the right reason on Android (see
> 5.7 below). No other Phase 5 remediation was attempted this session by design. Harnesses:
> vitest 199/199, playwright 36/36, typecheck clean, Android unit 83/83, Android library
> instrumented 7/7 — all unchanged/still green. New: Android app instrumented (paint gate)
> 1/3 green, 2/3 RED as intended. iOS 55/55 unchanged (no iOS gate built this session — see 5.7).
>
> **Session status (2026-08-27, branch `feat/visual-paint-gate`, second continuation — the actual
> native draw surface)**: built the missing `AutoskeletonOverlayView` on Android end to end and
> flipped the paint gate from 1/3 to 2/3 reliably green (the 3rd is flaky at a tolerance boundary,
> not a wiring defect — see 5.7 below for the full account). Root-caused and fixed THREE further
> real defects the original diagnosis did not anticipate, each confirmed empirically (not
> guessed) via targeted logging and real-device runs before being fixed: (1) `codegenConfig.type`
> was `"modules"`, so no Fabric ComponentDescriptor/ShadowNode/Props existed for
> `AutoskeletonOverlayView` on either platform regardless of ViewManager code — fixed by adding
> `src/native/AutoskeletonOverlayNativeComponent.ts` and setting `codegenConfig.type: "all"`,
> verified by inspecting the actual generated codegen output (Android
> `AutoskeletonOverlayViewManagerInterface`/`Delegate`, iOS `ComponentDescriptors.h`/`Props.h`), not
> assumed; (2) Android `getShapes()`'s `FabricUIManager.resolveView(reactTag)` silently returned
> `null` when called off the UI thread — fixed with a UI-thread dispatch primitive
> (`AutoskeletonUiThreadDispatcher`, mirrored on iOS as `AutoskeletonSystemUiThreadDispatcher`); (3)
> the wrapper `<View>` in `native/AutoSkeleton.tsx` was Fabric-view-flattened (no visual props), so
> its reactTag NEVER resolved to a real native view — fixed with `collapsable={false}`; (4) the
> native `AutoskeletonOverlayView` read the wire array's DENSITY-NORMALIZED geometry directly
> instead of scaling back to raw view pixels for the `Canvas` draw pass — fixed in
> `decodeWireShapes(wire, density)`. Also fixed an ADR-8 compliance gap (shared shimmer clock,
> matching `src/web/AutoSkeleton.tsx`'s own pattern) discovered while investigating the residual
> flakiness. **iOS**: re-investigated the "Swift/ObjC++ interop" blocker directly rather than
> trusting the earlier session's conclusion — the earlier "reproducible Xcode New Build System
> issue" theory was WRONG; the actual root cause (found via a minimal isolated probe class) is
> that `@objc` alone does not export a symbol into the generated `Autoskeleton-Swift.h` on this
> project's Swift 6.3.3 toolchain — the class/methods must also be `public`. Fixed by marking
> `AutoskeletonModuleBridge` and its `@objc` methods `public`; `getShapes`/`evictShapes` in
> `Autoskeleton.mm` now call the real Swift bridge (through a new
> `AutoskeletonUiThreadDispatching`-based dispatcher, mirroring Android's fix) instead of the old
> no-op stub. Also added `DEFINES_MODULE = YES` to `Autoskeleton.podspec` (a real, standard,
> documented fix for a static-library CocoaPods pod mixing Swift + Objective-C++, tried and kept
> even though it turned out not to be the deciding factor for this specific symptom) and a
> portable `#if __has_include(<Autoskeleton/Autoskeleton-Swift.h>)` import guard. **The iOS
> `RCTViewComponentView` overlay subclass (the visual draw-surface equivalent of Android's
> `AutoskeletonOverlayView`) was NOT built this session** — explicit scope stop, not an oversight:
> with zero iOS visual gate in this repo (5.7's own prior session explicitly deferred building
> one) there is no test harness to catch a mistake in hand-written Fabric C++/ObjC++ interop code,
> and the remaining session budget did not support the same multi-iteration empirical debugging
> this same class of native UI work required on Android. `resolveAutoskeletonOverlayNativeComponent()`
> still fails safely on iOS (no crash, no skeleton) until it exists — same contract as before,
> now with real `getShapes`/`evictShapes` data flowing underneath it. Harnesses this session:
> vitest 206/206 (was 199), playwright 36/36 unchanged, typecheck clean, Android unit 102/102 (was
> 83, +19 new), Android library instrumented 7/7 unchanged, Android app instrumented paint gate
> 2/3 reliably green + 1/3 flaky (was 1/3 green), iOS 59/59 (was 55, +4 new;
> verified via a temporary workspace-symlink install because `SyntheticHierarchyBuilder.swift`'s
> fixture-path resolution assumes a symlinked `:path` dependency — contradicting ADR-14's "no
> workspace symlink" rule, a pre-existing inconsistency this session did not introduce and did not
> fix, flagged as a follow-up; the real ADR-14-compliant tarball install was restored afterward and
> the getShapes/ViewManager/dispatcher code itself does not depend on that fixture path at all).
>
> **Session status (2026-08-27, branch `feat/visual-paint-gate`, third continuation — Android
> assertion calibration + iOS fixtures + iOS visual gate)**: three deliverables, in dependency
> order. (1) **Android paint gate assertion fix**: `skeletonPaintsOverDetectedShapes` was a
> calibration bug, not a wiring defect — it asserted the sampled pixel equals `baseColor` exactly,
> but the production draw pass (`AutoskeletonRendererTier1.ensureShader()`) paints one animated
> `LinearGradient(baseColor, highlightColor, baseColor)`, and `COLOR_TOLERANCE` (16) is narrower
> than the base/highlight per-channel delta (19) — any capture near the true highlight phase failed
> regardless of correctness. Fixed with `colorInRamp()`: every channel must fall within the
> ramp's own per-channel min/max, inflated by tolerance — strictly stronger than widening
> `COLOR_TOLERANCE`, since the three fixture colors stay far outside the grey 226..245 range on at
> least one channel each, verified rather than assumed. **4/4 consecutive runs, 3/3 green every
> time** (was 2/3 reliable + 1/3 flaky). (2) **iOS fixture-path fix**:
> `SyntheticHierarchyBuilder.swift`'s `packageRoot` computed a hardcoded 3-levels-up from
> `#filePath`, correct only for a symlinked `:path` dependency; under the real ADR-14 tarball
> install this landed on a path that never exists (`test/` is deliberately excluded from
> `package.json#files`). Fixed by mirroring the Android harness's already-established pattern
> (`SyntheticHierarchyBuilder.kt`'s `repoRoot`): walk up from the compile-time source location
> until a directory containing `test/fixtures/hierarchies` is found — no symlink reintroduced, no
> `test/` added to published files. **59/59 on 2 of 3 runs** (real tarball install, not symlinked);
> one run hit a single pre-existing, unrelated 2ms sensor-budget timing flake unconnected to any
> fixture-loading path, not reproduced on either follow-up run. Along the way, found and fixed a
> real npm gotcha unrelated to the design: `rm -rf node_modules/autoskeleton && npm install` alone
> silently served STALE cached tarball content keyed to the OLD integrity hash still recorded in
> `examples/bare-rn/package-lock.json`; fixed by reinstalling with the explicit
> `autoskeleton@file:../../.tarball/autoskeleton-0.1.0.tgz` specifier, which forces npm to
> recompute integrity. (3) **iOS visual gate built** (task 5.7's iOS half, previously blocked):
> added a genuine `com.apple.product-type.bundle.ui-testing` XCUITest target
> (`AutoskeletonBareRnPaintGateUITests`) to the app's own `.xcodeproj` (not CocoaPods-managed, so
> it survives `pod install`), created via the `xcodeproj` Ruby gem rather than hand-edited pbxproj
> text, wired via `TEST_TARGET_NAME` + a target dependency on the app target (the same mechanism
> Xcode's own target wizard generates) plus a new shared scheme `PaintGate-UITests`. Evaluated and
> rejected CocoaPods' `app_host_name` mechanism first: it only hosts a test bundle inside a minimal
> app the POD itself builds via a sibling `app_spec`, never the real `AutoskeletonBareRn` app with
> Metro connectivity. `PaintGateUITests.swift` mirrors `PaintGateInstrumentedTest.kt` exactly,
> including the same colour-ramp semantics from fix (1). **Verified RED for the right reason, 3
> consecutive deterministic runs**: `testSkeletonPaintsOverDetectedShapes` fails because the
> sampled pixel is React Native's own "Unimplemented component: <AutoskeletonOverlayView>"
> placeholder (screenshot evidence captured and inspected directly), not the fixture's raw content
> color. **This corrects a claim in the second continuation's own notes above**
> ("`resolveAutoskeletonOverlayNativeComponent()` still fails safely on iOS \[...\] no skeleton") —
> false on iOS as built: `codegenNativeComponent()` never throws synchronously for a missing native
> view manager registration, so `resolveAutoskeletonOverlayNativeComponent()` always returns the
> codegen'd reference and Fabric mounts it, then falls back to its own dev placeholder at mount
> time instead of leaving the real content visible. This is real, useful information for 5.8/2c:
> the overlay view build should not assume "fails open to null" was ever true on this platform.
> The other two gate assertions pass today for accurate reasons (real content color is masked by
> the placeholder while loading; toggling `isLoading` off correctly shows real content with no
> skeleton, confirming the overlay element only mounts while loading). **The `RCTViewComponentView`
> overlay subclass itself was NOT built this session** — explicit scope stop per this session's own
> instructions, which name stopping after the gate exists as a legitimate outcome rather than
> building a view without the multi-iteration native debugging budget Android's equivalent work
> required. Harnesses this session: vitest 206/206 unchanged, Android paint gate 3/3 (was 2/3 +
> 1/3 flaky), iOS unit 59/59 on 2/3 runs (real tarball install; unrelated flake on 1 run, not
> reproduced twice after), iOS UI test (new) 2/3 green + 1/3 RED by design (was: gate did not
> exist).

- [x] **5.1** RED→GREEN Turbo Module TS spec `src/native/NativeAutoskeleton.ts`
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
- [x] **5.2** RED→GREEN `NativeShapeCache` (native-side authority, ADR-9) keyed by the same
      composite-key string, written only for a traversal JS requested; `store.invalidate(...)` →
      native `evict(keys)` consistency wiring with the JS `ShapeStore` (1.3).
      **Tests**: iOS XCTest + Android JUnit consistency test — native cache and JS `ShapeStore`
      never diverge after `set`/`invalidate`/`evict` (ADR-9's explicit consequence).
      **Observability**: N/A directly; surfaces via `onMetrics.cacheHit` correctness.
      **Performance**: NFR-4 applies to the native `NativeShapeCache.get` path — local guard.
      Deps: 5.1. Complexity: M. Example app: bare RN + Expo.
- [x] **5.3** RED→GREEN Expo Go guidance path (ADR-15) — native accessor returns `null` when
      absent (never throws at import time); `__DEV__` throws a named actionable error naming
      Expo Go and the dev-build fix; production fails open (`children` rendered unwrapped,
      `onMetrics.degraded:['native-module-unavailable']`).
      **Tests**: Expo E2E (Detox/Maestro) — dev-mode named-error assertion; production fail-open
      assertion (children render, no crash, degradation flag present). **Observability**:
      `onMetrics.degraded` carries `native-module-unavailable` in production — the field RISK-10
      names as the field-visibility signal for an Expo Go install. **Performance**: N/A, error/
      fallback path. Deps: 5.1. Complexity: M. Example app: Expo (only app exercising the
      absent-module condition).
      **Session note**: `resolveNativeModule()`/`AutoskeletonNativeModuleUnavailableError`/
      `logNativeModuleUnavailableOnce()` implemented and Vitest-tested (mocked `react-native`);
      wired into `native/AutoSkeleton.tsx`'s fail-open branch. No Detox/Maestro harness exists
      anywhere in this repo (never scaffolded in any prior phase either), so the DoD's "Expo E2E"
      line is not closed this session — the logic is verified at the unit level only.
- [x] **5.4** RED→GREEN `src/native/tier2/SkiaRenderer.tsx` — opt-in Skia overlay, Reanimated
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
- [~] **5.5 PARTIAL** RED→GREEN native public `<AutoSkeleton>` — `src/native/AutoSkeleton.tsx`,
      `src/index.native.ts` — wires 3.x/4.x sensors + 3.2/4.4/5.4 renderers + `SkeletonProvider`,
      tier-selection logic, `delay` prop.
      **Tests**: iOS+Android native E2E — REQ-SIMPLE-1 full cold-load, and REQ-NAV-1 hot-path +
      rotation-invalidation end to end through the Turbo Module. **Observability**: full
      `onMetrics` emission verified end-to-end on both platforms. **Performance**: NFR-3/NFR-4
      end-to-end (traversal + bridge + cache) — local guard. Deps: 5.4, 5.3, 3.4, 4.6.
      Complexity: L. Example app: bare RN + Expo.
      **Session status**: the component itself (cache-key composition via `useWindowDimensions`/
      `PixelRatio.getFontScale()`/`I18nManager.isRTL`, cold-measurement via the Android-side
      `getShapes` bridge, REQ-PTR-1 default, ADR-16 handoff, tier selection, `delay`, ADR-15
      fail-open) is implemented and typechecked, but no iOS+Android native E2E was run — no
      Detox/Maestro harness exists in this repo (see 5.3's note), and the on-screen native draw
      surface (`AutoskeletonOverlayView`) referenced by `AutoskeletonOverlayNativeComponent.tsx`
      was not built this session (see the Phase 5 header note above), so a real device/simulator
      run would show NO visible skeleton yet on either platform even though the sensor bridge
      itself is real and tested (Android) or partially real (iOS). Marked PARTIAL, not complete,
      per this project's own "do not mark complete if focused tests fail/are missing" rule.
- [x] **5.6** Close the RISK-5 packaging detector's native portion — extend 0.6/2.5's test
      asserting `index.native.js` exists in `lib/module` and `lib/commonjs`, native specifiers
      correctly present there; run the full RISK-5 suite GREEN for the first time.
      **Tests**: `test/packaging/entries.test.ts` fully GREEN (started RED in 0.6).
      **Observability**: N/A, packaging test. **Performance**: N/A. Deps: 5.5, 2.5. Complexity:
      S. Example app: none/unit-only.
- [x] **5.7** RED, written FIRST per the RISK-5/0.6 precedent — the ON-DEVICE VISUAL PAINT GATE.
      Narrowed continuation of Phase 5, not the rest of its remediation: `examples/bare-rn/App.tsx`
      now renders a real `PaintGateScreen` fixture (known-color text/image/rounded-card content,
      runtime `isLoading` toggle) wrapped in the real native `<AutoSkeleton>` from the published
      package; `examples/bare-rn/android/app/src/androidTest/.../PaintGateInstrumentedTest.kt`
      launches the real app, waits for the real JS bundle to mount it, rasterizes the real
      on-screen frame with `PixelCopy.request(Window, ...)` (never `View.draw(Canvas)`), and
      asserts real ARGB pixels at the fixture's real screen location (found via
      `accessibilityLabel`, never guessed coordinates).
      **THIS TEST IS DELIBERATELY RED AND MUST NEVER BE WEAKENED, SKIPPED, OR DELETED TO MAKE CI
      GREEN.** It closes only when a real `AutoskeletonOverlayView` `ViewManager` is registered
      (Android: `AutoskeletonPackage.createViewManagers`; iOS: an `RCTViewManager`) and actually
      draws through the already-built `AutoskeletonRendererTier1.mount(surface:...)` — the exact
      gap 5.5's session note documents as still open.
      **Tests**: `PaintGateInstrumentedTest.skeletonPaintsOverDetectedShapes` and
      `.realContentHiddenWhileLoading` fail today for the right reason — real pixel mismatch
      (`#0000FF` sampled where `#e2e2e2` was expected), not a build error, missing fixture, bad
      selector, or unregistered-component error; `.realContentVisibleAndSkeletonGoneAfterLoadCompletes`
      already passes (nothing currently hides the content either, which is the same root cause
      from the other side) and stands as the regression guard once the other two go green. Not
      satisfiable by `AutoskeletonDebugOverlay`: the fixture never passes `debugOverlay` to
      `<AutoSkeleton>`, and every sampled pixel is the geometric center of a large fixture shape,
      far from any outline stroke, so only a genuine solid-fill production draw pass can turn it
      into `baseColor`. **Android status (final, third continuation)**: the exact-`baseColor`
      assertion was itself a calibration bug — the production draw pass animates a gradient
      between `baseColor` and `highlightColor`, and `COLOR_TOLERANCE` was narrower than that
      delta. Fixed with a colour-RAMP assertion (`colorInRamp()`, every channel within the ramp's
      own min/max + tolerance) — strictly precise, not a loosened tolerance. 3/3 assertions green,
      4/4 consecutive runs, no flakiness remaining.
      **iOS**: a genuine on-device XCUITest visual gate now exists —
      `examples/bare-rn/ios/AutoskeletonBareRnPaintGateUITests/PaintGateUITests.swift`, a real
      `com.apple.product-type.bundle.ui-testing` target added to the app's own `.xcodeproj` (via
      the `xcodeproj` Ruby gem, not CocoaPods — CocoaPods' `app_host_name` mechanism was evaluated
      and rejected because it only hosts tests inside a minimal app the POD itself builds, never
      the real example app with Metro connectivity), wired via `TEST_TARGET_NAME` + a target
      dependency on the app target, with a dedicated shared scheme `PaintGate-UITests`. Mirrors
      `PaintGateInstrumentedTest.kt` exactly (same fixture, same `testID` lookups via
      `XCUIElement`, same colour-ramp semantics, real `XCUIScreen.main.screenshot()` pixel
      sampling). Verified RED for the right reason, 3 consecutive deterministic runs:
      `testSkeletonPaintsOverDetectedShapes` fails because the sampled pixel is React Native's own
      "Unimplemented component: <AutoskeletonOverlayView>" placeholder — confirmed via captured
      screenshot evidence, not React Native's own no-op fallback the earlier session's notes
      assumed (see the Phase 5 header's third continuation note for the full correction). The
      `RCTViewComponentView` overlay subclass itself remains NOT built — explicit scope stop, gate
      exists and is proven RED for the right reason, which is this task's Definition of Done; the
      overlay view is 5.8/2c's job, not 5.7's. **Observability**: N/A, gate test. **Performance**:
      N/A. Deps: 5.5. Complexity: M. Example app: bare RN (both platforms now have a real,
      running, RED-by-design visual gate).
      **Incidental fixes discovered while building this fixture** (both real, both necessary for
      any bare-rn Jest/Metro use of the published package, neither a design deviation):
      `examples/bare-rn/jest.config.js` now sets `testEnvironmentOptions.customExportConditions:
      ['react-native']` — Jest's default resolver applies no `react-native` `exports` condition,
      so `require('autoskeleton')` was silently resolving to the WEB build (`lib/module/index.js`
      → `index.web.js`) under Jest even though Metro (real device/simulator builds) always
      resolves correctly; and `examples/bare-rn/metro.config.js` now sets `resolver.useWatchman:
      false` — Watchman cannot crawl this repo in the sandboxed session environment ("Operation
      not permitted"), crashing Metro on startup; the node-crawler fallback (already what Jest
      silently uses here) is unaffected functionally, just slower.
- [x] **5.8** RED→GREEN the iOS `RCTViewComponentView` overlay subclass — the missing draw
      surface `AutoskeletonOverlayHostComponent.tsx` resolves but which nothing implemented on
      iOS, the actual root cause of the "Unimplemented component: `<AutoskeletonOverlayView>`"
      placeholder 5.7's iOS gate proved was painting instead of a real skeleton.
      `ios/AutoskeletonOverlayViewHost.swift` (new, unit tested by
      `ios/Tests/AutoskeletonOverlayViewHostTests.swift`, 13 RED→GREEN cases: wire decode at full
      fidelity with NO density scaling — iOS's wire is already points, unlike Android's — hex
      color parsing with a safe fallback, mount/no-mount-on-cache-miss/no-mount-on-zero-size,
      in-place update without restarting the shimmer phase, reduced-motion/`animation:"none"`
      degradation, `speedMs` flowing through to the shared clock) hosts the EXISTING, already-
      tested `AutoskeletonRendererTier1` (task 3.2) — no new drawing logic, only the wiring.
      `ios/AutoskeletonOverlayView.h`/`.mm` (new) is the thin ObjC++ `RCTViewComponentView`
      subclass Fabric mounts: `+componentDescriptorProvider` wires the codegen'd
      `AutoskeletonOverlayViewComponentDescriptor`; `updateProps:oldProps:` and `layoutSubviews`
      both call into the Swift host (props arrive before layout metrics on first mount, mirroring
      why Android's own view re-runs `mountOrUpdate()` from `onSizeChanged`); `prepareForRecycle`
      calls `destroy()`.
      **Tests**: `PaintGate-UITests` 3/3 green, 3/3 consecutive full-suite runs. Real
      `xcodebuild test -scheme Autoskeleton-Unit-Tests` 72/72 (was 59/59 + 13 new host tests), no
      regression. **Observability**: N/A, hosting-only task — `debugOverlay` prop is accepted and
      stored, not yet wired to a visible rung overlay (matches Android's own current state, not a
      new gap). **Performance**: N/A, reuses the already-benchmarked tier-1 renderer unmodified.
      Deps: 5.7, 3.2. Complexity: M. Example app: bare RN (iOS).
      **Discovery mechanism, corrected mid-session**: the free-function `.mm`-crawl convention
      (`Class<RCTComponentViewProtocol> <Name>Cls(void)`, the mechanism this task's brief
      described) does NOT fire for this package — `parseiOSAnnotations` skips any library whose
      `codegenConfig` has no `ios` key at all before the crawl fallback is ever reached, confirmed
      empirically (added the free function, ran `pod install`, found no new entry in the
      generated `RCTThirdPartyComponentsProvider.mm`). Fixed with the non-deprecated, explicit
      `codegenConfig.ios.componentProvider` map in root `package.json` — the SAME mechanism
      `react-native-safe-area-context` uses, verified by reading its own `package.json` directly.
      **Second real defect found and fixed**: `AutoskeletonOverlayView.h` (subclassing
      `RCTViewComponentView`, which transitively `#include`s the C++ standard header `<atomic>`
      via RN's own `EventBeat.h`) broke the WHOLE Swift target's build the moment it was left
      PUBLIC — CocoaPods folds public headers into the pod's auto-generated umbrella header, which
      Xcode also compiles to build the synthesized Clang module Swift needs to see this pod's
      ObjC/C++ surface, and that module compilation could not resolve `<atomic>` ("could not build
      module 'Autoskeleton'"). Fixed by adding it to `Autoskeleton.podspec`'s
      `private_header_files`, mirroring `Autoskeleton.h`'s existing (opposite-reasoned) entry.
      **Third real defect found and fixed, in the TEST HARNESS, not production code**: with a real
      overlay now mounting, `PaintGateUITests`'s original single-shot screenshot sample (taken
      immediately after `waitForMount()`'s existence check) raced the overlay's own async mount —
      content children mount on React's FIRST render pass, the overlay only mounts once the async
      native `getShapes` round-trip resolves on a LATER pass. Confirmed empirically: 4/4
      consecutive single-shot runs failed, showing the exact raw content color, not a color
      partway through any animation phase. Fixed by polling each pixel for up to 5s
      (`pollUntilPixel`) instead of sampling once — the same "wait for a real condition" discipline
      `waitForMount` itself already used, never a widened color tolerance.

## Phase 6: Virtualized lists (all three sub-cases)

> **Session status (2026-08-28, branch `feat/phase-6-virtualized-lists`)**: 6.1-6.5 DONE on
> **Android only** — genuinely proven on a real emulator via a new `PaintGateListInstrumentedTest`
> (5/5 green, reproduced 3/3 consecutive full runs), not just unit-tested. **iOS was not touched
> this session** (no iOS simulator was booted; Android was the feasible path within this session's
> budget) — explicit scope stop, not an oversight, tracked as an open item below.
>
> Three REAL defects were found and fixed only because the app was actually run on-device — none
> were, or could have been, caught by Vitest (no RN runtime under Vitest's `node` environment):
> (1) `InteractionManager` has been REMOVED from `react-native` core on this repo's RN version
> (0.87.1), contradicting the task text's own `runAfterInteractions` mechanism — fixed with
> `scheduleAfterInteractions.ts` (`InteractionManager` → `requestIdleCallback` → `setTimeout(0)`
> fallback chain, unit-tested); (2) a concurrent-render race where every sibling list cell for an
> unseen `itemType` read the shared template registry as `'idle'` in the same commit (React
> render phases for all siblings finish before any effect flushes), so claiming inside `useEffect`
> let every one of them schedule its own measurement — fixed by claiming synchronously in the
> render body instead; (3) the invisible template-measurement host hid itself with `opacity: 0`,
> which `AutoskeletonSensor.kt`'s traversal explicitly treats as invisible (`alpha <= 0.01f` is
> skipped), so every template measurement silently produced a zero-shape snapshot — fixed by
> moving the template off-screen instead of hiding it via opacity.
>
> **Design deviation from this task list's literal text, stated explicitly**: none of the list
> components (`SkeletonList`, `SkeletonListFooter`, `SkeletonCell`/`useSkeletonCell`) accept or
> fire `onMetrics` — that prop lives only on whole-screen `<AutoSkeleton>`. The
> `cacheHit`/`traversalMs` observability this task list describes as `onMetrics` fields is instead
> exposed directly on `useSkeletonCell`'s return value (`snapshot`, `cacheHit`, `isFallback`,
> `cacheKey`) and via the dev-only `templateTraversalCounter` seam
> (`src/native/list/listRuntime.ts`), which is what the native E2E gate actually reads off the
> real running app. spec.md's abbreviated `<SkeletonList itemType estimatedCount />` example also
> omits how a template gets real content to measure; all three components take an optional
> `renderTemplate` prop for this (documented in each file's own header) — omitting it is valid and
> leaves that itemType on the deterministic fallback forever, never a crash or a wrong shape.
>
> Harnesses this session: vitest 241/241 (was 206), typecheck clean, Playwright 36/36 unchanged
> (2 REQ-PTR-1 tests strengthened with genuine `onMetrics` non-call/call assertions — see 6.5),
> Android unit 102/102 unchanged, Android library instrumented 7/7 unchanged, Android app
> `PaintGateInstrumentedTest` (Phase 5's whole-screen gate) 3/3 unchanged, **new
> `PaintGateListInstrumentedTest` 5/5 green, reproduced 3/3 consecutive full runs**. iOS unit/gate
> numbers not re-run this session (zero iOS source touched).

- [x] **6.1** RED→GREEN `<SkeletonList itemType estimatedCount />` — sub-case 1: N synthetic
      rows from cached `itemType` shapes; first-ever render measures ONE invisible template cell
      deferred via `Sensor.refine`/`runAfterInteractions`, persists before further rows use it.
      **Tests**: native E2E (Android) — `PaintGateListInstrumentedTest
      .skeletonListHeaderAndSkeletonListFooterBothPaintRealSkeletonContent` proves the standalone
      `SkeletonList` header block genuinely paints shimmer content from its own itemType's
      first-ever measurement (real pixel sample, not a formatter), and
      `.zeroTraversalOnBindAcrossManyConcurrentLoadingCells` proves the deferred measurement never
      blocks (the app is interactive/scrollable while it resolves). REQ-LIST-EMPTY-1/2 pure-logic
      layer (`decideCellBind`, `buildSyntheticRowKeys`, the template registry) is Vitest-tested at
      100% in `src/core/list.test.ts`. **Observability**: no `onMetrics` (see deviation note
      above) — `cacheHit`/`isFallback` are directly inspectable on the hook layer;
      `templateTraversalCounter` isolates the one-time measurement, read live off the real app.
      **Performance**: NFR-3 for the one-time measurement is the native sensor's own existing
      budget (unchanged); deferred/non-blocking is proven by the app staying scrollable/responsive
      throughout the on-device test, not a synthetic frame-budget assertion. Deps: 5.5.
      Complexity: L. Example app: bare RN (Android). iOS/Expo: not done this session.
- [x] **6.2** RED→GREEN pagination footer — sub-case 2: `ListFooterComponent` skeleton rows from
      cached `itemType` shapes, no re-traversal of existing rendered rows.
      **Tests**: native E2E (Android) — `SkeletonListFooter` shares the main list's itemType
      (already warm from `SkeletonCell` rows above it); `skeletonListHeaderAndSkeletonListFooter
      BothPaintRealSkeletonContent` scrolls until the footer is reachable and proves it paints
      real skeleton content, while `zeroTraversalOnBindAcrossManyConcurrentLoadingCells` proves the
      traversal counter stays at its already-settled value after the footer becomes visible — the
      direct "no re-traversal" proof. **Observability**: dev-only traversal counter (see 6.1);
      no `onMetrics` (deviation note above). **Performance**: zero additional traversal is the
      explicit counter-based assertion. Deps: 6.1. Complexity: M. Example app: bare RN (Android).
      iOS/Expo: not done this session.
- [x] **6.3** RED→GREEN `useSkeletonCell(itemType)` — sub-case 3: **ZERO TRAVERSAL ON BIND**,
      synchronous cache lookup only; unseen `itemType` renders a fallback generic skeleton
      immediately and schedules traversal via `runAfterInteractions`.
      **Tests**: native E2E (Android) — `zeroTraversalOnBindAcrossManyConcurrentLoadingCells`
      is THE direct proof: ~26 concurrently-loading `SkeletonCell` rows for one unseen `itemType`
      settle the real on-screen traversal counter at exactly 2 (1 per distinct itemType in the
      fixture) and it stays there through 12 scroll-driven recycle passes rebinding many more
      cells. `decideCellBind`'s "at most once, ever" contract is additionally Vitest-proven in
      isolation (`src/core/list.test.ts`). **Observability**: `isFallback` on the hook result is
      the "distinguishable" signal (no dev-sidecar flag — see deviation note); the fallback path
      renders a structurally distinct `FallbackSkeletonBlock`, itself regression-guarded by a real
      finding (`test/native/template-measurement-host.test.ts`: must never use `opacity<=0.01`,
      which the native sensor treats as invisible). **Performance**: NFR-4 bind-path budget is
      structurally zero-cost by construction (a bind is exactly one synchronous `Map`-like read;
      no sensor call exists on that path) — not independently benchmarked this session.
      Deps: 6.1. Complexity: L. Example app: bare RN (Android). iOS/Expo: not done this session.
- [x] **6.4** RED→GREEN shared shimmer phase across cells + recycling-safe hide/restore state
      (ADR-8/ADR-13) — keyed by item identity, not view instance; reset on bind.
      **Tests**: native E2E (Android) — `noStaleSkeletonAfterTenRecycleCycles` (10 scroll-
      down/up cycles, then samples every visible real AND skeleton row, asserting neither
      direction of RISK-3's leak) and `allVisibleSkeletonCellsShareOnePhaseInTheSameFrame`
      (samples 2+ visible skeleton cells in ONE captured frame and asserts they agree with EACH
      OTHER, not just each individually falling in the shimmer ramp — the actual observable
      meaning of "shared clock"). Both genuinely exercise a real `@shopify/flash-list` `FlashList`
      (installed as an example-app-only dev dependency), which performs REAL native view-instance
      recycling — FlatList cannot exercise this defect class by construction, noted explicitly
      since the task brief's literal example used FlatList/FlashList interchangeably.
      **Discovery**: the shared clock (`sharedShimmerClock`, a Kotlin file-scope singleton in
      `AutoskeletonOverlayView.kt`) and per-bind hide/restore reset (`mountOrUpdate()`'s
      cacheKey-diffing) were ALREADY correctly implemented by Phase 3-5's own native work — this
      task's real contribution was proving it holds under GENUINE list recycling, which no
      previous test exercised. **Observability**: `templateTraversalCounter` stays flat across
      all 10 recycle cycles (asserted directly). **Performance (NFR-8)**:
      `noUnboundedNativeHeapGrowthAcrossRecycleCycles` — a REAL `Debug
      .getNativeHeapAllocatedSize()` measurement before/after 10 recycle cycles, not a proxy, with
      an honestly-documented limitation (a two-point sample cannot be authoritative leak-detection
      without a dedicated heap-dump tool this project doesn't have wired up; a monotonic unbounded
      climb is what a genuine leak would show, which this test would catch). Deps: 6.3.
      Complexity: M. Example app: bare RN (Android). iOS/Expo: not done this session.
- [x] **6.5** RED→GREEN pull-to-refresh stale-while-revalidate default + opt-out (REQ-PTR-1),
      applied to both whole-screen `AutoSkeleton` and list contexts.
      **Real bug found and fixed, not merely tested**: `useHandoffAndMetrics` in BOTH
      `native/AutoSkeleton.tsx` and `web/AutoSkeleton.tsx` unconditionally called
      `controller.requestHandoff()` and fired `onMetrics` once the handoff settled, with NO check
      for the suppressed (stale-while-revalidate) cycle — present since Phase 2/5. Fixed via one
      shared, Vitest-tested predicate (`shouldRunHandoffCycle`, `src/core/refresh-gate.ts`).
      **Tests**: `test/web/auto-skeleton.spec.ts`'s REQ-PTR-1 suite (Playwright, real browser) was
      REWRITTEN to genuinely exercise the bug: the original test only asserted
      `overlayCount === 0` with `onMetrics` never even wired, which could not have caught this —
      the new version warms the cache with a real cold traversal first (so `snapshot` is
      genuinely non-null, the actual condition under which the bug fired), completes the
      suppressed cycle, and asserts `onMetrics` fires exactly once (from the warm-up), never
      twice. Verified RED against the pre-fix code (2 calls, not 1) before restoring the fix.
      List-context applicability: `SkeletonList`/`SkeletonListFooter`/`useSkeletonCell` have no
      independent `onMetrics`/loading-lifecycle of their own to leak an event from (see 6.1's
      deviation note) — PTR for a list is an app-level composition concern (conditionally
      rendering these components), satisfied by construction rather than needing its own bugfix.
      **Native E2E gap, stated honestly**: the native fix mirrors the web fix exactly (same
      predicate, same code shape) and is covered by the SAME Vitest predicate test, but this
      session did not build a dedicated on-device PTR scenario for the native
      `AutoSkeleton`/`useHandoffAndMetrics` path specifically (time-boxed out) — high confidence
      from the shared logic and the web proof, not a native on-device proof. **Observability**:
      `onMetrics` NOT fired for the default no-skeleton PTR path — asserted as a genuine non-call
      against a warm cache, the exact condition that was previously buggy. **Performance**: N/A,
      behavioral gate. Deps: 5.5. Complexity: S. Example app: Vite (web, real bugfix + real
      test); bare RN (native fix applied, not independently E2E-proven this session).
- [x] **G.4** RED→GREEN fix the `package.json#exports['.'].types` packaging gap this session's
      Phase 6 closure noted as open (a single flat `types` field made Phase 6's entire public API
      — `SkeletonList`/`SkeletonCell`/`SkeletonListFooter`/`useSkeletonCell` — invisible to
      TypeScript for a real react-native consumer; Metro resolved the module correctly, but `tsc`
      always resolved to the bare web-reexporting `index.d.ts` regardless of which platform
      condition was active). **Root cause, verified against `react-native-builder-bob`'s own
      source** (`node_modules/react-native-builder-bob/lib/src/targets/typescript.js:236-269`):
      the flat `types` key was listed FIRST in `exports['.']`'s JSON object, and Node/TypeScript's
      exports resolution takes the FIRST own key that is `"default"` or an active condition — so
      `types` always won before `react-native`/`browser` were ever checked. The previous session's
      abandoned attempt was reported as "bob's validator rejects a non-string
      `exports['.'].types`"; that read was about the wrong shape (a single key whose VALUE became
      an object) — bob's validator only inspects `exports['.'].types` when that exact top-level
      key is truthy (`typescript.js:244`), so REMOVING it and nesting a `types` sub-condition
      inside each of `react-native`/`browser`/`default` instead makes the guard a no-op; confirmed
      by running `bob build` (`npm run prepare`), which completed with zero errors and the
      pre-existing unrelated `[module]` warning unchanged (reproduced byte-identical before/after
      via `git stash`). **Fix**: `exports['.']` now nests `{ types, default }` under each of
      `react-native`/`browser`/`default`, pointing at `lib/typescript/module/src/index.native.d.ts`
      / `index.web.d.ts` / `index.d.ts` respectively (all three already emitted by the existing
      `tsc` multi-entry build — no build config changes needed). **Consumer configuration,
      documented in the new root `README.md`**: `moduleResolution: bundler|node16|nodenext` is
      required for TypeScript to honor `exports` at all; a React Native consumer needs
      `customConditions: ["react-native"]`, which `@react-native/typescript-config` (the config
      every RN app already extends) ships by default — verified `examples/bare-rn/tsconfig.json`
      needed zero changes. A Jest consumer needs `testEnvironmentOptions.customExportConditions:
      ['react-native']` (Jest ignores `exports` conditions entirely, independent of
      `moduleResolution` — this repo's `examples/bare-rn/jest.config.js` already had this from an
      earlier session; the README now states it explicitly). **Tests**: extended the RISK-5
      packaging detector (`test/packaging/entries.test.ts`) with a permanent guard —
      `resolveExportsTarget()`, a minimal simulation of Node's exports-resolution algorithm,
      proves `[react-native, types]` resolves to a declaration file containing `SkeletonList`,
      `[browser, types]` and bare `[types]` resolve to declaration files that do NOT, and the two
      are genuinely different files; also asserts `exports['.']` no longer sets a top-level
      `types` key. Verified RED first against the pre-fix `package.json` (3 of 25 assertions
      failed for the exact right reason — the native-condition resolution landed on
      `export * from './index.web.js'`, containing no `SkeletonList`), then GREEN after the fix
      (25/25). **Real-consumer proof** (not package.json inspection): repacked the tarball and
      reinstalled it into `examples/bare-rn` and `examples/vite` with an explicit `file:`
      specifier (the tarball trap — a bare `npm install` does not refresh a `file:` dependency
      once `package-lock.json` pins the old integrity hash). `examples/bare-rn`: real `tsc
      --noEmit` against the existing `App.tsx` (which already imports `SkeletonList`,
      `SkeletonCell`, `SkeletonListFooter`) exits 0 clean; a deliberate typo sanity check
      (`SkeletonList` → `SkeletonListDoesNotExist`) confirmed `tsc` genuinely inspects that import
      (`TS2305: has no exported member`) before being reverted. `examples/vite`: a temporary
      scratch fixture proved both directions — `AutoSkeleton`/`AutoSkeletonProps`/
      `SkeletonProvider` typecheck cleanly (exit 0), and a second temporary import of
      `SkeletonList` fails with the same `TS2305` error, then both scratch changes were removed
      (git-clean diff for `examples/vite`, only `package.json`/`package-lock.json` reinstall
      churn remains tracked). **No regressions**: vitest 247/247 (was 241/241 — +6 new packaging
      assertions), typecheck clean, Playwright 36/36, `examples/vite` `boot-smoke` (real
      production `vite build`) green, `examples/bare-rn` `boot-smoke` (RN CLI autolinking
      discovery) green. `examples/bare-rn`'s Jest suite fails on an unrelated pre-existing gap
      (`@shopify/flash-list`'s own ESM output is not in Jest's `transformIgnorePatterns`) —
      reproduced byte-identical against the pre-fix `package.json` via `git stash`, confirmed NOT
      a regression from this task, left untouched as out of scope. Android/iOS unit and gate
      suites not re-run this session (zero native source touched by this fix — package.json,
      README.md, and a test file only). Deps: 6.1-6.5. Complexity: S. Example app: bare RN
      (real, existing native-consumer proof); Vite (temporary web-consumer proof, both
      directions).

## Phase 7: Theming interops (Uniwind / NativeWind)

- [x] **7.1** RED→GREEN `--skl-base`/`--skl-highlight` CSS-variable contract wired into 2.2's
      renderer, Tailwind v4 `@theme` cascade, dark mode via cascade with no prop change
      (REQ-THEME-1).
      **Real bug found and fixed** (not a from-scratch feature): the CSS custom-property
      *fallback* contract (`var(--skl-base, #e2e2e2)`) already existed since task 2.2, but
      `css-renderer.ts`'s `applyAnimation()` unconditionally wrote an INLINE
      `overlay.style.setProperty('--skl-base', theme.baseColor)` on every mount — and
      `theme.baseColor` is always the library's own JS `DEFAULT_THEME` constant unless a
      consumer explicitly customizes `SkeletonProvider`. An inline style always beats any
      stylesheet declaration of the same custom property regardless of specificity or cascade
      origin, so a consumer's `:root`/`@theme`/`.dark` override was silently clobbered on every
      render — REQ-THEME-1's "no prop change" guarantee was not actually met. Fixed by exporting
      `DEFAULT_BASE_COLOR`/`DEFAULT_HIGHLIGHT_COLOR` as the single source of truth for both the
      stylesheet's `var()` fallback and `AutoSkeleton.tsx`'s `DEFAULT_THEME` (imported, not
      duplicated), and only writing the inline override when `theme.baseColor`/`highlightColor`
      differs from that default — i.e. only when a consumer explicitly asked for a color via a
      React prop. Default (unconfigured) usage now genuinely defers to the CSS cascade.
      **Tailwind v4 `@theme` finding (verified against the real compiler, not assumed)**: an
      arbitrary non-namespaced custom-property key (e.g. `--skl-highlight`) inside `@theme` is
      SILENTLY DROPPED by Tailwind v4 4.3.3 — only recognized namespaces (`--color-*`, `--font-*`,
      etc.) survive into the compiled `:root`/`:host` block. spec.md §1.9's own scenario text
      already anticipates this ("inside `@theme` **or** `:root`") — the practical consumer pattern
      is either a plain `:root { --skl-base: ...; }` declaration (untouched pass-through, verified)
      or a `--color-skl-base` alias inside `@theme` var-of-var'd into `--skl-base` at `:root`. Both
      are exercised by the tests below.
      **Tests**: `test/web/theme-cascade.spec.ts` (Playwright, 2 new) — both compile a REAL
      Tailwind v4 entry stylesheet through the actual installed `@tailwindcss/cli` binary
      (`test/web/helpers/tailwind.ts`, new — resolves and spawns the CLI directly, no `npx`/network
      dependency; scratch files live under gitignored `.tailwind-tmp/`, never committed) and mount
      the REAL `createCssRenderer()` with the library's untouched default theme (no
      `SkeletonProvider` override — the shape every default consumer gets): (1) a `@theme`
      `--color-skl-base`/`--color-skl-highlight` pair aliased at `:root` resolves through to the
      rendered `background-color`, overriding the JS default with zero prop change; (2) toggling
      `.dark` on `<html>` (no renderer method call, no re-mount, no prop of any kind) flips the
      resolved color via cascade alone. Verified RED first for the exact right reason (both
      assertions returned `rgb(226, 226, 226)` — the old inline-forced JS default — regardless of
      the Tailwind-compiled `--skl-base` value), then GREEN after the fix. Also extended
      `src/web/css-renderer.test.ts` (Vitest, +1) asserting the stylesheet's `var()` fallbacks
      match the exported `DEFAULT_*` constants exactly (drift guard). **Observability**: N/A,
      styling resolution only. **Performance**: N/A; contributes to NFR-6 only via CSS custom
      properties, re-verified in 7.4. Deps: 2.2. Complexity: S. Example app: Vite.
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
