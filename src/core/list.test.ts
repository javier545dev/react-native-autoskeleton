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
import { composeCacheKey, type ShapeCacheKey } from './cache-key';
import {
  createTemplateRegistry,
  createTraversalCounter,
  decideCellBind,
  FALLBACK_CELL_SHAPES,
  buildSyntheticRowKeys,
  MAX_MEASUREMENT_ATTEMPTS,
} from './list';

// The registry is keyed by the COMPOSITE CACHE KEY (adversarial-review
// defect, 2026-08-29 — see `TemplateRegistry`'s doc comment). These helpers
// build REAL keys through `composeCacheKey` rather than casting a bare
// itemType string, so the tests exercise the same values production does.
function keyFor(itemType: string, viewportWidth = 390): ShapeCacheKey {
  return composeCacheKey({
    skeletonKey: itemType,
    itemType,
    viewportWidth,
    fontScale: 1,
    direction: 'ltr',
    platform: 'ios',
  });
}

const FEED = keyFor('feedCard');
const PROMO = keyFor('promoCard');

describe('createTemplateRegistry', () => {
  it('starts every itemType idle', () => {
    const registry = createTemplateRegistry();
    expect(registry.stateFor(FEED)).toBe('idle');
  });

  it('tracks scheduled and measured transitions per itemType independently', () => {
    const registry = createTemplateRegistry();
    registry.markScheduled(FEED);
    expect(registry.stateFor(FEED)).toBe('scheduled');
    expect(registry.stateFor(PROMO)).toBe('idle');

    registry.markMeasured(FEED);
    expect(registry.stateFor(FEED)).toBe('measured');
    expect(registry.stateFor(PROMO)).toBe('idle');
  });

  it('reset(itemType) reverts a single itemType back to idle', () => {
    const registry = createTemplateRegistry();
    registry.markScheduled(FEED);
    registry.markScheduled(PROMO);
    registry.reset(FEED);
    expect(registry.stateFor(FEED)).toBe('idle');
    expect(registry.stateFor(PROMO)).toBe('scheduled');
  });

  it('reset() with no argument clears every itemType', () => {
    const registry = createTemplateRegistry();
    registry.markScheduled(FEED);
    registry.markScheduled(PROMO);
    registry.reset();
    expect(registry.stateFor(FEED)).toBe('idle');
    expect(registry.stateFor(PROMO)).toBe('idle');
  });
});

// Adversarial-review defect (2026-08-29, useTemplateMeasurement.ts): the
// registry was keyed by `itemType` while the store it guards is keyed by the
// full composite key, so ONE `'measured'` mark suppressed measurement for
// every other cache key sharing that itemType — permanently, for the app
// session. This pins the CONTRACT (a registry entry belongs to one composite
// key) so a future "optimisation" that narrows the key back to an itemType
// goes red here as well as at `tsc`.
describe('TemplateRegistry — an entry belongs to ONE composite cache key, not to an itemType', () => {
  it('does not let a measured key suppress a sibling key with the same itemType', () => {
    // Two lists on one screen, same cell kind, different `skeletonKey` — the
    // exact shape `useSkeletonCell({ itemType, skeletonKey })` allows.
    const feedList = composeCacheKey({
      skeletonKey: 'feed',
      itemType: 'card',
      viewportWidth: 390,
      fontScale: 1,
      direction: 'ltr',
      platform: 'ios',
    });
    const searchList = composeCacheKey({
      skeletonKey: 'search',
      itemType: 'card',
      viewportWidth: 390,
      fontScale: 1,
      direction: 'ltr',
      platform: 'ios',
    });
    expect(feedList).not.toBe(searchList);

    const registry = createTemplateRegistry();
    registry.markScheduled(feedList);
    registry.markMeasured(feedList);

    expect(registry.stateFor(searchList)).toBe('idle');
    // 'idle' + a cache MISS is the only combination that ever schedules.
    expect(decideCellBind(false, registry.stateFor(searchList), registry.attemptsFor(searchList))).toEqual({
      shouldScheduleTemplateMeasurement: true,
    });
  });

  it('re-measures the same itemType after a cache-key dimension changes (rotation, font scale, RTL)', () => {
    // The commonest instance by far: one list, one itemType, a rotation that
    // crosses a `bucketWidth`. Under the old itemType keying the new width
    // was a cache MISS whose measurement the stale 'measured' mark blocked,
    // pinning the list to `FallbackSkeletonBlock` for good.
    const registry = createTemplateRegistry();
    const portrait = keyFor('feedCard', 390);
    const landscape = keyFor('feedCard', 768);
    expect(portrait).not.toBe(landscape);

    registry.markScheduled(portrait);
    registry.markMeasured(portrait);

    expect(registry.stateFor(landscape)).toBe('idle');
    expect(decideCellBind(false, registry.stateFor(landscape), registry.attemptsFor(landscape))).toEqual({
      shouldScheduleTemplateMeasurement: true,
    });
    // ...and the portrait key is still done, so rotating back allocates nothing.
    expect(decideCellBind(false, registry.stateFor(portrait), registry.attemptsFor(portrait))).toEqual({
      shouldScheduleTemplateMeasurement: false,
    });
  });

  it('still collapses N concurrent sibling binds of ONE list to a single claim (RISK-3 preserved)', () => {
    // The guarantee the itemType keying was there to provide. Siblings of one
    // list share one composite key, so it survives the re-keying untouched.
    const registry = createTemplateRegistry();
    const key = keyFor('feedCard');
    let claims = 0;
    for (let cell = 0; cell < 20; cell++) {
      if (decideCellBind(false, registry.stateFor(key), registry.attemptsFor(key)).shouldScheduleTemplateMeasurement) {
        claims += 1;
        registry.markScheduled(key);
      }
    }
    expect(claims).toBe(1);
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
    registry.markScheduled(FEED);
    registry.releaseClaim(FEED);
    expect(registry.stateFor(FEED)).toBe('idle');
  });

  it('THE direct proof: a cancelled claim unblocks decideCellBind for the very next bind', () => {
    const registry = createTemplateRegistry();
    const itemType = keyFor('feedCard');
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
    registry.markScheduled(FEED);
    registry.markMeasured(FEED);
    registry.releaseClaim(FEED);
    expect(registry.stateFor(FEED)).toBe('measured');
  });

  it('is a no-op for an itemType still idle', () => {
    const registry = createTemplateRegistry();
    registry.releaseClaim(FEED);
    expect(registry.stateFor(FEED)).toBe('idle');
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
    registry.markScheduled(FEED);
    registry.markFailed(FEED);
    expect(registry.stateFor(FEED)).toBe('failed');
    expect(registry.stateFor(FEED)).not.toBe('measured');
  });

  it('tracks a per-itemType attempt count, independent of other itemTypes', () => {
    const registry = createTemplateRegistry();
    registry.markScheduled(FEED);
    registry.markFailed(FEED);
    expect(registry.attemptsFor(FEED)).toBe(1);
    expect(registry.attemptsFor(PROMO)).toBe(0);
  });

  it('decideCellBind allows a bounded retry from a failed state', () => {
    const registry = createTemplateRegistry();
    registry.markScheduled(FEED);
    registry.markFailed(FEED);
    const decision = decideCellBind(false, registry.stateFor(FEED), registry.attemptsFor(FEED));
    expect(decision.shouldScheduleTemplateMeasurement).toBe(true);
  });

  it('stops retrying once MAX_MEASUREMENT_ATTEMPTS is reached — an observable ceiling, never a silent infinite retry loop', () => {
    const registry = createTemplateRegistry();
    const itemType = keyFor('feedCard');
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
    registry.markScheduled(FEED);
    registry.markFailed(FEED);
    const decision = decideCellBind(true, registry.stateFor(FEED), registry.attemptsFor(FEED));
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
    const itemType = keyFor('promoCard');
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
    const itemType = keyFor('feedCard');
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
