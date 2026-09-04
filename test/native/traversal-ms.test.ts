// test/native/traversal-ms.test.ts
//
// REQ-OBS-METRICS-1 on native: `onMetrics.traversalMs` must be a measurement.
//
// It was the literal `0`, at both sites that build the payload in
// `src/native/AutoSkeleton.tsx`, while `sensor.ts`'s own comment claimed
// "`AutoSkeleton.tsx` measures bridge-call wall time directly around this
// `measure()` call". Nothing did. Web measured it properly the whole time, so a
// consumer aggregating the two platforms was reading a real distribution from
// one and a constant from the other — and the NFR-3 budget warning, which
// divides by exactly this number, could never fire on the platform whose 2ms
// traversal budget it exists to police.
//
// The bridge call is synchronous, so wall time around it IS the number a caller
// waited for: it covers the UI-thread hop and the native traversal together.
// This test makes a slow module observably slow, which is the only way to tell a
// real measurement apart from a zero that happens to look plausible.

import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SLOW_MEASURE_MS = 12;

let frameCallbacks: Array<FrameRequestCallback> = [];

vi.mock('react-native', () => ({
  AccessibilityInfo: {
    isReduceMotionEnabled: () => Promise.resolve(false),
    addEventListener: () => ({ remove: () => undefined }),
  },
  findNodeHandle: () => 1,
  I18nManager: { isRTL: false },
  PixelRatio: { getFontScale: () => 1 },
  Platform: { OS: 'ios' },
  StyleSheet: { create: (styles: Record<string, unknown>) => styles, absoluteFill: {} },
  TurboModuleRegistry: {
    get: () => ({
      // A module that genuinely takes time. Busy-waiting rather than sleeping
      // because `getShapes` is synchronous by contract — an async stub would
      // measure the wrong thing.
      getShapes: () => {
        const until = Date.now() + SLOW_MEASURE_MS;
        while (Date.now() < until) {
          /* burn wall time inside the bridge call */
        }
        // One 40x20 shape: WIRE_VERSION, then x, y, w, h, r.
        return [1, 0, 0, 40, 20, 0];
      },
      evictShapes: () => undefined,
    }),
    getEnforcing: () => null,
  },
  useWindowDimensions: () => ({ width: 375, height: 812 }),
  View: 'View',
}));

vi.mock('../../src/native/renderer/AutoskeletonOverlayHostComponent', () => ({
  resolveAutoskeletonOverlayNativeComponent: () => 'AutoskeletonOverlayView',
}));

type LayoutHandler = (event: { nativeEvent: { layout: { width: number; height: number } } }) => void;

interface TestRendererLike {
  root: { findAllByType(type: string): Array<{ props: Record<string, unknown> }> };
}

describe('<AutoSkeleton> — onMetrics.traversalMs is measured, not a constant', () => {
  let realRaf: typeof globalThis.requestAnimationFrame | undefined;
  let realCaf: typeof globalThis.cancelAnimationFrame | undefined;

  beforeEach(() => {
    vi.resetModules();
    frameCallbacks = [];
    realRaf = globalThis.requestAnimationFrame;
    realCaf = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) =>
      frameCallbacks.push(callback)) as unknown as typeof globalThis.requestAnimationFrame;
    globalThis.cancelAnimationFrame = (() => undefined) as unknown as typeof globalThis.cancelAnimationFrame;
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    globalThis.requestAnimationFrame = realRaf as typeof globalThis.requestAnimationFrame;
    globalThis.cancelAnimationFrame = realCaf as typeof globalThis.cancelAnimationFrame;
  });

  it('reports the wall time the synchronous bridge call actually took', async () => {
    const { AutoSkeleton } = await import('../../src/native/AutoSkeleton');
    const { act, create } = await import('react-test-renderer');

    const seen: Array<{ traversalMs: number; cacheHit: boolean }> = [];

    let renderer: TestRendererLike | undefined;
    act(() => {
      renderer = create(
        createElement(
          AutoSkeleton,
          {
            isLoading: true,
            skeletonKey: 'traversal-ms',
            onMetrics: (m: { traversalMs: number; cacheHit: boolean }) =>
              seen.push({ traversalMs: m.traversalMs, cacheHit: m.cacheHit }),
          },
          createElement('Text', null, 'content'),
        ),
      ) as unknown as TestRendererLike;
    });
    const tree = renderer as TestRendererLike;

    act(() => {
      const wrapper = tree.root.findAllByType('View')[0];
      (wrapper?.props.onLayout as LayoutHandler)({
        nativeEvent: { layout: { width: 320, height: 200 } },
      });
    });

    // The cold measurement is deferred by exactly one frame.
    act(() => {
      const queued = frameCallbacks;
      frameCallbacks = [];
      for (const callback of queued) {
        callback(0);
      }
    });

    // `onMetrics` fires when the handoff settles, which needs the load to
    // finish — a cycle stuck at `isLoading: true` never reports.
    act(() => {
      (renderer as unknown as { update: (el: unknown) => void }).update(
        createElement(
          AutoSkeleton,
          {
            isLoading: false,
            skeletonKey: 'traversal-ms',
            onMetrics: (m: { traversalMs: number; cacheHit: boolean }) =>
              seen.push({ traversalMs: m.traversalMs, cacheHit: m.cacheHit }),
          },
          createElement('Text', null, 'content'),
        ),
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
    });

    expect(seen.length, 'onMetrics never fired').toBeGreaterThan(0);
    const coldCycle = seen.find((m) => !m.cacheHit);
    expect(coldCycle, 'no cold cycle was reported').toBeDefined();
    expect(
      coldCycle!.traversalMs,
      `traversalMs was ${coldCycle!.traversalMs}; the mocked bridge call burns ${SLOW_MEASURE_MS}ms, ` +
        'so anything at or near zero means the value is still hard-coded',
    ).toBeGreaterThanOrEqual(SLOW_MEASURE_MS - 2);
  });
});
