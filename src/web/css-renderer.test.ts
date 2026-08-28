// src/web/css-renderer.test.ts
//
// tasks.md 2.2: pure, DOM-free parts of the CSS renderer — the generated
// stylesheet text and the `ShimmerClock` phase math — are ordinary
// deterministic functions and are unit-tested here under Vitest/node. The
// DOM-mounting half of the renderer (clip-path application, class toggling,
// reduced-motion pixel diff) needs real layout and lives in
// test/web/css-renderer.spec.ts (Playwright), never here (plan.md §7.3).

import { describe, expect, it } from 'vitest';
import { buildShimmerStylesheet, createShimmerClock } from './css-renderer';

describe('buildShimmerStylesheet (ADR-6/ADR-7)', () => {
  const css = buildShimmerStylesheet();

  it('never contains background-position (ADR-6 CSS-output half)', () => {
    expect(css.toLowerCase()).not.toContain('background-position');
  });

  it('only animates transform (shimmer) and opacity (pulse)', () => {
    const shimmerKeyframes = /@keyframes askl-shimmer\{([^}]+\}[^}]*)\}/.exec(css)?.[0] ?? '';
    expect(shimmerKeyframes).toContain('transform');
    expect(shimmerKeyframes).not.toContain('background-position');

    const pulseKeyframes = /@keyframes askl-pulse\{([^}]+\}[^}]*)\}/.exec(css)?.[0] ?? '';
    expect(pulseKeyframes).toContain('opacity');
    expect(pulseKeyframes).not.toContain('background-position');
  });

  it('is a single static stylesheet with no per-instance keyframe variants', () => {
    expect(css.match(/@keyframes/g)?.length).toBe(2);
  });
});

describe('createShimmerClock (plan.md §3.6)', () => {
  it('has a css driver and the requested period', () => {
    const clock = createShimmerClock(2000);
    expect(clock.driver).toBe('css');
    expect(clock.periodMs).toBe(2000);
  });

  it('phaseAt is 0 at startedAt and wraps every period', () => {
    const clock = createShimmerClock(1000);
    expect(clock.phaseAt(clock.startedAt)).toBeCloseTo(0, 5);
    expect(clock.phaseAt(clock.startedAt + 500)).toBeCloseTo(0.5, 5);
    expect(clock.phaseAt(clock.startedAt + 1000)).toBeCloseTo(0, 5);
    expect(clock.phaseAt(clock.startedAt + 1500)).toBeCloseTo(0.5, 5);
  });

  it('phaseOffsetMs is always within [0, periodMs)', () => {
    const clock = createShimmerClock(750);
    for (const delta of [0, 100, 749, 750, 1500, 3001]) {
      const offset = clock.phaseOffsetMs(clock.startedAt + delta);
      expect(offset).toBeGreaterThanOrEqual(0);
      expect(offset).toBeLessThan(750);
    }
  });

  it('setPeriod changes periodMs', () => {
    const clock = createShimmerClock(1000);
    clock.setPeriod(500);
    expect(clock.periodMs).toBe(500);
  });

  it('pause then resume preserves the phase instead of jumping', () => {
    const clock = createShimmerClock(1000);
    const phaseBeforePause = clock.phaseAt(clock.startedAt + 300);
    clock.pause();
    clock.resume();
    // Resuming immediately (no real time elapsed while "paused" in this
    // synchronous test) must not shift `startedAt` at all.
    expect(clock.phaseAt(clock.startedAt + 300)).toBeCloseTo(phaseBeforePause, 5);
  });

  it('subscribe returns an unsubscribe function (dev/test-only seam)', () => {
    const clock = createShimmerClock(1000);
    const unsubscribe = clock.subscribe(() => {});
    expect(typeof unsubscribe).toBe('function');
    unsubscribe();
  });
});
