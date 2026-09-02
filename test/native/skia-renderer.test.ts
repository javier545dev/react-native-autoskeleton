// test/native/skia-renderer.test.ts
//
// Task 5.4 / ADR-5 / ADR-8 / RISK-8: the parts of `SkiaRenderer.tsx` and
// `shimmerOrigin.ts` testable without mounting React and without either
// optional peer installed in this repo.
//
// SCOPE, STATED HONESTLY UP FRONT. This file proves the SHAPE of the tier-2
// drive animation, the shared-origin phase math, and that nothing is written
// to a shared value during the render phase. It does NOT prove that tier-2
// paints, that the gradient sweeps, or that two instances actually look in
// phase on a screen — this repo has no React renderer under Vitest that runs
// effects (node environment, jsdom banned project-wide) and no Skia. Those
// claims are gated on a real device instead, by
// `examples/bare-rn/ios/AutoskeletonBareRnPaintGateUITests/PaintGateUITests.swift`
// (`testTier2*`) and
// `examples/bare-rn/android/app/src/androidTest/.../Tier2PaintGateInstrumentedTest.kt`.
// A green run of this file alone is NOT evidence that tier-2 works.

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createDriveAnimation,
  SkiaShimmerOverlay,
  staggerDelayForIndex,
  type ReanimatedModule,
  type SkiaModule,
} from '../../src/native/tier2/SkiaRenderer';
import { TIER2_SHIMMER_ORIGIN_MS, tier2PhaseAt } from '../../src/native/tier2/shimmerOrigin';
import { createSkiaOverlay } from '../../src/index.skia';
import type { SkeletonOverlayProps } from '../../src/native/overlayContract';

// ---------------------------------------------------------------------------
// A Reanimated stand-in that RECORDS the animation tree instead of running it.
// ---------------------------------------------------------------------------

type Node = { readonly op: string; readonly args: readonly unknown[] };

function recordingReanimated(): { reanimated: ReanimatedModule; nodes: Node[]; driveWrites: unknown[] } {
  const nodes: Node[] = [];
  const driveWrites: unknown[] = [];
  const node = (op: string, ...args: unknown[]): Node => {
    const n = { op, args };
    nodes.push(n);
    return n;
  };
  const reanimated: ReanimatedModule = {
    useSharedValue<T>(initial: T) {
      let current = initial;
      return {
        get value(): T {
          return current;
        },
        set value(next: T) {
          current = next;
          driveWrites.push(next);
        },
      };
    },
    useDerivedValue<T>(updater: () => T) {
      return { value: updater() };
    },
    withRepeat: (animation: unknown, count?: number, reverse?: boolean) =>
      node('withRepeat', animation, count, reverse),
    withTiming: (toValue: number, config?: { duration?: number; easing?: unknown }) =>
      node('withTiming', toValue, config?.duration, config?.easing),
    withSequence: (...animations: unknown[]) => node('withSequence', ...animations),
    withDelay: (delayMs: number, animation: unknown) => node('withDelay', delayMs, animation),
    cancelAnimation: () => undefined,
    Easing: { linear: 'LINEAR' },
  };
  return { reanimated, nodes, driveWrites };
}

/** Flattens the recorded tree into `op(arg, arg, …)` strings so an assertion
 *  can name the exact structure without object identity noise. */
function describeNode(value: unknown): string {
  if (value !== null && typeof value === 'object' && 'op' in value && 'args' in value) {
    const n = value as Node;
    return `${n.op}(${n.args.map(describeNode).join(', ')})`;
  }
  return String(value);
}

// ---------------------------------------------------------------------------
// The drive animation
// ---------------------------------------------------------------------------

describe('createDriveAnimation — tier-2 must be the SAME wave as tier-1, not a lookalike', () => {
  // `ios/AutoskeletonRendererTier1.swift` `applyShimmer()`:
  //   fromValue = -width; toValue = width; duration = periodMs/1000;
  //   repeatCount = .infinity; (no `autoreverses`, no `timingFunction`)
  // That is a LINEAR SAWTOOTH with period `periodMs`.
  //
  // Before this change tier-2 built
  //   withRepeat(withTiming(1, { duration: speedMs }), -1, true)
  // which is a QUADRATIC-EASED TRIANGLE with period `2 * speedMs`, because
  // `withTiming`'s default easing is `Easing.inOut(Easing.quad)` (verified in
  // react-native-reanimated@4.6.0, `src/animation/timing.ts` `defaultConfig`)
  // and the third argument to `withRepeat` is `reverse`.
  //
  // Three independent divergences, all invisible to a colour-ramp gate that
  // samples one frame: direction, rate and pacing can each be wrong while
  // every sampled pixel stays inside the ramp.

  it('never auto-reverses (tier-1 is a sawtooth; a triangle sweeps back the way it came)', () => {
    const { reanimated, nodes } = recordingReanimated();
    createDriveAnimation(reanimated, 1400, 0);
    const repeats = nodes.filter((n) => n.op === 'withRepeat');
    expect(repeats).toHaveLength(1);
    // args = [animation, count, reverse]
    expect(repeats[0]!.args[2]).toBe(false);
  });

  it('repeats forever', () => {
    const { reanimated, nodes } = recordingReanimated();
    createDriveAnimation(reanimated, 1400, 0);
    expect(nodes.find((n) => n.op === 'withRepeat')!.args[1]).toBe(-1);
  });

  // NOTE: this one PASSES against the pre-fix implementation too — it also
  // passed `{ duration: speedMs }`. The 2 x speedMs period came from the
  // `reverse` flag, which is what the auto-reverse assertion above catches.
  // Kept because it pins the leg duration itself, not because it is the gate
  // for the period defect.
  it('sweeps for exactly speedMs per leg', () => {
    const { reanimated, nodes } = recordingReanimated();
    createDriveAnimation(reanimated, 1400, 0);
    const sweeps = nodes.filter((n) => n.op === 'withTiming' && n.args[0] === 1);
    expect(sweeps).toHaveLength(1);
    expect(sweeps[0]!.args[1]).toBe(1400);
  });

  it('paces linearly, because a CABasicAnimation with no timingFunction does', () => {
    const { reanimated, nodes } = recordingReanimated();
    createDriveAnimation(reanimated, 1400, 0);
    for (const timing of nodes.filter((n) => n.op === 'withTiming' && n.args[1] !== 0)) {
      expect(timing.args[2]).toBe('LINEAR');
    }
  });

  it('at phase 0 is exactly repeat(sequence(snap-to-0, linear sweep to 1))', () => {
    const { reanimated } = recordingReanimated();
    expect(describeNode(createDriveAnimation(reanimated, 1400, 0))).toBe(
      'withRepeat(withSequence(withTiming(0, 0, undefined), withTiming(1, 1400, LINEAR)), -1, false)',
    );
  });

  it('emits no zero-length leading leg at phase 0 (that would be an instant visible jump)', () => {
    const { reanimated, nodes } = recordingReanimated();
    createDriveAnimation(reanimated, 1400, 0);
    const outerSequences = nodes.filter((n) => n.op === 'withSequence');
    expect(outerSequences).toHaveLength(1);
  });

  it('ADR-8: joining mid-cycle finishes only the REMAINDER of the current period first', () => {
    const { reanimated } = recordingReanimated();
    // phase 0.25 -> three quarters of the period left before the wave wraps.
    expect(describeNode(createDriveAnimation(reanimated, 1400, 0.25))).toBe(
      'withSequence(withTiming(1, 1050, LINEAR), ' +
        'withRepeat(withSequence(withTiming(0, 0, undefined), withTiming(1, 1400, LINEAR)), -1, false))',
    );
  });

  it('a later joiner gets a SHORTER first leg — the whole point of a shared origin', () => {
    const early = recordingReanimated();
    createDriveAnimation(early.reanimated, 1400, 0.1);
    const late = recordingReanimated();
    createDriveAnimation(late.reanimated, 1400, 0.9);
    const firstLeg = (r: { nodes: Node[] }): number =>
      r.nodes.find((n) => n.op === 'withTiming' && n.args[0] === 1 && n.args[1] !== 1400)!.args[1] as number;
    expect(firstLeg(early)).toBeGreaterThan(firstLeg(late));
    expect(firstLeg(early) + 1400 * 0.1).toBeCloseTo(1400, 6);
    expect(firstLeg(late) + 1400 * 0.9).toBeCloseTo(1400, 6);
  });
});

// ---------------------------------------------------------------------------
// The shared origin
// ---------------------------------------------------------------------------

describe('tier2PhaseAt — ADR-8 phase from an absolute origin', () => {
  it('is 0 at the origin itself', () => {
    expect(tier2PhaseAt(1000, 1400, 1000)).toBe(0);
  });

  it('wraps at exactly one period', () => {
    expect(tier2PhaseAt(1000 + 1400, 1400, 1000)).toBe(0);
    expect(tier2PhaseAt(1000 + 700, 1400, 1000)).toBe(0.5);
    expect(tier2PhaseAt(1000 + 1400 + 350, 1400, 1000)).toBe(0.25);
  });

  it('stays in [0, 1) for a clock that moved backwards', () => {
    const phase = tier2PhaseAt(500, 1400, 1000);
    expect(phase).toBeGreaterThanOrEqual(0);
    expect(phase).toBeLessThan(1);
  });

  it('degenerates to 0 rather than dividing by zero on a non-positive period', () => {
    expect(tier2PhaseAt(12345, 0, 1000)).toBe(0);
    expect(tier2PhaseAt(12345, -5, 1000)).toBe(0);
  });

  it('two instances joining at DIFFERENT times land on the same wave, not the same phase', () => {
    // This is the ADR-8 invariant in its testable form: phase is a pure
    // function of wall-clock time against ONE origin, so an instance that
    // mounts 900 ms later joins 900 ms further along — it does not restart.
    const first = tier2PhaseAt(5_000, 1400, 1000);
    const second = tier2PhaseAt(5_900, 1400, 1000);
    expect(second).not.toBe(first);
    expect(tier2PhaseAt(5_000 + 1400, 1400, 1000)).toBeCloseTo(first, 10);
  });

  it('the module-scope origin is a real timestamp, fixed for the JS context', () => {
    expect(TIER2_SHIMMER_ORIGIN_MS).toBeGreaterThan(0);
    expect(TIER2_SHIMMER_ORIGIN_MS).toBe(TIER2_SHIMMER_ORIGIN_MS);
  });
});

// ---------------------------------------------------------------------------
// Render-phase purity (retained from the 2026-08-29 adversarial-review fix)
// ---------------------------------------------------------------------------

// Observed with `react-dom/server`, which really does invoke the component
// function and really does run `useMemo` — but never runs effects. That is
// precisely the isolation this needs: any write recorded here happened in the
// RENDER PHASE, because nothing else has run yet.
describe('SkiaShimmerOverlay — the shimmer driver is not started from the render body', () => {
  function stubSkia(): SkiaModule {
    const passthrough = (props: { children?: unknown }): unknown => props.children ?? null;
    return {
      Skia: {
        Path: {
          Make: () => ({
            addRRect() {
              return this;
            },
            addRect() {
              return this;
            },
          }),
        },
      },
      rrect: () => ({}),
      rect: () => ({}),
      vec: (x: number, y: number) => ({ x, y }),
      Canvas: passthrough,
      Group: passthrough,
      Path: passthrough,
      LinearGradient: () => null,
    };
  }

  const baseProps = {
    shapes: [
      { x: 0, y: 0, w: 100, h: 20, r: 4 },
      { x: 0, y: 30, w: 60, h: 60, r: 0 },
    ],
    baseColor: '#eee',
    highlightColor: '#fff',
    speedMs: 1400,
    width: 300,
    height: 200,
    reducedMotion: false,
  };

  it('performs no shared-value write while rendering', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { reanimated, driveWrites } = recordingReanimated();
    renderToStaticMarkup(
      createElement(SkiaShimmerOverlay, { ...baseProps, peers: { skia: stubSkia(), reanimated } }),
    );
    expect(driveWrites).toEqual([]);
  });

  it('performs no shared-value write while rendering under reduced motion either', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { reanimated, driveWrites } = recordingReanimated();
    renderToStaticMarkup(
      createElement(SkiaShimmerOverlay, {
        ...baseProps,
        reducedMotion: true,
        peers: { skia: stubSkia(), reanimated },
      }),
    );
    expect(driveWrites).toEqual([]);
  });

  it('re-rendering never accumulates animation assignments (the phase-reset half of the defect)', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { reanimated, driveWrites } = recordingReanimated();
    for (let render = 0; render < 5; render++) {
      renderToStaticMarkup(
        createElement(SkiaShimmerOverlay, { ...baseProps, peers: { skia: stubSkia(), reanimated } }),
      );
    }
    expect(driveWrites).toEqual([]);
  });

  it('builds the gradient band tier-1 builds: 2 x width wide, centred on the travel point', async () => {
    // `AutoskeletonRendererTier1.gradientFrame(for:)` is
    // `CGRect(x: -width, y: 0, width: width * 2, height: height)`, translated
    // over `transform.translation.x` from `-width` to `+width`. The Skia
    // equivalent is a linear gradient whose endpoints straddle the travel
    // point by exactly `width` in each direction.
    //
    // This reads the DERIVED VALUES rather than the rendered output, because
    // the stub's `useDerivedValue` evaluates its updater eagerly and there is
    // no Skia to rasterize. It therefore proves the geometry FORMULA, not that
    // Skia paints it — the on-device gate owns that claim.
    const { reanimated } = recordingReanimated();
    const derived: Array<{ x: number; y: number }> = [];
    const recording: ReanimatedModule = {
      ...reanimated,
      useSharedValue: <T,>(initial: T) => ({ value: initial }),
      useDerivedValue: <T,>(updater: () => T) => {
        const v = updater();
        derived.push(v as unknown as { x: number; y: number });
        return { value: v };
      },
    };
    // `drive` starts at 0, so `travel = -width`.
    const width = 300;
    // Rendering is what invokes the derived-value updaters.
    const { renderToStaticMarkup } = await import('react-dom/server');
    renderToStaticMarkup(
      createElement(SkiaShimmerOverlay, { ...baseProps, width, peers: { skia: stubSkia(), reanimated: recording } }),
    );
    expect(derived).toHaveLength(2);
    expect(derived[0]).toEqual({ x: -width - width, y: 0 });
    expect(derived[1]).toEqual({ x: -width + width, y: 0 });
  });
});

// ---------------------------------------------------------------------------
// The `animation` prop reaching tier-2 at all
// ---------------------------------------------------------------------------

// `SkeletonOverlayProps` carried no `animation` field and `native/
// AutoSkeleton.tsx` passed none, so an explicit `animation="none"` — the value
// whose entire meaning is "do not animate" — reached tier-2 as a full
// travelling shimmer, and so did `animation="pulse"`. Only `reducedMotion`
// crossed the boundary, which is a different question with a different answer.
describe('SkiaShimmerOverlay honours the `animation` prop, not only `reducedMotion`', () => {
  function recordingSkia(): { skia: SkiaModule; paths: Array<Record<string, unknown>> } {
    const paths: Array<Record<string, unknown>> = [];
    const passthrough = (props: { children?: unknown }): unknown => props.children ?? null;
    return {
      paths,
      skia: {
        Skia: {
          Path: {
            Make: () => ({
              addRRect() {
                return this;
              },
              addRect() {
                return this;
              },
            }),
          },
        },
        rrect: () => ({}),
        rect: () => ({}),
        vec: (x: number, y: number) => ({ x, y }),
        Canvas: passthrough,
        Group: passthrough,
        Path: (props: Record<string, unknown>) => {
          paths.push(props);
          return (props['children'] as unknown) ?? null;
        },
        LinearGradient: () => null,
      },
    };
  }

  const props = {
    shapes: [{ x: 0, y: 0, w: 100, h: 20, r: 4 }],
    baseColor: '#eee',
    highlightColor: '#fff',
    speedMs: 1400,
    width: 300,
    height: 200,
    reducedMotion: false,
  };

  async function renderWith(animation: 'shimmer' | 'pulse' | 'none', reducedMotion = false) {
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { reanimated } = recordingReanimated();
    const { skia, paths } = recordingSkia();
    renderToStaticMarkup(
      createElement(SkiaShimmerOverlay, {
        ...props,
        animation,
        reducedMotion,
        peers: { skia, reanimated },
      }),
    );
    // A path with a gradient child is the highlight; a childless one is the
    // opaque base fill the highlight breathes over.
    return {
      highlightPaths: paths.filter((p) => p['children'] !== undefined && p['children'] !== null),
      basePaths: paths.filter((p) => p['children'] === undefined || p['children'] === null),
    };
  }

  it("animation='none' draws no highlight at all — the one kind that must not animate", async () => {
    const { highlightPaths, basePaths } = await renderWith('none');
    expect(highlightPaths).toHaveLength(0);
    expect(basePaths).toHaveLength(1);
  });

  it("animation='pulse' draws the highlight OVER an opaque base fill", async () => {
    // Without a separate base underneath, breathing the highlight's opacity
    // would make the whole skeleton translucent at the trough and let the real
    // content show through — the exact mistake `applyPulse()`'s doc comment on
    // iOS warns about.
    const { highlightPaths, basePaths } = await renderWith('pulse');
    expect(highlightPaths).toHaveLength(1);
    expect(basePaths).toHaveLength(1);
  });

  it("animation='shimmer' needs no separate base — the travelling gradient covers", async () => {
    const { highlightPaths, basePaths } = await renderWith('shimmer');
    expect(highlightPaths).toHaveLength(1);
    expect(basePaths).toHaveLength(0);
  });

  it('reduce-motion still degrades shimmer to the pulse presentation', async () => {
    const { highlightPaths, basePaths } = await renderWith('shimmer', true);
    expect(highlightPaths).toHaveLength(1);
    expect(basePaths).toHaveLength(1);
  });

  it("reduce-motion never promotes animation='none' into a pulse", async () => {
    const { highlightPaths } = await renderWith('none', true);
    expect(highlightPaths).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// The dropped feature, still dropped
// ---------------------------------------------------------------------------

describe('staggerDelayForIndex (plan.md §4.1 index-order stagger)', () => {
  // Two assertions, unchanged and deliberately NOT extended: this function has
  // no call site anywhere in the library and adding a third green test to it
  // would only deepen the impression that it ships. See its doc comment.
  it('is zero for the first shape', () => {
    expect(staggerDelayForIndex(0)).toBe(0);
  });

  it('is monotonically increasing with wire index', () => {
    expect(staggerDelayForIndex(1)).toBeGreaterThan(staggerDelayForIndex(0));
    expect(staggerDelayForIndex(5)).toBeGreaterThan(staggerDelayForIndex(1));
  });
});

// ---------------------------------------------------------------------------
// ADR-5 / RISK-8: the default native graph must never name an optional peer
// ---------------------------------------------------------------------------

describe('the default native entry graph is peer-free, and tier-2 is only reachable by opting in', () => {
  const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../../src');
  const PEERS = ['@shopify/react-native-skia', 'react-native-reanimated'];

  /** Walks every RELATIVE import reachable from `entry` inside `src/`,
   *  returning the visited files and every bare specifier seen along the way.
   *  Source-level rather than tarball-level on purpose: this is the invariant
   *  authors break, and it fails in the same edit that breaks it. */
  function walk(entry: string): { files: string[]; specifiers: Set<string> } {
    const files: string[] = [];
    const specifiers = new Set<string>();
    const seen = new Set<string>();
    const queue = [entry];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const resolved = [current, `${current}.ts`, `${current}.tsx`, `${current}/index.ts`].find((candidate) => {
        try {
          readFileSync(candidate, 'utf8');
          return true;
        } catch {
          return false;
        }
      });
      if (resolved === undefined || seen.has(resolved)) {
        continue;
      }
      seen.add(resolved);
      files.push(resolved);
      const source = readFileSync(resolved, 'utf8');
      // Import/export specifiers only — never a mention inside a comment, which
      // this repo's files are full of by design.
      for (const match of source.matchAll(/(?:^|\n)\s*(?:import|export)[^;]*?from\s+'([^']+)'/g)) {
        const specifier = match[1]!;
        if (specifier.startsWith('.')) {
          queue.push(resolve(dirname(resolved), specifier));
        } else {
          specifiers.add(specifier);
        }
      }
      for (const match of source.matchAll(/(?:^|\n)\s*import\s+'([^']+)'/g)) {
        specifiers.add(match[1]!);
      }
    }
    return { files, specifiers };
  }

  it('index.native.ts reaches neither optional peer', () => {
    const { files, specifiers } = walk(resolve(SRC, 'index.native.ts'));
    // Guard against the walk silently degrading into a single-file check.
    expect(files.length).toBeGreaterThan(10);
    for (const peer of PEERS) {
      expect(Array.from(specifiers)).not.toContain(peer);
    }
  });

  it('index.native.ts does not reach the tier-2 renderer at all', () => {
    const { files } = walk(resolve(SRC, 'index.native.ts'));
    // The tier-2 IMPLEMENTATION must be reachable only through
    // `autoskeleton/skia`. `native/overlayContract.ts` — types only, no peer
    // names — is deliberately allowed, and is what lets `AutoSkeleton.tsx`
    // accept an overlay without importing one.
    expect(files.filter((f) => f.includes('/tier2/'))).toEqual([]);
    expect(files.some((f) => f.endsWith('native/overlayContract.ts'))).toBe(true);
  });

  it('index.skia.ts does not name the peers either — the CONSUMER supplies them', () => {
    // This is the whole reason `createSkiaOverlay` takes the modules as an
    // argument. A static import here would work under Metro but would make
    // both peers a hard build-time requirement of the subpath, and a DYNAMIC
    // one would not work at all: Metro rewrites `require(variable)` into an
    // unconditional throw, which is exactly how tier-2 came to be unreachable.
    const { specifiers } = walk(resolve(SRC, 'index.skia.ts'));
    for (const peer of PEERS) {
      expect(Array.from(specifiers)).not.toContain(peer);
    }
  });

  it('no file under src/ resolves a peer through a dynamic require', () => {
    const { files } = walk(resolve(SRC, 'index.skia.ts'));
    const nativeFiles = walk(resolve(SRC, 'index.native.ts')).files;
    for (const file of [...files, ...nativeFiles]) {
      // Comments MUST be stripped first: this repo documents the defect at
      // length, so the phrase `require(specifier)` appears in prose in several
      // of these very files. A scan that cannot tell code from commentary
      // would report the documentation as the defect.
      const source = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
      const dynamicRequires = source.match(/(?:^|[^.\w])require\(\s*(?!'|")/g) ?? [];
      expect(dynamicRequires, `${file} contains a dynamic require(); Metro compiles that to a throw`).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// The wrapper a consumer actually mounts
// ---------------------------------------------------------------------------

describe('createSkiaOverlay forwards the whole overlay contract', () => {
  // REGRESSION (2026-09-02). `createSkiaOverlay` built its element from an
  // explicit prop list and `animation` was missing from it, so tier-2 drew a
  // travelling shimmer for `animation="none"` — the exact defect
  // `overlayContract.ts` says commit f464f11 fixed. It survived because every
  // other tier-2 test renders `SkiaShimmerOverlay` DIRECTLY and passes
  // `animation` by hand, exercising a path no consumer takes: the overlay a
  // consumer mounts is always the one this factory returns.
  //
  // So this asserts the GENERAL property rather than the one prop that broke.
  // A dropped prop cannot fail to compile — `SkiaRenderer` defaults
  // `animation` to `'shimmer'` — so only a test comparing the two objects
  // key-by-key can catch the next one.
  // `Required<...>` rather than `SkeletonOverlayProps` is what makes the
  // forwarding test below exhaustive AND self-maintaining: it forces every
  // OPTIONAL field to be listed too, so adding a field to the contract fails
  // to compile here until it is added to this fixture — at which point the
  // loop starts asserting it is forwarded. Typed as the plain contract, this
  // fixture would silently keep testing only the fields someone remembered,
  // which is exactly how `animation` went unforwarded through a release.
  // `direction` is the proof: it was added while this test already existed,
  // is optional, and would not have been covered.
  const overlayProps: Required<SkeletonOverlayProps> = {
    shapes: [{ x: 0, y: 0, w: 10, h: 10, r: 0 }],
    baseColor: '#e2e2e2',
    highlightColor: '#f5f5f5',
    speedMs: 1400,
    width: 300,
    height: 200,
    animation: 'none',
    reducedMotion: false,
    direction: 'rtl',
  };

  /** `createSkiaOverlay` is typed as returning `SkeletonOverlayComponent`
   *  (`ComponentType`), which is a union with `ComponentClass` and therefore
   *  not callable. It always returns the function component defined inside it,
   *  so calling it is what actually happens at render — the cast narrows the
   *  declared type to the one the factory really produces, and reading the
   *  returned element's `props` is what lets this assert the FORWARDING rather
   *  than the rendered output (which would need a full Skia peer double). */
  function renderOverlayElement(props: SkeletonOverlayProps): Record<string, unknown> {
    const { reanimated } = recordingReanimated();
    const factory = createSkiaOverlay({ skia: {} as SkiaModule, reanimated }) as unknown as (
      p: SkeletonOverlayProps,
    ) => { props: Record<string, unknown> };
    return factory(props).props;
  }

  it('passes every SkeletonOverlayProps field through to the renderer', () => {
    const forwarded = renderOverlayElement(overlayProps);

    for (const key of Object.keys(overlayProps) as Array<keyof SkeletonOverlayProps>) {
      expect(forwarded[key], `createSkiaOverlay dropped "${key}"`).toEqual(overlayProps[key]);
    }
  });

  it("forwards animation='none', the field whose loss silently became 'shimmer'", () => {
    expect(renderOverlayElement({ ...overlayProps, animation: 'none' })['animation']).toBe('none');
  });
});
