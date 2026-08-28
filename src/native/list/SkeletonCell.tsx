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
import type { AnimationKind } from '../../core/types';
import { SkeletonContext } from '../AutoSkeleton';
import { SyntheticRow } from './SyntheticRow';
import { TemplateMeasurementHost } from './TemplateMeasurementHost';
import { useSkeletonCell } from './useSkeletonCell';

export interface SkeletonCellProps {
  readonly itemType: string;
  readonly skeletonKey?: string;
  readonly renderTemplate?: () => React.ReactNode;
  readonly animation?: AnimationKind;
  readonly reducedMotion?: boolean;
}

export function SkeletonCell(props: SkeletonCellProps): React.JSX.Element {
  const ctx = useContext(SkeletonContext);
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
        animation={props.animation ?? 'shimmer'}
        reducedMotion={props.reducedMotion ?? false}
        baseColor={ctx.theme.baseColor}
        highlightColor={ctx.theme.highlightColor}
        defaultRadius={ctx.theme.defaultRadius}
        speedMs={ctx.theme.speedMs}
      />
    </View>
  );
}
