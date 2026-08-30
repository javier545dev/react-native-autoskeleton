// src/native/list/SkeletonList.tsx
//
// Task 6.1 (tasks.md Phase 6) — REQ-LIST-EMPTY-1/2: `<SkeletonList itemType
// estimatedCount />` renders N synthetic skeleton rows using cached shapes
// for the declared `itemType`. On the FIRST-EVER render of an itemType (no
// cache entry), one invisible template cell is measured once, deferred via
// `runAfterInteractions` (see `useTemplateMeasurement.ts`) — never blocking
// the interaction frame, never traversing more than once regardless of how
// many rows/lists/cells bind to the same itemType afterward
// (`useSkeletonCell.ts`'s file header documents the shared registry this
// component participates in). While no measurement has landed yet, every
// row renders the deterministic `FallbackSkeletonBlock` (REQ-LIST-CELL-1's
// same fallback contract, reused here for consistency across all three
// list sub-cases) — never a blank frame.
//
// `renderTemplate` (see `useSkeletonCell.ts`'s file header for the shared
// rationale): supplies the real content to measure once. Omitting it is
// valid — rows keep rendering the generic fallback for that itemType until
// SOME other entry point (another `SkeletonList`, `SkeletonListFooter`, or
// `useSkeletonCell` bind) supplies one.

import { useContext } from 'react';
import { I18nManager, PixelRatio, Platform, View, useWindowDimensions } from 'react-native';
import { bucketWidth, composeCacheKey, quantizeFontScale } from '../../core/cache-key';
import { buildSyntheticRowKeys } from '../../core/list';
import { effectiveAnimation } from '../../core/animation';
import type { AnimationKind } from '../../core/types';
import { SkeletonContext } from '../AutoSkeleton';
import { useReducedMotion } from '../reducedMotion';
import { SyntheticRow } from './SyntheticRow';
import { TemplateMeasurementHost } from './TemplateMeasurementHost';
import { templateRegistry } from './listRuntime';
import { useTemplateMeasurement } from './useTemplateMeasurement';

export interface SkeletonListProps {
  readonly itemType: string;
  readonly estimatedCount: number;
  /** Disambiguates multiple lists on the same screen; defaults to
   *  `itemType`, matching the literal spec example
   *  (`<SkeletonList itemType="feedCard" estimatedCount={6} />`, no
   *  `skeletonKey` shown). */
  readonly skeletonKey?: string;
  readonly renderTemplate?: () => React.ReactNode;
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

export function SkeletonList(props: SkeletonListProps): React.JSX.Element {
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

  // THE ONLY SYNCHRONOUS ACTION: a sync cache read, identical to
  // `useSkeletonCell`'s own bind path.
  const snapshot = ctx.store.get(cacheKey) ?? null;
  const cacheHit = snapshot !== null;

  const { pendingTemplateNode, templateRef, onTemplateLayout } = useTemplateMeasurement({
    itemType: props.itemType,
    cacheKey,
    cacheHit,
    renderTemplate: props.renderTemplate,
    registry: templateRegistry,
    store: ctx.store,
    budgetMs: ctx.budgetMs,
    maxShapes: ctx.maxShapes,
    defaultRadius: ctx.theme.defaultRadius,
  });

  const rowKeys = buildSyntheticRowKeys(props.estimatedCount, props.itemType);
  const platformReducedMotion = useReducedMotion();
  const reducedMotion = props.reducedMotion ?? platformReducedMotion;
  const animation = effectiveAnimation(props.animation ?? 'shimmer', reducedMotion);

  return (
    <View>
      <TemplateMeasurementHost node={pendingTemplateNode} templateRef={templateRef} onLayout={onTemplateLayout} />
      {rowKeys.map((key, index) => (
        <View key={key} style={index > 0 ? { marginTop: props.rowSpacing ?? 12 } : undefined}>
          <SyntheticRow
            snapshot={snapshot}
            cacheKey={cacheKey}
            animation={animation}
            reducedMotion={reducedMotion}
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
