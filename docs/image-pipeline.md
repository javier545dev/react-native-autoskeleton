# The image loading pipeline (skeleton → placeholder → image)

`autoskeleton` deliberately owns **only phase 1** of a three-phase image
loading pipeline. This document explains the full pipeline, the exact
boundary autoskeleton stops at, and a worked example wiring `expo-image`.
See `plan.md` ADR-16 and `docs/product-brief.md` §9b for the design
rationale; this file is the consumer-facing version of that decision.

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
   would blow the < 9 kB gzip web budget (NFR-6) on its own.
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
  successor painted, or a timeout elapses, then cross-fades out. There is
  no instant where nothing is painted.
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
shipped for your platform yet.

## 5. Residual limits (not defects — stated as constraints)

- `displayDurationMs` never includes the placeholder/decode tail by design
  (see §2). If you need end-to-end "loading felt like" timing, add
  `handoffMs` yourself: `displayDurationMs + handoffMs ≈ total visible-
  skeleton wall time`.
- `autoskeleton` never inspects, decodes, or caches your image URL. It has
  no opinion on CDN, resizing, or format — that is entirely your image
  component's responsibility.
