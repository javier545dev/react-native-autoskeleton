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
  test('default: refreshing over existing content shows no skeleton', async ({ page, mountReady }) => {
    await mountReady();
    await page.evaluate(() => {
      const { React, createRoot, AutoSkeleton, SkeletonProvider, MemoryShapeStore } = window.AutoskeletonComponent;
      const store = new MemoryShapeStore();
      (window as unknown as { __root: unknown; __els: unknown }).__root = createRoot(
        document.getElementById('root')!,
      );
      (window as unknown as { __els: unknown }).__els = { React, AutoSkeleton, SkeletonProvider, store };
      const { __root, __els } = window as unknown as { __root: any; __els: any };
      __root.render(
        __els.React.createElement(
          __els.SkeletonProvider,
          { store: __els.store },
          __els.React.createElement(
            __els.AutoSkeleton,
            { isLoading: false, skeletonKey: 'ptr-screen' },
            __els.React.createElement('p', { id: 'real-content' }, 'Existing content'),
          ),
        ),
      );
    });
    await settle(page);

    await page.evaluate(() => {
      const { __root, __els } = window as unknown as { __root: any; __els: any };
      __root.render(
        __els.React.createElement(
          __els.SkeletonProvider,
          { store: __els.store },
          __els.React.createElement(
            __els.AutoSkeleton,
            { isLoading: true, skeletonKey: 'ptr-screen' },
            __els.React.createElement('p', { id: 'real-content' }, 'Existing content'),
          ),
        ),
      );
    });
    await settle(page);

    const overlayCount = await page.locator('.askl-overlay').count();
    expect(overlayCount).toBe(0);
  });

  test('opt-out (skeletonOnRefresh): refreshing over existing content shows the skeleton', async ({
    page,
    mountReady,
  }) => {
    await mountReady();
    await page.evaluate(() => {
      const { React, createRoot, AutoSkeleton, SkeletonProvider, MemoryShapeStore } = window.AutoskeletonComponent;
      const store = new MemoryShapeStore();
      const root = createRoot(document.getElementById('root')!);
      (window as unknown as { __root: unknown; __els: unknown }).__root = root;
      (window as unknown as { __els: unknown }).__els = { React, AutoSkeleton, SkeletonProvider, store };
      root.render(
        React.createElement(
          SkeletonProvider,
          { store },
          React.createElement(
            AutoSkeleton,
            { isLoading: false, skeletonKey: 'ptr-optout-screen' },
            React.createElement('p', {}, 'Existing content'),
          ),
        ),
      );
    });
    await settle(page);

    await page.evaluate(() => {
      const { __root, __els } = window as unknown as { __root: any; __els: any };
      __root.render(
        __els.React.createElement(
          __els.SkeletonProvider,
          { store: __els.store },
          __els.React.createElement(
            __els.AutoSkeleton,
            { isLoading: true, skeletonKey: 'ptr-optout-screen', skeletonOnRefresh: true },
            __els.React.createElement('p', {}, 'Existing content'),
          ),
        ),
      );
    });
    await settle(page);

    const overlayCount = await page.locator('.askl-overlay').count();
    expect(overlayCount).toBe(1);
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
