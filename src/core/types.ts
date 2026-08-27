// src/core/types.ts
//
// plan.md §2 module layout: this file owns `ShapeInfo`, `ShapeSnapshot`, wire
// constants, `DegradationFlag`, and the metrics payload shape. It is built up
// incrementally as earlier core tasks need each type (ADR-4: `src/core/` has
// zero platform imports, so every type here is plain data). Task 1.9
// consolidates and adds the `DegradationFlag` drift-guard test — by that point
// every type below already exists; 1.9 adds no new logic.

import type { ShapeCacheKey } from './cache-key';

/** Runtime platform a `Sensor`/`Renderer` instance actually executed on. */
export type Platform = 'ios' | 'android' | 'web';

/** Which renderer tier actually drew a given skeleton instance. */
export type RendererKind = 'native' | 'skia' | 'css';

/** Requested shimmer presentation; degrades to 'pulse'/'none' under reduced motion. */
export type AnimationKind = 'shimmer' | 'pulse' | 'none';

/** Text direction, participates in the composite cache key (RTL mirrors layout). */
export type Direction = 'ltr' | 'rtl';

/** Debug/telemetry classification. NEVER travels on the hot wire (see §4). */
export type ShapeSource =
  | 'text'
  | 'image'
  | 'input'
  | 'background'
  | 'synthetic-line'
  | 'container';

/** Where a shape's corner radius actually came from. Mandatory telemetry (ADR-2). */
export type RadiusSource = 'measured' | 'outline' | 'raster-probe' | 'hint' | 'default';

/** Every silent-degradation mode must be nameable. Task 1.9 asserts this union
 *  enumerates exactly these 8 documented flags (drift guard). */
export type DegradationFlag =
  | 'radius-unavailable' // rounded confirmed, amount unknown -> defaultRadius used
  | 'radius-probe-failed' // raster probe attempted and could not classify
  | 'leaf-class-unmatched' // a subtree produced only background shapes
  | 'budget-exceeded' // traversal exceeded budgetMs and was truncated
  | 'shape-cap-reached' // maxShapes hit, tail discarded
  | 'clientrects-empty' // DOM per-line measurement returned no rects
  | 'snapshot-version-mismatch' // stored snapshot rejected by wire version negotiation
  | 'native-module-unavailable'; // Expo Go: the Turbo Module is not in the binary (ADR-15)

/** One placeholder rectangle in the root/wrapper coordinate space, in CSS px (web)
 *  or density-independent points (native). `r` is a single uniform corner radius;
 *  per-corner radii are out of scope for v1 (brief §13). */
export interface ShapeInfo {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly r: number;
  /** dev builds only; absent in production snapshots */
  readonly source?: ShapeSource;
  readonly radiusSource?: RadiusSource;
}

/** Wire schema version. `float32` represents integers exactly up to 2^24, so
 *  version numbers are lossless forever in practice (plan.md §4.1). */
export const WIRE_VERSION = 1;
/** slot 0 = VERSION */
export const WIRE_HEADER_SLOTS = 1;
/** x, y, w, h, r per shape */
export const WIRE_STRIDE = 5;

/** Runtime form. `data` follows the §4 wire layout and is OWNED by this snapshot
 *  (plan.md §4.5: a snapshot's buffer is created once and never shared/mutated). */
export interface ShapeSnapshot {
  readonly key: ShapeCacheKey;
  /** wire schema version, mirrored from data[0] for cheap checks */
  readonly version: number;
  readonly capturedAt: number;
  /** the wrapper frame the shapes are relative to; needed to scale on near-miss reuse */
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly data: Float32Array;
  /** dev-only sidecars, index-aligned with the shape index (see §4.4) */
  readonly sources?: Uint8Array;
  readonly radiusSources?: Uint8Array;
  readonly degraded: readonly DegradationFlag[];
}

/** JSON-safe. This is what the capture CLI writes, what v2 disk persistence will store,
 *  and what crosses the SSR boundary. No ArrayBuffers, no NaN, no Infinity. */
export interface SerializedShapeSnapshot {
  readonly v: number;
  readonly key: string;
  readonly capturedAt: number;
  readonly frame: readonly [number, number];
  /** identical slot layout to the runtime wire, as plain numbers */
  readonly data: readonly number[];
  readonly sources?: readonly number[];
  readonly radiusSources?: readonly number[];
  readonly degraded?: readonly DegradationFlag[];
}
