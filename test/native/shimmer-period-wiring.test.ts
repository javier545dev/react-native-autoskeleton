// test/native/shimmer-period-wiring.test.ts
//
// ADR-8 arbitration, NATIVE half. `src/core/shimmer-period.test.ts` pins the
// arbiter itself; this file pins that the native render path actually ROUTES
// `speedMs` through it, which is the part that was broken.
//
// `SyntheticRow` is the single funnel every list sub-case goes through
// (`SkeletonList` -> initial load, `SkeletonListFooter` -> pagination,
// `SkeletonCell` -> per-cell), and it is hook-free, so it can be called
// directly as a plain function — the same technique
// `template-measurement-host.test.ts` already established here (no RN test
// renderer exists under Vitest's node environment; see vitest.config.ts).

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { ShapeCacheKey } from '../../src/core/cache-key';

vi.mock('react-native', () => ({
  StyleSheet: { create: (styles: Record<string, unknown>) => styles, absoluteFill: {} },
  View: 'View',
}));

const fakeOverlayComponent = 'AutoskeletonOverlayView';

vi.mock('../../src/native/renderer/AutoskeletonOverlayHostComponent', () => ({
  resolveAutoskeletonOverlayNativeComponent: () => fakeOverlayComponent,
}));

interface RenderedElement {
  readonly props: {
    readonly children?: RenderedElement | RenderedElement[];
    readonly speedMs?: number;
  };
}

function overlaySpeedMs(element: unknown): number | undefined {
  const root = element as RenderedElement;
  const children = root.props.children;
  const child = Array.isArray(children) ? children[0] : children;
  return child?.props.speedMs;
}

describe('SyntheticRow — ADR-8 shared-period arbitration on the native path', () => {
  let warnSpy: MockInstance<(...args: unknown[]) => void>;

  // `vi.resetModules()` gives each test a FRESH module graph, which is also
  // a fresh shared-period adoption — deliberately reset through the real
  // module boundary rather than a test-only escape hatch, so this file keeps
  // proving the production wiring and nothing else.
  beforeEach(() => {
    vi.resetModules();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined) as unknown as MockInstance<
      (...args: unknown[]) => void
    >;
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  async function renderRow(speedMs: number): Promise<unknown> {
    const { SyntheticRow } = await import('../../src/native/list/SyntheticRow');
    return SyntheticRow({
      snapshot: {
        key: 'v1|k|-|375|1|ltr|ios' as ShapeCacheKey,
        version: 1,
        capturedAt: 0,
        frameWidth: 100,
        frameHeight: 40,
        data: Float32Array.from([1, 0, 0, 100, 40, 0]),
        degraded: [],
      },
      cacheKey: 'k',
      animation: 'shimmer',
      reducedMotion: false,
      baseColor: '#e2e2e2',
      highlightColor: '#f5f5f5',
      defaultRadius: 4,
      speedMs,
    });
  }

  it('forwards the FIRST theme’s speedMs to the native overlay unchanged', async () => {
    expect(overlaySpeedMs(await renderRow(600))).toBe(600);
  });

  it('forwards the ADOPTED period for a second theme asking for a different speedMs', async () => {
    await renderRow(600);
    expect(overlaySpeedMs(await renderRow(900))).toBe(600);
  });

  it('warns once when a second theme’s speedMs cannot be honoured', async () => {
    await renderRow(600);
    await renderRow(900);
    await renderRow(900);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = String(warnSpy.mock.calls[0]?.[0]);
    expect(message).toContain('900');
    expect(message).toContain('600');
  });
});
