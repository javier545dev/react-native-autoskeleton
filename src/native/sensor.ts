// src/native/sensor.ts
//
// Task 5.1 (tasks.md Phase 5): the native `Sensor<TTarget>` implementation
// (plan.md §3.4) backing `getShapes`. Delegates the actual traversal to the
// existing iOS/Android `AutoskeletonSensor.measure()` (tasks 3.1/4.1) via
// the Turbo Module bridge (`wire-bridge.ts`) — this file owns none of the
// traversal logic itself, only the JS-side `Sensor` contract adapter.
//
// `TTarget` deviation, stated explicitly: `contracts.ts`'s own doc comment
// says "TTarget is the platform handle: a native view tag (number) on iOS/
// Android", but a bare reactTag carries no synchronously-readable geometry
// in JS, and `ShapeSnapshot.frameWidth`/`frameHeight` need one. The wire
// layout (plan.md §4.1) deliberately carries ONLY `[VERSION][x,y,w,h,r] x N`
// with no frame-bounds header slot — widening it would diverge web,
// native and the SSR capture CLI from their single shared schema, which is
// exactly what plan.md §1 calls "a hydration bug by construction" if it
// ever happened. React Native's own `onLayout` event already delivers
// `{ width, height }` synchronously at the call site with zero extra
// bridge cost, so `AutoSkeleton.tsx` (task 5.5) supplies them alongside the
// tag. `Sensor<TTarget = unknown>` is fully generic — nothing in the
// contract requires `TTarget` to literally be `number` — so this stays
// within the actual type contract while diverging from its example.

import type { HintEntry } from '../core/hint-registry';
import type { HintRegistry, Sensor, SensorOptions, SensorResult } from '../core/contracts';
import type { ShapeInfo, ShapeSnapshot } from '../core/types';
import type { AutoskeletonHintEntry } from './NativeAutoskeleton';
import type { Spec } from './NativeAutoskeleton';
import { fetchShapesOnce, type WireBridgeTracing } from './wire-bridge';

export interface NativeSensorTarget {
  readonly reactTag: number;
  readonly frameWidth: number;
  readonly frameHeight: number;
  /** Typed-hint channel (radius/lines): the raw, serializable snapshot from
   *  `core/hint-registry.ts`'s `snapshotHintEntries()`, taken by the caller
   *  (`AutoSkeleton.tsx`) at the same moment it reads `reactTag`. Marshaled
   *  verbatim into `config.hints` below — `SensorOptions.hints` (a
   *  `HintRegistry` of live functions) cannot cross the Turbo Module
   *  boundary at all, so this is the ONLY channel that can carry hint DATA
   *  across it. Absent/empty is a legitimate "no hints registered" state,
   *  not an error. */
  readonly hintEntries?: readonly HintEntry[];
}

/** `lines: 0` / `radius: -1` are the "no override" sentinels
 *  `NativeAutoskeleton.ts`'s `AutoskeletonGetShapesConfig.hints` documents —
 *  chosen because codegen'd array-of-object fields are a materially safer,
 *  more-travelled path with required scalar fields than with optional ones
 *  (verified against a real generated `AutoskeletonSpec.h` before this
 *  sentinel convention was chosen). */
function toWireHintEntries(entries: readonly HintEntry[] | undefined): AutoskeletonHintEntry[] {
  if (!entries) {
    return [];
  }
  return entries.map((entry) => ({
    nodeId: entry.nodeId,
    lines: entry.lines ?? 0,
    radius: entry.radius ?? -1,
  }));
}

export function createEmptyHintRegistry(): HintRegistry {
  return {
    linesFor: () => undefined,
    radiusFor: () => undefined,
    isIgnored: () => false,
  };
}

function toShapeInfo(
  shapes: readonly { x: number; y: number; w: number; h: number; r: number }[],
): ShapeInfo[] {
  return shapes.map((s) => ({ x: s.x, y: s.y, w: s.w, h: s.h, r: s.r }));
}

export interface CreateNativeSensorOptions {
  readonly platform: 'ios' | 'android';
  readonly getNativeModule: () => Pick<Spec, 'getShapes' | 'evictShapes'> | null;
  readonly tracing?: WireBridgeTracing;
  readonly now?: () => number;
}

/** Creates the native `Sensor<NativeSensorTarget>`. The native module is
 *  resolved LAZILY on every `measure()` call (never at module-load / import
 *  time — ADR-15: a missing module must never throw at import time), so a
 *  single sensor instance is safe to construct even when the module is
 *  absent (Expo Go) and works again immediately if it becomes available. */
export function createNativeSensor(options: CreateNativeSensorOptions): Sensor<NativeSensorTarget> {
  const now = options.now ?? Date.now;

  return {
    platform: options.platform,

    measure(target, sensorOptions: SensorOptions): SensorResult | null {
      const nativeModule = options.getNativeModule();
      if (!nativeModule) {
        return null;
      }
      // Phase-5-remediation (post-7.2 gap closure): forward the caller's
      // REAL SensorOptions scalars — not compiled defaults — across the
      // bridge. This is the fix for the pre-existing gap where
      // `SkeletonProvider.defaultRadius`/`budgetMs`/`maxShapes` were
      // silently dropped here and every native traversal ran against
      // `AutoskeletonSensorOptions.defaults`/`.defaults` instead.
      const config = {
        defaultRadius: sensorOptions.defaultRadius,
        budgetMs: sensorOptions.budgetMs,
        maxShapes: sensorOptions.maxShapes,
        collectDebugSidecars: sensorOptions.collectDebugSidecars,
        hints: toWireHintEntries(target.hintEntries),
      };
      const fetched = fetchShapesOnce(nativeModule, target.reactTag, sensorOptions.key, config, options.tracing);
      if (!fetched) {
        return null;
      }

      const n = (fetched.data.length - 1) / 5;
      const shapesRaw: { x: number; y: number; w: number; h: number; r: number }[] = [];
      for (let i = 0; i < n; i++) {
        const off = 1 + i * 5;
        shapesRaw.push({
          x: fetched.data[off]!,
          y: fetched.data[off + 1]!,
          w: fetched.data[off + 2]!,
          h: fetched.data[off + 3]!,
          r: fetched.data[off + 4]!,
        });
      }

      const snapshot: ShapeSnapshot = {
        key: sensorOptions.key,
        version: fetched.data[0]!,
        capturedAt: now(),
        frameWidth: target.frameWidth,
        frameHeight: target.frameHeight,
        data: fetched.data,
        degraded: [],
      };

      return {
        snapshot,
        // Native-side traversal timing is reported by the native
        // `os_signpost`/`Trace` intervals (tasks 3.1/4.1); the JS side of
        // the bridge has no independent clock on the traversal itself
        // (only on the bridge call, which `wire-bridge.ts` already traces
        // separately per REQ-OBS-PROFILE-1), so this is not double-counted
        // here — callers read native-reported traversal cost from
        // `onMetrics` assembled with `traversalMs: 0` on the JS side is
        // WRONG; instead `AutoSkeleton.tsx` measures bridge-call wall time
        // directly around this `measure()` call (task 5.5).
        traversalMs: 0,
        degraded: [],
      };
    },

    observe() {
      // Orientation/fontScale/RTL invalidation is already driven by
      // `AutoSkeleton.tsx`'s own `useWindowDimensions`/`I18nManager`
      // subscriptions feeding a fresh `cacheKey` (mirrors the web sensor's
      // documented split: composite-key rotation is a cache-key concern,
      // not a sensor-internal one — ADR-10). This native `Sensor` has no
      // additional native-side invalidation channel to expose to JS beyond
      // that, so `observe()` is a documented no-op returning a stable
      // unsubscribe function, matching the `Sensor` contract's shape.
      return () => undefined;
    },

    dispose() {
      // Stateless adapter; nothing to release.
    },
  };
}

export { toShapeInfo };
