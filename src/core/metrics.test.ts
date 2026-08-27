import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { Platform, RadiusSourceHistogram, RendererKind, SkeletonMetrics } from './types';
import {
  DEFAULT_BUDGET_MS,
  DEFAULT_MAX_SHAPES,
  checkBudgets,
  emitBudgetWarnings,
  formatBudgetWarning,
  formatShapeCapWarning,
} from './metrics';

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
    };
    expect(Object.values(histogram).reduce((a, b) => a + b, 0)).toBe(10);
  });
});
