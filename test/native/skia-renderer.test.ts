// test/native/skia-renderer.test.ts
//
// Task 5.4: the parts of `SkiaRenderer.tsx` testable without mounting React
// or requiring either optional peer — `createSkiaTier2Renderer`'s metadata/
// availability delegation, and the pure per-shape stagger formula (plan.md
// §4.1: "order is meaningful … staggers withDelay by index").

import { describe, expect, it } from 'vitest';
import { createSkiaTier2Renderer, staggerDelayForIndex } from '../../src/native/tier2/SkiaRenderer';

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
