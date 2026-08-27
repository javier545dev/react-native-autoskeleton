// src/core/contracts.ts
//
// plan.md §2 module layout: `Sensor`, `Renderer`, `ShapeStore`, `ShimmerClock`.
// `ShapeStore`/`ImportReport` were needed by `MemoryShapeStore` (task 1.3) and
// landed here first; `Sensor`/`Renderer`/`ShimmerClock`/`HintRegistry`/
// `SensorOptions`/`SensorResult` are finalized here in task 1.8 — types only,
// platform layers implement them in Phases 2-5.
//
// Observability / Performance: N/A, pure composition (types carry no runtime
// logic of their own).

import type { CacheKeyParts, ShapeCacheKey } from './cache-key';
import type {
  AnimationKind,
  DegradationFlag,
  Platform,
  RendererKind,
  SerializedShapeSnapshot,
  ShapeSnapshot,
} from './types';

export interface ImportReport {
  readonly accepted: number;
  readonly rejected: number;
  readonly reasons: readonly DegradationFlag[];
}

export interface ShapeStore {
  /** HOT PATH. MUST be synchronous and < 0.2 ms (spec NFR-4). Never async, never a
   *  Promise: an async lookup cannot produce a faithful first frame. */
  get(key: ShapeCacheKey): ShapeSnapshot | undefined;
  has(key: ShapeCacheKey): boolean;
  set(key: ShapeCacheKey, snapshot: ShapeSnapshot): void;
  delete(key: ShapeCacheKey): boolean;
  /** returns the number of entries removed */
  invalidate(predicate: (parts: CacheKeyParts) => boolean): number;
  clear(): void;
  readonly size: number;

  /** Serializable by construction. The capture CLI writes `export()` output; the SSR
   *  client and v2 disk persistence feed `import()`. Both are pure data. */
  export(): readonly SerializedShapeSnapshot[];
  import(entries: readonly SerializedShapeSnapshot[]): ImportReport;

  /** v2 disk persistence hook. Warm-up is async; lookup stays sync. Absent in v1. */
  hydrate?(): Promise<void>;

  /** list helpers and the debug overlay react to late-arriving cold results */
  subscribe(listener: (key: ShapeCacheKey) => void): () => void;
}

// ---------------------------------------------------------------------------
// Sensor (plan.md §3.4)
// ---------------------------------------------------------------------------

export type InvalidationReason =
  | 'resize'
  | 'mutation'
  | 'font-scale'
  | 'direction'
  | 'orientation'
  | 'manual';

export interface HintRegistry {
  /** typed-prop hints only; className is NEVER parsed (spec REQ-THEME-3) */
  linesFor(nodeId: string): number | undefined;
  radiusFor(nodeId: string): number | undefined;
  isIgnored(nodeId: string): boolean;
}

export interface SensorOptions {
  readonly key: ShapeCacheKey;
  readonly hints: HintRegistry;
  /** soft budget; traversal truncates and reports `budget-exceeded` rather than overrunning */
  readonly budgetMs: number;
  readonly maxShapes: number;
  readonly defaultRadius: number;
  /** dev builds only: populate `sources` / `radiusSources` sidecars */
  readonly collectDebugSidecars: boolean;
}

export interface SensorResult {
  readonly snapshot: ShapeSnapshot;
  readonly traversalMs: number;
  readonly degraded: readonly DegradationFlag[];
}

/** `TTarget` is the platform handle: a native view tag (number) on iOS/Android,
 *  an `HTMLElement` on web. Core never inspects it. */
export interface Sensor<TTarget = unknown> {
  readonly platform: Platform;
  /** COLD PATH. Synchronous on both platforms. Returns `null` when the
   *  target is not laid out yet. */
  measure(target: TTarget, options: SensorOptions): SensorResult | null;
  /** Optional refinement pass that may run off the interaction frame
   *  (ADR-2 rung R2, virtualized-list template measurement). */
  refine?(target: TTarget, options: SensorOptions): Promise<SensorResult>;
  /** `ResizeObserver` + `MutationObserver` on web; orientation/fontScale/RTL
   *  listeners on native. Returns an unsubscribe function. */
  observe(target: TTarget, onInvalidate: (reason: InvalidationReason) => void): () => void;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Renderer (plan.md §3.5)
// ---------------------------------------------------------------------------

export interface SkeletonTheme {
  readonly baseColor: string; // --skl-base
  readonly highlightColor: string; // --skl-highlight
  readonly defaultRadius: number;
  readonly speedMs: number;
}

export interface RenderProps {
  readonly snapshot: ShapeSnapshot;
  readonly theme: SkeletonTheme;
  readonly animation: AnimationKind;
  readonly clock: ShimmerClock;
  readonly reducedMotion: boolean;
  readonly debugOverlay: boolean;
}

export interface RendererHandle {
  /** geometry-only update; MUST NOT restart the shimmer phase and MUST NOT
   *  allocate per frame */
  update(next: ShapeSnapshot): void;
  setAnimation(kind: AnimationKind): void;
  destroy(): void;
}

/** `TSurface` is an `HTMLElement` on web and a host-component ref on native. */
export interface Renderer<TSurface = unknown> {
  readonly kind: RendererKind;
  /** false on Android when the degradation ladder cannot resolve radii (ADR-2) */
  readonly supportsRadius: boolean;
  /** tier-2 returns false when Skia/Reanimated peers are absent -> tier-1 is used */
  isAvailable(): boolean;
  mount(surface: TSurface, props: RenderProps): RendererHandle;
}

// ---------------------------------------------------------------------------
// ShimmerClock (plan.md §3.6)
// ---------------------------------------------------------------------------

/** Normalized shimmer phase in [0, 1). */
export type ClockPhase = number;

export interface ShimmerClock {
  readonly id: string;
  readonly driver: 'core-animation' | 'choreographer' | 'reanimated' | 'css';
  readonly periodMs: number;
  /** Absolute origin (epoch ms). Renderers configure a native/CSS animation
   *  with a negative start delay derived from `startedAt`, instead of
   *  receiving per-frame ticks (ADR-8). */
  readonly startedAt: number;

  /** Pure function of time; used by renderers at mount and by tests. */
  phaseAt(timestampMs: number): ClockPhase;
  /** Negative `animation-delay` / CoreAnimation `beginTime` offset for a joiner. */
  phaseOffsetMs(now: number): number;

  /** DEV/DEBUG AND TESTS ONLY. Production animation never ticks through JS
   *  (spec NFR-7). Calling this in production emits a dev warning. */
  subscribe(listener: (phase: ClockPhase, timestampMs: number) => void): () => void;

  setPeriod(ms: number): void;
  pause(): void;
  resume(): void;
}
