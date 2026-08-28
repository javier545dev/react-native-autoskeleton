// src/native/renderer/AutoskeletonOverlayHostComponent.tsx
//
// Visual-paint-gate remediation (tasks.md Phase 5, task 5.7 follow-up):
// the JS-side handle for the native tier-1 overlay host component
// ("AutoskeletonOverlayView", registered by
// `AutoskeletonPackage`/`AutoskeletonOverlayViewManager` on Android and a
// Fabric-discovered `RCTViewComponentView` subclass on iOS). This now
// resolves the CODEGEN'D Fabric component
// (`../AutoskeletonOverlayNativeComponent.ts`) instead of calling the
// legacy Paper API `requireNativeComponent` directly — the latter is what
// made the paint gate RED: with `codegenConfig.type: "modules"`, no
// ComponentDescriptor/ShadowNode/Props triple was ever generated for this
// view, so `requireNativeComponent` resolved to a component whose Fabric
// view config Fabric itself never received, and nothing ever mounted.
//
// ADR-9 in practice: this component receives `cacheKey` (plus theme/
// animation) as PROPS, never shapes. The native view reads geometry from
// `NativeShapeCache[cacheKey]` — populated by the SAME native `getShapes`
// call `AutoSkeleton.tsx` already made to populate the JS mirror — so
// shapes never round-trip JS -> native a second time at mount. Native
// re-mounts/updates the `AutoskeletonRendererTier1` (tasks 3.2/4.4) handle
// from React's own ordinary prop-diffing lifecycle: first prop set is
// "mount", a changed `cacheKey`/theme prop is "update", unmount is
// "destroy" — no separate imperative mount/update/destroy bridge calls are
// needed.

import type { HostComponent } from 'react-native';
import AutoskeletonOverlayView, {
  type NativeProps as AutoskeletonOverlayNativeProps,
} from '../AutoskeletonOverlayNativeComponent';

export type { AutoskeletonOverlayNativeProps };

const COMPONENT_NAME = 'AutoskeletonOverlayView';

/** The codegen'd component is resolved once at module load (codegen itself
 *  is lazy internally — it never throws synchronously even when the
 *  underlying native view manager is unlinked, e.g. Expo Go). This accessor
 *  keeps the same memoized/never-throwing shape the rest of the codebase
 *  already depends on (`AutoSkeleton.tsx` calls it unconditionally on every
 *  render) so swapping the underlying primitive stays a pure refactor. */
let cached: HostComponent<AutoskeletonOverlayNativeProps> | null = null;
let attempted = false;

export function resolveAutoskeletonOverlayNativeComponent(): HostComponent<AutoskeletonOverlayNativeProps> | null {
  if (attempted) {
    return cached;
  }
  attempted = true;
  try {
    cached = AutoskeletonOverlayView as HostComponent<AutoskeletonOverlayNativeProps>;
  } catch {
    cached = null;
  }
  return cached;
}

export { COMPONENT_NAME as AUTOSKELETON_OVERLAY_COMPONENT_NAME };
