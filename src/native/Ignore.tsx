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
import { describeChild } from './Hint';

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

/** True when the marker this component stamps has a real chance of never
 *  reaching a native view.
 *
 *  `cloneElement` sets props on the element it is given. A string `type` is a
 *  host component and the props land on the view itself. A `forwardRef` or
 *  `memo` object — which is what React Native's own `View`, `Text` and
 *  `Image` are, checked rather than assumed — is written precisely to pass
 *  props through. A PLAIN function or class component is the case that
 *  swallows them, which is the failure this predicate exists to surface.
 *
 *  DELIBERATELY IMPRECISE, and it matters that this is stated. A function
 *  component that spreads `{...props}` onto a host view forwards correctly and
 *  will still be warned about — a false positive. The alternative considered
 *  was attaching a ref and checking after mount, which is exact; it was
 *  rejected because `cloneElement(child, { ref })` overwrites the consumer's
 *  own ref on React 18, and breaking a working ref in shipped code to power a
 *  development warning is the wrong trade. So the warning says "may not"
 *  rather than "does not", and names the one-line way to be sure. */
export function ignoreMarkerMayNotReachHost(childType: unknown): boolean {
  return typeof childType === 'function';
}

/** Pure formatter, env-free so it is testable on its own — the same
 *  `formatXWarning` split `Hint.tsx` and `core/metrics.ts` already use. */
export function formatIgnoreCompositeChildWarning(childDescription: string): string {
  return (
    `[autoskeleton] <AutoSkeleton.Ignore> wraps ${childDescription}, and the marker it stamps ` +
    'reaches a native view only if that component forwards `nativeID` and `testID` down to one. ' +
    'If it does not, the subtree is measured anyway and the skeleton covers content you asked to ' +
    'exclude — with no error, because cloning always succeeds. If it does forward them, ignore ' +
    'this. To be certain, wrap a host element instead: ' +
    '<AutoSkeleton.Ignore><View><YourComponent /></View></AutoSkeleton.Ignore>.'
  );
}

/** `__DEV__` is the native dev gate this codebase already uses; the `NODE_ENV`
 *  arm is what makes this reachable under the Vitest `node` environment, where
 *  Metro never defines `__DEV__`. Same shape as `Hint.tsx`. */
function devWarningsEnabled(): boolean {
  if (typeof __DEV__ !== 'undefined') {
    return __DEV__;
  }
  return typeof process === 'undefined' || process.env?.['NODE_ENV'] !== 'production';
}

/** Warns once per distinct child description. A component that re-renders
 *  freely would otherwise warn on every render, which is noise a developer
 *  learns to scroll past — the same as no warning. Mirrors `Hint.tsx`'s latch. */
const warnedCompositeChildren = new Set<string>();

export function Ignore(props: { readonly children: ReactNode }): React.JSX.Element {
  const child = Children.only(props.children) as ReactElement<Record<string, unknown>>;
  if (devWarningsEnabled() && ignoreMarkerMayNotReachHost(child.type)) {
    const description = describeChild(child);
    if (!warnedCompositeChildren.has(description)) {
      warnedCompositeChildren.add(description);
      console.warn(formatIgnoreCompositeChildWarning(description));
    }
  }
  return cloneElement(child, {
    nativeID: AUTOSKELETON_IGNORE_MARKER_ID,
    testID: AUTOSKELETON_IGNORE_MARKER_ID,
  });
}
