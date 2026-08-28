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
  const raw = nativeModule.getShapes(reactTag, cacheKey, config);
  tracing.end(JSI_SERIALIZATION_TRACE_SECTION, token);
  if (!raw || raw.length === 0) {
    return null;
  }
  return { data: Float32Array.from(raw) };
}

/** ADR-9: JS is the sole authority for invalidation — mirrors
 *  `store.invalidate(...)` into a native `evict(keys)` call so the two
 *  caches never diverge. */
export function evictNativeShapes(nativeModule: Pick<Spec, 'evictShapes'>, cacheKeys: readonly string[]): void {
  if (cacheKeys.length === 0) {
    return;
  }
  nativeModule.evictShapes(Array.from(cacheKeys));
}
