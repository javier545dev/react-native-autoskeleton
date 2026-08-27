// src/native/tier2/SkiaRenderer.tsx
//
// Task 5.4 (tasks.md Phase 5) / plan.md ADR-5, RISK-8: the opt-in tier-2
// renderer. Skia draws the union-of-rounded-rects mask (same geometry rule
// as tier-1's `unionPath`/`AutoskeletonRendererTier1.unionPath`, brief §4)
// with a shimmer gradient driven ENTIRELY by Reanimated shared values on
// the UI thread — NFR-7 (zero React re-renders attributable to animation):
// the shared value's frame-by-frame mutation never touches React state, so
// no commit is ever scheduled by the animation itself. Per-shape stagger
// uses `withDelay`, keyed by wire shape INDEX (plan.md §4.1: "order is
// meaningful … the tier-2 Skia renderer staggers `withDelay` by index").
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

import { useMemo, type ReactElement } from 'react';
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

interface ReanimatedModule {
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
  // per-shape ticking); per-shape stagger is expressed as a `withDelay`
  // OFFSET applied to derived values below, keyed by wire index — never as
  // N independent `useSharedValue` drivers, which would defeat "one clock".
  const drive = Reanimated.useSharedValue(0);
  if (!props.reducedMotion) {
    drive.value = Reanimated.withRepeat(Reanimated.withTiming(1, { duration: props.speedMs }), -1, true);
  }

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
 *  independently unit-testable without mounting Skia/Reanimated at all. */
export function staggerDelayForIndex(index: number): number {
  return index * STAGGER_STEP_MS;
}
