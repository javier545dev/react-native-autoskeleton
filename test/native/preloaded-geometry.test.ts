// test/native/preloaded-geometry.test.ts
//
// THE ONLY WAY TO HAVE A SKELETON IN THE FIRST FRAME.
//
// A cold key cannot be measured in time, and that is physics rather than a
// defect: the sensor measures the real view tree, so the tree must be mounted
// and laid out before there is anything to measure (`mount-order.test.ts` pins
// the sequence — first commit, onLayout, one deferred frame, then shapes). The
// library covers that window with a neutral block that resolves into the
// measured shapes, which makes it LOOK right. Removing it is a different
// problem: you cannot measure faster, you can only already know.
//
// This is the round trip that already knows. Measure once, `exportShapeStore`,
// persist it however the app persists anything, `importIntoShapeStore` into a
// store handed to `SkeletonProvider` before the first render. The cold window
// does not get shorter; it does not happen.
//
// The industry agrees, for what it is worth: `auto-skeleton` resolves the first
// frame from "a layout prop, provider layouts, or a cache hit", and Boneyard
// captures layouts at build time with headless Chromium. Nobody measures in
// time, because nobody can.
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
    get: () => ({ getShapes: () => [1, 0, 0, 40, 20, 0] }),
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
  unmount(): void;
}

describe('preloaded geometry removes the cold window entirely', () => {
  let realRaf: typeof globalThis.requestAnimationFrame | undefined;

  beforeEach(() => {
    vi.resetModules();
    frameCallbacks = [];
    realRaf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) =>
      frameCallbacks.push(callback)) as unknown as typeof globalThis.requestAnimationFrame;
    globalThis.cancelAnimationFrame = (() => undefined) as unknown as typeof globalThis.cancelAnimationFrame;
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    globalThis.requestAnimationFrame = realRaf as typeof globalThis.requestAnimationFrame;
  });

  it('a store seeded from a previous run paints shapes in the first commit', async () => {
    const { AutoSkeleton, SkeletonProvider } = await import('../../src/native/AutoSkeleton');
    const { MemoryShapeStore } = await import('../../src/core/snapshot');
    const { exportShapeStore, importIntoShapeStore } = await import('../../src/core/snapshot-io');
    const { act, create } = await import('react-test-renderer');

    const mountWith = (store: InstanceType<typeof MemoryShapeStore>): TestRendererLike =>
      create(
        createElement(
          SkeletonProvider,
          { store },
          createElement(
            AutoSkeleton,
            { isLoading: true, skeletonKey: 'preloaded' },
            createElement('Text', null, 'content'),
          ),
        ),
      ) as unknown as TestRendererLike;

    // --- Run 1: the cold path, driven all the way through so it measures.
    const firstRun = new MemoryShapeStore();
    let first!: TestRendererLike;
    act(() => {
      first = mountWith(firstRun);
    });
    act(() => {
      const wrapper = first.root.findAllByType('View')[0];
      (wrapper?.props.onLayout as LayoutHandler)({ nativeEvent: { layout: { width: 320, height: 200 } } });
    });
    act(() => {
      const queued = frameCallbacks;
      frameCallbacks = [];
      for (const callback of queued) callback(0);
    });
    expect(first.root.findAllByType('AutoskeletonOverlayView').length).toBe(1);
    first.unmount();

    // --- What the consumer would persist between app launches.
    const persisted = exportShapeStore(firstRun);
    expect(persisted.length).toBeGreaterThan(0);
    // It must survive a real serialization boundary, not just an object copy —
    // that is the whole point of persisting it.
    const rehydrated = JSON.parse(JSON.stringify(persisted));

    // --- Run 2: a brand-new process. Nothing measured, nothing cached.
    const secondRun = new MemoryShapeStore();
    const report = importIntoShapeStore(secondRun, rehydrated);
    expect(report.accepted).toBe(persisted.length);
    expect(report.rejected).toBe(0);

    let second!: TestRendererLike;
    act(() => {
      second = mountWith(secondRun);
    });

    // No onLayout, no deferred frame, no traversal — the skeleton is simply
    // there, in the first commit. This is the cold window not happening.
    expect(second.root.findAllByType('AutoskeletonOverlayView').length).toBe(1);
    expect(frameCallbacks).toHaveLength(0);
    second.unmount();
  });

  it('an empty store in the same position has no skeleton in that first commit', async () => {
    // Anti-vacuity. Without this, a component that always mounted an overlay
    // would pass the test above and prove nothing about the seeding.
    const { AutoSkeleton, SkeletonProvider } = await import('../../src/native/AutoSkeleton');
    const { MemoryShapeStore } = await import('../../src/core/snapshot');
    const { act, create } = await import('react-test-renderer');

    let tree!: TestRendererLike;
    act(() => {
      tree = create(
        createElement(
          SkeletonProvider,
          { store: new MemoryShapeStore() },
          createElement(
            AutoSkeleton,
            { isLoading: true, skeletonKey: 'preloaded' },
            createElement('Text', null, 'content'),
          ),
        ),
      ) as unknown as TestRendererLike;
    });

    expect(tree.root.findAllByType('AutoskeletonOverlayView').length).toBe(0);
    tree.unmount();
  });
});
