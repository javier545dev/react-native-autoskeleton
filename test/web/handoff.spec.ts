// test/web/handoff.spec.ts
//
// tasks.md 8.4 / ADR-16: web image-handoff wiring — extends 1.7's
// `HandoffController` into 2.3's `<AutoSkeleton>`, proven with a REAL `<img>`
// successor (an artificially slow-loading image served through a real
// `page.route` delay, never a hand-rolled timer standing in for a load
// event). RISK-11's authoritative test: not "the skeleton disappeared" (a
// broken implementation could pass that), but "no frame exists where
// NEITHER the skeleton nor the successor is painted" — sampled every
// animation frame across the whole `isLoading -> false` transition.

import path from 'node:path';
import { expect, test as base } from '@playwright/test';
import { loadHarness } from './helpers/page';

const ENTRY = path.join(__dirname, 'helpers/component-entry.ts');
const RED_PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

const test = base.extend<{ mountReady: (imageDelayMs: number) => Promise<void> }>({
  // eslint-disable-next-line no-empty-pattern
  mountReady: async ({ page }, use) => {
    await use(async (imageDelayMs: number) => {
      await page.route('**/slow-successor.png', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, imageDelayMs));
        await route.fulfill({
          status: 200,
          contentType: 'image/png',
          body: Buffer.from(RED_PIXEL_PNG_BASE64, 'base64'),
        });
      });
      await loadHarness(page, ENTRY, `<div id="root"></div>`);
      await page.evaluate(() => {
        (window as unknown as { __metrics: unknown[] }).__metrics = [];
      });
    });
  },
});

/** Samples, once per animation frame, whether the skeleton overlay OR the
 *  successor `<img>` is painted — RISK-11's authoritative frame-capture
 *  check. Runs entirely in-page (no screenshot polling, which would be both
 *  slower and less precise than reading the actual paint-relevant DOM/image
 *  state every frame). Returns `{ violations, frames }`: `violations` MUST
 *  be `0` for the no-flash guarantee to hold. */
async function sampleFramesUntilSettled(
  page: import('@playwright/test').Page,
  maxFrames: number,
): Promise<{ violations: number; frames: number; sawSuccessorPaint: boolean }> {
  return page.evaluate(async (maxFramesInner) => {
    let violations = 0;
    let frames = 0;
    let sawSuccessorPaint = false;
    await new Promise<void>((resolve) => {
      function tick() {
        frames += 1;
        const overlay = document.querySelector('[aria-busy="true"][role="status"]');
        const overlayPainted = overlay !== null && overlay.getClientRects().length > 0;
        const img = document.querySelector('img') as HTMLImageElement | null;
        const successorPainted = img !== null && img.complete && img.naturalWidth > 0;
        if (successorPainted) {
          sawSuccessorPaint = true;
        }
        if (!overlayPainted && !successorPainted) {
          violations += 1;
        }
        // Settled once the overlay is gone AND the successor has painted —
        // nothing further to sample.
        if ((overlay === null && successorPainted) || frames >= maxFramesInner) {
          resolve();
          return;
        }
        requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
    return { violations, frames, sawSuccessorPaint };
  }, maxFrames);
}

test.describe('Web image-handoff wiring — RISK-11 no-flash frame-capture (ADR-16)', () => {
  test('no frame exists where neither the skeleton nor a successor is painted, across a slow real <img> load', async ({
    page,
    mountReady,
  }) => {
    await mountReady(150);
    await page.evaluate(() => {
      const { React, createRoot, AutoSkeleton, SkeletonProvider, MemoryShapeStore } = window.AutoskeletonComponent;
      const store = new MemoryShapeStore();
      const root = createRoot(document.getElementById('root')!);
      (window as unknown as { __setLoading: (v: boolean) => void }).__setLoading = () => {};
      function Harness() {
        const [isLoading, setIsLoading] = React.useState(true);
        (window as unknown as { __setLoading: (v: boolean) => void }).__setLoading = setIsLoading;
        return React.createElement(
          SkeletonProvider,
          { store },
          React.createElement(
            AutoSkeleton,
            {
              isLoading,
              skeletonKey: 'handoff-no-flash',
              expectsPlaceholder: true,
              onMetrics: (m: unknown) => (window as unknown as { __metrics: unknown[] }).__metrics.push(m),
            },
            React.createElement('img', { src: 'https://fixtures.autoskeleton.test/slow-successor.png', width: 200, height: 150, alt: '' }),
          ),
        );
      }
      root.render(React.createElement(Harness));
    });
    // Let the cold measurement + first overlay mount settle before starting
    // the transition under test.
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    );
    await expect(page.locator('[aria-busy="true"][role="status"]')).toHaveCount(1);

    const samplingPromise = sampleFramesUntilSettled(page, 240);
    await page.evaluate(() => (window as unknown as { __setLoading: (v: boolean) => void }).__setLoading(false));
    const { violations, frames, sawSuccessorPaint } = await samplingPromise;

    expect(frames).toBeGreaterThan(0);
    expect(sawSuccessorPaint).toBe(true);
    expect(violations, 'a frame existed where neither the skeleton nor the successor was painted').toBe(0);
  });
});

test.describe('Web image-handoff wiring — metric boundary (displayDurationMs / handoffMs / handoffReason)', () => {
  test('displayDurationMs stops at isLoading:false; handoffReason becomes successor-painted; the wall-time invariant holds', async ({
    page,
    mountReady,
  }) => {
    await mountReady(150);
    await page.evaluate(() => {
      const { React, createRoot, AutoSkeleton, SkeletonProvider, MemoryShapeStore } = window.AutoskeletonComponent;
      const store = new MemoryShapeStore();
      const root = createRoot(document.getElementById('root')!);
      function Harness() {
        const [isLoading, setIsLoading] = React.useState(true);
        (window as unknown as { __setLoading: (v: boolean) => void }).__setLoading = setIsLoading;
        return React.createElement(
          SkeletonProvider,
          { store },
          React.createElement(
            AutoSkeleton,
            {
              isLoading,
              skeletonKey: 'handoff-metrics',
              expectsPlaceholder: true,
              onMetrics: (m: unknown) => (window as unknown as { __metrics: unknown[] }).__metrics.push(m),
            },
            React.createElement('img', { src: 'https://fixtures.autoskeleton.test/slow-successor.png', width: 200, height: 150, alt: '' }),
          ),
        );
      }
      root.render(React.createElement(Harness));
    });
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    );

    const wallStart = await page.evaluate(() => performance.now());
    await page.evaluate(() => (window as unknown as { __setLoading: (v: boolean) => void }).__setLoading(false));
    await expect(page.locator('[aria-busy="true"][role="status"]')).toHaveCount(0, { timeout: 5_000 });
    const wallElapsed = await page.evaluate((start) => performance.now() - start, wallStart);

    const metrics = await page.evaluate(
      () => (window as unknown as { __metrics: Array<Record<string, unknown>> }).__metrics,
    );
    expect(metrics.length).toBeGreaterThanOrEqual(1);
    const metric = metrics[metrics.length - 1]!;
    expect(metric.handoffReason).toBe('successor-painted');
    expect(typeof metric.displayDurationMs).toBe('number');
    expect(typeof metric.handoffMs).toBe('number');
    const total = (metric.displayDurationMs as number) + (metric.handoffMs as number);
    // Wall-time invariant (ADR-16 / spec §3.7): allow generous slack for
    // real browser scheduling — this is a real-clock proof, not a
    // fake-timer unit test.
    expect(Math.abs(total - wallElapsed)).toBeLessThan(300);
  });

  test('the DEFAULT path (no expectsPlaceholder, no successor) still reports handoffReason:no-successor — the paint-detection heuristic must not misfire when nothing was expected', async ({
    page,
    mountReady,
  }) => {
    await mountReady(150);
    await page.evaluate(() => {
      const { React, createRoot, AutoSkeleton, SkeletonProvider, MemoryShapeStore } = window.AutoskeletonComponent;
      const store = new MemoryShapeStore();
      const root = createRoot(document.getElementById('root')!);
      function Harness() {
        const [isLoading, setIsLoading] = React.useState(true);
        (window as unknown as { __setLoading: (v: boolean) => void }).__setLoading = setIsLoading;
        return React.createElement(
          SkeletonProvider,
          { store },
          React.createElement(
            AutoSkeleton,
            {
              isLoading,
              skeletonKey: 'handoff-no-successor-default',
              onMetrics: (m: unknown) => (window as unknown as { __metrics: unknown[] }).__metrics.push(m),
            },
            React.createElement('p', null, 'plain text content, no image at all'),
          ),
        );
      }
      root.render(React.createElement(Harness));
    });
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    );

    await page.evaluate(() => (window as unknown as { __setLoading: (v: boolean) => void }).__setLoading(false));
    await expect(page.locator('[aria-busy="true"][role="status"]')).toHaveCount(0, { timeout: 5_000 });

    const metrics = await page.evaluate(
      () => (window as unknown as { __metrics: Array<Record<string, unknown>> }).__metrics,
    );
    const metric = metrics[metrics.length - 1]!;
    expect(metric.handoffReason).toBe('no-successor');
  });
});
