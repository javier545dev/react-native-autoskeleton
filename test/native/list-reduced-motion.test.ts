// test/native/list-reduced-motion.test.ts
//
// REQ-A11Y-3, on the components that reach the most pixels.
//
// `<AutoSkeleton>` reads the platform preference itself
// (`AccessibilityInfo` via `useReducedMotion`). The three list entry points
// did NOT: `SkeletonList`, `SkeletonListFooter` and `SkeletonCell` each took
// reduced motion as an OPTIONAL PROP and defaulted it to `false`
// (`props.reducedMotion ?? false`). A user with reduce-motion enabled at the
// OS level therefore got the full travelling shimmer in every list skeleton
// in the app unless the consumer happened to discover the prop and wire it by
// hand — an accessibility defect delivered through a silent default, which is
// the kind that never gets reported because it looks intentional.
//
// The prop stays supported (an explicit `false` must still force motion on,
// for a preview/storybook that wants it); it just stops being the ONLY source.
//
// Effects never run under `renderToStaticMarkup`, which is exactly right here:
// every assertion below is about what the component decides during render,
// from a preference that must be readable synchronously on first paint.

import { beforeEach, describe, expect, it, vi } from 'vitest';

let reduceMotionEnabled = false;

vi.mock('react-native', () => ({
  AccessibilityInfo: {
    isReduceMotionEnabled: () => Promise.resolve(reduceMotionEnabled),
    addEventListener: () => ({ remove: () => undefined }),
  },
  Animated: { Value: class {}, loop: () => ({ start() {}, stop() {} }), sequence: () => ({}), timing: () => ({}), View: 'AnimatedView' },
  findNodeHandle: () => 1,
  I18nManager: { isRTL: false },
  PixelRatio: { getFontScale: () => 1 },
  Platform: { OS: 'ios' },
  // Reached through `nativeModuleAccessor.ts`; the native module itself is
  // irrelevant here because `SyntheticRow` — the single funnel every list
  // sub-case reaches the overlay through — is mocked and captured below.
  TurboModuleRegistry: { get: () => null, getEnforcing: () => null },
  StyleSheet: {
    create: (styles: Record<string, unknown>) => styles,
    absoluteFill: {},
  },
  useWindowDimensions: () => ({ width: 375, height: 812 }),
  View: 'div',
}));

// The store itself is proved by `reduced-motion-store.test.ts`. Mocked here
// because `useSyncExternalStore` takes `getServerSnapshot` — a hard-coded
// `false` React Native never executes — under `renderToStaticMarkup`, so
// driving the real store through a server render would assert against that
// constant instead of against the components' wiring.
vi.mock('../../src/native/reducedMotion', () => ({
  useReducedMotion: () => reduceMotionEnabled,
}));

// The codegen'd spec module statically imports
// `react-native/Libraries/Utilities/codegenNativeComponent`, which is Flow
// source and unparseable under plain Vitest — mocked here for the same reason
// `test/native/overlay-host-component.test.ts` documents.
vi.mock('../../src/native/AutoskeletonOverlayNativeComponent', () => ({
  default: 'AutoskeletonOverlayView',
}));

/** Captures what each list entry point actually hands the row renderer —
 *  the single funnel all three reach the native overlay through. */
const rowProps: Array<Record<string, unknown>> = [];
vi.mock('../../src/native/list/SyntheticRow', () => ({
  SyntheticRow: (props: Record<string, unknown>) => {
    rowProps.push(props);
    return null;
  },
}));

async function render(element: unknown): Promise<void> {
  const { renderToStaticMarkup } = await import('react-dom/server');
  renderToStaticMarkup(element as React.ReactElement);
}

/** Drives the module-level `AccessibilityInfo.isReduceMotionEnabled()` promise
 *  to resolution before rendering, the way a real app's first paint follows a
 *  cold start by at least a microtask. */
async function settlePreference(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('list skeletons honour the PLATFORM reduce-motion preference by default', () => {
  beforeEach(() => {
    rowProps.length = 0;
    vi.resetModules();
  });

  it('SkeletonList: reduce-motion on, prop omitted -> rows are told reduced motion', async () => {
    reduceMotionEnabled = true;
    const { createElement } = await import('react');
    const { SkeletonList } = await import('../../src/native/list/SkeletonList');
    await settlePreference();
    await render(createElement(SkeletonList, { itemType: 'feedCard', estimatedCount: 2 }));
    expect(rowProps.length).toBeGreaterThan(0);
    for (const p of rowProps) {
      expect(p['reducedMotion']).toBe(true);
      expect(p['animation']).toBe('pulse');
    }
  });

  it('SkeletonListFooter: same default, same preference', async () => {
    reduceMotionEnabled = true;
    const { createElement } = await import('react');
    const { SkeletonListFooter } = await import('../../src/native/list/SkeletonListFooter');
    await settlePreference();
    await render(createElement(SkeletonListFooter, { itemType: 'feedCard', estimatedCount: 2 }));
    expect(rowProps.length).toBeGreaterThan(0);
    for (const p of rowProps) {
      expect(p['reducedMotion']).toBe(true);
    }
  });

  it('SkeletonCell: same default, same preference', async () => {
    reduceMotionEnabled = true;
    const { createElement } = await import('react');
    const { SkeletonCell } = await import('../../src/native/list/SkeletonCell');
    await settlePreference();
    await render(createElement(SkeletonCell, { itemType: 'feedCard' }));
    expect(rowProps.length).toBeGreaterThan(0);
    for (const p of rowProps) {
      expect(p['reducedMotion']).toBe(true);
    }
  });

  it('an EXPLICIT reducedMotion={false} still wins — the prop is not removed', async () => {
    reduceMotionEnabled = true;
    const { createElement } = await import('react');
    const { SkeletonList } = await import('../../src/native/list/SkeletonList');
    await settlePreference();
    await render(
      createElement(SkeletonList, { itemType: 'feedCard', estimatedCount: 1, reducedMotion: false }),
    );
    expect(rowProps[0]!['reducedMotion']).toBe(false);
    expect(rowProps[0]!['animation']).toBe('shimmer');
  });

  it('preference off: nothing changes for everyone else', async () => {
    reduceMotionEnabled = false;
    const { createElement } = await import('react');
    const { SkeletonList } = await import('../../src/native/list/SkeletonList');
    await settlePreference();
    await render(createElement(SkeletonList, { itemType: 'feedCard', estimatedCount: 1 }));
    expect(rowProps[0]!['reducedMotion']).toBe(false);
    expect(rowProps[0]!['animation']).toBe('shimmer');
  });

  it("animation='none' is never promoted into a pulse by the preference", async () => {
    reduceMotionEnabled = true;
    const { createElement } = await import('react');
    const { SkeletonList } = await import('../../src/native/list/SkeletonList');
    await settlePreference();
    await render(
      createElement(SkeletonList, { itemType: 'feedCard', estimatedCount: 1, animation: 'none' }),
    );
    expect(rowProps[0]!['animation']).toBe('none');
  });
});
