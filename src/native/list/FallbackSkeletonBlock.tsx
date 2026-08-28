// src/native/list/FallbackSkeletonBlock.tsx
//
// REQ-LIST-CELL-1's unseen-itemType fallback: a deterministic, generic
// skeleton rendered the INSTANT an itemType has no cache entry — MUST be
// synchronous, MUST NOT go through the real native tier-1 overlay (which
// reads `AutoskeletonNativeShapeCache` by `cacheKey`, and there genuinely is
// no cache entry to read yet for an unseen itemType — ADR-9: native holds
// the DATA, and there IS no data). Deliberately a separate, simpler,
// distinguishable rendering path (plain `Animated.View`s, opacity pulse via
// the native driver so it never depends on the JS thread) — not a
// regression from tier-1, a documented v1 design choice for a shape that,
// by construction, was never measured from anything real.

import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { FALLBACK_CELL_SHAPES } from '../../core/list';

export interface FallbackSkeletonBlockProps {
  readonly baseColor: string;
  readonly reducedMotion?: boolean;
}

/** Genuine external-system synchronization (an imperative `Animated` loop) —
 *  isolated in its own hook per the no-use-effect skill's Rule 4. */
function usePulseOpacity(reducedMotion: boolean): Animated.Value {
  const opacity = useRef(new Animated.Value(reducedMotion ? 0.85 : 0.6)).current;

  useEffect(() => {
    if (reducedMotion) {
      opacity.setValue(0.85);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.6, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion]);

  return opacity;
}

export function FallbackSkeletonBlock(props: FallbackSkeletonBlockProps): React.JSX.Element {
  const opacity = usePulseOpacity(props.reducedMotion ?? false);
  const maxHeight = Math.max(...FALLBACK_CELL_SHAPES.map((s) => s.y + s.h));

  return (
    <Animated.View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[styles.wrapper, { height: maxHeight, opacity }]}
    >
      {FALLBACK_CELL_SHAPES.map((shape, index) => (
        <View
          key={index}
          style={[
            styles.shape,
            {
              left: shape.x,
              top: shape.y,
              width: shape.w,
              height: shape.h,
              borderRadius: shape.r,
              backgroundColor: props.baseColor,
            },
          ]}
        />
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'relative',
    width: '100%',
  },
  shape: {
    position: 'absolute',
  },
});
