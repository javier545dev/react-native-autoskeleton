// test/web/shadow-dom.spec.ts
//
// The DOM sensor walks `element.children`, which never crosses a shadow
// boundary: a shadow host reports `children.length === 0` and
// `textContent === ''` no matter how much laid-out content its shadow tree
// paints. So a design-system consumer whose components are custom elements
// got a skeleton with a hole in it — and, because the host is usually a
// transparent wrapper, `hasNonTransparentBackground()` did not even fall back
// to the host's own box.
//
// Open and closed roots are NOT symmetric, and this suite pins both halves:
// an open root is reachable (`el.shadowRoot`) and is now traversed; a closed
// root is not merely untraversable, it is UNDETECTABLE — `el.shadowRoot` is
// `null` for a closed host and for an ordinary element alike, so there is no
// observation a sensor could make to report the gap either. That asymmetry is
// the reason the fix is "traverse what can be reached" rather than "raise a
// degradation flag", and the closed-root test below is what keeps that claim
// honest rather than assumed.

import path from 'node:path';
import { expect, test } from '@playwright/test';
import { expectCloseTo, loadHarness } from './helpers/page';

const ENTRY = path.join(__dirname, 'helpers/dom-sensor-entry.ts');

interface Shape {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Loads the harness, runs `mutate` (which attaches the shadow roots — they
 *  cannot come from `setContent` markup, only from script), then measures
 *  `#root` with the REAL production sensor. */
async function measureAfter(
  page: import('@playwright/test').Page,
  bodyHtml: string,
  mutate: string,
): Promise<{ shapes: Shape[]; degraded: string[] }> {
  await loadHarness(page, ENTRY, bodyHtml);
  return page.evaluate((mutateSource) => {
    // eslint-disable-next-line no-new-func
    new Function(mutateSource)();
    const { createDomSensor, createEmptyHintRegistry, composeCacheKey, decodeWire } = window.Autoskeleton;
    const result = createDomSensor!().measure(document.getElementById('root')!, {
      key: composeCacheKey!({
        skeletonKey: 'shadow',
        viewportWidth: 375,
        fontScale: 1,
        direction: 'ltr',
        platform: 'web',
      }),
      hints: createEmptyHintRegistry!(),
      budgetMs: 50,
      maxShapes: 60,
      defaultRadius: 4,
      collectDebugSidecars: false,
    });
    if (result === null) {
      return { shapes: [], degraded: [] };
    }
    return {
      shapes: decodeWire!(result.snapshot.data).shapes.map((s) => ({ x: s.x, y: s.y, w: s.w, h: s.h })),
      degraded: [...result.degraded],
    };
  }, mutate);
}

const ROOT = (inner: string): string =>
  `<div id="root" style="position:relative;width:200px;">${inner}</div>`;

test.describe('DOM sensor — open shadow roots', () => {
  test('content inside an open shadow root is detected, at its real laid-out geometry', async ({
    page,
  }) => {
    const { shapes } = await measureAfter(
      page,
      ROOT(`<div id="host"></div>`),
      `document.getElementById('host').attachShadow({ mode: 'open' }).innerHTML =
         '<div style="width:80px;height:25px;background:#0f0"></div>';`,
    );
    expect(shapes.length).toBe(1);
    expectCloseTo(shapes[0]!.x, 0, 'x');
    expectCloseTo(shapes[0]!.y, 0, 'y');
    expectCloseTo(shapes[0]!.w, 80, 'w');
    expectCloseTo(shapes[0]!.h, 25, 'h');
  });

  test('shadow content is measured alongside light-DOM siblings, in document order', async ({
    page,
  }) => {
    const { shapes } = await measureAfter(
      page,
      ROOT(
        `<div style="width:100px;height:20px;background:#f00"></div>` +
          `<div id="host"></div>` +
          `<div style="width:60px;height:30px;background:#00f"></div>`,
      ),
      `document.getElementById('host').attachShadow({ mode: 'open' }).innerHTML =
         '<div style="width:80px;height:25px;background:#0f0"></div>';`,
    );
    expect(shapes.map((s) => Math.round(s.h))).toEqual([20, 25, 30]);
    expect(shapes.map((s) => Math.round(s.y))).toEqual([0, 20, 45]);
  });

  test('a slotted light child is shaped exactly ONCE, not once per tree it appears in', async ({
    page,
  }) => {
    // The child lives in the light DOM (so `host.children` reaches it) and is
    // rendered through a `<slot>` in the shadow tree (so a naive "walk both
    // trees" would find it twice and pay for it twice against `maxShapes`).
    const { shapes } = await measureAfter(
      page,
      ROOT(`<div id="host"><div style="width:90px;height:40px;background:#f0f"></div></div>`),
      `document.getElementById('host').attachShadow({ mode: 'open' }).innerHTML = '<slot></slot>';`,
    );
    expect(shapes.length).toBe(1);
    expectCloseTo(shapes[0]!.w, 90, 'w');
    expectCloseTo(shapes[0]!.h, 40, 'h');
  });

  test('text inside an open shadow root resolves per line box, like any other text leaf', async ({
    page,
  }) => {
    const { shapes } = await measureAfter(
      page,
      ROOT(`<div id="host"></div>`),
      `document.getElementById('host').attachShadow({ mode: 'open' }).innerHTML =
         '<p style="margin:0;font-size:16px;line-height:20px;white-space:pre-line">one\\ntwo\\nthree</p>';`,
    );
    expect(shapes.length).toBe(3);
  });
});

test.describe('DOM sensor — closed shadow roots are undetectable, not merely untraversable', () => {
  test('a closed host is indistinguishable from an ordinary empty element', async ({ page }) => {
    await loadHarness(page, ENTRY, ROOT(`<div id="closed"></div><div id="plain"></div>`));
    const observations = await page.evaluate(() => {
      document.getElementById('closed')!.attachShadow({ mode: 'closed' }).innerHTML =
        '<div style="width:70px;height:15px;background:#ff0"></div>';
      const closed = document.getElementById('closed')!;
      const plain = document.getElementById('plain')!;
      return {
        closedShadowRoot: closed.shadowRoot,
        plainShadowRoot: plain.shadowRoot,
        closedChildren: closed.children.length,
        plainChildren: plain.children.length,
        closedText: closed.textContent,
        plainText: plain.textContent,
      };
    });
    // Every observable the sensor could branch on reports the same value for
    // both. There is therefore no honest `DegradationFlag` to raise for a
    // closed root: raising one would require a signal that does not exist,
    // and the only way to learn the truth (`attachShadow` throwing) means
    // mutating the consumer's DOM, which a read-only sensor must never do.
    expect(observations.closedShadowRoot).toBeNull();
    expect(observations.plainShadowRoot).toBeNull();
    expect(observations.closedChildren).toBe(observations.plainChildren);
    expect(observations.closedText).toBe(observations.plainText);
  });
});
