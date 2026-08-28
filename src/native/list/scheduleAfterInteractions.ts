// src/native/list/scheduleAfterInteractions.ts
//
// Real, on-device finding (Phase 6 apply session, `examples/bare-rn`, RN
// 0.87.1): `InteractionManager` has been REMOVED from `react-native` core
// on this RN version — `import { InteractionManager } from 'react-native'`
// throws at render time ("InteractionManager has been removed from
// react-native core. Please refactor long tasks into smaller ones, and use
// 'requestIdleCallback' instead."), even though tasks.md 6.1/6.3 and
// spec.md REQ-LIST-CELL-1's own literal text both specify
// `runAfterInteractions` as the deferral mechanism. This was invisible to
// every Vitest test (RN-runtime-only code, no RN runtime under Vitest's
// node environment) and was only caught by actually running the app on a
// real emulator — exactly the class of defect this phase's native E2E
// requirement exists to catch.
//
// Fix: feature-detect in priority order — `InteractionManager` when
// present (older RN, or a future RN that reintroduces it under a flag),
// then the global `requestIdleCallback` RN's own error message points to,
// then a bare `setTimeout(0)` as the last-resort fallback (never throws,
// never blocks forever). Whichever path is taken, `cancel()` always tears
// down whatever was actually scheduled.

import { InteractionManager } from 'react-native';

export interface ScheduledInteractionHandle {
  cancel(): void;
}

type RequestIdleCallbackFn = (
  callback: (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void,
) => number;

function getGlobalRequestIdleCallback(): RequestIdleCallbackFn | undefined {
  const globalObject = globalThis as unknown as { requestIdleCallback?: RequestIdleCallbackFn };
  return typeof globalObject.requestIdleCallback === 'function' ? globalObject.requestIdleCallback : undefined;
}

function getGlobalCancelIdleCallback(): ((handle: number) => void) | undefined {
  const globalObject = globalThis as unknown as { cancelIdleCallback?: (handle: number) => void };
  return typeof globalObject.cancelIdleCallback === 'function' ? globalObject.cancelIdleCallback : undefined;
}

export function scheduleAfterInteractions(callback: () => void): ScheduledInteractionHandle {
  // The ENTIRE probe — including `typeof InteractionManager`, not just the
  // call — lives inside this one try/catch. On RN 0.87.1, `InteractionManager`
  // is exported via a getter that THROWS on any read (Babel's named-import
  // interop compiles `InteractionManager` to a property access on the
  // `react-native` module object, so even `typeof InteractionManager`
  // triggers that getter and propagates the throw — bare undeclared-
  // identifier `typeof` is exception-safe in JS, but property-access
  // `typeof` is not). A `typeof` guard OUTSIDE a try/catch (this file's own
  // first, broken attempt, caught by the same on-device testing that found
  // the original defect) still crashes before ever reaching the call.
  try {
    if (
      typeof InteractionManager !== 'undefined' &&
      typeof InteractionManager.runAfterInteractions === 'function'
    ) {
      return InteractionManager.runAfterInteractions(callback);
    }
  } catch {
    // Falls through to the next strategy below.
  }

  const requestIdle = getGlobalRequestIdleCallback();
  if (requestIdle) {
    const handle = requestIdle(() => callback());
    const cancelIdle = getGlobalCancelIdleCallback();
    return { cancel: () => cancelIdle?.(handle) };
  }

  const timeoutHandle = setTimeout(callback, 0);
  return { cancel: () => clearTimeout(timeoutHandle) };
}
