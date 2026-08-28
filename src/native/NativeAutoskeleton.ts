// src/native/NativeAutoskeleton.ts
//
// Task 5.1 (tasks.md Phase 5) / plan.md ADR-1: the `getShapes` Turbo Module
// spec, codegen'd by `react-native-codegen` (package.json `codegenConfig`,
// `jsSrcsDir: "src"` scans recursively for `Native*.ts`). Turbo Module
// codegen has no typed-array support, so the wire's `Float32Array` layout
// (plan.md §4) crosses the bridge as a boxed `Array<number>` and is
// converted exactly once, in `wire-bridge.ts`, never here and never per
// frame (ADR-1's exit criterion; REQ-LIST-CELL-1).
//
// `reactTag` completes `contracts.ts`'s own `Sensor<TTarget>` documentation
// ("TTarget is the platform handle: a native view tag (number) on iOS/
// Android") — a Turbo Module method cannot know which laid-out subtree to
// traverse from a cache key alone, so the native `Sensor<number>`
// implementation (`sensor.ts`) resolves the view from this tag and calls
// straight into the existing 3.1/4.1 `AutoskeletonSensor.measure()`.
// `cacheKey` is threaded through so the native call ALSO writes the result
// into `NativeShapeCache` (ADR-9, task 5.2) keyed by the same string the
// renderer's native view reads from — "native writes data only for a
// traversal JS requested".
//
// Phase-5-remediation (post-7.2 gap closure): `config` is the fix for the
// gap task 7.2 found and flagged — `getShapes` used to accept no
// configuration at all, so every native traversal ran against COMPILED
// DEFAULTS (Android: `AutoskeletonSensorOptions.defaults`; iOS: `.defaults`),
// meaning `SkeletonProvider.defaultRadius`/`budgetMs`/`maxShapes` never
// reached native and REQ-OBS-BUDGET-1's "budgets MUST be configurable" was
// structurally unmet there. `config` carries exactly the SCALAR fields of
// `SensorOptions` (`core/contracts.ts`) that both native `SensorOptions`
// structs already declare and a bridge crossing can represent — `hints`
// (a `HintRegistry` of live JS functions) cannot cross a Turbo Module
// boundary and stays out of scope here: verified (see apply-progress) that
// BOTH native bridge paths already hardcode an EMPTY hint registry
// regardless of this change, and no JS-side producer of non-empty per-node
// hints exists anywhere in this codebase yet (`createEmptyHintRegistry()`
// is the only implementation in `native/sensor.ts` and `AutoSkeleton.tsx`
// hardcodes empty hint functions too) — threading real hint DATA end-to-end
// is a distinct, materially larger feature with no existing JS producer,
// not a config-shape omission, and is out of this change's scope.
//
// A per-call parameter (not a separate `setConfig()`) per ADR-1's own
// call-frequency discipline: `getShapes` already runs once per cache miss
// per mount (never per frame, never on list-cell bind —
// `test/native/wire-bridge.test.ts` asserts this), so one extra marshaled
// object costs nothing extra against that budget, while a `setConfig()`
// would add a second, orderable call and a mutable-global-state hazard for
// no benefit at this call frequency.

import { TurboModuleRegistry, type TurboModule } from 'react-native';

export interface AutoskeletonGetShapesConfig {
  /** Mirrors `SensorOptions.defaultRadius` — Android's ADR-2 rung R3
   *  fallback radius used whenever the public-API degradation ladder can't
   *  resolve a rounded view's real corner radius (the common case: RN's
   *  `CompositeBackgroundDrawable` never reports one via `getOutline()`).
   *  Architecturally inert on iOS today (`layer.cornerRadius` always
   *  resolves directly, no fallback rung exists there), forwarded anyway so
   *  the config is honest end-to-end rather than silently platform-gated. */
  readonly defaultRadius: number;
  /** Mirrors `SensorOptions.budgetMs`. */
  readonly budgetMs: number;
  /** Mirrors `SensorOptions.maxShapes`. */
  readonly maxShapes: number;
  /** Mirrors `SensorOptions.collectDebugSidecars`. */
  readonly collectDebugSidecars: boolean;
}

export interface Spec extends TurboModule {
  /**
   * SYNCHRONOUS. Traverses the laid-out native view identified by
   * `reactTag`, encodes the result as the flat wire layout
   * `[VERSION][x,y,w,h,r] x N` (plan.md §4), stores it in the native
   * `NativeShapeCache` under `cacheKey`, and returns it as a boxed
   * `Array<number>`. Runs once per cache miss per mount — NEVER per frame,
   * NEVER on virtualized-list cell bind (REQ-LIST-CELL-1). `config` is
   * threaded into the real native `sensor.measure()` options on both
   * platforms — see the `AutoskeletonGetShapesConfig` doc above.
   */
  getShapes(reactTag: number, cacheKey: string, config: AutoskeletonGetShapesConfig): Array<number>;

  /** ADR-9: JS is the sole authority for eviction/invalidation. Removes the
   * given keys from the native-side `NativeShapeCache` so it can never
   * diverge from the JS `ShapeStore` after a JS-side `invalidate()`. */
  evictShapes(cacheKeys: Array<string>): void;
}

export default TurboModuleRegistry.get<Spec>('Autoskeleton');
