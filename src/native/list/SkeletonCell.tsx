// src/native/list/SkeletonCell.tsx
//
// Ergonomic component pairing `useSkeletonCell` (task 6.3) with
// `SyntheticRow` and `TemplateMeasurementHost` — for a consumer that just
// wants "the skeleton for one list cell" rendered, without hand-assembling
// the raw hook result. `useSkeletonCell` itself stays exported for
// consumers who need the raw snapshot/cacheHit/cacheKey (e.g. to drive
// custom row layout).

import { useContext } from 'react';
import { View } from 'react-native';
import { effectiveAnimation } from '../../core/animation';
import type { AnimationKind } from '../../core/types';
import { SkeletonContext } from '../AutoSkeleton';
import { useReducedMotion } from '../reducedMotion';
import { SyntheticRow } from './SyntheticRow';
import { TemplateMeasurementHost } from './TemplateMeasurementHost';
import { useSkeletonCell } from './useSkeletonCell';

export interface SkeletonCellProps {
  readonly itemType: string;
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
}

export function SkeletonCell(props: SkeletonCellProps): React.JSX.Element {
  const ctx = useContext(SkeletonContext);
  const platformReducedMotion = useReducedMotion();
  const reducedMotion = props.reducedMotion ?? platformReducedMotion;
  const animation = effectiveAnimation(props.animation ?? 'shimmer', reducedMotion);
  const cell = useSkeletonCell({
    itemType: props.itemType,
    skeletonKey: props.skeletonKey,
    renderTemplate: props.renderTemplate,
  });

  return (
    <View>
      <TemplateMeasurementHost
        node={cell.pendingTemplateNode}
        templateRef={cell.templateRef}
        onLayout={cell.onTemplateLayout}
      />
      <SyntheticRow
        snapshot={cell.snapshot}
        cacheKey={cell.cacheKey}
        animation={animation}
        reducedMotion={reducedMotion}
        // The direction `cell.cacheKey` was composed with, straight from the
        // hook that composed it — never a second `I18nManager` read.
        direction={cell.direction}
        baseColor={ctx.theme.baseColor}
        highlightColor={ctx.theme.highlightColor}
        defaultRadius={ctx.theme.defaultRadius}
        speedMs={ctx.theme.speedMs}
      />
    </View>
  );
}
