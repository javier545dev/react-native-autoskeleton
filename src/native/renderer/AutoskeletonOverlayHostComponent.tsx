// src/native/renderer/AutoskeletonOverlayNativeComponent.ts
//
// Task 5.5 (tasks.md Phase 5) / plan.md ADR-5, ADR-9: the JS-side handle for
// the native tier-1 overlay host component ("AutoskeletonOverlayView",
// registered by `AutoskeletonPackage`/`AutoskeletonOverlayViewManager` on
// Android and `AutoskeletonOverlayViewManager` on iOS). This is a LEGACY
// (paper) `requireNativeComponent` view — not a codegen'd Fabric component —
// which the New Architecture's Fabric Interop Layer mounts and updates
// automatically; no additional Fabric ComponentDescriptor/ShadowNode work is
// needed for a simple absolute-positioned draw surface like this one.
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

import { requireNativeComponent, type ViewProps } from 'react-native';

export interface AutoskeletonOverlayNativeProps extends ViewProps {
  readonly cacheKey: string;
  readonly baseColor: string;
  readonly highlightColor: string;
  readonly defaultRadius: number;
  readonly speedMs: number;
  readonly animation: 'shimmer' | 'pulse' | 'none';
  readonly reducedMotion: boolean;
  /** REQ-OBS-OVERLAY-1: delegates to the existing native
   *  `AutoskeletonDebugOverlay` (tasks 3.3/4.5) — outline + index/source/
   *  hit-miss + radius-rung badge per shape, dev-build only. */
  readonly debugOverlay: boolean;
}

const COMPONENT_NAME = 'AutoskeletonOverlayView';

/** `requireNativeComponent` throws synchronously if the native view is not
 *  linked, which is exactly the ADR-15 "throw at first use, not import
 *  time" contract IF this were evaluated eagerly — so it is resolved
 *  LAZILY (only when actually rendered), guarded the same way
 *  `nativeModuleAccessor.ts` guards `NativeAutoskeleton`. */
let cached: ReturnType<typeof requireNativeComponent<AutoskeletonOverlayNativeProps>> | null = null;
let attempted = false;

export function resolveAutoskeletonOverlayNativeComponent():
  | ReturnType<typeof requireNativeComponent<AutoskeletonOverlayNativeProps>>
  | null {
  if (attempted) {
    return cached;
  }
  attempted = true;
  try {
    cached = requireNativeComponent<AutoskeletonOverlayNativeProps>(COMPONENT_NAME);
  } catch {
    cached = null;
  }
  return cached;
}

export { COMPONENT_NAME as AUTOSKELETON_OVERLAY_COMPONENT_NAME };
