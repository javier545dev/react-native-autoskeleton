// src/native/nativeModuleAccessor.ts
//
// Task 5.3 (tasks.md Phase 5) / plan.md ADR-15, RISK-10: Expo Go guidance.
// Custom native modules are absent from the prebuilt Expo Go binary, so
// `NativeAutoskeleton` (task 5.1, `TurboModuleRegistry.get`, never
// `getEnforcing`) resolves to `null` there instead of throwing at import
// time — an import-time throw would break Metro's whole module graph, not
// just this component.
//
// - `__DEV__`: first USE throws a named, actionable error naming Expo Go
//   and the development-build fix.
// - production: fails OPEN — callers render `children` unwrapped and emit
//   `onMetrics.degraded: ['native-module-unavailable']` (spec REQ-OBS,
//   plan.md ADR-15/RISK-10's field-visibility signal for an Expo Go
//   install in the field).
//
// This module itself never throws or logs — it is a pure resolver. The
// __DEV__ throw / production fail-open BRANCH is the caller's
// responsibility (`src/native/AutoSkeleton.tsx`), because only the caller
// knows what "first use" means for its own render cycle and can choose to
// render `children` instead of crashing.

import NativeAutoskeleton, { type Spec } from './NativeAutoskeleton';

export const AUTOSKELETON_NATIVE_MODULE_UNAVAILABLE_DOCS_URL =
  'https://github.com/javier545dev/react-native-autoskeleton#expo-go';

/** Thrown in `__DEV__` on first use when the native module is unavailable
 *  (ADR-15). Named and actionable rather than an opaque bridge error. */
export class AutoskeletonNativeModuleUnavailableError extends Error {
  constructor() {
    super(
      "autoskeleton's native module ('Autoskeleton') is not present in this app binary. " +
        'The most likely cause is Expo Go, which cannot load custom native modules. ' +
        'Use a development build instead: npx expo prebuild && npx expo run:ios|run:android ' +
        '(or an EAS development build). ' +
        `See ${AUTOSKELETON_NATIVE_MODULE_UNAVAILABLE_DOCS_URL} for details.`,
    );
    this.name = 'AutoskeletonNativeModuleUnavailableError';
  }
}

/** Never throws. Returns `null` when the Turbo Module is not present in
 *  this binary (Expo Go, or a build that failed autolinking). */
export function resolveNativeModule(): Spec | null {
  return NativeAutoskeleton ?? null;
}

let productionWarningLogged = false;

/** Logs the ADR-15 guidance message exactly once per process in production
 *  (never throws there — production fails open). No-op in `__DEV__`, where
 *  the caller is expected to throw `AutoskeletonNativeModuleUnavailableError`
 *  instead. */
export function logNativeModuleUnavailableOnce(): void {
  if (productionWarningLogged) {
    return;
  }
  productionWarningLogged = true;
  // eslint-disable-next-line no-console
  console.warn(new AutoskeletonNativeModuleUnavailableError().message);
}

/** Test-only reset of the once-per-process production warning latch. */
export function __resetNativeModuleUnavailableWarningForTests(): void {
  productionWarningLogged = false;
}
