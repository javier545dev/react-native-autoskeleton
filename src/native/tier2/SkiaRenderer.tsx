// src/native/tier2/SkiaRenderer.tsx
//
// Task 5.4 (tasks.md Phase 5) / plan.md ADR-5, ADR-8, RISK-8: the opt-in
// tier-2 renderer. Skia draws the union-of-rounded-rects mask (same geometry
// rule as tier-1's `unionPath`/`AutoskeletonRendererTier1.unionPath`, brief
// §4) with a shimmer gradient driven ENTIRELY by Reanimated shared values on
// the UI thread — NFR-7 (zero React re-renders attributable to animation):
// the shared value's frame-by-frame mutation never touches React state, so no
// commit is ever scheduled by the animation itself.
//
// ---------------------------------------------------------------------------
// HOW THE PEERS GET HERE, AND WHY THAT CHANGED (2026-08-29)
// ---------------------------------------------------------------------------
// This file used to resolve `@shopify/react-native-skia` and
// `react-native-reanimated` through a single `require(specifier)` call with a
// VARIABLE specifier, gated behind `tier2PeersAvailable()`. That is unusable
// under Metro and was proven so on a real device this session: Metro's
// transformer rewrites a dynamic `require` into
//
//     function (line) { throw new Error('Dynamic require defined at line ' +
//                       line + '; not supported by Metro'); }(31)
//
// so the probe's own `try/catch` swallowed the throw and
// `tier2PeersAvailable()` returned FALSE unconditionally — including in an app
// with both peers genuinely installed, pods built and linked. Verified on
// iPhone 17 / iOS 26.5 with `@shopify/react-native-skia@2.11.1`,
// `react-native-reanimated@4.6.0` and `react-native-worklets@0.12.1`
// installed: `onMetrics.renderer` reported `native`. Tier-2 was unreachable
// in ANY Metro-bundled app, for every consumer, regardless of what they
// installed.
//
// The peers are therefore INJECTED by the consumer now, through the
// `autoskeleton/skia` subpath entry (`src/index.skia.ts`):
//
//     import * as Skia from '@shopify/react-native-skia';
//     import Reanimated, { Easing } from 'react-native-reanimated';
//     import { createSkiaOverlay } from 'autoskeleton/skia';
//
//     const overlay = createSkiaOverlay({ skia: Skia, reanimated: { ...Reanimated, Easing } });
//     <SkeletonProvider overlay={overlay}>…</SkeletonProvider>
//
// That is a strict improvement on three axes at once:
//  1. It WORKS under Metro — the peers are statically imported by the
//     CONSUMER's own module graph, so Metro resolves and bundles them.
//  2. It is genuinely opt-in (ADR-5, RISK-8: "tier 2 is strictly opt-in").
//     The old probe made tier-2 turn itself on for anyone who happened to
//     have both peers installed — and Reanimated is a hard requirement of
//     React Navigation, so "the consumer installed Reanimated for something
//     else" is the common case, not the exotic one. Opt-out-by-uninstall is
//     not opt-in.
//  3. This repo's own `tsc` and Vitest stay completely independent of whether
//     either peer is installed HERE (RISK-8's typecheck-time constraint):
//     nothing in this file, or anywhere in `index.native.ts`'s transitive
//     graph, names either package. The peer surfaces below are still small
//     LOCAL interfaces covering only what this file uses; the EXAMPLE app's
//     own `tsc` is what checks them against the real installed packages,
//     which is the right boundary for that check.
//
// ---------------------------------------------------------------------------
// PER-SHAPE STAGGER IS STILL NOT IMPLEMENTED
// ---------------------------------------------------------------------------
// What ships is ONE union path and ONE gradient for the whole overlay, so
// there is nothing per-shape to offset. plan.md §4.1's index stagger remains a
// DROPPED FEATURE. See `staggerDelayForIndex` at the bottom of this file.

import { useEffect, useMemo, type ReactElement } from 'react';
import type { ShapeInfo } from '../../core/types';
import { tier2PhaseAt } from './shimmerOrigin';

// ---------------------------------------------------------------------------
// Minimal local surface of each optional peer's API actually used here.
// ---------------------------------------------------------------------------

interface SkiaPathBuilder {
  // Signatures verified against `@shopify/react-native-skia@2.11.1`'s own
  // `SkPath`: `addRRect(rrect: InputRRect, isCCW?: boolean)` and
  // `addRect(rect: InputRect, isCCW?: boolean)`. They are declared exactly
  // this way so the EXAMPLE app's `tsc` — the only place where the real
  // package and these interfaces coexist — fails loudly on drift. It already
  // has: `dir?: number` was wrong here and the example's typecheck said so.
  addRRect(rrect: unknown, isCCW?: boolean): SkiaPathBuilder;
  addRect(rect: unknown, isCCW?: boolean): SkiaPathBuilder;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SkiaComponent = any;

/** The subset of `@shopify/react-native-skia`'s module namespace this file
 *  uses. Structural, so passing the real `import * as Skia` satisfies it. */
export interface SkiaModule {
  readonly Skia: { readonly Path: { Make(): SkiaPathBuilder } };
  rrect(rect: { x: number; y: number; width: number; height: number }, rx: number, ry: number): unknown;
  rect(x: number, y: number, width: number, height: number): unknown;
  vec(x: number, y: number): { x: number; y: number };
  readonly Canvas: SkiaComponent;
  readonly Group: SkiaComponent;
  readonly Path: SkiaComponent;
  readonly LinearGradient: SkiaComponent;
}

export interface SharedValueLike<T> {
  value: T;
}

/** The subset of `react-native-reanimated`'s API this file uses. */
export interface ReanimatedModule {
  useSharedValue<T>(initial: T): SharedValueLike<T>;
  useDerivedValue<T>(updater: () => T, deps?: readonly unknown[]): SharedValueLike<T>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  withRepeat: (animation: any, count?: number, reverse?: boolean) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  withTiming: (toValue: number, config?: { duration?: number; easing?: any }) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  withSequence: (...animations: any[]) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  withDelay: (delayMs: number, animation: any) => any;
  // METHOD syntax, not a property with a function type, on purpose: TypeScript
  // checks method parameters bivariantly, so the real
  // `cancelAnimation<T>(sv: SharedValue<T>)` — whose parameter has strictly
  // MORE members than `SharedValueLike` — remains assignable here. A property
  // declaration would be checked contravariantly under `strictFunctionTypes`
  // and reject it, forcing this library to re-declare Reanimated's whole
  // `SharedValue` interface just to call one function.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cancelAnimation(sharedValue: SharedValueLike<any>): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly Easing: { readonly linear: any };
}

export interface Tier2Peers {
  readonly skia: SkiaModule;
  readonly reanimated: ReanimatedModule;
}

// ---------------------------------------------------------------------------
// The drive animation
// ---------------------------------------------------------------------------

const STAGGER_STEP_MS = 40;

/** Builds the shimmer driver: a LINEAR SAWTOOTH from 0 to 1 with period
 *  `speedMs`, joined at `phase01` so it is already in phase with every other
 *  tier-2 instance in this JS context (ADR-8).
 *
 *  Every clause here is a deliberate correction of a divergence from tier-1
 *  that the previous implementation carried, each independently observable:
 *
 *  1. **Sawtooth, not triangle.** The old code used
 *     `withRepeat(withTiming(1, ...), -1, true)` (the third argument is `reverse`), which is a
 *     TRIANGLE wave. Tier-1 is a sawtooth: `ios/AutoskeletonRendererTier1.swift`
 *     `applyShimmer()` sets `fromValue = -width`, `toValue = width`,
 *     `repeatCount = .infinity` and never sets `autoreverses`. A triangle
 *     sweeps the highlight back the way it came; a sawtooth always sweeps the
 *     same direction. Different animation, not a different phase of the same one.
 *  2. **Period `speedMs`, not `2 × speedMs`.** An auto-reversing repeat takes
 *     two `speedMs` legs to return to its start, so the old tier-2 ran at
 *     exactly half tier-1's rate for the same `theme.speedMs`.
 *  3. **Linear.** `withTiming`'s default easing is `Easing.inOut(Easing.quad)`
 *     (verified in `react-native-reanimated@4.6.0`, `src/animation/timing.ts`:
 *     `easing: Easing.inOut(Easing.quad)` in `defaultConfig`), while a
 *     `CABasicAnimation` with no `timingFunction` paces linearly. The old code
 *     passed no easing, so the two tiers accelerated differently even where
 *     they agreed on direction.
 *
 *  The `withTiming(0, { duration: 0 })` head of the repeated sequence is the
 *  sawtooth's instantaneous flyback. It is needed because `withRepeat`'s
 *  non-reversing branch restarts each repetition from `animation.startValue`
 *  — the value the REPEAT itself started at — and that value is 1 here, since
 *  the repeat is chained after the partial first leg below. Snapping to 0
 *  first makes every repetition a full 0 -> 1 sweep regardless of what the
 *  repeat inherited. A zero-duration `withTiming` completes on its first frame
 *  (`timing.ts`: `if (runtime >= config.duration)` with `runtime` 0 and
 *  `duration` 0), so it costs no visible time.
 *
 *  Exported standalone so its SHAPE is unit-testable without a React renderer
 *  that runs effects — this repo has none under Vitest (node environment,
 *  jsdom banned project-wide). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createDriveAnimation(reanimated: ReanimatedModule, speedMs: number, phase01: number): any {
  const linear = reanimated.Easing.linear;
  const fullCycle = reanimated.withRepeat(
    reanimated.withSequence(
      reanimated.withTiming(0, { duration: 0 }),
      reanimated.withTiming(1, { duration: speedMs, easing: linear }),
    ),
    -1,
    false,
  );
  // Already at the top of a cycle: no partial leg needed, and none must be
  // emitted — a zero-duration leg to 1 would be an instant visible jump.
  if (!(phase01 > 0)) {
    return fullCycle;
  }
  // Finish the cycle already in progress at the shared clock's current phase,
  // then hand over to the aligned repeat. The caller seeds `drive.value` to
  // `phase01` first, so this leg runs from `phase01` to 1 over exactly the
  // time the shared wave has left in its current period.
  return reanimated.withSequence(
    reanimated.withTiming(1, { duration: speedMs * (1 - phase01), easing: linear }),
    fullCycle,
  );
}

// ---------------------------------------------------------------------------
// SkiaShimmerOverlay — the actual React component
// ---------------------------------------------------------------------------

export interface SkiaShimmerOverlayProps {
  readonly peers: Tier2Peers;
  readonly shapes: readonly ShapeInfo[];
  readonly baseColor: string;
  readonly highlightColor: string;
  readonly speedMs: number;
  readonly width: number;
  readonly height: number;
  readonly reducedMotion: boolean;
  /** Test seam: overrides the wall clock used to derive the join phase.
   *  Production never passes it. */
  readonly nowMs?: () => number;
}

/** Draws the union of the measured shapes as one Skia path filled with a
 *  shimmer gradient that mirrors tier-1's exactly:
 *  `[base, highlight, base]` across a band `2 × width` wide whose centre
 *  travels from `-width` to `+width` once per `speedMs`
 *  (`AutoskeletonRendererTier1.gradientFrame(for:)` is
 *  `CGRect(x: -width, y: 0, width: width * 2, height: height)`, translated
 *  over `transform.translation.x` from `-width` to `+width`).
 *
 *  The MASK is stationary and only the gradient travels — the exact invariant
 *  the G.18 tier-1 defect violated, and the one the paired on-device gate
 *  (`testTier2SkeletonCoverageStaysStationaryAcrossAWholeShimmerCycle`)
 *  samples across a whole cycle to prove. */
export function SkiaShimmerOverlay(props: SkiaShimmerOverlayProps): ReactElement {
  const { skia, reanimated } = props.peers;

  const maskPath = useMemo(() => {
    const path = skia.Skia.Path.Make();
    for (const shape of props.shapes) {
      const radius = Math.min(shape.r, Math.min(shape.w, shape.h) / 2);
      if (radius > 0) {
        path.addRRect(skia.rrect({ x: shape.x, y: shape.y, width: shape.w, height: shape.h }, radius, radius));
      } else {
        path.addRect(skia.rect(shape.x, shape.y, shape.w, shape.h));
      }
    }
    return path;
  }, [props.shapes, skia]);

  // ONE shared driver value for the whole overlay (ADR-8: one clock, not
  // per-shape ticking) — never N independent `useSharedValue` drivers, which
  // would defeat "one clock".
  //
  // The assignment lives in an effect, not the render body: beyond being a
  // documented Reanimated correctness violation (an external side effect in
  // the render phase, unsafe under StrictMode double-invocation and any
  // concurrent render React discards), a render-body assignment re-created a
  // FRESH animation on EVERY render, so any unrelated parent re-render
  // silently restarted the sweep — the exact opposite of ADR-8.
  const drive = reanimated.useSharedValue(0);
  const nowMs = props.nowMs;
  useEffect(() => {
    if (props.reducedMotion || !(props.speedMs > 0)) {
      // REQ-A11Y-3: no directional movement at all under reduced motion, and
      // the driver is parked at 0 so the gradient's highlight sits off the
      // left edge and the skeleton reads as a flat, fully covering base fill.
      reanimated.cancelAnimation(drive);
      drive.value = 0;
      return;
    }
    const phase = tier2PhaseAt((nowMs ?? Date.now)(), props.speedMs);
    drive.value = phase;
    drive.value = createDriveAnimation(reanimated, props.speedMs, phase);
    return () => {
      // Without this, switching to reduced motion (or unmounting) left the
      // `withRepeat` running forever — a real, previously-open defect.
      reanimated.cancelAnimation(drive);
    };
  }, [drive, reanimated, props.reducedMotion, props.speedMs, nowMs]);

  const width = props.width;
  const gradientStart = reanimated.useDerivedValue(() => {
    const travel = -width + drive.value * width * 2;
    return { x: travel - width, y: 0 };
  }, [drive, width]);
  const gradientEnd = reanimated.useDerivedValue(() => {
    const travel = -width + drive.value * width * 2;
    return { x: travel + width, y: 0 };
  }, [drive, width]);

  return (
    <skia.Canvas style={{ width: props.width, height: props.height }}>
      <skia.Path path={maskPath} color={props.baseColor}>
        <skia.LinearGradient
          start={gradientStart}
          end={gradientEnd}
          colors={[props.baseColor, props.highlightColor, props.baseColor]}
          positions={[0, 0.5, 1]}
        />
      </skia.Path>
    </skia.Canvas>
  );
}

/** Per-shape stagger delay in ms for wire index `i` (plan.md §4.1: order is
 *  meaningful, staggered by INDEX).
 *
 *  NOT WIRED — deliberately, and stated here so the green unit test on it can
 *  never be mistaken for a shipped feature (the exact trap task G.15 found in
 *  the native accessibility helpers). `SkiaShimmerOverlay` draws ONE union
 *  path under ONE gradient, so there is no per-shape node to delay. Wiring
 *  this needs one `<Skia.Path>` per shape, each with its own
 *  `useDerivedValue` — i.e. hooks in a loop over a variable-length array,
 *  which the rules of hooks forbid — or a Skia runtime shader carrying a
 *  per-shape phase uniform. Either is a redesign, and per-shape stagger is
 *  ALSO a divergence from tier-1, which has no stagger at all: shipping it
 *  would make the two tiers visibly different animations rather than the same
 *  one at two fidelity levels. Kept rather than deleted so plan.md §4.1's
 *  requirement is not silently dropped; carried forward as an open item. */
export function staggerDelayForIndex(index: number): number {
  return index * STAGGER_STEP_MS;
}
