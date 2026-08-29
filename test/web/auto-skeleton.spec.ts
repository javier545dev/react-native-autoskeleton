// test/web/auto-skeleton.spec.ts
//
// tasks.md 2.3/2.4 — `<AutoSkeleton>` web component + `debugOverlay`. Runs
// the REAL production component (React + ReactDOM bundled together) inside a
// real browser (plan.md §7.3). Covers: REQ-SIMPLE-1 cold-load, REQ-A11Y-1/2,
// REQ-PTR-1 default-stale + opt-out, REQ-NAV-1 hot-path + rotation-
// invalidation, REQ-OBS-METRICS-1 (`onMetrics` fires exactly once), and
// REQ-OBS-OVERLAY-1 (`debugOverlay` outline count/annotations).

import path from 'node:path';
import { expect, test as base } from '@playwright/test';
import { loadHarness } from './helpers/page';

const ENTRY = path.join(__dirname, 'helpers/component-entry.ts');

const test = base.extend<{ mountReady: () => Promise<void> }>({
  // eslint-disable-next-line no-empty-pattern
  mountReady: async ({ page }, use) => {
    await use(async () => {
      await loadHarness(page, ENTRY, `<div id="root"></div>`);
      await page.evaluate(() => {
        (window as unknown as { __metrics: unknown[] }).__metrics = [];
      });
    });
  },
});

/** Waits two animation frames — long enough for the cold-measurement effect
 *  (runs after commit) and the resulting re-render/overlay mount to settle. */
async function settle(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

test.describe('AutoSkeleton — REQ-SIMPLE-1 cold load', () => {
  test('renders a shimmer overlay matching the detected subtree before real data exists', async ({
    page,
    mountReady,
  }) => {
    await mountReady();
    await page.evaluate(() => {
      const { React, createRoot, AutoSkeleton, SkeletonProvider, MemoryShapeStore } = window.AutoskeletonComponent;
      const store = new MemoryShapeStore();
      const root = createRoot(document.getElementById('root')!);
      root.render(
        React.createElement(
          SkeletonProvider,
          { store },
          React.createElement(
            AutoSkeleton,
            {
              isLoading: true,
              skeletonKey: 'simple-screen',
              onMetrics: (m: unknown) => (window as unknown as { __metrics: unknown[] }).__metrics.push(m),
            },
            React.createElement('p', { style: { margin: 0, fontSize: 16 } }, 'Hello world'),
          ),
        ),
      );
    });
    await settle(page);

    const overlayCount = await page.locator('.askl-overlay').count();
    expect(overlayCount).toBe(1);
    const clipPath = await page.evaluate(
      () => getComputedStyle(document.querySelector('.askl-overlay')!).clipPath,
    );
    expect(clipPath).toContain('path(');
  });
});

test.describe('AutoSkeleton — REQ-A11Y-1/2', () => {
  test('overlay carries aria-busy/role=status and hides real content from AT while loading', async ({
    page,
    mountReady,
  }) => {
    await mountReady();
    await page.evaluate(() => {
      const { React, createRoot, AutoSkeleton, SkeletonProvider, MemoryShapeStore } = window.AutoskeletonComponent;
      const store = new MemoryShapeStore();
      const root = createRoot(document.getElementById('root')!);
      root.render(
        React.createElement(
          SkeletonProvider,
          { store },
          React.createElement(
            AutoSkeleton,
            { isLoading: true, skeletonKey: 'a11y-screen' },
            React.createElement('p', { id: 'real-content' }, 'Real content'),
          ),
        ),
      );
    });
    await settle(page);

    // NOTE (G.16): `contentAriaHidden` below is an ATTRIBUTE check, and it was
    // satisfied by the OLD, wrong `phase === 'skeleton'` predicate too — it
    // only ever exercised the one state in which both predicates agree. The
    // predicate itself is gated by `test/web/accessibility.spec.ts`, which
    // reads Chromium's own accessibility tree across every state. This test
    // stays as the cheap markup-level regression for the covered case.
    const info = await page.evaluate(() => {
      const overlayHost = document.querySelector('[role="status"]');
      const realContent = document.getElementById('real-content')!;
      return {
        ariaBusy: overlayHost?.getAttribute('aria-busy'),
        role: overlayHost?.getAttribute('role'),
        announcement: overlayHost?.textContent?.includes('Loading'),
        contentAriaHidden: realContent.closest('[aria-hidden="true"]') !== null,
      };
    });
    expect(info.ariaBusy).toBe('true');
    expect(info.role).toBe('status');
    expect(info.announcement).toBe(true);
    expect(info.contentAriaHidden).toBe(true);
  });
});

test.describe('AutoSkeleton — REQ-PTR-1 pull-to-refresh', () => {
  // Task 6.5 (tasks.md Phase 6) gap closure: this test previously only
  // asserted `overlayCount === 0` — it never wired `onMetrics` at all, so it
  // could not have caught the real pre-existing bug `useHandoffAndMetrics`
  // shipped with (both platforms unconditionally fired `onMetrics` once
  // `controller.settled` resolved, with no check for the suppressed-cycle
  // case). A NON-call assertion is only meaningful if the callback was
  // genuinely wired and the surrounding path genuinely exercised (waiting
  // past the full handoff fade, exactly like the REQ-NAV-1 test below) —
  // otherwise "never called" is true for the trivial reason that nothing
  // was listening.
  test('default: refreshing WARM-CACHE content shows no skeleton, and onMetrics does not fire again', async ({
    page,
    mountReady,
  }) => {
    // The bug (and the fix) only bite when the composite cache key is
    // ALREADY warm (REQ-NAV-1 intersecting REQ-PTR-1): a cold, never-
    // measured key produces `snapshot === null` throughout, and the OLD web
    // code's separate `!latest.snapshot` guard incidentally swallowed
    // `onMetrics` for that reason alone — a false-negative-proof test. This
    // test deliberately warms the cache with a REAL cold traversal first
    // (mirroring how an already-visited screen behaves), THEN triggers the
    // suppressed refresh cycle, so `snapshot` is genuinely non-null and the
    // fix under test is what actually prevents the call.
    await mountReady();
    await page.evaluate(() => {
      const { React, createRoot, AutoSkeleton, SkeletonProvider, MemoryShapeStore } = window.AutoskeletonComponent;
      const store = new MemoryShapeStore();
      const metrics: unknown[] = [];
      (window as unknown as { __metrics: unknown[] }).__metrics = metrics;
      (window as unknown as { __root: unknown; __els: unknown }).__root = createRoot(
        document.getElementById('root')!,
      );
      (window as unknown as { __els: unknown }).__els = { React, AutoSkeleton, SkeletonProvider, store };
      const { __root, __els } = window as unknown as { __root: any; __els: any };
      // Cycle 1: a genuine cold load — warms the cache with a real
      // traversal, exactly like a first visit to this screen.
      __root.render(
        __els.React.createElement(
          __els.SkeletonProvider,
          { store: __els.store },
          __els.React.createElement(
            __els.AutoSkeleton,
            { isLoading: true, skeletonKey: 'ptr-screen', onMetrics: (m: unknown) => metrics.push(m) },
            __els.React.createElement('p', { id: 'real-content' }, 'Existing content'),
          ),
        ),
      );
    });
    await settle(page);

    // End cycle 1 (content resolves) so the handoff settles and the cache
    // key is confirmed warm before the refresh cycle begins.
    await page.evaluate(() => {
      const { __root, __els, __metrics } = window as unknown as { __root: any; __els: any; __metrics: unknown[] };
      __root.render(
        __els.React.createElement(
          __els.SkeletonProvider,
          { store: __els.store },
          __els.React.createElement(
            __els.AutoSkeleton,
            { isLoading: false, skeletonKey: 'ptr-screen', onMetrics: (m: unknown) => __metrics.push(m) },
            __els.React.createElement('p', { id: 'real-content' }, 'Existing content'),
          ),
        ),
      );
    });
    await page.waitForTimeout(300);
    const metricsAfterColdLoad = await page.evaluate(
      () => (window as unknown as { __metrics: unknown[] }).__metrics,
    );
    expect(metricsAfterColdLoad).toHaveLength(1);

    // Cycle 2: pull-to-refresh over the now-warm cache key — REQ-PTR-1's
    // actual scenario. `cacheHit` is true and `snapshot` is genuinely
    // non-null this time, so the fix (not an incidental null-snapshot
    // guard) is what must prevent a second `onMetrics` call.
    await page.evaluate(() => {
      const { __root, __els, __metrics } = window as unknown as { __root: any; __els: any; __metrics: unknown[] };
      __root.render(
        __els.React.createElement(
          __els.SkeletonProvider,
          { store: __els.store },
          __els.React.createElement(
            __els.AutoSkeleton,
            { isLoading: true, skeletonKey: 'ptr-screen', onMetrics: (m: unknown) => __metrics.push(m) },
            __els.React.createElement('p', { id: 'real-content' }, 'Existing content'),
          ),
        ),
      );
    });
    await settle(page);

    const overlayCount = await page.locator('.askl-overlay').count();
    expect(overlayCount).toBe(0);

    // Complete cycle 2 (isLoading -> false again, mirroring the refresh
    // resolving) — this is the exact moment the bug fired: `requestHandoff`
    // only ever runs reactively on `!isLoading`, so `controller.settled`
    // never resolves (and `onMetrics` never has a chance to fire, buggy or
    // not) until this transition happens. Skipping this step would make the
    // non-call assertion below pass trivially for the wrong reason, exactly
    // the "test would pass because nothing is wired at all" trap this task
    // was explicitly warned about.
    await page.evaluate(() => {
      const { __root, __els, __metrics } = window as unknown as { __root: any; __els: any; __metrics: unknown[] };
      __root.render(
        __els.React.createElement(
          __els.SkeletonProvider,
          { store: __els.store },
          __els.React.createElement(
            __els.AutoSkeleton,
            { isLoading: false, skeletonKey: 'ptr-screen', onMetrics: (m: unknown) => __metrics.push(m) },
            __els.React.createElement('p', { id: 'real-content' }, 'Existing content'),
          ),
        ),
      );
    });

    // Wait past the full handoff fade (default 120ms) plus slack — the same
    // window the REQ-NAV-1 test below waits before reading `__metrics` for
    // its POSITIVE assertion. A non-call assertion taken any earlier would
    // be meaningless (the callback might simply not have had time yet).
    await page.waitForTimeout(300);
    const metricsAfterSuppressedCycle = await page.evaluate(
      () => (window as unknown as { __metrics: unknown[] }).__metrics,
    );
    expect(metricsAfterSuppressedCycle).toHaveLength(1);
  });

  test('opt-out (skeletonOnRefresh): refreshing over existing content shows the skeleton, and onMetrics fires once', async ({
    page,
    mountReady,
  }) => {
    await mountReady();
    await page.evaluate(() => {
      const { React, createRoot, AutoSkeleton, SkeletonProvider, MemoryShapeStore } = window.AutoskeletonComponent;
      const store = new MemoryShapeStore();
      const metrics: unknown[] = [];
      (window as unknown as { __metrics: unknown[] }).__metrics = metrics;
      const root = createRoot(document.getElementById('root')!);
      (window as unknown as { __root: unknown; __els: unknown }).__root = root;
      (window as unknown as { __els: unknown }).__els = { React, AutoSkeleton, SkeletonProvider, store };
      root.render(
        React.createElement(
          SkeletonProvider,
          { store },
          React.createElement(
            AutoSkeleton,
            { isLoading: false, skeletonKey: 'ptr-optout-screen', onMetrics: (m: unknown) => metrics.push(m) },
            React.createElement('p', {}, 'Existing content'),
          ),
        ),
      );
    });
    await settle(page);

    await page.evaluate(() => {
      const { __root, __els, __metrics } = window as unknown as { __root: any; __els: any; __metrics: unknown[] };
      __root.render(
        __els.React.createElement(
          __els.SkeletonProvider,
          { store: __els.store },
          __els.React.createElement(
            __els.AutoSkeleton,
            {
              isLoading: true,
              skeletonKey: 'ptr-optout-screen',
              skeletonOnRefresh: true,
              onMetrics: (m: unknown) => __metrics.push(m),
            },
            __els.React.createElement('p', {}, 'Existing content'),
          ),
        ),
      );
    });
    await settle(page);

    const overlayCount = await page.locator('.askl-overlay').count();
    expect(overlayCount).toBe(1);

    // End the opted-in cycle (isLoading -> false) so the handoff settles and
    // onMetrics gets a chance to fire — proving the fix is scoped to the
    // SUPPRESSED case only, never to a genuinely-shown skeleton cycle.
    await page.evaluate(() => {
      const { __root, __els, __metrics } = window as unknown as { __root: any; __els: any; __metrics: unknown[] };
      __root.render(
        __els.React.createElement(
          __els.SkeletonProvider,
          { store: __els.store },
          __els.React.createElement(
            __els.AutoSkeleton,
            {
              isLoading: false,
              skeletonKey: 'ptr-optout-screen',
              skeletonOnRefresh: true,
              onMetrics: (m: unknown) => __metrics.push(m),
            },
            __els.React.createElement('p', {}, 'Existing content'),
          ),
        ),
      );
    });
    await page.waitForTimeout(300);
    const metricsAfterOptOutCycle = await page.evaluate(
      () => (window as unknown as { __metrics: unknown[] }).__metrics,
    );
    expect(metricsAfterOptOutCycle).toHaveLength(1);
  });
});

test.describe('AutoSkeleton — REQ-NAV-1 cache hot path + REQ-OBS-METRICS-1', () => {
  test('a second mount with a shared store reports cacheHit:true, traversalMs:0, onMetrics fires once per cycle', async ({
    page,
    mountReady,
  }) => {
    await mountReady();
    await page.evaluate(() => {
      const { React, createRoot, AutoSkeleton, SkeletonProvider, MemoryShapeStore } = window.AutoskeletonComponent;
      const store = new MemoryShapeStore();
      (window as unknown as { __store: unknown }).__store = store;
      (window as unknown as { __els: unknown }).__els = { React, createRoot, AutoSkeleton, SkeletonProvider };
      const metrics: unknown[] = [];
      (window as unknown as { __metrics: unknown[] }).__metrics = metrics;

      const root1 = createRoot(document.getElementById('root')!);
      root1.render(
        React.createElement(
          SkeletonProvider,
          { store },
          React.createElement(
            AutoSkeleton,
            {
              isLoading: true,
              skeletonKey: 'nav-screen',
              onMetrics: (m: unknown) => metrics.push(m),
            },
            React.createElement('p', {}, 'Nav content'),
          ),
        ),
      );
      (window as unknown as { __root1: unknown }).__root1 = root1;
    });
    await settle(page);

    // End cycle 1 (isLoading -> false) so onMetrics fires for the cold load.
    // Deliberately NOT unmounted in the same synchronous call: the
    // `useEffect` that calls `requestHandoff()` is a PASSIVE effect that
    // React flushes after paint, not synchronously after `render()` returns
    // — unmounting immediately would cancel it before it ever runs.
    await page.evaluate(() => {
      const { __root1, __els, __store, __metrics } = window as unknown as {
        __root1: any;
        __els: any;
        __store: any;
        __metrics: unknown[];
      };
      __root1.render(
        __els.React.createElement(
          __els.SkeletonProvider,
          { store: __store },
          __els.React.createElement(
            __els.AutoSkeleton,
            { isLoading: false, skeletonKey: 'nav-screen', onMetrics: (m: unknown) => __metrics.push(m) },
            __els.React.createElement('p', {}, 'Nav content'),
          ),
        ),
      );
    });
    // Handoff fade (default 120ms) + settle.
    await page.waitForTimeout(300);

    const coldMetrics = await page.evaluate(() => (window as unknown as { __metrics: any[] }).__metrics);
    expect(coldMetrics).toHaveLength(1);
    expect(coldMetrics[0].cacheHit).toBe(false);
    expect(coldMetrics[0].traversalMs).toBeGreaterThan(0);

    await page.evaluate(() => (window as unknown as { __root1: any }).__root1.unmount());

    // "Navigate back": fresh mount, same shared store, same composite key.
    await page.evaluate(() => {
      document.getElementById('root')!.innerHTML = '';
      const { __els, __store, __metrics } = window as unknown as { __els: any; __store: any; __metrics: unknown[] };
      const root2 = __els.createRoot(document.getElementById('root')!);
      root2.render(
        __els.React.createElement(
          __els.SkeletonProvider,
          { store: __store },
          __els.React.createElement(
            __els.AutoSkeleton,
            { isLoading: true, skeletonKey: 'nav-screen', onMetrics: (m: unknown) => __metrics.push(m) },
            __els.React.createElement('p', {}, 'Nav content'),
          ),
        ),
      );
      (window as unknown as { __root2: unknown }).__root2 = root2;
    });
    await settle(page);

    await page.evaluate(() => {
      const { __root2, __els, __store, __metrics } = window as unknown as {
        __root2: any;
        __els: any;
        __store: any;
        __metrics: unknown[];
      };
      __root2.render(
        __els.React.createElement(
          __els.SkeletonProvider,
          { store: __store },
          __els.React.createElement(
            __els.AutoSkeleton,
            { isLoading: false, skeletonKey: 'nav-screen', onMetrics: (m: unknown) => __metrics.push(m) },
            __els.React.createElement('p', {}, 'Nav content'),
          ),
        ),
      );
    });
    await page.waitForTimeout(200);

    const allMetrics = await page.evaluate(() => (window as unknown as { __metrics: any[] }).__metrics);
    expect(allMetrics).toHaveLength(2);
    expect(allMetrics[1].cacheHit).toBe(true);
    expect(allMetrics[1].traversalMs).toBe(0);
  });

  test('rotation invalidation: a viewport width bucket change forces a fresh traversal', async ({
    page,
    mountReady,
  }) => {
    await page.setViewportSize({ width: 375, height: 700 });
    await mountReady();
    await page.evaluate(() => {
      const { React, createRoot, AutoSkeleton, SkeletonProvider, MemoryShapeStore } = window.AutoskeletonComponent;
      const store = new MemoryShapeStore();
      (window as unknown as { __store: unknown }).__store = store;
      (window as unknown as { __els: unknown }).__els = { React, AutoSkeleton, SkeletonProvider };
      const metrics: unknown[] = [];
      (window as unknown as { __metrics: unknown[] }).__metrics = metrics;
      const root = createRoot(document.getElementById('root')!);
      (window as unknown as { __root: unknown }).__root = root;
      root.render(
        React.createElement(
          SkeletonProvider,
          { store },
          React.createElement(
            AutoSkeleton,
            { isLoading: true, skeletonKey: 'rotate-screen', onMetrics: (m: unknown) => metrics.push(m) },
            // A full-width background box (not short text) so its shape
            // WIDTH genuinely scales with the container across the two
            // viewport buckets below — short text would wrap to the same
            // natural content width in both cases and falsely look cached.
            React.createElement('div', { style: { background: '#ff0000', width: '100%', height: '20px' } }),
          ),
        ),
      );
    });
    await settle(page);

    // Same width bucket again (still "portrait"): a second render must NOT
    // re-traverse — the cache-key-scoped `cacheStateRef` was already
    // resolved for this bucket on the first render of this cycle.
    const clipPathBefore = await page.evaluate(
      () => getComputedStyle(document.querySelector('.askl-overlay')!).clipPath,
    );
    expect(clipPathBefore).toContain('path(');

    // Rotate to a clearly different width bucket (375 -> 1024).
    await page.setViewportSize({ width: 1024, height: 700 });
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await settle(page);

    const clipPathAfter = await page.evaluate(
      () => getComputedStyle(document.querySelector('.askl-overlay')!).clipPath,
    );
    // The overlay frame widens with the container (100% width paragraph), so
    // a genuinely fresh traversal produces a DIFFERENT clip-path text value
    // — the readable-diff guarantee plan.md §7.3 calls for.
    expect(clipPathAfter).not.toBe(clipPathBefore);
  });
});

test.describe('AutoSkeleton — REQ-OBS-BUDGET-1 dev budget warnings, emitted from the real measurement path', () => {
  test('shape count exceeding a configured maxShapes emits a console.warn citing the real counts', async ({
    page,
    mountReady,
  }) => {
    await mountReady();
    const warnings: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'warning') warnings.push(msg.text());
    });

    await page.evaluate(() => {
      const { React, createRoot, AutoSkeleton, SkeletonProvider, MemoryShapeStore } = window.AutoskeletonComponent;
      const store = new MemoryShapeStore();
      const root = createRoot(document.getElementById('root')!);
      root.render(
        React.createElement(
          SkeletonProvider,
          // A real, aggressively low maxShapes so a genuine multi-shape
          // traversal (two real leaves below) really trips dom-sensor.ts's
          // `shape-cap-reached` truncation — no formatter is called
          // directly, only real props flow into the real component. (The
          // wiring reads that real degradation flag rather than comparing
          // the truncated snapshot's own capped count against maxShapes,
          // since a truncated snapshot's count can never itself exceed
          // maxShapes by construction — see AutoSkeleton.tsx's
          // useColdMeasurement comment.)
          { store, maxShapes: 1 },
          React.createElement(
            AutoSkeleton,
            { isLoading: true, skeletonKey: 'budget-shapecap-screen' },
            React.createElement('div', {}, [
              React.createElement('p', { key: 'a', style: { margin: 0 } }, 'One'),
              React.createElement('p', { key: 'b', style: { margin: 0 } }, 'Two'),
            ]),
          ),
        ),
      );
    });
    await settle(page);

    const shapeCapWarning = warnings.find((w) => w.includes('shapes') && w.includes('exceeding'));
    expect(shapeCapWarning).toBeTruthy();
    expect(shapeCapWarning).toContain('1');
  });

  test('traversal exceeding a configured budgetMs emits a console.warn citing the real measured time', async ({
    page,
    mountReady,
  }) => {
    await mountReady();
    const warnings: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'warning') warnings.push(msg.text());
    });

    await page.evaluate(() => {
      const { React, createRoot, AutoSkeleton, SkeletonProvider, MemoryShapeStore } = window.AutoskeletonComponent;
      const store = new MemoryShapeStore();
      const root = createRoot(document.getElementById('root')!);
      root.render(
        React.createElement(
          SkeletonProvider,
          // A negative budgetMs guarantees ANY real measured traversal time
          // (always >= 0) exceeds it — deterministic without depending on
          // machine-speed timing flakiness, while still exercising the real
          // `checkBudgets`/`emitBudgetWarnings` call against a REAL
          // `traversalMs` produced by the real sensor.
          { store, budgetMs: -1 },
          React.createElement(
            AutoSkeleton,
            { isLoading: true, skeletonKey: 'budget-time-screen' },
            React.createElement('p', { style: { margin: 0 } }, 'Hello world'),
          ),
        ),
      );
    });
    await settle(page);

    const timeWarning = warnings.find((w) => w.includes('traversal took'));
    expect(timeWarning).toBeTruthy();
  });

  test('no warning fires when traversal stays within the default budgets', async ({ page, mountReady }) => {
    await mountReady();
    const warnings: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'warning') warnings.push(msg.text());
    });

    await page.evaluate(() => {
      const { React, createRoot, AutoSkeleton, SkeletonProvider, MemoryShapeStore } = window.AutoskeletonComponent;
      const store = new MemoryShapeStore();
      const root = createRoot(document.getElementById('root')!);
      root.render(
        React.createElement(
          SkeletonProvider,
          { store },
          React.createElement(
            AutoSkeleton,
            { isLoading: true, skeletonKey: 'budget-ok-screen' },
            React.createElement('p', { style: { margin: 0 } }, 'Hello world'),
          ),
        ),
      );
    });
    await settle(page);

    expect(warnings).toEqual([]);
  });
});

test.describe('AutoSkeleton — REQ-OBS-BUDGET-2 radius fallback share warning, wired to the real sensor output', () => {
  test('no false-positive fires against real DOM traversal even at an aggressive threshold', async ({
    page,
    mountReady,
  }) => {
    // On web, dom-sensor.ts's `leafShape` only ever assigns radiusSource
    // 'measured' or 'hint' (never 'default') — web always knows the exact
    // pixel radius directly, unlike Android's degradation ladder (plan.md
    // ADR-2). A genuine positive trigger for REQ-OBS-BUDGET-2 is therefore
    // structurally impossible on this platform; what this test proves is
    // that the real wiring, fed the real sensor's live `radiusSources`
    // sidecar, correctly stays silent even against `radiusFallbackShare: 0`
    // — the most aggressive threshold that would fire on any nonzero
    // default-rung share.
    await mountReady();
    const warnings: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'warning') warnings.push(msg.text());
    });

    await page.evaluate(() => {
      const { React, createRoot, AutoSkeleton, SkeletonProvider, MemoryShapeStore } = window.AutoskeletonComponent;
      const store = new MemoryShapeStore();
      const root = createRoot(document.getElementById('root')!);
      root.render(
        React.createElement(
          SkeletonProvider,
          { store, radiusFallbackShare: 0 },
          React.createElement(
            AutoSkeleton,
            { isLoading: true, skeletonKey: 'radius-fallback-screen' },
            React.createElement('div', { style: { background: '#eee', borderRadius: 8, width: 40, height: 40 } }),
          ),
        ),
      );
    });
    await settle(page);

    const radiusWarning = warnings.find((w) => w.includes('default') && w.includes('fallback'));
    expect(radiusWarning).toBeUndefined();
  });
});

test.describe('AutoSkeleton — debugOverlay (REQ-OBS-OVERLAY-1)', () => {
  test('outlines one box per detected shape, each annotated with index/source/cache badge', async ({
    page,
    mountReady,
  }) => {
    await mountReady();
    await page.evaluate(() => {
      const { React, createRoot, AutoSkeleton, SkeletonProvider, MemoryShapeStore } = window.AutoskeletonComponent;
      const store = new MemoryShapeStore();
      const root = createRoot(document.getElementById('root')!);
      root.render(
        React.createElement(
          SkeletonProvider,
          { store },
          React.createElement(
            AutoSkeleton,
            { isLoading: true, skeletonKey: 'debug-screen', debugOverlay: true },
            React.createElement(
              'div',
              {},
              React.createElement('p', { style: { margin: 0 } }, 'One'),
              React.createElement('img', { src: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', width: 10, height: 10 }),
            ),
          ),
        ),
      );
    });
    await settle(page);

    const shapeBoxes = await page.locator('[data-askl-debug-shape]').count();
    const decodedShapeCount = await page.evaluate(() => {
      const overlay = document.querySelector('.askl-overlay')!;
      // Sibling debug overlay renders inside the same status container.
      return document.querySelectorAll('[data-askl-debug-shape]').length > 0 && overlay !== null;
    });
    expect(decodedShapeCount).toBe(true);
    expect(shapeBoxes).toBeGreaterThan(0);

    const firstAnnotation = await page.evaluate(() => {
      const el = document.querySelector('[data-askl-debug-shape="0"]')!;
      return {
        source: el.getAttribute('data-askl-debug-source'),
        cache: el.getAttribute('data-askl-debug-cache'),
      };
    });
    expect(firstAnnotation.cache).toBe('MISS');
    expect(firstAnnotation.source).toBeTruthy();
  });
});

test.describe('AutoSkeleton — typed-hint channel (radius/lines, public API)', () => {
  // `<AutoSkeleton.Hint>` (`src/web/Hint.tsx`, added 2026-08-28 after NFR-6's
  // second revision, 8 kB -> 9 kB) is sugar over the SAME self-sufficient
  // `data-autoskeleton-radius` attribute a consumer could already set by
  // hand — both channels must keep working. This first test proves the raw
  // hand-set attribute still works (the pre-existing, still-supported
  // channel); the second test below proves the SAME pipeline through the
  // new `<AutoSkeleton.Hint>` component itself. Both prove the FULL real
  // pipeline — through the real cold measurement, into `onMetrics`'s
  // `radiusSourceHistogram` — the exact telemetry ADR-2 makes mandatory in
  // every rung.
  test('a plain data-autoskeleton-radius attribute reaches onMetrics.radiusSourceHistogram as "hint"', async ({
    page,
    mountReady,
  }) => {
    await mountReady();
    await page.evaluate(() => {
      const { React, createRoot, AutoSkeleton, SkeletonProvider, MemoryShapeStore } = window.AutoskeletonComponent;
      const store = new MemoryShapeStore();
      const metrics: unknown[] = [];
      (window as unknown as { __metrics: unknown[] }).__metrics = metrics;
      (window as unknown as { __root: unknown; __els: unknown }).__root = createRoot(
        document.getElementById('root')!,
      );
      (window as unknown as { __els: unknown }).__els = { React, AutoSkeleton, SkeletonProvider, store };
      const { __root, __els } = window as unknown as { __root: any; __els: any };
      const child = () =>
        __els.React.createElement('div', {
          id: 'hint-target',
          'data-autoskeleton-radius': 20,
          style: { width: 80, height: 80, background: '#00ff00', borderRadius: 4 },
        });
      __root.render(
        __els.React.createElement(
          __els.SkeletonProvider,
          { store: __els.store },
          __els.React.createElement(
            __els.AutoSkeleton,
            { isLoading: true, skeletonKey: 'hint-e2e-screen', onMetrics: (m: unknown) => metrics.push(m) },
            child(),
          ),
        ),
      );
    });
    await settle(page);

    // `onMetrics`/`requestHandoff()` fires on the isLoading TRUE -> FALSE
    // transition (matches the REQ-PTR-1 tests' own established pattern
    // above) — a single isLoading:true render never fires it.
    await page.evaluate(() => {
      const { __root, __els, __metrics } = window as unknown as { __root: any; __els: any; __metrics: unknown[] };
      __root.render(
        __els.React.createElement(
          __els.SkeletonProvider,
          { store: __els.store },
          __els.React.createElement(
            __els.AutoSkeleton,
            { isLoading: false, skeletonKey: 'hint-e2e-screen', onMetrics: (m: unknown) => __metrics.push(m) },
            __els.React.createElement('div', {
              id: 'hint-target',
              'data-autoskeleton-radius': 20,
              style: { width: 80, height: 80, background: '#00ff00', borderRadius: 4 },
            }),
          ),
        ),
      );
    });
    await page.waitForTimeout(400);

    const histogram = await page.evaluate(() => {
      const metrics = (window as unknown as { __metrics: { radiusSourceHistogram?: Record<string, number> }[] })
        .__metrics;
      return metrics[0]?.radiusSourceHistogram;
    });

    expect(histogram?.hint).toBe(1);
    expect(histogram?.measured ?? 0).toBe(0);
  });

  test('<AutoSkeleton.Hint id radius> reaches onMetrics.radiusSourceHistogram as "hint" (same pipeline, via the component)', async ({
    page,
    mountReady,
  }) => {
    await mountReady();
    await page.evaluate(() => {
      const { React, createRoot, AutoSkeleton, SkeletonProvider, MemoryShapeStore } = window.AutoskeletonComponent;
      const store = new MemoryShapeStore();
      const metrics: unknown[] = [];
      (window as unknown as { __metrics: unknown[] }).__metrics = metrics;
      (window as unknown as { __root: unknown; __els: unknown }).__root = createRoot(
        document.getElementById('root')!,
      );
      (window as unknown as { __els: unknown }).__els = { React, AutoSkeleton, SkeletonProvider, store };
      const { __root, __els } = window as unknown as { __root: any; __els: any };
      const hintedChild = () =>
        __els.React.createElement(
          __els.AutoSkeleton.Hint,
          { id: 'hint-component-target', radius: 20 },
          __els.React.createElement('div', {
            style: { width: 80, height: 80, background: '#00ff00', borderRadius: 4 },
          }),
        );
      __root.render(
        __els.React.createElement(
          __els.SkeletonProvider,
          { store: __els.store },
          __els.React.createElement(
            __els.AutoSkeleton,
            { isLoading: true, skeletonKey: 'hint-component-e2e-screen', onMetrics: (m: unknown) => metrics.push(m) },
            hintedChild(),
          ),
        ),
      );
    });
    await settle(page);

    // Same isLoading TRUE -> FALSE transition requirement as the raw-
    // attribute test above.
    await page.evaluate(() => {
      const { __root, __els, __metrics } = window as unknown as { __root: any; __els: any; __metrics: unknown[] };
      __root.render(
        __els.React.createElement(
          __els.SkeletonProvider,
          { store: __els.store },
          __els.React.createElement(
            __els.AutoSkeleton,
            {
              isLoading: false,
              skeletonKey: 'hint-component-e2e-screen',
              onMetrics: (m: unknown) => __metrics.push(m),
            },
            __els.React.createElement(
              __els.AutoSkeleton.Hint,
              { id: 'hint-component-target', radius: 20 },
              __els.React.createElement('div', {
                style: { width: 80, height: 80, background: '#00ff00', borderRadius: 4 },
              }),
            ),
          ),
        ),
      );
    });
    await page.waitForTimeout(400);

    const histogram = await page.evaluate(() => {
      const metrics = (window as unknown as { __metrics: { radiusSourceHistogram?: Record<string, number> }[] })
        .__metrics;
      return metrics[0]?.radiusSourceHistogram;
    });

    expect(histogram?.hint).toBe(1);
    expect(histogram?.measured ?? 0).toBe(0);
  });
});

test.describe('AutoSkeleton — delay prop (session gap closure: declared but never read)', () => {
  test('withholds the skeleton overlay until `delay` ms have elapsed', async ({ page, mountReady }) => {
    await mountReady();
    await page.evaluate(() => {
      const { React, createRoot, AutoSkeleton, SkeletonProvider, MemoryShapeStore } = window.AutoskeletonComponent;
      const store = new MemoryShapeStore();
      const root = createRoot(document.getElementById('root')!);
      root.render(
        React.createElement(
          SkeletonProvider,
          { store },
          React.createElement(
            AutoSkeleton,
            { isLoading: true, skeletonKey: 'delay-screen', delay: 200 },
            React.createElement('p', { style: { margin: 0 } }, 'Delayed'),
          ),
        ),
      );
    });

    // Immediately after mount, well before the 200ms delay, no overlay yet.
    await settle(page);
    expect(await page.locator('.askl-overlay').count()).toBe(0);

    await page.waitForTimeout(300);
    expect(await page.locator('.askl-overlay').count()).toBe(1);
  });

  test('a load that resolves before `delay` elapses never shows a skeleton at all', async ({ page, mountReady }) => {
    await mountReady();
    await page.evaluate(() => {
      const { React, createRoot, AutoSkeleton, SkeletonProvider, MemoryShapeStore } = window.AutoskeletonComponent;
      const store = new MemoryShapeStore();
      const root = createRoot(document.getElementById('root')!);
      (window as unknown as { __setLoading: (v: boolean) => void }).__setLoading = () => {};
      function Harness() {
        const [isLoading, setIsLoading] = React.useState(true);
        (window as unknown as { __setLoading: (v: boolean) => void }).__setLoading = setIsLoading;
        return React.createElement(
          AutoSkeleton,
          { isLoading, skeletonKey: 'delay-resolves-fast', delay: 500 },
          React.createElement('p', { style: { margin: 0 } }, 'Fast'),
        );
      }
      root.render(React.createElement(SkeletonProvider, { store }, React.createElement(Harness)));
    });

    await settle(page);
    expect(await page.locator('.askl-overlay').count()).toBe(0);

    // Resolve well before the 500ms delay would have elapsed.
    await page.waitForTimeout(100);
    await page.evaluate(() => (window as unknown as { __setLoading: (v: boolean) => void }).__setLoading(false));
    await settle(page);

    // Wait past the original delay window entirely — the skeleton must
    // never have appeared, not even briefly.
    await page.waitForTimeout(500);
    expect(await page.locator('.askl-overlay').count()).toBe(0);
  });
});

test.describe('AutoSkeleton — scaled ancestor (the user-visible half of the sensor fix)', () => {
  test('the painted overlay covers exactly the wrapper it is drawn into, not a scaled-up copy of it', async ({
    page,
  }) => {
    // `test/web/dom-sensor.spec.ts` proves the sensor now reports the root's
    // OWN coordinate space. This proves what that was for: the overlay lives
    // INSIDE the scaling ancestor, so viewport-space geometry got scaled a
    // second time when it painted and the skeleton covered four times the
    // area it was measured from.
    await loadHarness(
      page,
      ENTRY,
      `<div style="transform:scale(2);transform-origin:0 0;width:200px;"><div id="root"></div></div>`,
    );
    await page.evaluate(() => {
      const { React, createRoot, AutoSkeleton } = window.AutoskeletonComponent;
      createRoot(document.getElementById('root')!).render(
        React.createElement(
          AutoSkeleton,
          { isLoading: true, skeletonKey: 'scaled' },
          React.createElement('div', { style: { width: 100, height: 20, background: '#f00' } }),
          React.createElement('div', { style: { width: 60, height: 30, background: '#00f' } }),
        ),
      );
    });
    await settle(page);

    const boxes = await page.evaluate(() => {
      const wrapper = document.getElementById('root')!.firstElementChild!.getBoundingClientRect();
      const overlay = document.querySelector('.askl-overlay')!.getBoundingClientRect();
      return { wrapper: { w: wrapper.width, h: wrapper.height }, overlay: { w: overlay.width, h: overlay.height } };
    });
    expect(boxes.overlay.w).toBeCloseTo(boxes.wrapper.w, 1);
    expect(boxes.overlay.h).toBeCloseTo(boxes.wrapper.h, 1);
    // Rendered at scale 2, so the wrapper really is twice its layout box —
    // proving the ancestor transform was in effect and the assertion above is
    // not passing because nothing was scaled at all.
    expect(boxes.wrapper.w).toBeCloseTo(400, 1);
  });
});
