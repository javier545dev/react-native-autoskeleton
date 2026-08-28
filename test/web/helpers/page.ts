// test/web/helpers/page.ts
//
// Shared page-setup helpers for the web sensor/renderer/component Playwright
// suites (plan.md §7.3): the self-hosted test font (never a system font, per
// task 0.3's smoke test / plan.md §7.3 determinism rules), and a 0.5 px
// geometry-tolerance assertion helper (never `toEqual` on raw floats).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { bundleEntry } from './bundle';

const FONT_PATH = path.join(__dirname, '../../fixtures/fonts/test-font.woff2');
const FONT_URL = 'https://fixtures.autoskeleton.test/test-font.woff2';
export const FONT_FAMILY = 'AutoskeletonTestFont';
/** 0.5 px tolerance per plan.md §7.3 — geometry assertions never use `toEqual`
 *  on raw floats. */
export const GEOMETRY_TOLERANCE_PX = 0.5;

/** Loads a page with `bodyHtml` inside a `<body>` styled with the self-hosted
 *  test font, waits for `document.fonts.ready`, then injects the bundled
 *  production module graph from `entryPath` as `window.Autoskeleton`. */
export async function loadHarness(
  page: Page,
  entryPath: string,
  bodyHtml: string,
  options: { direction?: 'ltr' | 'rtl'; extraHeadHtml?: string } = {},
): Promise<void> {
  await page.route('**/test-font.woff2', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'font/woff2',
      body: readFileSync(FONT_PATH),
    });
  });

  const direction = options.direction ?? 'ltr';
  await page.setContent(
    `<!doctype html>
<html dir="${direction}">
  <head>
    <style>
      @font-face {
        font-family: '${FONT_FAMILY}';
        src: url('${FONT_URL}') format('woff2');
        font-display: block;
      }
      * { box-sizing: border-box; }
      body { margin: 0; font-family: '${FONT_FAMILY}', sans-serif; }
    </style>
    ${options.extraHeadHtml ?? ''}
  </head>
  <body>${bodyHtml}</body>
</html>`,
    { waitUntil: 'load' },
  );
  await page.evaluate(() => document.fonts.ready);

  const bundle = await bundleEntry(entryPath);
  await page.addScriptTag({ content: bundle });
}

/** Asserts two numbers are within `GEOMETRY_TOLERANCE_PX` of each other —
 *  the "never `toEqual` on raw floats" rule from plan.md §7.3. */
export function expectCloseTo(actual: number, expected: number, message?: string): void {
  expect(Math.abs(actual - expected), message ?? `expected ${actual} ~= ${expected}`).toBeLessThanOrEqual(
    GEOMETRY_TOLERANCE_PX,
  );
}
