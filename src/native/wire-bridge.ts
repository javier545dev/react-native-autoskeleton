// src/native/wire-bridge.ts
//
// Task 5.1 (tasks.md Phase 5) / plan.md ADR-1 exit criterion: the ONLY place
// in the codebase that converts a `getShapes` boxed `Array<number>` result
// into a `Float32Array` via `Float32Array.from`. Called exactly once per
// cache miss per mount (never per frame, never on virtualized-list cell
// bind — REQ-LIST-CELL-1), which is what makes ADR-1's accepted boxing cost
// affordable. `test/native/wire-bridge.test.ts` asserts this call-count
// discipline against a mocked native module.
//
// Observability: wraps the call with a distinct signpost/trace phase name
// (REQ-OBS-PROFILE-1's "JSI-serialization phase … reported as a separate
// line item", ADR-1's exit criterion) — implemented as a lightweight
// injectable seam mirroring `AutoskeletonTracing`'s pattern on iOS/Android,
// so tests can assert it fired without depending on a real profiler.

import type { AutoskeletonGetShapesConfig, Spec } from './NativeAutoskeleton';

export interface WireBridgeTracing {
  begin(section: string): unknown;
  end(section: string, token: unknown): void;
}

/** Default: no-op in tests/JS; production builds get real signpost/trace
 *  coverage from the NATIVE side of `getShapes` itself (task 5.1's own
 *  DoD: "wraps the boxing call with os_signpost/Trace intervals"). This JS
 *  seam exists so a test can inject a recording double and assert the
 *  bridge call is wrapped at all, without requiring a native profiler. */
const noopTracing: WireBridgeTracing = {
  begin: () => undefined,
  end: () => undefined,
};

export const JSI_SERIALIZATION_TRACE_SECTION = 'AutoskeletonJsiSerialization';

export interface FetchShapesResult {
  readonly data: Float32Array;
}

/** Calls `NativeAutoskeleton.getShapes(reactTag, cacheKey, config)` exactly
 *  once and converts the boxed result into a core-owned `Float32Array`
 *  (plan.md §4.5 rule 2: core never retains a buffer it did not allocate —
 *  the boxed JS array from the bridge is not a buffer at all, so this IS
 *  the copy). Returns `null` when the native module is unavailable
 *  (ADR-15) or the target is not laid out yet (native returns an empty
 *  array).
 *
 *  `config` (Phase-5-remediation, post-7.2 gap closure) is forwarded to the
 *  native call VERBATIM — this is the entire fix for the bridge's own
 *  half of the gap; `sensor.ts` is what builds `config` from the caller's
 *  real `SensorOptions` rather than a compiled default. */
export function fetchShapesOnce(
  nativeModule: Pick<Spec, 'getShapes'>,
  reactTag: number,
  cacheKey: string,
  config: AutoskeletonGetShapesConfig,
  tracing: WireBridgeTracing = noopTracing,
): FetchShapesResult | null {
  const token = tracing.begin(JSI_SERIALIZATION_TRACE_SECTION);
  try {
    const raw = nativeModule.getShapes(reactTag, cacheKey, config);
    if (!raw || raw.length === 0) {
      return null;
    }
    return { data: Float32Array.from(raw) };
  } catch {
    // Adversarial-review finding (2026-08-29): `getShapes` is a SYNCHRONOUS
    // Turbo Module call into platform traversal code and it can throw — a
    // codegen argument-conversion failure, or a native-side exception
    // surfaced across the bridge. Both call sites run this inside a
    // `requestAnimationFrame` / `InteractionManager` callback
    // (`AutoSkeleton.tsx`'s `useColdMeasurement`, `useTemplateMeasurement`'s
    // `attemptMeasure`), which is WORSE than the render-phase throw the
    // report described: no React error boundary sits above a host callback,
    // so the exception reached RN's `ExceptionsManager` as an unhandled JS
    // error — a redbox in dev, a reported fatal in release.
    //
    // `null` is ADR-15's established fail-open posture (children rendered, no
    // skeleton, no crash) expressed in this function's OWN existing
    // vocabulary — the same value it already returns for an unavailable
    // module or an unlaid-out target, and the value both call sites already
    // handle. Deliberately scoped to the bridge call and its conversion,
    // which are the foreign-input hazards; `sensor.ts`'s own
    // `WireMalformedLengthError` congruence assertion is OUR authored
    // invariant and stays loud, outside this boundary.
    return null;
  } finally {
    // Second defect of the same class, found by grepping the class rather
    // than the instance: a throw between `begin` and `end` leaked the
    // signpost/trace interval, so the exact profiling channel
    // REQ-OBS-PROFILE-1 depends on would report a JSI-serialization phase
    // that never closed.
    tracing.end(JSI_SERIALIZATION_TRACE_SECTION, token);
  }
}

/** ADR-9: JS is the sole authority for invalidation — mirrors
 *  `store.invalidate(...)` into a native `evict(keys)` call so the two
 *  caches never diverge. */
export function evictNativeShapes(nativeModule: Pick<Spec, 'evictShapes'>, cacheKeys: readonly string[]): void {
  if (cacheKeys.length === 0) {
    return;
  }
  try {
    nativeModule.evictShapes(Array.from(cacheKeys));
  } catch {
    // Same class as `fetchShapesOnce`'s bridge throw, closed by the same
    // grep. A failed eviction leaves a stale NATIVE entry that JS has already
    // discarded — strictly better than crashing an app to purge a cache, and
    // the same ADR-15 fail-open posture. (This function has no production
    // call site yet; the guard exists so wiring ADR-9's eviction up later
    // cannot reopen the class.)
  }
}
