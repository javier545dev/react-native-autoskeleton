/**
 * ADR-5/RISK-8 tier-2 opt-in, spelled exactly the way a consumer spells it.
 *
 * The optional peers are imported HERE, in the app's own module graph, so
 * Metro statically resolves and bundles them, and they are handed to the
 * library. The library itself never names either package. If either import
 * is deleted, this file stops compiling — which is the point: tier-2 cannot
 * silently half-exist.
 *
 * Built ONCE at module scope. A component identity that changed per render
 * would remount the whole Skia canvas on every parent render.
 *
 * Lives in its own module (rather than inside `App.tsx`) so BOTH the tier-2
 * paint-gate fixture and the browsable tier-2 demo share one overlay
 * identity. Two `createSkiaOverlay` calls would be two distinct component
 * types, and switching between them would remount the canvas.
 */
import * as Skia from '@shopify/react-native-skia';
import {
  Easing,
  cancelAnimation,
  useDerivedValue,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { createSkiaOverlay } from 'autoskeleton/skia';

export const SKIA_OVERLAY = createSkiaOverlay({
  skia: Skia,
  reanimated: {
    useSharedValue,
    useDerivedValue,
    withRepeat,
    withTiming,
    withSequence,
    withDelay,
    cancelAnimation,
    Easing,
  },
});
