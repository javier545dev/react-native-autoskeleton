// test/native/sensor.test.ts
//
// Task 5.1 (tasks.md Phase 5): the native `Sensor<NativeSensorTarget>`
// adapter, against a mocked native module (no `react-native` import needed
// here — `sensor.ts` only type-imports `Spec`).

import { describe, expect, it, vi } from 'vitest';
import type { ShapeCacheKey } from '../../src/core/cache-key';
import { WireMalformedLengthError } from '../../src/core/wire';
import { createEmptyHintRegistry, createNativeSensor } from '../../src/native/sensor';

function wireArrayFor(shapes: readonly [number, number, number, number, number][]): number[] {
  const out: number[] = [1];
  for (const [x, y, w, h, r] of shapes) out.push(x, y, w, h, r);
  return out;
}

const OPTIONS = {
  key: 'v1|k|-|375|1|ltr|ios' as ShapeCacheKey,
  hints: createEmptyHintRegistry(),
  budgetMs: 2,
  maxShapes: 60,
  defaultRadius: 4,
  collectDebugSidecars: false,
};

describe('createNativeSensor (task 5.1)', () => {
  it('resolves the native module lazily per-call, never at construction time', () => {
    const getNativeModule = vi.fn().mockReturnValue(null);
    createNativeSensor({ platform: 'ios', getNativeModule });
    expect(getNativeModule).not.toHaveBeenCalled();
  });

  it('returns null when the native module is unavailable (ADR-15, Expo Go)', () => {
    const sensor = createNativeSensor({ platform: 'android', getNativeModule: () => null });
    expect(sensor.measure({ reactTag: 5, frameWidth: 100, frameHeight: 50 }, OPTIONS)).toBeNull();
  });

  it('passes reactTag and cacheKey straight through to getShapes exactly once', () => {
    const getShapes = vi.fn().mockReturnValue(wireArrayFor([[0, 0, 10, 10, 2]]));
    const sensor = createNativeSensor({
      platform: 'ios',
      getNativeModule: () => ({ getShapes, evictShapes: vi.fn() }),
    });
    sensor.measure({ reactTag: 77, frameWidth: 375, frameHeight: 800 }, OPTIONS);
    expect(getShapes).toHaveBeenCalledTimes(1);
    expect(getShapes).toHaveBeenCalledWith(77, OPTIONS.key, {
      defaultRadius: OPTIONS.defaultRadius,
      budgetMs: OPTIONS.budgetMs,
      maxShapes: OPTIONS.maxShapes,
      collectDebugSidecars: OPTIONS.collectDebugSidecars,
      hints: [],
    });
  });

  // Phase-5-remediation (post-7.2 gap closure): proves the CALLER's real
  // SensorOptions scalars arrive at the native call verbatim, not compiled
  // defaults. Uses values that all differ from `OPTIONS` above (and from
  // the native compiled defaults: Android `budgetMs=2/maxShapes=60/
  // defaultRadius=0`, iOS `budgetMs=2/maxShapes=60/defaultRadius=0`) so a
  // regression that silently drops back to defaults cannot pass this
  // assertion by accident.
  it('forwards a non-default defaultRadius/budgetMs/maxShapes/collectDebugSidecars set to native getShapes unchanged', () => {
    const getShapes = vi.fn().mockReturnValue(wireArrayFor([[0, 0, 10, 10, 2]]));
    const sensor = createNativeSensor({
      platform: 'android',
      getNativeModule: () => ({ getShapes, evictShapes: vi.fn() }),
    });
    const nonDefaultOptions = {
      ...OPTIONS,
      defaultRadius: 16,
      budgetMs: 4,
      maxShapes: 1,
      collectDebugSidecars: true,
    };

    sensor.measure({ reactTag: 9, frameWidth: 375, frameHeight: 800 }, nonDefaultOptions);

    expect(getShapes).toHaveBeenCalledWith(9, nonDefaultOptions.key, {
      defaultRadius: 16,
      budgetMs: 4,
      maxShapes: 1,
      collectDebugSidecars: true,
      hints: [],
    });
  });

  // Typed-hint channel: `target.hintEntries` (the raw, serializable snapshot
  // from `core/hint-registry.ts`) is marshaled verbatim into `config.hints` —
  // the ONLY channel that can carry hint DATA across the Turbo Module
  // boundary, since `SensorOptions.hints` (a `HintRegistry` of live
  // functions) cannot cross it at all.
  it('marshals target.hintEntries into config.hints, applying the lines=0/radius=-1 "no override" sentinels', () => {
    const getShapes = vi.fn().mockReturnValue(wireArrayFor([[0, 0, 10, 10, 2]]));
    const sensor = createNativeSensor({
      platform: 'ios',
      getNativeModule: () => ({ getShapes, evictShapes: vi.fn() }),
    });
    sensor.measure(
      {
        reactTag: 77,
        frameWidth: 375,
        frameHeight: 800,
        hintEntries: [
          { nodeId: 'title', lines: 3, radius: 8 },
          { nodeId: 'avatar', radius: 24 },
          { nodeId: 'subtitle', lines: 2 },
        ],
      },
      OPTIONS,
    );
    expect(getShapes).toHaveBeenCalledWith(
      77,
      OPTIONS.key,
      expect.objectContaining({
        hints: [
          { nodeId: 'title', lines: 3, radius: 8 },
          { nodeId: 'avatar', lines: 0, radius: 24 },
          { nodeId: 'subtitle', lines: 2, radius: -1 },
        ],
      }),
    );
  });

  it('defaults config.hints to an empty array when the target carries no hintEntries', () => {
    const getShapes = vi.fn().mockReturnValue(wireArrayFor([[0, 0, 10, 10, 2]]));
    const sensor = createNativeSensor({
      platform: 'ios',
      getNativeModule: () => ({ getShapes, evictShapes: vi.fn() }),
    });
    sensor.measure({ reactTag: 1, frameWidth: 375, frameHeight: 800 }, OPTIONS);
    expect(getShapes).toHaveBeenCalledWith(1, OPTIONS.key, expect.objectContaining({ hints: [] }));
  });

  it('decodes the wire array into a ShapeSnapshot carrying the caller-supplied frame size', () => {
    const getShapes = vi.fn().mockReturnValue(wireArrayFor([[1, 2, 3, 4, 5], [10, 20, 30, 40, 0]]));
    const sensor = createNativeSensor({
      platform: 'android',
      getNativeModule: () => ({ getShapes, evictShapes: vi.fn() }),
    });
    const result = sensor.measure({ reactTag: 1, frameWidth: 375, frameHeight: 812 }, OPTIONS);
    expect(result).not.toBeNull();
    expect(result!.snapshot.key).toBe(OPTIONS.key);
    expect(result!.snapshot.frameWidth).toBe(375);
    expect(result!.snapshot.frameHeight).toBe(812);
    expect(result!.snapshot.data).toBeInstanceOf(Float32Array);
    expect(Array.from(result!.snapshot.data)).toEqual([1, 1, 2, 3, 4, 5, 10, 20, 30, 40, 0]);
  });

  // Adversarial-review defect: `const n = (fetched.data.length - 1) / 5` had
  // no assertion that `(fetched.data.length - 1) % 5 === 0` — a truncated
  // native payload (e.g. a header plus a partial shape) yielded a
  // FRACTIONAL `n`, and the loop below it then read past the shapes the
  // buffer actually holds, propagating `NaN` geometry silently. The
  // non-null assertions (`fetched.data[off]!`) are compile-time only and
  // catch nothing at runtime.
  it('throws WireMalformedLengthError instead of computing a fractional shape count from a truncated wire array', () => {
    // 4 elements total: 1 version slot + 3 stray values — not a whole
    // 5-wide shape. (4 - 1) / 5 = 0.6.
    const getShapes = vi.fn().mockReturnValue([1, 0, 0, 10]);
    const sensor = createNativeSensor({
      platform: 'ios',
      getNativeModule: () => ({ getShapes, evictShapes: vi.fn() }),
    });
    expect(() => sensor.measure({ reactTag: 1, frameWidth: 100, frameHeight: 50 }, OPTIONS)).toThrow(
      WireMalformedLengthError,
    );
  });

  it('does not throw for a genuinely well-formed wire array (regression guard on the new congruence check)', () => {
    const getShapes = vi.fn().mockReturnValue(wireArrayFor([[0, 0, 10, 10, 2], [5, 5, 8, 8, 1]]));
    const sensor = createNativeSensor({
      platform: 'ios',
      getNativeModule: () => ({ getShapes, evictShapes: vi.fn() }),
    });
    expect(() =>
      sensor.measure({ reactTag: 1, frameWidth: 100, frameHeight: 50 }, OPTIONS),
    ).not.toThrow();
  });

  it('returns null when the traversal target was not laid out yet (native reports an empty array)', () => {
    const getShapes = vi.fn().mockReturnValue([]);
    const sensor = createNativeSensor({
      platform: 'ios',
      getNativeModule: () => ({ getShapes, evictShapes: vi.fn() }),
    });
    expect(sensor.measure({ reactTag: 1, frameWidth: 0, frameHeight: 0 }, OPTIONS)).toBeNull();
  });

  it('observe() returns a stable no-op unsubscribe (invalidation is driven by cacheKey rotation, not a native channel)', () => {
    const sensor = createNativeSensor({ platform: 'ios', getNativeModule: () => null });
    const unsubscribe = sensor.observe({ reactTag: 1, frameWidth: 0, frameHeight: 0 }, () => undefined);
    expect(() => unsubscribe()).not.toThrow();
  });

  it('exposes the configured platform', () => {
    expect(createNativeSensor({ platform: 'ios', getNativeModule: () => null }).platform).toBe('ios');
    expect(createNativeSensor({ platform: 'android', getNativeModule: () => null }).platform).toBe('android');
  });
});
