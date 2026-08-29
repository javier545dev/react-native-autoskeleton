// test/native/skia-renderer.test.ts
//
// Task 5.4: the parts of `SkiaRenderer.tsx` testable without mounting React
// or requiring either optional peer — `createSkiaTier2Renderer`'s metadata/
// availability delegation, and the pure per-shape stagger formula (plan.md
// §4.1: "order is meaningful … staggers withDelay by index").

import { describe, expect, it } from 'vitest';
import {
  createDriveAnimation,
  createSkiaTier2Renderer,
  SkiaShimmerOverlay,
  staggerDelayForIndex,
} from '../../src/native/tier2/SkiaRenderer';

describe('createSkiaTier2Renderer (task 5.4)', () => {
  it('reports kind "skia" and supportsRadius true', () => {
    const renderer = createSkiaTier2Renderer(() => {
      throw new Error('unavailable');
    });
    expect(renderer.kind).toBe('skia');
    expect(renderer.supportsRadius).toBe(true);
  });

  it('isAvailable() is false when peers cannot be required (default tier-1 fallback, RISK-8)', () => {
    const renderer = createSkiaTier2Renderer(() => {
      throw new Error('Cannot find module');
    });
    expect(renderer.isAvailable()).toBe(false);
  });

  it('isAvailable() is true only when both peers resolve at a compatible version', () => {
    const renderer = createSkiaTier2Renderer((specifier: string) => {
      if (specifier === '@shopify/react-native-skia/package.json') return { version: '1.4.0' };
      if (specifier === 'react-native-reanimated/package.json') return { version: '4.2.0' };
      throw new Error('unexpected');
    });
    expect(renderer.isAvailable()).toBe(true);
  });

  it('mount() returns an inert handle (actual rendering is JSX-driven, not imperative — see file header)', () => {
    const renderer = createSkiaTier2Renderer(() => ({ version: '99.0.0' }));
    const handle = renderer.mount(undefined as never, {} as never);
    expect(() => handle.update({} as never)).not.toThrow();
    expect(() => handle.setAnimation('shimmer')).not.toThrow();
    expect(() => handle.destroy()).not.toThrow();
  });
});

describe('staggerDelayForIndex (plan.md §4.1 index-order stagger)', () => {
  it('is zero for the first shape', () => {
    expect(staggerDelayForIndex(0)).toBe(0);
  });

  it('is monotonically increasing with wire index', () => {
    expect(staggerDelayForIndex(1)).toBeGreaterThan(staggerDelayForIndex(0));
    expect(staggerDelayForIndex(5)).toBeGreaterThan(staggerDelayForIndex(1));
  });
});

// Adversarial-review defect (2026-08-29). `SkiaShimmerOverlay`'s render body
// contained a bare `drive.value = Reanimated.withRepeat(...)`. Two things are
// wrong with it and only one is the style rule:
//
//  1. Writing a Reanimated shared value during render is a documented
//     correctness violation (it is an external side effect in the render
//     phase, unsafe under StrictMode double-invocation and any concurrent
//     re-render React chooses to throw away).
//  2. Worse, and specific to this code: it re-assigns a FRESH
//     `withRepeat(withTiming(...))` on EVERY render. Each assignment restarts
//     the sweep from the current value, so any unrelated parent re-render
//     silently resets the shimmer phase — the exact opposite of ADR-8's "one
//     clock, every instance in phase" and of NFR-7's "zero React re-renders
//     attributable to animation" read in the other direction.
//
// Observed with `react-dom/server`, which really does invoke the component
// function and really does run `useMemo` — but never runs effects. That is
// precisely the isolation this needs: any write recorded here happened in the
// RENDER PHASE, because nothing else has run yet.
//
// HONESTLY SCOPED, and the same shape as this project's existing open item
// (i): this repo has no React renderer under Vitest that runs effects (node
// environment, jsdom banned project-wide), so "the effect subsequently starts
// the animation" is NOT proven here. What is proven is that render allocates
// no animation, and — separately, directly — the animation the effect builds.
describe('SkiaShimmerOverlay — the shimmer driver is not started from the render body', () => {
  interface RecordedPeers {
    readonly requireFn: (specifier: string) => unknown;
    readonly driveWrites: number[];
  }

  function recordingPeers(): RecordedPeers {
    const driveWrites: number[] = [];
    const passthrough = (props: { children?: unknown }): unknown => props.children ?? null;
    const skia = {
      Skia: { Path: { Make: () => ({ addRRect() { return this; }, addRect() { return this; } }) } },
      rrect: () => ({}),
      rect: () => ({}),
      vec: (x: number, y: number) => ({ x, y }),
      Canvas: passthrough,
      Path: passthrough,
      LinearGradient: () => null,
    };
    const reanimated = {
      useSharedValue<T>(initial: T) {
        let current = initial;
        return {
          get value(): T {
            return current;
          },
          set value(next: T) {
            current = next;
            driveWrites.push(next as unknown as number);
          },
        };
      },
      useDerivedValue<T>(updater: () => T): { value: T } {
        return { value: updater() };
      },
      withRepeat: (animation: number) => animation,
      withTiming: (toValue: number, config?: { duration?: number }) => config?.duration ?? toValue,
      withDelay: (delayMs: number, animation: number) => delayMs + animation,
    };
    return {
      driveWrites,
      requireFn: (specifier: string) => {
        if (specifier === '@shopify/react-native-skia') return skia;
        if (specifier === 'react-native-reanimated') return reanimated;
        throw new Error(`unexpected specifier ${specifier}`);
      },
    };
  }

  const baseProps = {
    shapes: [
      { x: 0, y: 0, w: 100, h: 20, r: 4 },
      { x: 0, y: 30, w: 60, h: 60, r: 0 },
    ],
    baseColor: '#eee',
    highlightColor: '#fff',
    speedMs: 1500,
    width: 300,
    height: 200,
    reducedMotion: false,
  };

  it('performs no shared-value write while rendering', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { createElement } = await import('react');
    const peers = recordingPeers();

    renderToStaticMarkup(
      createElement(SkiaShimmerOverlay, { ...baseProps, requireFn: peers.requireFn }),
    );

    expect(peers.driveWrites).toEqual([]);
  });

  it('performs no shared-value write while rendering under reduced motion either', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { createElement } = await import('react');
    const peers = recordingPeers();

    renderToStaticMarkup(
      createElement(SkiaShimmerOverlay, { ...baseProps, reducedMotion: true, requireFn: peers.requireFn }),
    );

    expect(peers.driveWrites).toEqual([]);
  });

  it('re-rendering never accumulates animation assignments (the phase-reset half of the defect)', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { createElement } = await import('react');
    const peers = recordingPeers();

    for (let render = 0; render < 5; render++) {
      renderToStaticMarkup(
        createElement(SkiaShimmerOverlay, { ...baseProps, requireFn: peers.requireFn }),
      );
    }

    expect(peers.driveWrites).toEqual([]);
  });
});

// The animation the effect assigns, tested directly — because the effect
// WIRING itself cannot be tested here (no React renderer under Vitest runs
// effects; see this file's note above and open item (i)). This covers the
// shape; it deliberately does not claim to cover the wiring.
describe('createDriveAnimation (ADR-8: one clock, infinite auto-reversing sweep)', () => {
  it('repeats forever, auto-reverses, and takes exactly speedMs per sweep', () => {
    const calls: unknown[][] = [];
    const reanimated = {
      useSharedValue: <T,>(v: T) => ({ value: v }),
      useDerivedValue: <T,>(u: () => T) => ({ value: u() }),
      withTiming: (toValue: number, config?: { duration?: number }) => {
        calls.push(['withTiming', toValue, config?.duration]);
        return 1;
      },
      withRepeat: (animation: number, count?: number, reverse?: boolean) => {
        calls.push(['withRepeat', animation, count, reverse]);
        return 2;
      },
      withDelay: (d: number, a: number) => d + a,
    };

    expect(createDriveAnimation(reanimated, 1500)).toBe(2);
    expect(calls).toEqual([
      ['withTiming', 1, 1500],
      ['withRepeat', 1, -1, true],
    ]);
  });
});
