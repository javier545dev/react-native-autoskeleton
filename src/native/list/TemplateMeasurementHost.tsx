// src/native/list/TemplateMeasurementHost.tsx
//
// Shared invisible-mount wrapper for `useTemplateMeasurement`'s
// `pendingTemplateNode` — factored out of `SkeletonList` (task 6.1) and
// `SkeletonCell` so both render the SAME off-screen-but-laid-out container
// around whichever real template content is currently pending measurement.
//
// REAL, on-device-found defect (Phase 6 apply session): this component's
// FIRST version used `opacity: 0` to hide the template from the user. That
// made the template invisible to the NATIVE SENSOR too —
// `AutoskeletonSensor.kt`'s traversal explicitly skips any view with
// `view.alpha <= 0.01f` (a deliberate, correct production behavior: a
// genuinely-invisible decorative view should never contribute a shape to a
// real skeleton) — so `nativeSensor.measure()` always returned a snapshot
// with ZERO shapes (`data: [VERSION]`, no shape quintuples) for every
// template, no matter how much real content `renderTemplate` supplied.
// Fixed by moving the template far OFF-SCREEN (`left`/`top: -10000`)
// instead of hiding it via opacity — `alpha` stays at its default `1`
// (visible per the sensor's own check), while the user never sees it
// because it renders entirely outside the viewport. `position: 'absolute'`
// keeps it out of the surrounding synthetic rows' layout flow either way.

import type { ComponentRef, ReactNode, RefObject } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';

export interface TemplateMeasurementHostProps {
  readonly node: ReactNode | null;
  readonly templateRef: RefObject<ComponentRef<typeof View> | null>;
  readonly onLayout: (event: LayoutChangeEvent) => void;
}

export function TemplateMeasurementHost(props: TemplateMeasurementHostProps): React.JSX.Element | null {
  if (!props.node) {
    return null;
  }
  return (
    <View
      ref={props.templateRef}
      onLayout={props.onLayout}
      collapsable={false}
      style={styles.invisibleTemplate}
      pointerEvents="none"
    >
      {props.node}
    </View>
  );
}

/** Far enough off-screen that no real device viewport could ever overlap it,
 *  while staying within `Float32`-safe layout coordinate ranges. */
const OFFSCREEN_OFFSET = -10000;

const styles = StyleSheet.create({
  invisibleTemplate: {
    position: 'absolute',
    left: OFFSCREEN_OFFSET,
    top: OFFSCREEN_OFFSET,
  },
});
