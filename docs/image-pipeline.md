# The image loading pipeline (skeleton → placeholder → image)

`autoskeleton` deliberately owns **only phase 1** of a three-phase image
loading pipeline. This document explains the full pipeline, the exact
boundary autoskeleton stops at, and a worked example wiring `expo-image`.
See `plan.md` ADR-16 and `docs/product-brief.md` §9b for the design
rationale; this file is the consumer-facing version of that decision.

<p align="center">
  <img
    src="assets/image-handoff.gif"
    alt="A skeleton block held on screen until the image behind it has actually painted, then removed"
    width="720">
</p>

<sub>Reveal-before-hide, recorded from the `examples/vite` `#/image-handoff`
demo. The skeleton is not removed when `isLoading` flips — it is removed once
the successor has painted, which is why no frame shows an empty slot. The
readout prints which of the two guards ended the cycle:
`successor-painted` here, `timeout` if the image never paints.</sub>

## 1. The three phases

| Phase | What's happening | Who owns it |
|---|---|---|
| 1. Skeleton | No data yet — no image URL, no dimensions, nothing to decode. | **`autoskeleton`** |
| 2. Placeholder | The URL and its blurhash/thumbhash have arrived, but the full image has not decoded. | Your image component (`expo-image`, `react-native-fast-image`, a web `<img>` with LQIP) |
| 3. Image | Decode complete; the real image is on screen. | Your image component |

`autoskeleton` cedes control at the **1 → 2 boundary**: the instant your
`isLoading` prop becomes `false`. It never implements, decodes, bundles, or
manages blurhash. Two reasons, stated plainly:

1. A blurhash decoder would duplicate what `expo-image` already ships, and
   would blow the web entry's gzip budget (NFR-6 — currently **7933 B**, the
   single source of truth being `benchmarks/budgets.json`'s
   `webEntryGzipBytes`) on its own.
2. Owning phase 2 would force a hard dependency on one specific image
   component, contradicting the "agnostic to styling and component system"
   design that makes the sensor work at all.

## 2. What "owning only phase 1" costs you, and what autoskeleton pays for it

Ceding control at the 1 → 2 boundary creates one real risk: a **flash** —
an instant where neither the skeleton nor the successor visual is painted.
`autoskeleton` pays for closing that gap itself, not by asking you to:

- **Reveal-before-hide, never hide-then-reveal.** When `isLoading` becomes
  `false`, your content subtree is revealed *underneath* the still
  fully-painted skeleton overlay. The overlay is retained until told the
  successor painted, or a timeout elapses, and is then removed after a
  further `handoffFadeMs`. There is no instant where nothing is painted.
  Note that `handoffFadeMs` is a delay, not a fade — nothing animates
  opacity on teardown, so raising it keeps a fully opaque skeleton on
  screen for longer rather than dissolving it (corrected 2026-08-30).
- **`onMetrics.displayDurationMs` measures phase 1 only** — stamped the
  moment `isLoading` flips `false`, never including the placeholder/decode
  tail. The tail is reported *separately* as `handoffMs` +
  `handoffReason`, so the perceived-performance metric never accidentally
  measures your image component instead of the skeleton.

## 3. Worked example: `expo-image`

The example below is not hand-typed documentation prose — it is a real,
compiling TypeScript file, typechecked in CI against the real published
`autoskeleton` types and the real `expo-image` types (see
`examples/expo/docs-examples/ImagePipelineExample.tsx`, verified by
`npm run typecheck:docs-examples` in `examples/expo`, wired into
`.github/workflows/docs.yml`). If this snippet ever drifted from the real
`AutoSkeletonProps` shape, that job — not a human reviewer — would catch it.

```tsx
import { Image } from 'expo-image';
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { AutoSkeleton, SkeletonProvider, type SkeletonMetrics } from 'autoskeleton';

function ProductCardInner({ productId }: { readonly productId: string }) {
  const [product, setProduct] = useState<Product | null>(null);
  const [metrics, setMetrics] = useState<SkeletonMetrics | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchProduct(productId).then((p) => { if (!cancelled) setProduct(p); });
    return () => { cancelled = true; };
  }, [productId]);

  return (
    <View style={{ width: 160, height: 160, borderRadius: 12, overflow: 'hidden' }}>
      <AutoSkeleton
        isLoading={product === null}
        skeletonKey={`product-card-${productId}`}
        expectsPlaceholder
        onSuccessorPainted={() => { /* see "Current implementation status" below */ }}
        onMetrics={setMetrics}
      >
        {product !== null && (
          <Image
            source={{ uri: product.imageUrl }}
            placeholder={{ blurhash: product.blurhash }}
            contentFit="cover"
            style={{ width: '100%', height: '100%' }}
            transition={200}
          />
        )}
      </AutoSkeleton>
    </View>
  );
}

// handoffTimeoutMs/handoffFadeMs are configured at the SkeletonProvider
// level, not per <AutoSkeleton> instance.
export function ProductCard(props: { readonly productId: string }) {
  return (
    <SkeletonProvider handoffTimeoutMs={250} handoffFadeMs={120}>
      <ProductCardInner productId={props.productId} />
    </SkeletonProvider>
  );
}
```

The full file (with the `fetchProduct` stub and `Product` type) lives at
`examples/expo/docs-examples/ImagePipelineExample.tsx`.

## 3a. Phase 1 needs something to measure — keep the slot mounted

This is the one thing that catches people out, and it is not a bug: **the
skeleton is derived from what is actually rendered.** Write the loading branch
the natural way and there is nothing rendered to derive it from:

```tsx
// No skeleton paints. onMetrics reports shapeCount: 0.
<AutoSkeleton skeletonKey="product-hero" isLoading={product === null} expectsPlaceholder>
  {product !== null && <Image source={{ uri: product.imageUrl }} … />}
</AutoSkeleton>
```

While `product` is null the subtree is empty. There are no leaves, so the
traversal returns nothing, and `<AutoSkeleton>`'s own wrapper is
`position: 'relative'` with no size of its own — so on native the sensor does
not even have a laid-out root to traverse. Measured on an Android emulator:
`shapeCount: 0`, `handoffReason: 'timeout'`.

**A bare wrapper does not rescue it either.** The container rule emits a
container's own shape only when it has no detectable leaves **and** a
non-transparent background. A transparent sized `<View>` contributes nothing,
on all three platforms.

Mount the slot unconditionally and give it a background:

```tsx
<AutoSkeleton skeletonKey="product-hero" isLoading={product === null} expectsPlaceholder>
  <View style={{ width: 180, height: 180, borderRadius: 12, overflow: 'hidden',
                 backgroundColor: '#1f2430' }}>
    {product !== null && <Image source={{ uri: product.imageUrl }} … />}
  </View>
</AutoSkeleton>
```

That slot is the pattern, not a workaround for a defect. Two reasons it has to
work this way:

1. **The sensor sees the loading state, not the loaded one.** It cannot know
   that a currently-empty box will later hold an image. Painting a placeholder
   over an empty box would mean inventing geometry no measurement produced,
   which is the one thing this library exists not to do.
2. **A non-transparent background is the only observable difference between a
   box that is content and a box that is structure.** Transparent sized boxes
   are how every React Native layout expresses spacers, flex fillers,
   safe-area padding and gap shims. If they contributed shapes, a typical
   loading screen would paint grey blocks over its own gutters.

Reserving the space is also better UI on its own terms: the slot stops the
layout jumping when the image arrives, which is the same reason you would size
it in a codebase with no skeletons at all.

Gated as behaviour rather than left to prose — the shared
`container-rule-sized-but-transparent` fixture drives all three sensors
(`SyntheticHierarchyBuilderTests`, `AutoskeletonSensorTest`, and a both-
directions case in `test/web/dom-sensor.spec.ts`).

`examples/expo/demos/ImagePipelineDemo.tsx` runs this on a device, and
`examples/expo/docs-examples/ImagePipelineExample.tsx` is the typechecked version of the
snippet above.

## 4. Current implementation status — read this before wiring `onSuccessorPainted`

This is stated exactly once here, plainly, because it is easy to get wrong:

- **On web**, `autoskeleton` wires an **automatic paint-detection
  heuristic** (double `requestAnimationFrame` after content commit, plus
  `img.decode()`/`load` for any same-origin `<img>` in the wrapped
  subtree). It runs by default whenever `expectsPlaceholder` is set — you
  do not need to call anything yourself. `onSuccessorPainted`, if you also
  supply it, fires *alongside* the heuristic.
- **On native (iOS/Android)**, that heuristic is **not yet wired**. This is
  an open, tracked gap, not a hypothetical one — `grep`-confirmed zero
  call sites feeding `onSuccessorPainted` from any real paint signal on
  native as of this writing. Until it lands, every native handoff with
  `expectsPlaceholder` falls through to the `handoffTimeoutMs` timeout path,
  even when `expo-image`'s own image has already loaded correctly.
  `onMetrics.handoffReason` will read `'timeout'`, not
  `'successor-painted'`.

**What this means in practice today:** on native, wiring
`onSuccessorPainted` has no effect (nothing calls it), and you will see a
skeleton that stays visible for up to `handoffTimeoutMs` (default 250 ms)
after your image has actually loaded — never a blank frame, never wrong
content, just a slightly longer skeleton than strictly necessary. This is
the documented "unwired default" from `plan.md` §3.8: worst case is a
longer skeleton, never a flash.

**The field signal to watch for:** if `onMetrics.handoffReason` reads
`'timeout'` in your telemetry, either your successor visual is genuinely
slow, or (on native, today) the paint-detection heuristic simply hasn't
shipped for your platform yet. On native it will read `'timeout'` for
*every* `expectsPlaceholder` handoff, so it is not a useful signal there
until the heuristic lands — see
[`observability.md` §1.3](./observability.md).

## 5. Residual limits (not defects — stated as constraints)

- `displayDurationMs` never includes the placeholder/decode tail by design
  (see §2). If you need end-to-end "loading felt like" timing, add
  `handoffMs` yourself: `displayDurationMs + handoffMs ≈ total visible-
  skeleton wall time`.
- `autoskeleton` never inspects, decodes, or caches your image URL. It has
  no opinion on CDN, resizing, or format — that is entirely your image
  component's responsibility.
