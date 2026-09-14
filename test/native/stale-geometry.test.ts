// test/native/stale-geometry.test.ts
//
// WHAT HAPPENS WHEN THE CONTENT CHANGES SIZE BETWEEN LOADING CYCLES.
//
// `composeCacheKey` covers the dimensions the PLATFORM can change underneath a
// consumer: width bucket, font scale, direction, platform. Rotate the device or
// bump the system text size and the key changes, the cache misses, and a fresh
// traversal runs. That much works.
//
// What no part of the key describes is the consumer's own content. A list that
// paginates, a detail screen whose second load carries more text, a card that
// gains a row — same skeletonKey, same bucket, same scale, same direction, and
// a genuinely different layout. The second cycle serves the FIRST cycle's
// geometry.
//
// `Sensor.observe()` exists in `core/contracts.ts` for exactly this, with
// `'mutation'` among its `InvalidationReason`s, and has no call site on either
// platform. Rather than wire a real mutation observer into native — much
// larger, and it would still only report that the tree moved — each loading
// cycle re-asks the sensor ONCE, after the cached snapshot has already painted
// the first frame, and repaints only if the answer changed.
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let frameCallbacks: Array<FrameRequestCallback> = [];
/** Every `getShapes` call the component makes, with what it returned. */
let traversals: Array<readonly number[]> = [];
/** Swapped between cycles to stand in for "the content got taller". */
let nextWire: readonly number[] = [];

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
      getShapes: () => {
        traversals.push(nextWire);
        return [...nextWire];
      },
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
  update(element: React.ReactElement): void;
  unmount(): void;
}

// One 200x40 shape, then one 200x400 shape: the same key describing a layout
// that grew by an order of magnitude.
const SHORT_CONTENT = [1, 0, 0, 200, 40, 0] as const;
const TALL_CONTENT = [1, 0, 0, 200, 400, 0] as const;

describe('geometry cached across loading cycles', () => {
  let realRaf: typeof globalThis.requestAnimationFrame | undefined;
  let realCaf: typeof globalThis.cancelAnimationFrame | undefined;

  beforeEach(() => {
    vi.resetModules();
    frameCallbacks = [];
    traversals = [];
    nextWire = SHORT_CONTENT;
    realRaf = globalThis.requestAnimationFrame;
    realCaf = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) =>
      frameCallbacks.push(callback)) as unknown as typeof globalThis.requestAnimationFrame;
    globalThis.cancelAnimationFrame = (() => undefined) as unknown as typeof globalThis.cancelAnimationFrame;
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    globalThis.requestAnimationFrame =
      typeof realRaf === 'function' ? realRaf : ((() => 0) as typeof globalThis.requestAnimationFrame);
    globalThis.cancelAnimationFrame =
      typeof realCaf === 'function' ? realCaf : ((() => undefined) as typeof globalThis.cancelAnimationFrame);
  });

  it('repaints a second cycle whose content grew, instead of serving the first cycle geometry', async () => {
    const { AutoSkeleton, SkeletonProvider } = await import('../../src/native/AutoSkeleton');
    const { MemoryShapeStore } = await import('../../src/core/snapshot');
    const { act, create } = await import('react-test-renderer');

    const store = new MemoryShapeStore();
    const element = (isLoading: boolean) =>
      createElement(
        SkeletonProvider,
        { store },
        createElement(
          AutoSkeleton,
          { isLoading, skeletonKey: 'grows', skeletonOnRefresh: true },
          createElement('Text', null, 'content'),
        ),
      );

    let tree!: TestRendererLike;
    act(() => {
      tree = create(element(true)) as unknown as TestRendererLike;
    });
    act(() => {
      const wrapper = tree.root.findAllByType('View')[0];
      (wrapper?.props.onLayout as LayoutHandler)({ nativeEvent: { layout: { width: 200, height: 40 } } });
    });
    act(() => {
      const queued = frameCallbacks;
      frameCallbacks = [];
      for (const callback of queued) callback(0);
    });
    expect(traversals).toHaveLength(1);

    // Load resolves; the content is replaced by something much taller; a new
    // load begins. Nothing the cache key describes has changed.
    act(() => {
      tree.update(element(false));
    });
    nextWire = TALL_CONTENT;
    act(() => {
      tree.update(element(true));
    });
    act(() => {
      const queued = frameCallbacks;
      frameCallbacks = [];
      for (const callback of queued) callback(0);
    });

    // The cached snapshot still paints the first frame — that is the cache's
    // job and it is untouched — but the cycle also re-asks the sensor, and the
    // answer changed, so the skeleton is repainted for the content that is
    // actually there.
    expect(traversals).toHaveLength(2);
    const painted = tree.root.findAllByType('AutoskeletonOverlayView')[0]?.props.shapes as readonly number[];
    expect(painted).toEqual([...TALL_CONTENT]);
    expect(painted).not.toEqual([...SHORT_CONTENT]);

    tree.unmount();
  });

  // Anti-vacuity: the harness must be able to observe a SECOND traversal at
  // all, or the assertion above would hold for a component that never measures.
  it('does run a second traversal when the cache key itself changes', async () => {
    const { AutoSkeleton, SkeletonProvider } = await import('../../src/native/AutoSkeleton');
    const { MemoryShapeStore } = await import('../../src/core/snapshot');
    const { act, create } = await import('react-test-renderer');

    const store = new MemoryShapeStore();
    const element = (skeletonKey: string) =>
      createElement(
        SkeletonProvider,
        { store },
        createElement(
          AutoSkeleton,
          { isLoading: true, skeletonKey },
          createElement('Text', null, 'content'),
        ),
      );

    let tree!: TestRendererLike;
    act(() => {
      tree = create(element('first')) as unknown as TestRendererLike;
    });
    const layout = () =>
      act(() => {
        const wrapper = tree.root.findAllByType('View')[0];
        (wrapper?.props.onLayout as LayoutHandler)({ nativeEvent: { layout: { width: 200, height: 40 } } });
      });
    const flush = () =>
      act(() => {
        const queued = frameCallbacks;
        frameCallbacks = [];
        for (const callback of queued) callback(0);
      });
    layout();
    flush();
    expect(traversals).toHaveLength(1);

    act(() => {
      tree.update(element('second'));
    });
    layout();
    flush();
    expect(traversals).toHaveLength(2);

    tree.unmount();
  });

  it('a revalidation that finds the same geometry repaints nothing', async () => {
    // The other half, and the one that keeps the cost honest: revalidating
    // every cycle is only acceptable because the COMMON case — the layout did
    // not change — writes no state and repaints nothing. Without this guard the
    // shimmer would restart on every cycle for no reason, which is worse than
    // the staleness the revalidation exists to fix.
    const { AutoSkeleton, SkeletonProvider } = await import('../../src/native/AutoSkeleton');
    const { MemoryShapeStore } = await import('../../src/core/snapshot');
    const { act, create } = await import('react-test-renderer');

    const store = new MemoryShapeStore();
    const element = (isLoading: boolean) =>
      createElement(
        SkeletonProvider,
        { store },
        createElement(
          AutoSkeleton,
          { isLoading, skeletonKey: 'steady', skeletonOnRefresh: true },
          createElement('Text', null, 'content'),
        ),
      );

    let tree!: TestRendererLike;
    act(() => {
      tree = create(element(true)) as unknown as TestRendererLike;
    });
    act(() => {
      const wrapper = tree.root.findAllByType('View')[0];
      (wrapper?.props.onLayout as LayoutHandler)({ nativeEvent: { layout: { width: 200, height: 40 } } });
    });
    act(() => {
      const queued = frameCallbacks;
      frameCallbacks = [];
      for (const callback of queued) callback(0);
    });
    const paintedFirst = tree.root.findAllByType('AutoskeletonOverlayView')[0]?.props
      .shapes as readonly number[];

    // Second cycle, content UNCHANGED — `nextWire` stays SHORT_CONTENT.
    act(() => {
      tree.update(element(false));
    });
    act(() => {
      tree.update(element(true));
    });
    act(() => {
      const queued = frameCallbacks;
      frameCallbacks = [];
      for (const callback of queued) callback(0);
    });

    // It asked again — that is the point — and found nothing worth changing.
    expect(traversals).toHaveLength(2);
    const paintedSecond = tree.root.findAllByType('AutoskeletonOverlayView')[0]?.props
      .shapes as readonly number[];
    expect(paintedSecond).toEqual(paintedFirst);
    tree.unmount();
  });
});
