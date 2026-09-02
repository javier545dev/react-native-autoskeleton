// src/native/list/SyntheticRow.tsx
//
// Shared row renderer behind `SkeletonList` (task 6.1) and
// `SkeletonListFooter` (task 6.2): a cache hit renders the REAL native
// tier-1 overlay (`AutoskeletonOverlayView`, reading
// `AutoskeletonNativeShapeCache` by `cacheKey` — ADR-9), sized to the
// measured snapshot's own `frameHeight`; a cache miss renders the
// deterministic `FallbackSkeletonBlock` (REQ-LIST-CELL-1's fallback
// contract, reused here for consistency across every list sub-case).

import { StyleSheet, View } from 'react-native';
import { resolveSharedShimmerPeriodMs } from '../../core/shimmer-period';
import type { AnimationKind, Direction, ShapeSnapshot } from '../../core/types';
import { resolveAutoskeletonOverlayNativeComponent } from '../renderer/AutoskeletonOverlayHostComponent';
import { FallbackSkeletonBlock } from './FallbackSkeletonBlock';

export interface SyntheticRowProps {
  readonly snapshot: ShapeSnapshot | null;
  readonly cacheKey: string;
  readonly animation: AnimationKind;
  readonly reducedMotion: boolean;
  readonly baseColor: string;
  readonly highlightColor: string;
  readonly defaultRadius: number;
  readonly speedMs: number;
  /** The writing direction the snapshot was measured for. REQUIRED, not
   *  optional-with-a-default: every caller already holds this value — it is
   *  the one they handed `composeCacheKey` to build `cacheKey` — so passing it
   *  costs nothing, while a default would let a call site silently paint an
   *  RTL snapshot with an LTR sweep and never fail to compile. This row
   *  renderer deliberately does NOT read `I18nManager` itself: two independent
   *  reads can only ever agree by luck, and the value that must agree is the
   *  one already baked into `cacheKey`. */
  readonly direction: Direction;
}

export function SyntheticRow(props: SyntheticRowProps): React.JSX.Element {
  const OverlayComponent = resolveAutoskeletonOverlayNativeComponent();
  // ADR-8 arbitration: this is the single funnel every list sub-case
  // (`SkeletonList` initial load, `SkeletonListFooter` pagination,
  // `SkeletonCell` per-cell) reaches the native overlay through, so it is the
  // one place the shared period has to be resolved for all three. See
  // `core/shimmer-period.ts` for why the FIRST period wins.
  const speedMs = resolveSharedShimmerPeriodMs(props.speedMs);
  if (props.snapshot && OverlayComponent) {
    return (
      <View style={{ height: props.snapshot.frameHeight, width: '100%' }}>
        <OverlayComponent
          cacheKey={props.cacheKey}
          baseColor={props.baseColor}
          highlightColor={props.highlightColor}
          defaultRadius={props.defaultRadius}
          speedMs={speedMs}
          animation={props.animation}
          reducedMotion={props.reducedMotion}
          writingDirection={props.direction}
          debugOverlay={false}
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          style={StyleSheet.absoluteFill}
        />
      </View>
    );
  }
  return <FallbackSkeletonBlock baseColor={props.baseColor} reducedMotion={props.reducedMotion} />;
}
