// test/ssr/dashboard.spec.ts
//
// tasks.md 8.3: `<AutoSkeleton.SSR skeletonKey>` server component + client
// hydration bridge, verified end to end against the REAL Next.js example
// app (`examples/next`) — never a hand-rolled harness. Two-phase setup (see
// `./helpers/next-server.ts`): capture under `next dev`, then verify under a
// fresh `next build && next start` so the manifest/CSS bundle the capture
// CLI just wrote are baked into the compiled production server.
//
// Zero-hydration-mismatch is proven three separate ways (never conflated,
// per this session's brief): (1) the server-rendered markup genuinely
// contains real skeleton geometry (a non-empty `clip-path`, JS disabled so
// nothing client-side could have produced it); (2) hydration completes with
// no React console warning AND the pre/post-hydration DOM is structurally
// unchanged (a mismatch would make React discard and re-render the subtree,
// changing it); (3) the eventual painted result is correct (real content
// swaps in once the simulated fetch resolves).

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { runCapture } from '../../cli/capture';
import { buildAndStartNextProd, startNextDev, type RunningServer } from './helpers/next-server';

const GENERATED_DIR = path.resolve(__dirname, '../../examples/next/generated/autoskeleton-ssr');
const CAPTURED_BUCKETS = [375, 1280] as const; // subset: proves "correct at MORE than one width"
const CAPTURE_DEV_PORT = 4101;
const PROD_PORT = 4102;

let prodServer: RunningServer;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(300_000);

  const devServer = await startNextDev(CAPTURE_DEV_PORT);
  try {
    await runCapture({
      baseURL: devServer.baseURL,
      registry: { dashboard: '/dashboard-capture' },
      outDir: GENERATED_DIR,
      widthBuckets: [...CAPTURED_BUCKETS],
      directions: ['ltr', 'rtl'],
    });
  } finally {
    await devServer.stop();
  }

  prodServer = await buildAndStartNextProd(PROD_PORT);
});

test.afterAll(async ({}, testInfo) => {
  testInfo.setTimeout(60_000);
  await prodServer?.stop();
  // Deliberately does NOT delete `GENERATED_DIR` — it is committed, real
  // build output (the same as running the capture CLI's own `main()` would
  // produce), left in place so `examples/next` keeps working standalone
  // after this suite runs, exactly like a real `next-capture && next build`
  // pipeline would leave it.
});

function hydrationErrorsFrom(consoleTexts: readonly string[]): string[] {
  return consoleTexts.filter((text) => /hydrat/i.test(text) || /did not match/i.test(text));
}

test.describe('AutoSkeleton.SSR — server markup genuinely contains skeleton geometry (aspect 1/3)', () => {
  test('with JS disabled, the served HTML contains a real, non-empty clip-path rule for the captured key', async ({
    browser,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const response = await page.goto(`${prodServer.baseURL}/dashboard`);
    expect(response?.ok()).toBe(true);

    const html = await page.content();
    // The fallback overlay element itself, with JS disabled, must be the
    // ACTUAL served markup — not a placeholder a script would later fill in.
    expect(html).toContain('data-askl-ssr-key="dashboard"');
    expect(html).toContain('data-askl-ssr-dir="ltr"');
    expect(html).toContain('aria-busy="true"');

    // The CSS bundle (also served with JS disabled — it's a <link>/<style>,
    // not script-injected) must carry a REAL clip-path for this bucket,
    // proving the "skeleton geometry" claim isn't just an empty div.
    const cssBundle = await readFile(path.join(GENERATED_DIR, 'bundle.css'), 'utf8');
    expect(cssBundle).toMatch(/\[data-askl-ssr-key="dashboard"\]\[data-askl-ssr-dir="ltr"\]\{clip-path:path\(/);

    await context.close();
  });
});

test.describe('AutoSkeleton.SSR — zero hydration mismatch (aspect 2/3: console + DOM equality)', () => {
  test('hydration completes with no React console warning, and the fallback DOM is unchanged pre/post-hydration', async ({
    page,
  }) => {
    const consoleTexts: string[] = [];
    page.on('console', (msg) => consoleTexts.push(msg.text()));
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    // `waitUntil: 'load'`/`'domcontentloaded'` both block until the FULL
    // streamed response finishes — which, for this route, is AFTER
    // DashboardContent's 1200ms simulated fetch resolves and the real
    // content has already swapped in. `'commit'` fires as soon as
    // navigation is committed, well before the response finishes streaming,
    // so the fallback's markup can still be caught in the DOM.
    await page.goto(`${prodServer.baseURL}/dashboard`, { waitUntil: 'commit' });
    await page.waitForSelector('[data-askl-ssr-key="dashboard"]', { state: 'attached', timeout: 5_000 });

    const preHydrationOuterHtml = await page.evaluate(
      () => document.querySelector('[data-askl-ssr-key="dashboard"]')?.outerHTML ?? null,
    );
    expect(preHydrationOuterHtml).not.toBeNull();

    // Give React a moment to finish hydrating this subtree (well under the
    // 1200ms content swap) and re-read the SAME element.
    await page.waitForTimeout(200);
    const postHydrationOuterHtml = await page.evaluate(
      () => document.querySelector('[data-askl-ssr-key="dashboard"]')?.outerHTML ?? null,
    );

    expect(postHydrationOuterHtml).toBe(preHydrationOuterHtml);
    expect(hydrationErrorsFrom(consoleTexts), consoleTexts.join('\n')).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});

test.describe('AutoSkeleton.SSR — the eventual painted result is correct (aspect 3/3)', () => {
  test('real content replaces the fallback once the simulated fetch resolves, with no lingering skeleton', async ({
    page,
  }) => {
    await page.goto(`${prodServer.baseURL}/dashboard`);
    await expect(page.getByRole('heading', { name: 'Q3 Revenue Dashboard' })).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[data-askl-ssr-key="dashboard"]')).toHaveCount(0);
  });
});

test.describe('AutoSkeleton.SSR — one server payload correct at MULTIPLE widths (load-bearing SSR assertion)', () => {
  for (const bucket of CAPTURED_BUCKETS) {
    test(`at viewport width ${bucket}, the fallback's computed geometry matches THAT bucket's captured dimensions`, async ({
      browser,
    }) => {
      const context = await browser.newContext({
        javaScriptEnabled: false,
        viewport: { width: bucket, height: 900 },
      });
      const page = await context.newPage();
      await page.goto(`${prodServer.baseURL}/dashboard`);

      const clipPath = await page.evaluate(
        () => getComputedStyle(document.querySelector('[data-askl-ssr-key="dashboard"]')!).clipPath,
      );
      expect(clipPath).toContain('path(');
      expect(clipPath).not.toBe('none');

      await context.close();
    });
  }

  test('the SAME served bundle.css contains genuinely different rules for the two captured buckets (never one rule reused under two @media guards)', async () => {
    const cssBundle = await readFile(path.join(GENERATED_DIR, 'bundle.css'), 'utf8');
    const blocks = cssBundle.split('@media').slice(1).filter((b) => b.includes('dashboard'));
    // Exactly one @media block per captured bucket — never merged, never
    // duplicated (mirrors cli/media-bundle.test.ts's own drift-guard check,
    // now proven against what actually got SERVED, not just generated).
    expect(blocks).toHaveLength(CAPTURED_BUCKETS.length);
    expect(blocks[0]).not.toBe(blocks[1]);
    const clipPaths = blocks.map((b) => /clip-path:(path\([^)]*\))/.exec(b)?.[1]);
    expect(clipPaths[0]).toBeDefined();
    expect(clipPaths[1]).toBeDefined();
    expect(clipPaths[0]).not.toBe(clipPaths[1]);
  });
});

test.describe('AutoSkeleton.SSR — RTL direction replay', () => {
  test('the RTL route serves data-askl-ssr-dir="rtl" with zero hydration mismatch', async ({ page }) => {
    const consoleTexts: string[] = [];
    page.on('console', (msg) => consoleTexts.push(msg.text()));

    // See the aspect-2/3 test above for why `waitUntil: 'commit'` (not
    // `'load'`) is required to catch the fallback before it swaps.
    await page.goto(`${prodServer.baseURL}/dashboard-rtl`, { waitUntil: 'commit' });
    await page.waitForSelector('[data-askl-ssr-key="dashboard"]', { state: 'attached', timeout: 5_000 });
    const outerHtml = await page.evaluate(
      () => document.querySelector('[data-askl-ssr-key="dashboard"]')?.outerHTML ?? null,
    );
    expect(outerHtml).toContain('data-askl-ssr-dir="rtl"');

    await page.waitForTimeout(200);
    expect(hydrationErrorsFrom(consoleTexts), consoleTexts.join('\n')).toEqual([]);
  });
});

test.describe('AutoSkeleton.SSR — ADR-12 uncaptured skeletonKey renders the SAME neutral block server AND client', () => {
  test('an uncaptured key serves the neutral block with zero hydration mismatch', async ({ page }) => {
    const consoleTexts: string[] = [];
    page.on('console', (msg) => consoleTexts.push(msg.text()));

    await page.goto(`${prodServer.baseURL}/uncaptured`, { waitUntil: 'commit' });
    await page.waitForSelector('[data-askl-ssr-neutral="true"]', { state: 'attached', timeout: 5_000 });
    const preHydrationOuterHtml = await page.evaluate(
      () => document.querySelector('[data-askl-ssr-neutral="true"]')?.outerHTML ?? null,
    );
    expect(preHydrationOuterHtml).not.toBeNull();
    expect(preHydrationOuterHtml).not.toContain('data-askl-ssr-key');

    await page.waitForTimeout(200);
    const postHydrationOuterHtml = await page.evaluate(
      () => document.querySelector('[data-askl-ssr-neutral="true"]')?.outerHTML ?? null,
    );
    expect(postHydrationOuterHtml).toBe(preHydrationOuterHtml);
    expect(hydrationErrorsFrom(consoleTexts), consoleTexts.join('\n')).toEqual([]);
  });
});
