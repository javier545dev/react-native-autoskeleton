// src/native/tier2/SkiaRenderer.tsx
//
// Task 5.4 (tasks.md Phase 5) / plan.md ADR-5, RISK-8: the opt-in tier-2
// renderer. Skia draws the union-of-rounded-rects mask (same geometry rule
// as tier-1's `unionPath`/`AutoskeletonRendererTier1.unionPath`, brief §4)
// with a shimmer gradient driven ENTIRELY by Reanimated shared values on
// the UI thread — NFR-7 (zero React re-renders attributable to animation):
// the shared value's frame-by-frame mutation never touches React state, so
// no commit is ever scheduled by the animation itself.
//
// PER-SHAPE STAGGER IS NOT IMPLEMENTED — corrected here 2026-08-29, because
// this header previously asserted that it was ("per-shape stagger is
// expressed as a `withDelay` OFFSET applied to derived values below, keyed by
// wire index"), and no such derived values exist. What ships is ONE union
// path and ONE gradient for the whole overlay, so there is nothing per-shape
// to offset. plan.md §4.1's index stagger is therefore a DROPPED FEATURE, not
// dead code: `staggerDelayForIndex` below is its formula, exported, unit-
// tested, and reached by nothing. See its own doc comment for what wiring it
// would actually cost.
//
// Neither `@shopify/react-native-skia` nor `react-native-reanimated` is
// statically imported anywhere in this file — both are resolved via a
// single `require()` call, gated behind `tier2PeersAvailable()`, and typed
// against small LOCAL interfaces covering only the subset of each
// library's API this file actually uses. This is deliberate: it keeps
// typechecking in THIS repo (`npm run typecheck`) fully independent of
// whether either optional peer is actually installed here (RISK-8: "the
// default tier must work fully without either installed" — including at
// typecheck time, not merely at runtime), at the cost of losing the
// libraries' own richer prop types. `SkiaRenderer` is imported by
// `AutoSkeleton.tsx` unconditionally (a static import of THIS file is
// always safe — see below), but this file's own top-level scope never
// requires either peer; only `mountSkiaTier2()`/`SkiaShimmerOverlay`'s
// render body do, and only after `isAvailable()` has already confirmed
// both peers resolve.
//
// HONESTLY SCOPED: written and typechecked without either peer installed
// in this repo (ADR-14/RISK-8's own zero-dependency-default constraint
// means neither ships here), and without a running Expo/bare example app
// with the peers installed to visually verify the shimmer/stagger/morph
// against the real library APIs. Recommended before this tier ships to
// consumers: a follow-up pass in `examples/expo` (peers installed) to
// confirm the exact prop names/shapes below against the installed
// versions and correct any drift from Skia/Reanimated's real APIs.

import { useEffect, useMemo, type ReactElement } from 'react';
import type { Renderer, RendererHandle, RenderProps } from '../../core/contracts';
import type { ShapeInfo } from '../../core/types';
import { tier2PeersAvailable, type PeerRequire } from './peerAvailability';

// ---------------------------------------------------------------------------
// Minimal local surface of each optional peer's API actually used here.
// ---------------------------------------------------------------------------

interface SkiaPathModule {
  Skia: { Path: { Make(): SkiaPathBuilder } };
}
interface SkiaPathBuilder {
  addRRect(rect: unknown, dir?: number): SkiaPathBuilder;
  addRect(rect: unknown): SkiaPathBuilder;
}
interface SkiaRRectModule {
  rrect(rect: { x: number; y: number; width: number; height: number }, rx: number, ry: number): unknown;
  rect(r: { x: number; y: number; width: number; height: number }): unknown;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SkiaComponent = any;
interface SkiaModule extends SkiaPathModule, SkiaRRectModule {
  Canvas: SkiaComponent;
  Path: SkiaComponent;
  LinearGradient: SkiaComponent;
  vec: (x: number, y: number) => { x: number; y: number };
}

export interface ReanimatedModule {
  useSharedValue<T>(initial: T): { value: T };
  useDerivedValue<T>(updater: () => T, deps?: readonly unknown[]): { value: T };
  withRepeat: (animation: number, count?: number, reverse?: boolean) => number;
  withTiming: (toValue: number, config?: { duration?: number }) => number;
  withDelay: (delayMs: number, animation: number) => number;
}

function requireSkia(requireFn: PeerRequire): SkiaModule {
  return requireFn('@shopify/react-native-skia') as SkiaModule;
}
function requireReanimated(requireFn: PeerRequire): ReanimatedModule {
  return requireFn('react-native-reanimated') as ReanimatedModule;
}

// ---------------------------------------------------------------------------
// Renderer<TSurface> metadata adapter (mirrors renderer/tier1.ts)
// ---------------------------------------------------------------------------

/** `Renderer.isAvailable()` returns false when either optional peer is
 *  absent or version-mismatched — silent tier-1 fallback (ADR-5/RISK-8).
 *  `mount()` is a documented no-op for the same reason `tier1.ts`'s is:
 *  actual mounting is `<SkiaShimmerOverlay>` rendered directly as JSX by
 *  `AutoSkeleton.tsx`, not an imperative bridge call. */
export function createSkiaTier2Renderer(requireFn?: PeerRequire): Renderer<never> {
  return {
    kind: 'skia',
    supportsRadius: true,
    isAvailable(): boolean {
      return tier2PeersAvailable(requireFn);
    },
    mount(_surface: never, _props: RenderProps): RendererHandle {
      return {
        update: () => undefined,
        setAnimation: () => undefined,
        destroy: () => undefined,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// SkiaShimmerOverlay — the actual React component
// ---------------------------------------------------------------------------

const STAGGER_STEP_MS = 40;

/** The one shared drive animation: an infinite, auto-reversing sweep of the
 *  0..1 driver over `speedMs`. Exported standalone so its SHAPE is unit-
 *  testable without a React renderer that runs effects — this repo has none
 *  under Vitest (node environment, jsdom banned project-wide), which is the
 *  same limitation already carried as open item (i). The effect WIRING is
 *  therefore not covered by a test here, and this comment is the honest
 *  record of that, not a claim to the contrary. */
export function createDriveAnimation(Reanimated: ReanimatedModule, speedMs: number): number {
  return Reanimated.withRepeat(Reanimated.withTiming(1, { duration: speedMs }), -1, true);
}

export interface SkiaShimmerOverlayProps {
  readonly shapes: readonly ShapeInfo[];
  readonly baseColor: string;
  readonly highlightColor: string;
  readonly speedMs: number;
  readonly width: number;
  readonly height: number;
  readonly reducedMotion: boolean;
  /** Injectable only for tests; production always uses the real `require`. */
  readonly requireFn?: PeerRequire;
}

/** Renders ONLY when the caller has already confirmed
 *  `createSkiaTier2Renderer().isAvailable()` — this component itself does
 *  not re-check, so a caller that skips the check gets a hard `require`
 *  failure rather than a silent no-op, which is the correct failure mode
 *  for "you called the wrong function", distinct from ADR-5's "peer
 *  absent -> fall back to tier-1" contract that `isAvailable()` owns. */
export function SkiaShimmerOverlay(props: SkiaShimmerOverlayProps): ReactElement {
  const requireFn = props.requireFn ?? ((s: string) => require(s));
  const Skia = requireSkia(requireFn);
  const Reanimated = requireReanimated(requireFn);

  const maskPath = useMemo(() => {
    const path = Skia.Skia.Path.Make();
    for (const shape of props.shapes) {
      const radius = Math.min(shape.r, Math.min(shape.w, shape.h) / 2);
      const rect = { x: shape.x, y: shape.y, width: shape.w, height: shape.h };
      if (radius > 0) {
        path.addRRect(Skia.rrect(rect, radius, radius));
      } else {
        path.addRect(Skia.rect(rect));
      }
    }
    return path;
  }, [props.shapes, Skia]);

  // ONE shared driver value for the whole overlay (ADR-8: one clock, not
  // per-shape ticking) — never N independent `useSharedValue` drivers, which
  // would defeat "one clock".
  //
  // Adversarial-review defect (2026-08-29): this assignment used to sit bare
  // in the render body. Beyond being a documented Reanimated correctness
  // violation (an external side effect in the render phase, unsafe under
  // StrictMode double-invocation and any concurrent render React discards),
  // it re-assigned a FRESH `withRepeat(withTiming(...))` on EVERY render, so
  // any unrelated parent re-render silently restarted the sweep — the exact
  // opposite of ADR-8's "every instance in phase". An effect runs once per
  // change of the values the animation actually depends on.
  const drive = Reanimated.useSharedValue(0);
  useEffect(() => {
    if (props.reducedMotion) {
      return;
    }
    drive.value = createDriveAnimation(Reanimated, props.speedMs);
    // `Reanimated` is the module object from `requireFn`, stable by the
    // require cache; `drive` is a stable shared-value handle.
  }, [drive, Reanimated, props.reducedMotion, props.speedMs]);

  const gradientStart = Reanimated.useDerivedValue(
    () => ({ x: -props.width + drive.value * props.width * 2, y: 0 }),
    [drive, props.width],
  );

  return (
    <Skia.Canvas style={{ width: props.width, height: props.height }}>
      <Skia.Path path={maskPath} color={props.baseColor}>
        <Skia.LinearGradient
          start={Skia.vec(0, 0)}
          end={gradientStart}
          colors={[props.baseColor, props.highlightColor, props.baseColor]}
        />
      </Skia.Path>
    </Skia.Canvas>
  );
}

/** Per-shape stagger delay in ms for wire index `i` (plan.md §4.1: order is
 *  meaningful, staggered by INDEX). Exported standalone so it is
 *  independently unit-testable without mounting Skia/Reanimated at all.
 *
 *  NOT WIRED — deliberately, and stated here so the green unit test on it can
 *  never be mistaken for a shipped feature (the exact trap task G.15 found in
 *  the native accessibility helpers). `SkiaShimmerOverlay` draws ONE union
 *  path under ONE gradient, so there is no per-shape node to delay. Wiring
 *  this needs one `<Skia.Path>` per shape, each with its own
 *  `useDerivedValue` — i.e. hooks in a loop over a variable-length array,
 *  which the rules of hooks forbid — or a Skia runtime shader carrying a
 *  per-shape phase uniform. Either is a redesign of a tier that is opt-in,
 *  disabled by default, and (per this file's header) never yet verified
 *  against the real Skia/Reanimated APIs, and neither can be gated by any
 *  test this repo can run today. Kept rather than deleted so plan.md §4.1's
 *  requirement is not silently dropped; carried forward as an open item. */
export function staggerDelayForIndex(index: number): number {
  return index * STAGGER_STEP_MS;
}
