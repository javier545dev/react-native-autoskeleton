// src/core/list.test.ts
//
// Phase 6 (tasks.md 6.1-6.4): RED-first tests for the pure "policy" layer
// behind virtualized-list skeletons — ADR-13's "zero traversal on bind"
// hard rule, proven here as a deterministic property of pure functions,
// independent of any React/RN runtime (this repo has no DOM/RN renderer
// available to Vitest — see vitest.config.ts's 'node' environment note).
// `src/native/list/*` is the thin React wrapper Vitest cannot exercise
// directly; native E2E proves that wiring. This file proves the DECISION
// logic the wrapper defers to.

import { describe, expect, it } from 'vitest';
import {
  createTemplateRegistry,
  createTraversalCounter,
  decideCellBind,
  FALLBACK_CELL_SHAPES,
  buildSyntheticRowKeys,
  MAX_MEASUREMENT_ATTEMPTS,
} from './list';

describe('createTemplateRegistry', () => {
  it('starts every itemType idle', () => {
    const registry = createTemplateRegistry();
    expect(registry.stateFor('feedCard')).toBe('idle');
  });

  it('tracks scheduled and measured transitions per itemType independently', () => {
    const registry = createTemplateRegistry();
    registry.markScheduled('feedCard');
    expect(registry.stateFor('feedCard')).toBe('scheduled');
    expect(registry.stateFor('promoCard')).toBe('idle');

    registry.markMeasured('feedCard');
    expect(registry.stateFor('feedCard')).toBe('measured');
    expect(registry.stateFor('promoCard')).toBe('idle');
  });

  it('reset(itemType) reverts a single itemType back to idle', () => {
    const registry = createTemplateRegistry();
    registry.markScheduled('feedCard');
    registry.markScheduled('promoCard');
    registry.reset('feedCard');
    expect(registry.stateFor('feedCard')).toBe('idle');
    expect(registry.stateFor('promoCard')).toBe('scheduled');
  });

  it('reset() with no argument clears every itemType', () => {
    const registry = createTemplateRegistry();
    registry.markScheduled('feedCard');
    registry.markScheduled('promoCard');
    registry.reset();
    expect(registry.stateFor('feedCard')).toBe('idle');
    expect(registry.stateFor('promoCard')).toBe('idle');
  });
});

// Adversarial-review defect (2026-08-28, useTemplateMeasurement.ts): a
// FlashList cell recycled to a different itemType mid-measurement — or a
// genuine unmount — used to leave that itemType stuck at 'scheduled'
// FOREVER, because the only registry mutation the hook's cleanup path ever
// performed was NONE: `markMeasured` only ran inside `finish()`, which a
// cancelled effect never reaches. `decideCellBind` requires 'idle' to ever
// schedule again, so `FallbackSkeletonBlock` rendered for that itemType for
// the rest of the app session, across the whole app. No existing test
// covered unmount/recycle mid-measurement — every prior test let the
// measurement settle first.
describe('TemplateRegistry.releaseClaim — cancelled/recycled measurement releases its claim (adversarial-review defect)', () => {
  it('reverts a scheduled itemType back to idle so another cell can retry', () => {
    const registry = createTemplateRegistry();
    registry.markScheduled('feedCard');
    registry.releaseClaim('feedCard');
    expect(registry.stateFor('feedCard')).toBe('idle');
  });

  it('THE direct proof: a cancelled claim unblocks decideCellBind for the very next bind', () => {
    const registry = createTemplateRegistry();
    const itemType = 'feedCard';
    // Cell A claims the itemType synchronously during render (mirrors the
    // hook's own render-body `registry.markScheduled(itemType)`).
    registry.markScheduled(itemType);
    // Cell A is recycled to a different itemType (or unmounted) before its
    // deferred measurement ever resolves — the hook's cleanup effect must
    // release the claim.
    registry.releaseClaim(itemType);
    // Cell B (or Cell A re-bound after recycling) may now retry — this is
    // the exact assertion that was `false` forever pre-fix.
    const decision = decideCellBind(false, registry.stateFor(itemType), registry.attemptsFor(itemType));
    expect(decision.shouldScheduleTemplateMeasurement).toBe(true);
  });

  it('is a no-op for an itemType that already resolved to measured — never un-measures a real success', () => {
    const registry = createTemplateRegistry();
    registry.markScheduled('feedCard');
    registry.markMeasured('feedCard');
    registry.releaseClaim('feedCard');
    expect(registry.stateFor('feedCard')).toBe('measured');
  });

  it('is a no-op for an itemType still idle', () => {
    const registry = createTemplateRegistry();
    registry.releaseClaim('feedCard');
    expect(registry.stateFor('feedCard')).toBe('idle');
  });
});

// Second poisoning path from the same adversarial-review report: the
// give-up branches (template never laid out; RAF retries exhausted) used to
// call `finish()` -> `markMeasured(itemType)` WITHOUT ever writing a cache
// entry — masquerading a failure as a success and permanently blocking any
// future retry, even by a different, valid cell instance.
describe("TemplateRegistry.markFailed — 'gave up' is distinct from 'measured' (adversarial-review defect)", () => {
  it('does NOT masquerade as measured', () => {
    const registry = createTemplateRegistry();
    registry.markScheduled('feedCard');
    registry.markFailed('feedCard');
    expect(registry.stateFor('feedCard')).toBe('failed');
    expect(registry.stateFor('feedCard')).not.toBe('measured');
  });

  it('tracks a per-itemType attempt count, independent of other itemTypes', () => {
    const registry = createTemplateRegistry();
    registry.markScheduled('feedCard');
    registry.markFailed('feedCard');
    expect(registry.attemptsFor('feedCard')).toBe(1);
    expect(registry.attemptsFor('promoCard')).toBe(0);
  });

  it('decideCellBind allows a bounded retry from a failed state', () => {
    const registry = createTemplateRegistry();
    registry.markScheduled('feedCard');
    registry.markFailed('feedCard');
    const decision = decideCellBind(false, registry.stateFor('feedCard'), registry.attemptsFor('feedCard'));
    expect(decision.shouldScheduleTemplateMeasurement).toBe(true);
  });

  it('stops retrying once MAX_MEASUREMENT_ATTEMPTS is reached — an observable ceiling, never a silent infinite retry loop', () => {
    const registry = createTemplateRegistry();
    const itemType = 'feedCard';
    for (let i = 0; i < MAX_MEASUREMENT_ATTEMPTS; i++) {
      registry.markScheduled(itemType);
      registry.markFailed(itemType);
    }
    expect(registry.attemptsFor(itemType)).toBe(MAX_MEASUREMENT_ATTEMPTS);
    const decision = decideCellBind(false, registry.stateFor(itemType), registry.attemptsFor(itemType));
    expect(decision.shouldScheduleTemplateMeasurement).toBe(false);
  });

  it('a cache hit never schedules a retry, even from a failed state under budget', () => {
    const registry = createTemplateRegistry();
    registry.markScheduled('feedCard');
    registry.markFailed('feedCard');
    const decision = decideCellBind(true, registry.stateFor('feedCard'), registry.attemptsFor('feedCard'));
    expect(decision.shouldScheduleTemplateMeasurement).toBe(false);
  });
});

describe('decideCellBind — REQ-LIST-CELL-1 / ADR-13 zero-traversal-on-bind', () => {
  it('never schedules a template measurement when the bind is already a cache hit', () => {
    expect(decideCellBind(true, 'idle', 0).shouldScheduleTemplateMeasurement).toBe(false);
    expect(decideCellBind(true, 'scheduled', 0).shouldScheduleTemplateMeasurement).toBe(false);
    expect(decideCellBind(true, 'measured', 0).shouldScheduleTemplateMeasurement).toBe(false);
  });

  it('schedules exactly once for an unseen itemType: true only while idle', () => {
    expect(decideCellBind(false, 'idle', 0).shouldScheduleTemplateMeasurement).toBe(true);
    expect(decideCellBind(false, 'scheduled', 0).shouldScheduleTemplateMeasurement).toBe(false);
    expect(decideCellBind(false, 'measured', 0).shouldScheduleTemplateMeasurement).toBe(false);
  });

  it('THE direct proof: simulating N rebinds of an unseen itemType schedules a template measurement exactly once', () => {
    const registry = createTemplateRegistry();
    const itemType = 'promoCard';
    let scheduleCount = 0;

    for (let i = 0; i < 50; i++) {
      const cacheHit = false; // never resolves mid-loop in this simulation
      const decision = decideCellBind(cacheHit, registry.stateFor(itemType), registry.attemptsFor(itemType));
      if (decision.shouldScheduleTemplateMeasurement) {
        registry.markScheduled(itemType);
        scheduleCount += 1;
      }
    }

    expect(scheduleCount).toBe(1);
  });

  it('THE direct proof: once cached, N rebinds never schedule and never traverse', () => {
    const registry = createTemplateRegistry();
    const itemType = 'feedCard';
    registry.markScheduled(itemType);
    registry.markMeasured(itemType);
    let scheduleCount = 0;

    for (let i = 0; i < 50; i++) {
      const decision = decideCellBind(true, registry.stateFor(itemType), registry.attemptsFor(itemType));
      if (decision.shouldScheduleTemplateMeasurement) {
        scheduleCount += 1;
      }
    }

    expect(scheduleCount).toBe(0);
  });
});

describe('createTraversalCounter', () => {
  it('starts at zero and only changes via increment/reset', () => {
    const counter = createTraversalCounter();
    expect(counter.count).toBe(0);
    counter.increment();
    counter.increment();
    expect(counter.count).toBe(2);
    counter.reset();
    expect(counter.count).toBe(0);
  });
});

describe('buildSyntheticRowKeys — REQ-LIST-EMPTY-1/REQ-LIST-PAGE-1', () => {
  it('builds exactly estimatedCount stable, order-stable keys', () => {
    expect(buildSyntheticRowKeys(6, 'feedCard')).toEqual([
      'feedCard-0',
      'feedCard-1',
      'feedCard-2',
      'feedCard-3',
      'feedCard-4',
      'feedCard-5',
    ]);
  });

  it('clamps a negative or fractional count to a safe non-negative integer', () => {
    expect(buildSyntheticRowKeys(-3, 'x')).toEqual([]);
    expect(buildSyntheticRowKeys(2.9, 'x')).toEqual(['x-0', 'x-1']);
  });
});

describe('FALLBACK_CELL_SHAPES — REQ-LIST-CELL-1 unseen-itemType fallback', () => {
  it('is a deterministic, non-empty, generic shape set', () => {
    expect(FALLBACK_CELL_SHAPES.length).toBeGreaterThan(0);
    for (const shape of FALLBACK_CELL_SHAPES) {
      expect(shape.w).toBeGreaterThan(0);
      expect(shape.h).toBeGreaterThan(0);
    }
  });
});
