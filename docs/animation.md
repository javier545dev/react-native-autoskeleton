# Animation and reduced motion

> Verified against the tree at commit `f464f11`
> ("fix: make the animation prop mean one thing on all four renderers"),
> 2026-08-30. Before that commit every renderer interpreted the `animation`
> prop differently; if you are reading an older checkout, this page does not
> describe it.

```tsx
<AutoSkeleton isLoading={isLoading} skeletonKey="card" animation="shimmer" />
```

`animation` is `'shimmer' | 'pulse' | 'none'`, defaulting to `'shimmer'`. It is
accepted by `<AutoSkeleton>`, `<SkeletonList>`, `<SkeletonListFooter>` and
`<SkeletonCell>`.

---

## 1. What each value means

The vocabulary is defined once, in `src/core/animation.ts`, and every renderer
implements that definition:

| Value | Base fill | Highlight band | What moves |
|---|---|---|---|
| `shimmer` | opaque | travels across the container once per clock period | position (`transform` only) |
| `pulse` | opaque | **parked at the container's centre** | opacity only, breathing between `0.6` and `1` once per period |
| `none` | opaque | hidden | nothing |

Two properties are load-bearing and easy to get wrong:

- **The base fill never becomes translucent.** Pulsing the whole overlay would
  let the real content bleed through at the trough. Only the highlight's
  opacity breathes.
- **"Do not animate" is not "do not paint."** `none` still covers the content
  with an opaque skeleton. It just does not move.

### Why the pulse parks at the *centre*

Because the natural implementation — leave the sweep's transform wherever it
happened to be — is a bug that already shipped twice. On Android, stopping the
frame loop froze the gradient at an arbitrary phase, so the streak could sit
anywhere; iOS did the same thing more quietly, parking at the left edge because
the gradient hangs a full width to the left. Neither position had been chosen by
anyone. A named resting position is the only version that is reproducible and
identical across platforms.

### What is deliberately *not* part of the contract

The exact easing curve of the breath. CSS says `ease-in-out`, Reanimated's
`withTiming` default is `Easing.inOut(Easing.quad)`, Core Animation is told
`easeInEaseOut`, and Android derives a raised cosine from the shared clock
because it draws every frame itself. Those are four spellings of "smooth in,
smooth out" and they are sub-perceptual against each other.

The **amplitude** (`0.6` → `1`), the **period** (one full breath per
`speedMs`) and the **resting position** are the contract, and those are
identical everywhere.

---

## 2. Reduced motion

```
effectiveAnimation(animation, reducedMotion)
```

**Reduce-motion only ever removes motion:**

| Requested | Preference off | Preference on |
|---|---|---|
| `shimmer` | `shimmer` | **`pulse`** |
| `pulse` | `pulse` | `pulse` |
| `none` | `none` | `none` |

`none` staying `none` is not a detail. Tier-1 previously collapsed all three
values into `reducedMotion || animation === 'none'`, so the one value whose
whole meaning is "do not animate" was the one value guaranteed an animation.

The function is idempotent by construction, so it does not matter whether JS
degrades the value before sending it to a native view or the native view
degrades it itself. Both do, and they cannot disagree.

Kotlin (`AutoskeletonOverlayView.effectiveAnimation`) and Swift
(`AutoskeletonOverlayViewHost.effectiveAnimation`) cannot import the TypeScript
module, so they carry three-line mirrors pinned against the same table by
`AutoskeletonAnimationKindTest.kt` and `AutoskeletonAnimationKindTests.swift`.

### How the preference is read, per platform

| Platform | Source | Live? |
|---|---|---|
| Native (iOS/Android) | `AccessibilityInfo` via `src/native/reducedMotion.ts`, exposed as a `useSyncExternalStore` external store | **Yes.** Seeded once per JS context and subscribed to `reduceMotionChanged`; toggle it in Settings and the skeleton changes without a relaunch. |
| Web (runtime) | `window.matchMedia('(prefers-reduced-motion: reduce)').matches` | **No.** Read when the overlay mounts, not subscribed. Change the setting, then remount. |
| Web (pre-hydration SSR) | a `@media (prefers-reduced-motion: reduce)` block in the generated `bundle.css` | Yes, by the browser — and with zero JavaScript, before hydration. |

The native store is worth one note because both of its previous defects were
silent, and both are fixed: the snapshot used to be seeded by a promise that
notified nobody (so a user who already had the preference on got a shimmer on
the first skeleton after every cold start), and `subscribe` used to hand
React's `onChange` straight to the platform listener, which ignores its
argument (so toggling the setting while the app ran did nothing at all,
permanently). There is now one writer, and notifying is part of writing.

### The list components read it too

`<SkeletonList>`, `<SkeletonListFooter>` and `<SkeletonCell>` each read the
platform preference when their `reducedMotion` prop is omitted. That prop used
to default to `false` outright, so an OS-level reduce-motion user got the full
travelling shimmer in every list skeleton unless the consumer discovered the
prop and wired it by hand.

Pass it explicitly only when you deliberately want motion regardless — a
storybook, a preview:

```tsx
<SkeletonList itemType="row" estimatedCount={6} reducedMotion={false} />
```

---

## 3. Where each renderer implements it

| Renderer | Mechanism |
|---|---|
| Web CSS | `.askl-anim-shimmer` / `-pulse` / `-none` classes on the overlay, one shared stylesheet, one `@keyframes` pair. The pulse targets `.askl-shimmer-layer` (the element that actually carries the highlight gradient), whose `left:-50%; width:200%` box puts the gradient's 50% stop exactly at the overlay's centre with no transform applied. |
| Web SSR bundle | A `@media (prefers-reduced-motion: reduce)` block swapping the sweep for the same `askl-pulse` keyframes and the same `--askl-speed` property. |
| Native tier-1 (iOS) | `CABasicAnimation`. Shimmer translates the gradient layer with `beginTime` derived from the shared clock's absolute origin; pulse parks it at `width / 2` and animates `opacity` with `autoreverses`; `none` sets the gradient's opacity to 0. |
| Native tier-1 (Android) | Draws every frame itself from the shared clock's phase: the highlight's x-offset is `w / 2` under pulse and a swept value under shimmer, and its alpha is a raised cosine between `153` (= 0.6 × 255) and `255`. |
| Tier-2 (Skia + Reanimated) | One `useDerivedValue` driving the union path's gradient; `withRepeat`/`withTiming` for the breath. It now receives the `animation` prop — previously it received only `reducedMotion`, so an explicit `animation="none"` reached it as a full shimmer. |

A zero or negative `speedMs` cannot express any animation, so tier-2 resolves
it to `'none'` rather than dividing by zero.

`speedMs` (the `SkeletonProvider` theme's shimmer period, default `1400`) is
the period for **both** shimmer and pulse. It is arbitrated first-writer-wins
across the whole JS context — see
[`observability.md` §3.3](./observability.md).

---

## 4. Known residual divergence

**The list cache-miss fallback does not follow this contract.**

When a list `itemType` has no measured snapshot yet, `SyntheticRow` renders
`FallbackSkeletonBlock` instead of the real tier-1 overlay — deliberately, since
tier-1 reads geometry from the native shape cache by `cacheKey` and there is
genuinely no entry to read. That block runs its own `Animated` opacity loop and:

- **ignores `animation` entirely** — `animation="none"` still gets a pulsing
  fallback;
- under reduced motion it holds a **static** `0.85` opacity rather than
  pulsing.

Its period (700 ms up, 700 ms down) does match the default `speedMs` of 1400,
but it does not read the theme's `speedMs` either.

This only affects the window before an `itemType` has been measured, and never
affects `<AutoSkeleton>`. Stated here rather than left to be discovered.

**Tier-1 and tier-2 do not share a phase origin**, so mixing renderers on one
screen gives you two groups running at the same speed with a fixed offset
between them. See
[`platform-support.md` §5i](./platform-support.md).

**Per-shape stagger is not implemented** on either tier, despite
`staggerDelayForIndex` being exported from `autoskeleton/skia` and unit-tested.

---

## 5. Seeing it

- `examples/bare-rn` → **Demos › Motion** — a segmented control for all three
  values plus a live readout of the OS preference, read through
  `AccessibilityInfo` and subscribed to, so you can flip it in Settings and
  watch the shimmer degrade without relaunching.
  - iOS simulator: Settings › Accessibility › Motion › Reduce Motion
  - Android emulator: Settings › Accessibility › Remove animations
- `examples/vite` → `#/reduced-motion` — the same contract in a browser.
- `examples/next` — the pre-hydration SSR path, gated by
  `test/web/ssr-reduced-motion.spec.ts`, which asserts the degraded overlay
  really **repaints** across frames (a pulse) rather than merely losing its
  transform (a static block). That distinction is the exact defect the test was
  written to catch.
