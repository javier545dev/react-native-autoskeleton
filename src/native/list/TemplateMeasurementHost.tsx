// src/native/list/TemplateMeasurementHost.tsx
//
// Shared invisible-mount wrapper for `useTemplateMeasurement`'s
// `pendingTemplateNode` — factored out of `SkeletonList` (task 6.1) and
// `SkeletonCell` so both render the SAME off-screen-but-laid-out container
// (`opacity: 0`, `position: 'absolute'`, taken out of flow but still
// measured) around whichever real template content is currently pending
// measurement.

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

const styles = StyleSheet.create({
  invisibleTemplate: {
    position: 'absolute',
    opacity: 0,
    left: 0,
    top: 0,
    zIndex: -1,
  },
});
