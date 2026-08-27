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

import { TurboModuleRegistry, type TurboModule } from 'react-native';

export interface Spec extends TurboModule {
  /**
   * SYNCHRONOUS. Traverses the laid-out native view identified by
   * `reactTag`, encodes the result as the flat wire layout
   * `[VERSION][x,y,w,h,r] x N` (plan.md §4), stores it in the native
   * `NativeShapeCache` under `cacheKey`, and returns it as a boxed
   * `Array<number>`. Runs once per cache miss per mount — NEVER per frame,
   * NEVER on virtualized-list cell bind (REQ-LIST-CELL-1).
   */
  getShapes(reactTag: number, cacheKey: string): Array<number>;

  /** ADR-9: JS is the sole authority for eviction/invalidation. Removes the
   * given keys from the native-side `NativeShapeCache` so it can never
   * diverge from the JS `ShapeStore` after a JS-side `invalidate()`. */
  evictShapes(cacheKeys: Array<string>): void;
}

export default TurboModuleRegistry.get<Spec>('Autoskeleton');
