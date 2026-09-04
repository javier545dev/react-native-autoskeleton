// src/native/list/SkeletonListFooter.tsx
//
// Task 6.2 (tasks.md Phase 6) — REQ-LIST-PAGE-1: `<SkeletonListFooter
// itemType estimatedCount />`, meant for `ListFooterComponent`, renders
// skeleton rows from the SAME cached `itemType` shapes a list's rows
// already use, WITHOUT re-traversing existing rendered rows. Deliberately
// simpler than `SkeletonList`: this component NEVER schedules a template
// measurement itself (no `renderTemplate` prop at all) — pagination assumes
// the itemType was already seen (real rows are already rendered above the
// footer), so there is nothing here for it to measure even if it wanted to.
// It performs exactly one synchronous cache read, same as every other Phase
// 6 entry point, and nothing else — the dev-only traversal counter
// (`templateTraversalCounter`, `listRuntime.ts`) never increments as a
// result of this component mounting, unmounting, or re-rendering, which is
// the direct proof REQ-LIST-PAGE-1 asks for.

import { useContext } from 'react';
import { I18nManager, PixelRatio, Platform, View, useWindowDimensions } from 'react-native';
import { bucketWidth, composeCacheKey, quantizeFontScale } from '../../core/cache-key';
import { buildSyntheticRowKeys } from '../../core/list';
import { effectiveAnimation } from '../../core/animation';
import type { AnimationKind } from '../../core/types';
import { SkeletonContext } from '../AutoSkeleton';
import { useReducedMotion } from '../reducedMotion';
import { SyntheticRow } from './SyntheticRow';

export interface SkeletonListFooterProps {
  readonly itemType: string;
  readonly estimatedCount: number;
  readonly skeletonKey?: string;
  readonly animation?: AnimationKind;
  /** Overrides the PLATFORM reduce-motion preference, which is read
   *  automatically when this is omitted. It used to default to `false`
   *  outright, so an OS-level reduce-motion user got the full travelling
   *  shimmer in every list skeleton unless the consumer discovered this prop
   *  and wired it by hand — an accessibility defect shipped through a silent
   *  default. Kept as an explicit override (a preview or storybook may want
   *  motion regardless), no longer as the only source. */
  readonly reducedMotion?: boolean;
  readonly rowSpacing?: number;
}

export function SkeletonListFooter(props: SkeletonListFooterProps): React.JSX.Element {
  const ctx = useContext(SkeletonContext);
  const { width: windowWidth } = useWindowDimensions();
  const widthBucket = bucketWidth(windowWidth);
  const direction = I18nManager.isRTL ? 'rtl' : 'ltr';
  const platform: 'ios' | 'android' = Platform.OS === 'android' ? 'android' : 'ios';

  const cacheKey = composeCacheKey({
    skeletonKey: props.skeletonKey ?? props.itemType,
    itemType: props.itemType,
    viewportWidth: widthBucket,
    fontScale: quantizeFontScale(PixelRatio.getFontScale()),
    direction,
    platform,
  });

  // THE ONLY ACTION THIS COMPONENT EVER TAKES: a sync cache read. There is
  // no measurement scheduling anywhere in this file.
  const snapshot = ctx.store.get(cacheKey) ?? null;

  const rowKeys = buildSyntheticRowKeys(props.estimatedCount, props.itemType);
  const platformReducedMotion = useReducedMotion();
  const reducedMotion = props.reducedMotion ?? platformReducedMotion;
  const animation = effectiveAnimation(props.animation ?? 'shimmer', reducedMotion);

  return (
    <View>
      {rowKeys.map((key, index) => (
        <View key={key} style={index > 0 ? { marginTop: props.rowSpacing ?? 12 } : undefined}>
          <SyntheticRow
            snapshot={snapshot}
            cacheKey={cacheKey}
            animation={animation}
            reducedMotion={reducedMotion}
            // The same local `composeCacheKey` above received, so the sweep
            // can never travel against the geometry cached under that key.
            direction={direction}
            baseColor={ctx.theme.baseColor}
            highlightColor={ctx.theme.highlightColor}
            defaultRadius={ctx.theme.defaultRadius}
            speedMs={ctx.theme.speedMs}
          />
        </View>
      ))}
    </View>
  );
}
