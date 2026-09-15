import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { Platform, RadiusSourceHistogram, RendererKind, SkeletonMetrics } from './types';
import { RADIUS_SOURCES } from './types';
import {
  DEFAULT_BUDGET_MS,
  DEFAULT_MAX_SHAPES,
  DEFAULT_RADIUS_FALLBACK_SHARE,
  checkBudgets,
  checkRadiusFallback,
  emitBudgetWarnings,
  emitRadiusFallbackWarning,
  formatBudgetWarning,
  formatRadiusFallbackWarning,
  formatShapeCapWarning,
} from './metrics';

/** Builds a `radiusSources` dev sidecar with `defaultCount` shapes resolved
 *  via the `default` rung and the remainder via `outline` — mirrors what a
 *  real sensor writes (index-aligned `Uint8Array`, `RADIUS_SOURCES.indexOf`). */
function buildRadiusSources(defaultCount: number, otherCount: number): Uint8Array {
  const defaultIndex = RADIUS_SOURCES.indexOf('default');
  const outlineIndex = RADIUS_SOURCES.indexOf('outline');
  return Uint8Array.from([
    ...Array<number>(defaultCount).fill(defaultIndex),
    ...Array<number>(otherCount).fill(outlineIndex),
  ]);
}

// Task 1.6 (tasks.md Phase 1): this module emits onMetrics/REQ-OBS-BUDGET-1
// warnings — this task IS the observability deliverable.

describe('budget constants match spec §3 exactly', () => {
  it('defaults budgetMs to 2 and maxShapes to 60 (NFR-3 / REQ-OBS-BUDGET-1)', () => {
    expect(DEFAULT_BUDGET_MS).toBe(2);
    expect(DEFAULT_MAX_SHAPES).toBe(60);
  });
});

describe('REQ-OBS-BUDGET-1 — traversal exceeds the default time budget', () => {
  it('formats an actionable warning citing the measured time, the budget, and a suggestion', () => {
    const message = formatBudgetWarning(3.4, 2);
    expect(message).toContain('3.4');
    expect(message).toContain('2');
    expect(message.toLowerCase()).toContain('ignore');
  });

  it('checkBudgets reports budgetExceeded: true for a 3.4ms traversal against a 2ms budget', () => {
    const result = checkBudgets(3.4, 10, { budgetMs: 2, maxShapes: 60 });
    expect(result.budgetExceeded).toBe(true);
    expect(result.warnings.some((w) => w.includes('3.4') && w.includes('2'))).toBe(true);
  });

  it('does not warn when traversal stays within budget', () => {
    const result = checkBudgets(1, 10, { budgetMs: 2, maxShapes: 60 });
    expect(result.budgetExceeded).toBe(false);
    expect(result.warnings).toEqual([]);
  });
});

describe('REQ-OBS-BUDGET-1 — shape count exceeds the default budget', () => {
  it('formats an actionable warning citing the measured count, the budget, and a suggestion', () => {
    const message = formatShapeCapWarning(74, 60);
    expect(message).toContain('74');
    expect(message).toContain('60');
    expect(message.toLowerCase()).toContain('ignore');
  });

  it('checkBudgets reports shapeCapExceeded: true for 74 shapes against a 60-shape budget', () => {
    const result = checkBudgets(1, 74, { budgetMs: 2, maxShapes: 60 });
    expect(result.shapeCapExceeded).toBe(true);
    expect(result.warnings.some((w) => w.includes('74') && w.includes('60'))).toBe(true);
  });
});

describe('emitBudgetWarnings — dev-build console emission', () => {
  it('logs every warning via console.warn', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    emitBudgetWarnings({ budgetExceeded: true, shapeCapExceeded: false, warnings: ['a', 'b'] });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenNthCalledWith(1, 'a');
    expect(spy).toHaveBeenNthCalledWith(2, 'b');
    spy.mockRestore();
  });
});

describe('REQ-OBS-BUDGET-2 — radius fallback share exceeds the configured threshold', () => {
  it('defaults the fallback share threshold to 30%', () => {
    expect(DEFAULT_RADIUS_FALLBACK_SHARE).toBe(0.3);
  });

  it('formats an actionable warning citing counts, percentage, threshold, and the remedy', () => {
    const message = formatRadiusFallbackWarning(18, 20, 0.9, 0.3);
    expect(message).toContain('18');
    expect(message).toContain('20');
    expect(message).toContain('90');
    expect(message).toContain('30');
    expect(message.toLowerCase()).toContain('radius');
    expect(message).toContain('SkeletonProvider.defaultRadius');
  });

  it('checkRadiusFallback reports shareExceeded: true for 18/20 default-rung shapes (90% > 30%)', () => {
    const result = checkRadiusFallback(buildRadiusSources(18, 2), { radiusFallbackShare: 0.3 });
    expect(result.shareExceeded).toBe(true);
    expect(result.defaultCount).toBe(18);
    expect(result.totalCount).toBe(20);
    expect(result.share).toBeCloseTo(0.9, 5);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('18/20');
  });

  it('does NOT fire when the share is at or below the threshold (6/20 = exactly 30%)', () => {
    const result = checkRadiusFallback(buildRadiusSources(6, 14), { radiusFallbackShare: 0.3 });
    expect(result.shareExceeded).toBe(false);
    expect(result.warnings).toEqual([]);
  });

  it('reports no shapes/no warning when the radiusSources sidecar is absent', () => {
    const result = checkRadiusFallback(undefined, { radiusFallbackShare: 0.3 });
    expect(result.shareExceeded).toBe(false);
    expect(result.totalCount).toBe(0);
    expect(result.defaultCount).toBe(0);
    expect(result.warnings).toEqual([]);
  });
});

describe('emitRadiusFallbackWarning — dev-build console emission', () => {
  it('logs the warning via console.warn when the share is exceeded', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = checkRadiusFallback(buildRadiusSources(18, 2), { radiusFallbackShare: 0.3 });
    emitRadiusFallbackWarning(result);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(result.warnings[0]);
    spy.mockRestore();
  });

  it('logs nothing when the share was not exceeded', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = checkRadiusFallback(buildRadiusSources(1, 19), { radiusFallbackShare: 0.3 });
    emitRadiusFallbackWarning(result);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('SkeletonMetrics — base 7 onMetrics fields (spec §2.1) are typed', () => {
  it('types traversalMs, shapeCount, cacheHit, ttfsMs, displayDurationMs, platform, renderer', () => {
    expectTypeOf<SkeletonMetrics['traversalMs']>().toEqualTypeOf<number>();
    expectTypeOf<SkeletonMetrics['shapeCount']>().toEqualTypeOf<number>();
    expectTypeOf<SkeletonMetrics['cacheHit']>().toEqualTypeOf<boolean>();
    expectTypeOf<SkeletonMetrics['ttfsMs']>().toEqualTypeOf<number>();
    expectTypeOf<SkeletonMetrics['displayDurationMs']>().toEqualTypeOf<number>();
    expectTypeOf<SkeletonMetrics['platform']>().toEqualTypeOf<Platform>();
    expectTypeOf<SkeletonMetrics['renderer']>().toEqualTypeOf<RendererKind>();
  });

  it('types radiusSourceHistogram as a readonly RadiusSource -> number record', () => {
    expectTypeOf<SkeletonMetrics['radiusSourceHistogram']>().toEqualTypeOf<RadiusSourceHistogram>();
    const histogram: RadiusSourceHistogram = {
      measured: 1,
      outline: 2,
      'raster-probe': 0,
      hint: 3,
      default: 4,
      style: 5,
    };
    expect(Object.values(histogram).reduce((a, b) => a + b, 0)).toBe(15);
  });
});
