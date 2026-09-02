// src/index.skia.ts — the `autoskeleton/skia` subpath entry (ADR-5 tier-2).
//
// This is the ONLY place a consumer opts in to the tier-2 Skia renderer, and
// opting in is an explicit act: you import this entry, hand it the two peer
// modules from YOUR OWN module graph, and pass the result to
// `<SkeletonProvider overlay={…}>`.
//
//     import * as Skia from '@shopify/react-native-skia';
//     import Reanimated, { Easing } from 'react-native-reanimated';
//     import { SkeletonProvider } from 'autoskeleton';
//     import { createSkiaOverlay } from 'autoskeleton/skia';
//
//     const overlay = createSkiaOverlay({
//       skia: Skia,
//       reanimated: { ...Reanimated, Easing },
//     });
//
//     <SkeletonProvider overlay={overlay}>…</SkeletonProvider>
//
// WHY THE CONSUMER PASSES THE MODULES IN, rather than this file importing them:
//
//  * **It is the only shape that works under Metro.** Metro builds a STATIC
//    dependency graph. A `require()` with a variable specifier — what this
//    library used to do — is rewritten by Metro's transformer into a function
//    that unconditionally throws `'Dynamic require … not supported by Metro'`,
//    which the old probe's `try/catch` then swallowed into "peer absent". That
//    was proven on a real device this session: an app with both peers
//    installed, pods built and linked, reported `onMetrics.renderer: 'native'`.
//    A STATIC import in the library would work, but it would make both peers
//    hard build-time requirements for every consumer, which ADR-5 forbids.
//    An import in the CONSUMER's file is static for Metro and absent for
//    everyone who never writes it.
//  * **It makes tier-2 genuinely opt-in (RISK-8).** Detecting installed peers
//    turned tier-2 on for anyone who had them — and React Navigation requires
//    Reanimated, so that is the common case. Opt-out-by-uninstall is not opt-in.
//  * **It keeps the default graph peer-free.** Nothing reachable from
//    `index.native.ts` names `@shopify/react-native-skia` or
//    `react-native-reanimated`, which is what `test/packaging/entries.test.ts`
//    and `test/packaging/web-bundle.test.ts` assert, and what keeps this
//    repo's own `tsc` independent of whether either peer is installed here.
//
// The peer types below are this library's own small structural interfaces, so
// the CONSUMER's `tsc` is what checks the real installed packages against
// them. That check is genuine — passing a namespace whose shape has drifted
// fails the consumer's typecheck at the call above — and it happens at the
// only boundary where both the real packages and this library's expectations
// exist at the same time.

import { createElement, type ReactElement } from 'react';
import { SkiaShimmerOverlay, type Tier2Peers } from './native/tier2/SkiaRenderer';
import type { SkeletonOverlayComponent, SkeletonOverlayProps } from './native/overlayContract';

export type { SkiaModule, ReanimatedModule, Tier2Peers } from './native/tier2/SkiaRenderer';
export { staggerDelayForIndex } from './native/tier2/SkiaRenderer';
export { TIER2_SHIMMER_ORIGIN_MS, tier2PhaseAt } from './native/tier2/shimmerOrigin';
export type { SkeletonOverlayComponent, SkeletonOverlayProps } from './native/overlayContract';

/** Builds the tier-2 overlay component to hand to `<SkeletonProvider overlay>`.
 *
 *  Returns a plain component, not a memoized singleton keyed on `peers`: the
 *  consumer is expected to call this ONCE at module scope (as the example app
 *  does), and a component identity that changed per render would remount the
 *  whole Skia canvas on every parent render. */
export function createSkiaOverlay(peers: Tier2Peers): SkeletonOverlayComponent {
  function AutoskeletonSkiaOverlay(props: SkeletonOverlayProps): ReactElement {
    // Every field of `SkeletonOverlayProps` is forwarded, and `animation` is
    // the one that has been dropped here before. It was added to the overlay
    // contract precisely to stop tier-2 drawing a travelling shimmer for
    // `animation="none"` (see `overlayContract.ts`), and commit f464f11 fixed
    // that everywhere except this wrapper — the only place a consumer's
    // overlay is actually constructed. Omitting it does not fail to compile:
    // `SkiaRenderer` reads `props.animation ?? 'shimmer'`, so a dropped prop
    // silently becomes the most animated kind, which is exactly the bug.
    // The tests missed it for the same reason: they render `SkiaShimmerOverlay`
    // directly and pass `animation` by hand, so they exercised a path no
    // consumer takes. `test/native/skia-renderer.test.ts` now also renders
    // THROUGH `createSkiaOverlay`.
    return createElement(SkiaShimmerOverlay, {
      peers,
      shapes: props.shapes,
      baseColor: props.baseColor,
      highlightColor: props.highlightColor,
      speedMs: props.speedMs,
      width: props.width,
      height: props.height,
      animation: props.animation,
      reducedMotion: props.reducedMotion,
      direction: props.direction,
    });
  }
  return AutoskeletonSkiaOverlay;
}
