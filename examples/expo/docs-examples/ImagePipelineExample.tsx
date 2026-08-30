// examples/expo/docs-examples/ImagePipelineExample.tsx
//
// tasks.md 9.4 — the worked `expo-image` example referenced by
// `docs/image-pipeline.md`. This file is NOT hand-typed prose copy-pasted
// into a Markdown code fence: it lives here, inside `examples/expo`, so it
// typechecks against the REAL published `autoskeleton` types (installed
// from the packed tarball, same as every other example app — see the
// tarball-trap warning in `tasks.md`) and the REAL `expo-image` types. CI
// runs `npx tsc --noEmit -p tsconfig.docs-examples.json` against this exact
// file (see that config and `.github/workflows/docs.yml`) — if this example
// ever drifts from the real `AutoSkeletonProps` shape, the docs job fails
// instead of silently shipping wrong documentation.
//
// ADR-16 (plan.md §6): autoskeleton owns ONLY phase 1 (no data yet — the
// shimmer). It cedes control at the isLoading -> false boundary; phases 2
// (placeholder/blurhash) and 3 (decoded image) belong entirely to
// `expo-image`, which autoskeleton never imports, decodes, or renders.

import { Image } from 'expo-image';
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { AutoSkeleton, SkeletonProvider, type SkeletonMetrics } from 'autoskeleton';

interface Product {
  readonly id: string;
  readonly imageUrl: string;
  readonly blurhash: string;
}

async function fetchProduct(id: string): Promise<Product> {
  // Real network call in a real app; stubbed here so this file compiles and
  // typechecks standalone without a live API.
  return { id, imageUrl: `https://example.com/products/${id}.jpg`, blurhash: 'L6PZfSi_.AyE_3t7t7R**0o#DgR4' };
}

/**
 * The full three-phase pipeline (docs/image-pipeline.md #3), wired for a
 * real product card:
 *
 *   Phase 1 (skeleton)     — `isLoading=true`: autoskeleton renders the
 *                            shimmer shape. No image URL exists yet.
 *   Phase 2 (placeholder)  — `isLoading=false`, `expo-image`'s OWN
 *                            `placeholder`/blurhash transition takes over.
 *                            autoskeleton does not render anything itself
 *                            here; it only keeps its overlay retained
 *                            (reveal-before-hide) until told the successor
 *                            painted, or `handoffTimeoutMs` elapses.
 *   Phase 3 (image)        — the real image is decoded and on screen. Not
 *                            owned by autoskeleton at all.
 */
function ProductCardInner({ productId }: { readonly productId: string }): React.JSX.Element {
  const [product, setProduct] = useState<Product | null>(null);
  const [metrics, setMetrics] = useState<SkeletonMetrics | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchProduct(productId).then((p) => {
      if (!cancelled) setProduct(p);
    });
    return () => {
      cancelled = true;
    };
  }, [productId]);

  return (
    <View style={{ width: 160, height: 160, borderRadius: 12, overflow: 'hidden' }}>
      <AutoSkeleton
        isLoading={product === null}
        skeletonKey={`product-card-${productId}`}
        // Declares that a successor visual (expo-image's placeholder/image)
        // is expected once loading completes — without this, autoskeleton
        // has no reason to retain the overlay past isLoading=false at all.
        expectsPlaceholder
        // CURRENT IMPLEMENTATION STATUS (stated plainly, not glossed over):
        // on web, autoskeleton wires an automatic paint-detection heuristic
        // (double requestAnimationFrame + img.decode()) that calls this
        // internally — no extra work needed there. On NATIVE (this file),
        // that heuristic is NOT yet wired (open follow-up work, tracked
        // separately from this doc). Until it lands, the native handoff
        // always falls through to the `handoffTimeoutMs` timeout path
        // (configured on the surrounding `SkeletonProvider` below) —
        // `onMetrics.handoffReason` will read `'timeout'`, not
        // `'successor-painted'`, even though expo-image's own image loads
        // correctly. This is a real, current limitation of the native
        // pipeline, not a hypothetical one.
        onSuccessorPainted={() => {
          // Reserved for when native paint detection is wired; currently
          // never invoked automatically on this platform. See the status
          // note above.
        }}
        onMetrics={setMetrics}
      >
        {/* The slot is mounted UNCONDITIONALLY, sized, and opaque. That is
            phase 1's whole input: the skeleton is derived from what is
            actually rendered, so the natural spelling —
            `{product !== null && <Image … />}` with nothing else inside — has
            an EMPTY subtree while loading, measures zero shapes, and paints no
            skeleton at all (verified on an Android emulator: `shapeCount: 0`).
            A bare transparent wrapper does not rescue it either: the container
            rule emits a container's own shape only when its subtree has no
            detectable leaf AND it has a non-transparent background, which is
            the only signal that distinguishes a content box from a spacer.
            See `docs/image-pipeline.md` §3a for the full argument; the rule is
            gated on all three sensors by the shared
            `container-rule-sized-but-transparent` fixture. */}
        <View style={{ width: '100%', height: '100%', backgroundColor: '#1f2430' }}>
          {product !== null && (
            <Image
              source={{ uri: product.imageUrl }}
              placeholder={{ blurhash: product.blurhash }}
              placeholderContentFit="cover"
              contentFit="cover"
              style={{ width: '100%', height: '100%' }}
              transition={200}
            />
          )}
        </View>
      </AutoSkeleton>
      {metrics !== null && metrics.handoffReason === 'timeout' && (
        // Exactly the signal docs/image-pipeline.md tells consumers to
        // watch for: a real handoffReason of 'timeout' in the field means
        // "wire onSuccessorPainted" (or, on native today, "wait for the
        // native paint-detection heuristic to ship").
        null
      )}
    </View>
  );
}

/** `handoffTimeoutMs`/`handoffFadeMs` (ADR-16 §3.8) are configured at the
 *  `SkeletonProvider` level, not per `<AutoSkeleton>` instance — every
 *  skeleton under one provider shares the same handoff timing budget. */
export function ProductCard(props: { readonly productId: string }): React.JSX.Element {
  return (
    <SkeletonProvider handoffTimeoutMs={250} handoffFadeMs={120}>
      <ProductCardInner productId={props.productId} />
    </SkeletonProvider>
  );
}
