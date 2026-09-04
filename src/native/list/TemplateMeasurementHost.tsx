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
//
// SECOND real, on-device-found defect, same two style properties (2026-08-30):
// moving the template off-screen fixed the alpha exclusion but left the
// container with a leading position and NO horizontal size constraint. A Yoga
// absolutely-positioned box that declares only `left` resolves its width from
// its own CONTENT — the intrinsic width — so every width-INHERITING child in
// the template (`flex: 1`, `width: '100%'`, `alignSelf: 'stretch'`) collapsed
// to zero, and both native sensors drop a zero-width frame outright. Measured
// while writing `examples/bare-rn/demos/ListDemo.tsx`: a row whose text column
// used `flex: 1` cached a 92.19 x 88 snapshot where the real row is
// 411.43 x 88, and every skeleton row painted as a lone avatar square with
// nothing beside it. Re-measured on an Android emulator 2026-08-30 with the
// paint-gate fixture: 144dp measured against a 379dp container.
//
// The missing width was never the consumer's to supply. This host is mounted
// INSIDE the very `SkeletonList`/`SkeletonCell` whose rows the snapshot will
// be drawn for, so its parent already carries the real content width — the
// list knows its own width even though the template does not. Declaring BOTH
// `left` and `right` is what makes Yoga read it: for an absolute box with no
// explicit `width`, `width = parentContentWidth - left - right`, so
// `left + right === 0` resolves to exactly the parent's content width while
// `left` still carries the box off-screen. Nothing is threaded through
// `renderTemplate`, and a template written the natural way — inheriting its
// width like the real row does — now measures at the width the real row will
// actually have.

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
    // Yoga resolves an absolute box with no explicit `width` but both
    // horizontal insets to `parentContentWidth - left - right`. These two
    // cancel, so the template is laid out at exactly its parent's content
    // width — the real row width — while `left` keeps it off-screen. They
    // must stay exact negatives of each other; see this file's header.
    right: -OFFSCREEN_OFFSET,
    top: OFFSCREEN_OFFSET,
  },
});
