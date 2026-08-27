// test/native/sensor.test.ts
//
// Task 5.1 (tasks.md Phase 5): the native `Sensor<NativeSensorTarget>`
// adapter, against a mocked native module (no `react-native` import needed
// here — `sensor.ts` only type-imports `Spec`).

import { describe, expect, it, vi } from 'vitest';
import type { ShapeCacheKey } from '../../src/core/cache-key';
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
    expect(getShapes).toHaveBeenCalledWith(77, OPTIONS.key);
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
