// test/native/native-module-unavailable-fail-open.test.ts
//
// ADR-15 / RISK-10, the PRODUCTION half: `<AutoSkeleton>` must fail OPEN when
// the `Autoskeleton` Turbo Module is absent from the app binary (Expo Go, or
// a build that never autolinked) — render `children` unwrapped, warn once,
// and never crash.
//
// `test/native/native-module-accessor.test.ts` already pins the resolver and
// the once-per-process warning. Neither it nor any other suite ever mounted
// the COMPONENT with the module absent, and that gap hid a real crash: the
// fail-open branch is an early `return` placed ABOVE the `overlayShapes`
// `useMemo`, so the render that flips `nativeUnavailable` to `true` runs one
// hook fewer than the render before it and React aborts with "Rendered fewer
// hooks than expected". `__DEV__` never reaches that branch (the
// `onNativeModuleUnavailable` callback throws the named error first), which
// is exactly why only production — the path nobody runs in a simulator —
// was affected.
//
// WHY A REAL RENDERER HERE. The sibling suites in this directory render
// through `react-dom/server`'s `renderToStaticMarkup`, which is the right
// tool for "what does this component DECIDE during one render" and cannot
// prove anything here: `nativeUnavailable` is flipped from an effect, and
// Fizz neither runs effects nor validates hook counts across renders. Only a
// client reconciler commits effects and enforces the hook contract, so this
// one file drives `react-test-renderer` instead. `react-native` itself stays
// mocked exactly as the sibling suites mock it.

import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

/** Frame callbacks queued by the stubbed `requestAnimationFrame` — the cold
 *  measurement is deferred by exactly one frame (see `useColdMeasurement`). */
let frameCallbacks: Array<FrameRequestCallback> = [];

vi.mock('react-native', () => ({
  AccessibilityInfo: {
    isReduceMotionEnabled: () => Promise.resolve(false),
    addEventListener: () => ({ remove: () => undefined }),
  },
  // Non-null so `measure()` gets past its reactTag guard and actually
  // reaches the module resolution this test is about.
  findNodeHandle: () => 1,
  I18nManager: { isRTL: false },
  PixelRatio: { getFontScale: () => 1 },
  Platform: { OS: 'ios' },
  StyleSheet: { create: (styles: Record<string, unknown>) => styles, absoluteFill: {} },
  // THE defect's precondition: Expo Go ships no custom native modules, so
  // `TurboModuleRegistry.get('Autoskeleton')` resolves to null (never
  // `getEnforcing`, which would throw at import time — see
  // `nativeModuleAccessor.ts`).
  TurboModuleRegistry: { get: () => null, getEnforcing: () => null },
  useWindowDimensions: () => ({ width: 375, height: 812 }),
  View: 'View',
}));

// Same rationale as `test/native/overlay-host-component.test.ts`: the
// codegen'd spec module statically imports Flow source that plain Vitest
// cannot parse.
vi.mock('../../src/native/renderer/AutoskeletonOverlayHostComponent', () => ({
  resolveAutoskeletonOverlayNativeComponent: () => 'AutoskeletonOverlayView',
}));

interface TestRendererLike {
  toJSON(): unknown;
  root: {
    findAllByType(type: string): Array<{ props: Record<string, unknown> }>;
  };
}

type LayoutHandler = (event: { nativeEvent: { layout: { width: number; height: number } } }) => void;

describe('<AutoSkeleton> — ADR-15 production fail-open (native module absent)', () => {
  let warnSpy: MockInstance<(...args: unknown[]) => void>;
  let realRaf: typeof globalThis.requestAnimationFrame | undefined;
  let realCaf: typeof globalThis.cancelAnimationFrame | undefined;

  beforeEach(() => {
    // A fresh module graph per test: the module-level default `MemoryShapeStore`
    // and the once-per-process warning latch are both reset through the real
    // module boundary, so this file keeps proving production wiring only.
    vi.resetModules();
    frameCallbacks = [];
    realRaf = globalThis.requestAnimationFrame;
    realCaf = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) =>
      frameCallbacks.push(callback)) as unknown as typeof globalThis.requestAnimationFrame;
    globalThis.cancelAnimationFrame = (() => undefined) as unknown as typeof globalThis.cancelAnimationFrame;
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined) as unknown as MockInstance<
      (...args: unknown[]) => void
    >;
  });

  afterEach(() => {
    warnSpy.mockRestore();
    globalThis.requestAnimationFrame = realRaf as typeof globalThis.requestAnimationFrame;
    globalThis.cancelAnimationFrame = realCaf as typeof globalThis.cancelAnimationFrame;
  });

  /** Mounts a loading `<AutoSkeleton>`, then drives the exact production
   *  sequence that reaches the fail-open branch: a real layout event, then
   *  the one deferred frame `useColdMeasurement` schedules the native
   *  `getShapes` call on. */
  async function mountAndDriveColdMeasurement(): Promise<TestRendererLike> {
    const { AutoSkeleton } = await import('../../src/native/AutoSkeleton');
    const { act, create } = await import('react-test-renderer');

    let renderer: TestRendererLike | undefined;
    act(() => {
      renderer = create(
        createElement(
          AutoSkeleton,
          { isLoading: true, skeletonKey: 'expo-go-fail-open' },
          createElement('Text', null, 'real content'),
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

    act(() => {
      const queued = frameCallbacks;
      frameCallbacks = [];
      for (const callback of queued) {
        callback(0);
      }
    });

    return tree;
  }

  it('renders children instead of crashing when the native module is absent', async () => {
    await expect(mountAndDriveColdMeasurement()).resolves.toBeDefined();
  });

  it('keeps the children mounted and warns once about the missing module', async () => {
    const tree = await mountAndDriveColdMeasurement();

    expect(JSON.stringify(tree.toJSON())).toContain('real content');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain('Expo Go');
  });
});
