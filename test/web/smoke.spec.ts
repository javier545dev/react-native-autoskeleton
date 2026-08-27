import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

// Task 0.3 (tasks.md Phase 0): proves the Playwright runner executes a real browser,
// loads the self-hosted test font deterministically (font-display: block, no system
// font), and that `document.fonts.ready` resolves before any measurement would run.
// This is the harness proof; the real DOM sensor fixture harness (shared JSON
// hierarchies under test/fixtures/hierarchies/) is built starting Phase 2.

const FONT_PATH = path.join(__dirname, '../fixtures/fonts/test-font.woff2');
const FONT_URL = 'https://fixtures.autoskeleton.test/test-font.woff2';
const FONT_FAMILY = 'AutoskeletonTestFont';

test('blank page loads the self-hosted test font and reports fonts.ready', async ({
  page,
}) => {
  // Route interception, not a real network fetch: the font is served from the
  // repo-committed fixture bytes so the test is deterministic and works offline,
  // exactly like the shared hierarchy fixtures Phase 2+ will load the same way.
  await page.route('**/test-font.woff2', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'font/woff2',
      body: readFileSync(FONT_PATH),
    });
  });

  await page.setContent(
    `<!doctype html>
<html>
  <head>
    <style>
      @font-face {
        font-family: '${FONT_FAMILY}';
        src: url('${FONT_URL}') format('woff2');
        font-display: block;
      }
      body { font-family: '${FONT_FAMILY}', sans-serif; }
    </style>
  </head>
  <body>fixture harness placeholder</body>
</html>`,
    { waitUntil: 'load' }
  );

  await page.evaluate(() => document.fonts.ready);

  const status = await page.evaluate(() => document.fonts.status);
  expect(status).toBe('loaded');

  const loadedFamilies = await page.evaluate(() =>
    Array.from(document.fonts).map((f) => f.family)
  );
  expect(loadedFamilies).toContain(FONT_FAMILY);
});
