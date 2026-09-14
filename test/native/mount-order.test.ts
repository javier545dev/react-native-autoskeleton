// test/native/mount-order.test.ts
//
// WHAT IS ON SCREEN, STEP BY STEP, WHILE A COLD SKELETON MOUNTS.
//
// The product's promise is that the skeleton is what the reader sees first.
// On a cold mount it is not, and this file pins the actual order rather than
// the intended one, because the gap between the two is a real defect that was
// observed on a device before it was understood here: ~150ms of live content
// visible before the loader appeared.
//
// The cause is structural, not a bug to patch at one site. The sensor measures
// the REAL view tree, so the content must be mounted and laid out BEFORE there
// is anything to measure, and ADR-16 keeps that content mounted (never
// `display:none`) so the handoff has something already painted underneath. The
// chain is therefore forced:
//
//   render children -> Yoga lays out -> onLayout -> +1 rAF (Fabric's mounting
//   phase; `resolveView(reactTag)` is null before it, see `useColdMeasurement`)
//   -> getShapes -> setColdSnapshot -> overlay mounts
//
// Every step before the last has the content on screen and no skeleton over
// it. `overlayVisible` requires `snapshot !== null`, and on a cold key there is
// no snapshot until the traversal returns.
//
// The second case is the contrast that makes the first one a CHOICE rather
// than a law: reuse the same store and the skeleton is present in the very
// first commit, no layout, no frame, no traversal. That is the cache earning
// its place, stated as behaviour instead of as an ADR.
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
    get: () => ({
      // One 40x20 shape: WIRE_VERSION, then x, y, w, h, r.
      getShapes: () => [1, 0, 0, 40, 20, 0],
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
  unmount(): void;
}

describe('<AutoSkeleton> — what is on screen while a cold skeleton mounts', () => {
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

  it('paints the content BEFORE the skeleton on a cold key, and names every step it takes', async () => {
    const { AutoSkeleton } = await import('../../src/native/AutoSkeleton');
    const { act, create } = await import('react-test-renderer');

    let tree!: TestRendererLike;

    const overlays = (): number => tree.root.findAllByType('AutoskeletonOverlayView').length;
    const contents = (): number => tree.root.findAllByType('Text').length;
    // The wrapper's resolved opacity: 0 means the content is mounted (so it can
    // be measured) but not shown.
    const wrapperOpacity = (): number => {
      const style = tree.root.findAllByType('View')[0]?.props.style;
      const flat = (Array.isArray(style) ? style : [style]).filter(Boolean) as Array<Record<string, unknown>>;
      return flat.reduce((acc, s) => (typeof s.opacity === 'number' ? s.opacity : acc), 1);
    };
    // The neutral placeholder shown while the content is hidden and no measured
    // geometry exists yet.
    const placeholders = (): number =>
      tree.root.findAllByType('View').filter((v) => v.props.testID === 'autoskeleton-measuring').length;
    const timeline: Array<{
      step: string;
      content: number;
      skeleton: number;
      opacity: number;
      placeholder: number;
    }> = [];
    const record = (step: string): void => {
      timeline.push({
        step,
        content: contents(),
        skeleton: overlays(),
        opacity: wrapperOpacity(),
        placeholder: placeholders(),
      });
    };

    act(() => {
      tree = create(
        createElement(
          AutoSkeleton,
          { isLoading: true, skeletonKey: 'mount-order' },
          createElement('Text', null, 'content'),
        ),
      ) as unknown as TestRendererLike;
    });
    record('1. first commit');

    act(() => {
      const wrapper = tree.root.findAllByType('View')[0];
      (wrapper?.props.onLayout as LayoutHandler)({ nativeEvent: { layout: { width: 320, height: 200 } } });
    });
    record('2. after onLayout');

    act(() => {
      const queued = frameCallbacks;
      frameCallbacks = [];
      for (const callback of queued) callback(0);
    });
    record('3. after the deferred frame measures');

    // eslint-disable-next-line no-console
    console.log('[mount-order] cold:', timeline);

    // The content is mounted from the very first commit — ADR-16 requires it,
    // and the sensor could not measure anything otherwise.
    expect(timeline.every((t) => t.content === 1)).toBe(true);

    // ONE SKELETON SURFACE, ALWAYS. From the first frame that has a size to
    // paint, there is exactly one thing covering the content, and it is the
    // real overlay — first carrying a single full-bleed neutral rect, then the
    // measured shapes, delivered to the SAME mounted component under the same
    // `cacheKey`. The native host takes its in-place `update(shapes)` path for
    // that, which its contract states "MUST NOT restart the shimmer phase", so
    // the block RESOLVES INTO the shapes instead of being swapped for them.
    //
    // This assertion replaces an earlier one that read "it is gone the moment
    // real geometry exists; two skeletons never overlap". That pinned the hard
    // cut — blank, then a dead slab, then a different shimmering element — as
    // correct. The test encoded the defect.
    const surfaces = (t: (typeof timeline)[number]): number => t.skeleton + t.placeholder;

    // Step 1 is pre-layout: nothing has a size yet, so the static cover is the
    // only thing that can stand in. Steps 2 and 3 are the overlay.
    expect(timeline[0]!.placeholder).toBe(1);
    expect(timeline[0]!.skeleton).toBe(0);
    expect(timeline[1]!.skeleton).toBe(1);
    expect(timeline[2]!.skeleton).toBe(1);

    // Never two at once, never zero: no gap to see through and no double
    // paint, at any step.
    expect(timeline.map(surfaces)).toEqual([1, 1, 1]);

    // The wrapper is never made transparent. An earlier attempt did that to
    // hide the content and hid the cover with it, because the cover lives
    // inside the same wrapper. A node-counting test cannot see that; it is
    // asserted here so the regression stays visible in the record.
    expect(timeline.every((t) => t.opacity === 1)).toBe(true);

    tree.unmount();
  });

  it('mounts the skeleton in the FIRST commit once the store already holds that geometry', async () => {
    const { AutoSkeleton } = await import('../../src/native/AutoSkeleton');
    const { act, create } = await import('react-test-renderer');

    // No `store` prop: that one belongs to `SkeletonProvider`. `AutoSkeleton`
    // reads `ctx.store`, which without a provider is the module-level default
    // — shared by both mounts below, which is exactly the warm-cache condition
    // under test.
    const mount = (): TestRendererLike =>
      create(
        createElement(
          AutoSkeleton,
          { isLoading: true, skeletonKey: 'mount-order' },
          createElement('Text', null, 'content'),
        ),
      ) as unknown as TestRendererLike;

    // Cycle 1 — cold. Drive it all the way through so the store is populated.
    let first!: TestRendererLike;
    act(() => {
      first = mount();
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
    // The cold cycle resolved: the skeleton is up, so geometry now exists for
    // this key. That is the precondition for the warm assertion below.
    expect(first.root.findAllByType('AutoskeletonOverlayView').length).toBe(1);
    first.unmount();

    // Cycle 2 — warm. Same key, same store, nothing else changed.
    let second!: TestRendererLike;
    act(() => {
      second = mount();
    });

    // No onLayout, no frame, no traversal: the skeleton is simply there.
    expect(second.root.findAllByType('AutoskeletonOverlayView').length).toBe(1);
    second.unmount();
  });
});
