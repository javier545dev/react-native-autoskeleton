import path from 'node:path';
import { expect, test } from '@playwright/test';
import { loadHarness } from './helpers/page';

// `leafShape()` refuses to shape a leaf whose computed `opacity` is `0` —
// covering something invisible with an opaque block draws a shape over empty
// space. It did not look at `visibility`, which appears nowhere in the module,
// so a `visibility: hidden` element was measured exactly like a visible one:
// it keeps its box and reports a real `getBoundingClientRect()`.
//
// WHY THIS IS A PLAYWRIGHT SPEC AND NOT A UNIT TEST. jsdom implements no
// `getClientRects()` geometry, so a hidden element's box — the whole subject
// here — does not exist there. The same reason `dom-sensor.spec.ts` gives.
//
// WHY BOTH BRANCHES ARE ASSERTED SEPARATELY. `traverse` dispatches text leaves
// to `textLeafShapes` before `leafShape` is ever reached. The first version of
// this fix only guarded `leafShape`, and a hidden <span> kept producing its
// shape — caught by building the demo, not by reading the diff. One test per
// branch, so a future refactor that reunifies or re-splits those paths cannot
// half-pass.

const ENTRY = path.join(__dirname, 'helpers/dom-sensor-entry.ts');

async function shapeCount(page: import('@playwright/test').Page, bodyHtml: string): Promise<number> {
  await loadHarness(page, ENTRY, bodyHtml);
  return page.evaluate(() => {
    const { createDomSensor, createEmptyHintRegistry, composeCacheKey, decodeWire } =
      window.Autoskeleton;
    const sensor = createDomSensor!();
    const root = document.getElementById('root')!;
    const key = composeCacheKey!({
      skeletonKey: 'visibility',
      viewportWidth: 375,
      fontScale: 1,
      direction: 'ltr',
      platform: 'web',
    });
    const result = sensor.measure(root, {
      key,
      hints: createEmptyHintRegistry!(),
      budgetMs: 50,
      maxShapes: 60,
      defaultRadius: 4,
      collectDebugSidecars: false,
    });
    return result === null ? 0 : decodeWire!(result.snapshot.data).shapes.length;
  });
}

/** Two leaves that always count, so the delta below can only come from the
 *  third one. Keeping a constant floor makes a regression that drops
 *  everything look different from one that drops only the hidden leaf. */
const ALWAYS_SHAPED = `
  <div style="width:64px;height:64px;background:#ccc"></div>
  <p style="width:200px">visible paragraph</p>
`;

test.describe('visibility: hidden contributes no shape', () => {
  test('a hidden TEXT leaf is not shaped, and a visible one is', async ({ page }) => {
    const visible = await shapeCount(
      page,
      `<div id="root">${ALWAYS_SHAPED}<span style="visibility:visible">badge</span></div>`
    );
    const hidden = await shapeCount(
      page,
      `<div id="root">${ALWAYS_SHAPED}<span style="visibility:hidden">badge</span></div>`
    );
    expect(visible, 'the visible control must itself produce shapes').toBeGreaterThan(0);
    expect(hidden, 'the hidden span still produced a shape').toBe(visible - 1);
  });

  test('a hidden NON-TEXT leaf is not shaped, and a visible one is', async ({ page }) => {
    const box = (v: string) =>
      `<div id="root">${ALWAYS_SHAPED}<div style="width:40px;height:12px;background:#333;visibility:${v}"></div></div>`;
    const visible = await shapeCount(page, box('visible'));
    const hidden = await shapeCount(page, box('hidden'));
    expect(visible, 'the visible control must itself produce shapes').toBeGreaterThan(0);
    expect(hidden, 'the hidden box still produced a shape').toBe(visible - 1);
  });

  test('a leaf that opts back in under a hidden ancestor is still shaped', async ({ page }) => {
    // `visibility` inherits and `getComputedStyle` resolves that before the
    // sensor reads it, which is why one leaf-level check is complete. The same
    // property is what makes `visibility: visible` a real escape hatch, so a
    // fix that skipped hidden SUBTREES wholesale would break this case.
    const hiddenParent = `<div id="root">${ALWAYS_SHAPED}<div style="visibility:hidden"><span style="visibility:visible">opted back in</span></div></div>`;
    const bothHidden = `<div id="root">${ALWAYS_SHAPED}<div style="visibility:hidden"><span>stays hidden</span></div></div>`;
    expect(await shapeCount(page, hiddenParent)).toBe((await shapeCount(page, bothHidden)) + 1);
  });
});
