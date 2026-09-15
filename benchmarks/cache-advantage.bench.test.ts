// benchmarks/cache-advantage.bench.test.ts
//
// Why this library has a cache at all, as a number instead of an ADR.
//
// ADR-9 (plan.md:1046) asserts a two-cache architecture, and `useSkeletonCell`
// is built on its consequence: a virtualized list measures ONE invisible
// template cell and every visible cell reads that geometry back through
// `ctx.store.get(cacheKey)` rather than measuring itself. That is the ONLY
// scenario where the cache is load-bearing — for a lone `<AutoSkeleton>` whose
// children stay mounted (ADR-16 reveal-before-hide), the sensor measures live
// in the same cycle it paints, and the cache contributes nothing.
//
// Nothing checked whether the trade actually pays. Neutralizing the store so
// every lookup misses leaves 771 of 774 unit tests green, and the 3 that fail
// are tests OF the store — because no test mounts a list end to end. A claim
// that expensive, resting on an architecture that carries a native cache, a
// wire format, an LRU on each side and a bridge contract, should be measured.
//
// It pays by roughly three orders of magnitude today. The gate below is set
// far looser than that on purpose: it is not a performance budget (those live
// in `budgets.json`), it is a TRIPWIRE. If traversal ever becomes as cheap as
// a lookup — a faster engine, a smaller reference screen, a rewritten sensor —
// this test fails, and the correct response is not to relax it but to delete
// the cache and everything that exists to serve it.
import { describe, expect, it } from 'vitest';

import { benchmarkCacheLookup } from './support/core-benchmarks';
import { benchmarkWebSensorTraversal } from './support/web-benchmarks';

/** A screenful of a virtualized list — the scenario the cache exists for. */
const CELLS = 50;

/** The measured advantage is ~1400x per call. Ten is a floor chosen to sit far
 *  below any plausible CI noise (a lookup is fast enough that `performance.now`
 *  resolution is a real term in its p95) while still being a number the
 *  architecture would fail if the premise inverted. */
const MIN_ADVANTAGE = 10;

describe('the cache pays for itself on the only path that needs it', () => {
  it(`${CELLS} cells sharing one measurement beat ${CELLS} measurements by ${MIN_ADVANTAGE}x`, async () => {
    const traversal = await benchmarkWebSensorTraversal({ shapeCount: 30, iterations: 20 });
    const lookup = benchmarkCacheLookup({ shapeCount: 30, iterations: 1000 });

    // Anti-vacuity: a lookup benchmark that measured MISSES would report a
    // wonderful number for doing nothing, and this whole file would be a lie.
    expect(lookup.hit).toBe(true);
    expect(traversal.p95Ms).toBeGreaterThan(0);

    const withCacheMs = traversal.p95Ms + CELLS * lookup.p95Ms;
    const withoutCacheMs = CELLS * traversal.p95Ms;

    // eslint-disable-next-line no-console
    console.log('[benchmarks] cache advantage', {
      cells: CELLS,
      traversalP95Ms: traversal.p95Ms,
      cacheLookupP95Ms: lookup.p95Ms,
      withCacheMs,
      withoutCacheMs,
      advantage: withoutCacheMs / withCacheMs,
    });

    expect(withoutCacheMs).toBeGreaterThan(withCacheMs * MIN_ADVANTAGE);
  });

  /** The per-call shape of the same claim, kept separate so a regression says
   *  WHICH half moved: a lookup that got slower and a traversal that got
   *  faster are opposite findings with opposite responses. */
  it('a single lookup is cheaper than a single traversal', async () => {
    const traversal = await benchmarkWebSensorTraversal({ shapeCount: 30, iterations: 20 });
    const lookup = benchmarkCacheLookup({ shapeCount: 30, iterations: 1000 });

    expect(lookup.hit).toBe(true);
    expect(lookup.p95Ms).toBeLessThan(traversal.p95Ms);
  });
});
