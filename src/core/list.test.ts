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

describe('decideCellBind — REQ-LIST-CELL-1 / ADR-13 zero-traversal-on-bind', () => {
  it('never schedules a template measurement when the bind is already a cache hit', () => {
    expect(decideCellBind(true, 'idle').shouldScheduleTemplateMeasurement).toBe(false);
    expect(decideCellBind(true, 'scheduled').shouldScheduleTemplateMeasurement).toBe(false);
    expect(decideCellBind(true, 'measured').shouldScheduleTemplateMeasurement).toBe(false);
  });

  it('schedules exactly once for an unseen itemType: true only while idle', () => {
    expect(decideCellBind(false, 'idle').shouldScheduleTemplateMeasurement).toBe(true);
    expect(decideCellBind(false, 'scheduled').shouldScheduleTemplateMeasurement).toBe(false);
    expect(decideCellBind(false, 'measured').shouldScheduleTemplateMeasurement).toBe(false);
  });

  it('THE direct proof: simulating N rebinds of an unseen itemType schedules a template measurement exactly once', () => {
    const registry = createTemplateRegistry();
    const itemType = 'promoCard';
    let scheduleCount = 0;

    for (let i = 0; i < 50; i++) {
      const cacheHit = false; // never resolves mid-loop in this simulation
      const decision = decideCellBind(cacheHit, registry.stateFor(itemType));
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
      const decision = decideCellBind(true, registry.stateFor(itemType));
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
