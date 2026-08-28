// src/native/Ignore.tsx
//
// `<AutoSkeleton.Ignore>` — the native half of the Ignore bug fix (see
// `src/web/AutoSkeleton.tsx`'s own `Ignore` for the web half, already
// correct). Extracted into its own small module — mirrors
// `src/native/list/TemplateMeasurementHost.tsx`'s pattern — specifically so
// it stays unit-testable with only a `react` import: `AutoSkeleton.tsx`
// itself pulls in `AccessibilityInfo`/`findNodeHandle`/`I18nManager`/
// `PixelRatio`/`Platform`/`useWindowDimensions` from `react-native`, which
// cannot be imported under this repo's plain Vitest `node` environment
// without a heavy module-boundary mock (`test/native/native-module-
// accessor.test.ts`'s doc comment).
//
// THE BUG this fixes: before this change, `Ignore` was a bare pass-through
// fragment (`return <>{props.children}</>`) — it marked nothing, registered
// nothing, had no effect. A user wrapping content in it got skeleton shapes
// drawn OVER exactly the content they asked to exclude, because neither
// native sensor had any marker to find.
//
// THE DIAGNOSIS (already done, not re-derived here): web already works
// because its sensor has TWO channels (`src/web/dom-sensor.ts`'s
// `isIgnored`): `el.hasAttribute(IGNORE_ATTRIBUTE) || hints.isIgnored(...)`
// — the `data-autoskeleton-ignore` marker is self-sufficient, no registry
// needed. Native only ever had the registry channel
// (`AutoskeletonSensor.kt`/`.swift`'s `ctx.options.hints.isIgnored(id)`),
// and production always passes an empty registry
// (`AutoskeletonEmptyHintRegistry`) — verified in task 5.9's remediation:
// `HintRegistry` cannot cross the Turbo Module boundary at all, so the
// registry channel is currently unreachable in production regardless of
// what `Ignore` does.
//
// THE FIX: give native the same self-sufficient marker channel web already
// has, structurally the same `marker || registry` shape as web's
// `isIgnored()` — see `AUTOSKELETON_IGNORE_MARKER_ID`'s doc comment below
// and `AutoskeletonSensor.kt`/`.swift`'s `traverse()`.
//
// MECHANISM CHOSEN: `React.cloneElement` on the single element child,
// stamping BOTH `nativeID` and `testID` with the marker — not a wrapping
// `View`, which would introduce a flex container and change the consumer's
// layout (the hard constraint: `<AutoSkeleton.Ignore>` must stay
// layout-neutral, exactly like web's `display: contents` wrapper). RN's
// `display: 'contents'` style value exists as a type in this RN version but
// its interaction with a native tree-walking sensor (does Fabric still
// mount a real native view for it? does that view still carry a settable
// `nativeID`?) is unverified and untested — `cloneElement` is deterministic,
// auditable, and needs no such verification.
//
// WHY BOTH `nativeID` AND `testID`, VERIFIED (not assumed) by reading
// `node_modules/react-native`'s actual Fabric source: on Android, the JS
// `nativeID` prop reaches `view.setTag(R.id.view_tag_native_id, ...)`
// (`BaseViewManager.java`), the exact tag `AutoskeletonSensor.kt`'s
// `nativeId()` reads — so `nativeID` alone is correct there. On iOS,
// however, the JS `nativeID` prop reaches a DIFFERENT, unrelated
// `UIView.nativeId` category property (`RCTViewComponentView.mm`: `if
// (oldViewProps.nativeId != newViewProps.nativeId) { self.nativeId = ...
// }`, backed by `UIView+React.h`'s own `nativeID` category — never read by
// `AutoskeletonSensor.swift`); it is the JS `testID` prop that reaches
// `self.accessibilityIdentifier` (`RCTViewComponentView.mm`'s `testId`
// prop-diffing branch), which is what `AutoskeletonSensor.swift` actually
// reads. Setting only `nativeID` would silently no-op on iOS. This is a
// real, previously-undocumented RN prop-to-native-channel asymmetry
// (plan.md's ADR text describes the SENSOR's read side correctly but does
// not name which JS prop reaches each channel) — flagged here for whoever
// eventually builds the general typed-hint channel (radius/lines), which
// will hit the same iOS asymmetry and needs the same two-prop treatment or
// a native-side fix to read `.nativeId` instead of `accessibilityIdentifier`
// on iOS (out of scope for this fix).
//
// API CONSTRAINT this imposes on consumers (documented, not silent):
// `<AutoSkeleton.Ignore>` accepts exactly ONE element child
// (`React.Children.only` — throws in dev otherwise, the same discipline RN
// itself uses for single-child APIs). That child's `nativeID`/`testID`, if
// it set its own, is overwritten by the marker.

import { Children, cloneElement, type ReactElement, type ReactNode } from 'react';

/** Sentinel `nativeID`/`testID` value both native sensors recognize
 *  DIRECTLY, independent of `HintRegistry` — structurally the same
 *  `marker || registry` shape as `src/web/dom-sensor.ts`'s `isIgnored()`.
 *  Mirrored as a hardcoded literal in `AutoskeletonTypes.kt`
 *  (`AUTOSKELETON_IGNORE_MARKER_NATIVE_ID`) and `AutoskeletonTypes.swift`
 *  (`autoskeletonIgnoreMarkerNativeId`) — the same deliberate-duplication
 *  convention this codebase already uses for `SKELETON_BASE_COLOR` in the
 *  on-device paint-gate tests, so a drift between platforms is a loud test
 *  failure, never a silent divergence. */
export const AUTOSKELETON_IGNORE_MARKER_ID = '__autoskeleton-ignore__';

export function Ignore(props: { readonly children: ReactNode }): React.JSX.Element {
  const child = Children.only(props.children) as ReactElement<Record<string, unknown>>;
  return cloneElement(child, {
    nativeID: AUTOSKELETON_IGNORE_MARKER_ID,
    testID: AUTOSKELETON_IGNORE_MARKER_ID,
  });
}
