# Observability: `debugOverlay` and budget warnings

`autoskeleton` treats observability as a phase-1 requirement, not a final
add-on (`docs/product-brief.md` §11). This document covers the two
developer-facing tools: the visual `debugOverlay` and dev-mode budget
warnings. See `docs/image-pipeline.md` for `onMetrics`, and `plan.md` §6
ADR-2 for `radiusSourceHistogram`.

## `debugOverlay`

```tsx
<AutoSkeleton
  isLoading={isLoading}
  skeletonKey="product-card"
  debugOverlay={__DEV__}
/>
```

When `debugOverlay` is `true` **and** `__DEV__` is true, `autoskeleton`
draws the outlines of every detected shape, annotated with:

- its index in traversal order,
- its source type (`text` / `image` / `background` / `synthetic-line` /
  `container`),
- a cache hit/miss badge,
- (Android only, today) its `RadiusSource` — which rung of ADR-2's
  degradation ladder resolved that shape's corner radius
  (`measured`/`outline`/`raster-probe`/`hint`/`default`).

This is the tool for answering "why did it not detect this node" or "why is
this corner square when I expected it rounded" without reading source.

`debugOverlay` is **dev-only by construction**, not by convention: the
`process.env.NODE_ENV !== 'production'` guard is written so a real
production build's bundler (Vite/webpack/Metro) dead-code-eliminates the
entire `DebugOverlay` component via its own `production` literal
replacement — verified by `test/packaging/web-bundle.test.ts` (task 2.5's
DoD), which asserts the string `askl-debug-overlay` never appears in a
production web bundle. You do not need to strip `debugOverlay` props before
shipping; a correctly configured bundler already removes the code that
would use them.

**Current implementation status:** the overlay draws on **web only**.

On **both** native platforms the `debugOverlay` prop is accepted and stored
and nothing reads it: Android's `AutoskeletonOverlayView` declares
`var debugOverlay` and its ViewManager assigns it, but no code path reads the
field, and `AutoskeletonDebugOverlayFactory.createIfDebug` has no production
call site. iOS's `mountOrUpdate` takes a `debugOverlay: Bool` it never
references, and `AutoskeletonDebugOverlay.swift` likewise has no caller. Both
classes are implemented and unit-tested; neither is wired.

This paragraph previously said the overlay was "fully wired on web and
Android" and named iOS as the only gap — "an open item, not a silent gap".
That was exactly backwards, and worse than an undocumented gap: a reader with
a blank overlay on Android would have concluded the fault was theirs. Corrected
2026-08-30 after a fresh-eyes review. `spec.md`'s REQ-OBS-OVERLAY-1 asks for
the overlay to draw, so this remains an open requirement on native, not a
resolved one.

## Dev budget warnings

Two independent budgets are checked after every traversal:

| Budget | Default | Configured via |
|---|---|---|
| Traversal time | 2 ms (NFR-3) | `SkeletonProvider budgetMs` |
| Shape count | 60 shapes (NFR-3) | `SkeletonProvider maxShapes` |

```tsx
<SkeletonProvider budgetMs={2} maxShapes={60}>
  <App />
</SkeletonProvider>
```

When a traversal exceeds either budget, a `console.warn` fires in
development only, naming the measured value, the configured budget, and an
actionable suggestion:

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
`traversalP95Ms`/`shapeCount` gates enforce in CI (`benchmarks/`, task
9.1) — a warning you see locally in development is the same threshold that
would fail a regression benchmark in CI.

### Radius-fallback warning (Android, ADR-2)

A third, Android-specific warning fires when more than 30% of a screen's
shapes fall back to `defaultRadius` (the lowest rung of ADR-2's public-API
radius ladder — meaning autoskeleton could not determine the real corner
radius for most of your rounded views). This is the actionable signal to
add a typed `radius` hint to the affected views, since Android has no
reliable public API to recover an arbitrary view's corner radius (see
`docs/product-brief.md` §9c for the full, measured limitation).

### Shared-shimmer-period warning (all platforms)

ADR-8 gives every skeleton on screen ONE shared clock so they shimmer in
phase. `speedMs` — that clock's period — is a per-`SkeletonTheme` value, so
two `<AutoSkeleton>` trees under two different `SkeletonProvider` themes can
ask for two different periods. Only one can be honoured.

The rule is **the first period to reach a mounted skeleton wins**, identically
on iOS, Android and web. A later request for a different `speedMs` is refused
and a dev-build `console.warn` fires **once per distinct refused value**,
naming the value that was ignored, the value actually in effect, and the two
ways out (use one `speedMs` everywhere, or drop it). Nothing is ever silently
discarded.

Before this rule, all three platforms behaved differently and none of them
said anything: iOS ended up running two periods at once (already-mounted
skeletons keep the animation duration baked in at their own mount, so they
drifted permanently out of phase with newer ones), Android retuned the live
clock and visibly jumped the phase of every skeleton on screen, and on web
`speedMs` reached nothing at all — even a single theme's value was discarded.

### SSR manifest warnings (web)

Two more dev-build warnings cover the SSR replay path, both from
`src/web/ssr/manifest-warning.ts` and both latched once:

- **Schema version** — a `manifest.json` this build cannot replay renders the
  neutral generic block instead, naming both versions.
- **Manifest/CSS drift** — `manifest.json` and `bundle.css` came from
  different capture runs, so skeletons fell back to the neutral block rather
  than replaying geometry the CSS no longer matches. Names both build tokens
  so you can tell which artifact is stale.

See `docs/ssr-capture-cli.md` for the mechanism behind both.

## Typed hints: `<AutoSkeleton.Hint>` — one API, one known asymmetry

`<AutoSkeleton.Hint>` exists on **both** native (`src/native/Hint.tsx`) and
web (`src/web/Hint.tsx`), added 2026-08-28 after `spec.md` NFR-6 was revised
a second time (8 kB → 9 kB) specifically to buy back this API symmetry —
see NFR-6's row for the full rationale.

```tsx
<AutoSkeleton.Hint id="avatar" radius={24}>
  <RoundedAvatar />
</AutoSkeleton.Hint>
```

| Prop | Native | Web |
|---|---|---|
| `id` (required) | ✅ stamps `nativeID`, and `testID` only when the child set none — see "Your `testID` is never overwritten" below | ✅ stamps `data-autoskeleton-id` |
| `radius` | ✅ primary radius mechanism on Android (ADR-2 R0); overrides `layer.cornerRadius` on iOS | ✅ stamps `data-autoskeleton-radius`, the same self-sufficient attribute channel a consumer could already set by hand |
| `lines` | ✅ consulted by both native sensors | ❌ **not a prop on web at all — a real, documented gap, not an oversight** |

### Your `testID` is never overwritten (native)

Wrapping an element in `<AutoSkeleton.Hint>` **keeps whatever `testID` that
element already had.** `testID` is the handle Detox, Maestro, Appium and
argent match on (Android: `R.id.react_test_id` plus the plain view tag; iOS:
`accessibilityIdentifier`), so overwriting it would silently break e2e tests
that already pass — a failure that gets misattributed, because nothing points
back at us.

The conflict is real rather than cosmetic: on iOS the sensor reads
`accessibilityIdentifier`, which is *exactly* what `testID` sets, so our
lookup key and your e2e handle are the same native property. When they
differ, both are kept working:

- your `testID` stays untouched;
- `nativeID` still carries the hint `id` (Android's lookup channel; no e2e
  tool reads `nativeID`);
- the hint values are **also** registered under your `testID`, so the iOS
  sensor still resolves them;
- a dev-build (`__DEV__`) `console.warn` fires **once** per distinct
  conflict, naming both ids and the element.

Silence the warning by keying the hint off the value that is already there:

```tsx
<AutoSkeleton.Hint id="checkout-button" radius={12}>
  <Pressable testID="checkout-button" />
</AutoSkeleton.Hint>
```

**Known gap, not fixed here:** `<AutoSkeleton.Ignore>` still overwrites both
`nativeID` and `testID`, because its channel value is a fixed sentinel both
native sensors compare against literally — there is no alias to register, so
preserving a consumer `testID` would make `Ignore` silently stop working on
iOS. Closing it needs a native-side second marker channel.

**Why web has no `lines` prop.** Web's DOM sensor (`src/web/dom-sensor.ts`)
never calls `hints.linesFor()` anywhere in its traversal. Its one
theoretical consultation point — the `textLeafShapes` `clientrects-empty`
fallback, which only runs when `Range.getClientRects()` returns zero rects
for a text leaf — was live-probed in Playwright (`display:none`,
zero-font-size, zero-width-overflow-hidden constructions) and found
genuinely unreachable under non-degenerate geometry given the module's
current `isTextLeaf` gate: any construction that drives `getClientRects()`
to empty also makes the element's own frame degenerate, so the branch never
fires for real content. Wiring a `lines` prop through to an unreachable
branch would be a silent no-op, not a fix, so it was deliberately left out
of the web `Hint` API rather than shipped as dead code. Making it reachable
would require redesigning `isTextLeaf` itself — real surgery, not a small
wiring change — and is tracked as an open item, not silently dropped.
