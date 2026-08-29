// test/web/dom-sensor.spec.ts
//
// tasks.md 2.1 — the web `Sensor<HTMLElement>`. Runs the REAL production
// `createDomSensor()` inside `page.evaluate` against real DOM layout
// (plan.md §7.3). jsdom is explicitly banned for this module: it does not
// implement `getClientRects()` geometry (jsdom #653, #3729), which is the
// exact API the per-line text leaf detection below depends on — a jsdom-run
// version of this suite would see an empty `DOMRectList` and every
// multi-line assertion would silently pass against nothing. That is why this
// suite runs under Playwright/real Chromium, never Vitest/jsdom.

import path from 'node:path';
import { expect, test as base } from '@playwright/test';
import { expectCloseTo, loadHarness } from './helpers/page';

const ENTRY = path.join(__dirname, 'helpers/dom-sensor-entry.ts');

const test = base.extend<{ measure: (bodyHtml: string, opts?: MeasureOpts) => Promise<MeasureResult> }>({
  // eslint-disable-next-line no-empty-pattern
  measure: async ({ page }, use) => {
    await use(async (bodyHtml, opts = {}) => {
      await loadHarness(page, ENTRY, bodyHtml, { direction: opts.direction });
      return page.evaluate((options) => {
        const { createDomSensor, createEmptyHintRegistry, composeCacheKey, decodeWire, RADIUS_SOURCES } =
          window.Autoskeleton;
        const sensor = createDomSensor!();
        const root = document.getElementById('root')!;
        const key = composeCacheKey!({
          skeletonKey: 'test',
          viewportWidth: 375,
          fontScale: 1,
          direction: options.direction ?? 'ltr',
          platform: 'web',
        });
        const result = sensor.measure(root, {
          key,
          hints: createEmptyHintRegistry!(),
          budgetMs: options.budgetMs ?? 50,
          maxShapes: options.maxShapes ?? 60,
          defaultRadius: 4,
          collectDebugSidecars: options.collectDebugSidecars ?? true,
        });
        if (result === null) {
          return { shapes: null, frame: null, degraded: [], traversalMs: 0, hasProfileMarks: false };
        }
        const decoded = decodeWire!(result.snapshot.data);
        const marks = performance.getEntriesByName('autoskeleton-traversal', 'measure');
        const radiusSources = result.snapshot.radiusSources
          ? Array.from(result.snapshot.radiusSources, (i) => RADIUS_SOURCES![i]!)
          : undefined;
        return {
          shapes: decoded.shapes.map((s) => ({ x: s.x, y: s.y, w: s.w, h: s.h, r: s.r })),
          frame: { w: result.snapshot.frameWidth, h: result.snapshot.frameHeight },
          degraded: result.degraded,
          traversalMs: result.traversalMs,
          hasProfileMarks: marks.length > 0,
          sourcesLength: result.snapshot.sources?.length,
          radiusSources,
        };
      }, opts);
    });
  },
});

interface MeasureOpts {
  readonly direction?: 'ltr' | 'rtl';
  readonly budgetMs?: number;
  readonly maxShapes?: number;
  readonly collectDebugSidecars?: boolean;
}

interface MeasureResult {
  readonly shapes: { x: number; y: number; w: number; h: number; r: number }[] | null;
  readonly frame: { w: number; h: number } | null;
  readonly degraded: readonly string[];
  readonly traversalMs: number;
  readonly hasProfileMarks: boolean;
  readonly sourcesLength?: number;
  readonly radiusSources?: readonly string[];
}

const TEXT_STYLE = 'margin:0;font-size:16px;line-height:20px;white-space:pre-line;';

test.describe('DOM sensor — per-line text (multi-line box detection)', () => {
  test('1-line text box produces exactly one shape', async ({ measure }) => {
    const { shapes } = await measure(
      `<div id="root" style="position:relative;width:300px;"><p style="${TEXT_STYLE}">Single line</p></div>`,
    );
    expect(shapes).toHaveLength(1);
  });

  test('2-line text box produces exactly two shapes', async ({ measure }) => {
    const { shapes } = await measure(
      `<div id="root" style="position:relative;width:300px;"><p style="${TEXT_STYLE}">Line one\nLine two</p></div>`,
    );
    expect(shapes).toHaveLength(2);
  });

  test('5-line text box produces exactly five shapes', async ({ measure }) => {
    const { shapes } = await measure(
      `<div id="root" style="position:relative;width:300px;"><p style="${TEXT_STYLE}">L1\nL2\nL3\nL4\nL5</p></div>`,
    );
    expect(shapes).toHaveLength(5);
  });

  test('real soft-wrap (no explicit breaks) still produces multiple line shapes', async ({ measure }) => {
    const longText =
      'This paragraph is intentionally long so that a one hundred pixel wide container forces ' +
      'real browser line-wrapping across several lines without any explicit break characters.';
    const { shapes } = await measure(
      `<div id="root" style="position:relative;width:100px;"><p style="margin:0;font-size:14px;line-height:18px;">${longText}</p></div>`,
    );
    expect(shapes!.length).toBeGreaterThan(1);
    for (const shape of shapes!) {
      expect(shape.h).toBeGreaterThan(0);
      expect(shape.w).toBeGreaterThan(0);
    }
  });

  test('justified text still resolves one shape per line box', async ({ measure }) => {
    const longText =
      'Justified text alignment spaces out each line so it reaches both edges except the last, ' +
      'and this sensor must still detect one shape per real line box.';
    const { shapes } = await measure(
      `<div id="root" style="position:relative;width:150px;"><p style="margin:0;font-size:14px;line-height:18px;text-align:justify;">${longText}</p></div>`,
    );
    expect(shapes!.length).toBeGreaterThan(1);
  });
});

test.describe('DOM sensor — RTL', () => {
  test('a short line shifts toward the trailing edge under RTL vs LTR', async ({ measure }) => {
    const html = `<div id="root" style="position:relative;width:200px;"><p style="margin:0;font-size:16px;">Hi</p></div>`;
    const ltr = await measure(html, { direction: 'ltr' });
    const rtl = await measure(html, { direction: 'rtl' });
    expect(ltr.shapes).toHaveLength(1);
    expect(rtl.shapes).toHaveLength(1);
    // LTR: short line starts near x=0. RTL: 'start' resolves to the right
    // edge, so the same short line's x is pushed well to the right. This is
    // exactly the real-browser-only geometry jsdom cannot produce.
    expect(ltr.shapes![0]!.x).toBeLessThan(20);
    expect(rtl.shapes![0]!.x).toBeGreaterThan(100);
  });
});

test.describe('DOM sensor — container-vs-leaf resolution (spec §1.1)', () => {
  test('a container with detectable leaves omits its own shape', async ({ measure }) => {
    const { shapes } = await measure(
      `<div id="root" style="position:relative;width:300px;">
         <div style="background:#ff0000;padding:8px;">
           <p style="margin:0;font-size:16px;">Card text</p>
         </div>
       </div>`,
    );
    // Exactly the text leaf's shape(s) — the red container contributes none.
    expect(shapes!.length).toBeGreaterThanOrEqual(1);
    for (const shape of shapes!) {
      expect(shape.w).toBeLessThan(300);
    }
  });

  test('a container with no detectable leaves renders its own shape instead', async ({ measure }) => {
    const { shapes } = await measure(
      `<div id="root" style="position:relative;width:300px;">
         <div id="card" style="background:#00ff00;width:120px;height:60px;">
           <div style="background:transparent;width:100%;height:100%;"></div>
         </div>
       </div>`,
    );
    expect(shapes).toHaveLength(1);
    expect(shapes![0]!.w).toBeCloseTo(120, 0);
    expect(shapes![0]!.h).toBeCloseTo(60, 0);
  });
});

test.describe('DOM sensor — typed radius hint (R0, plan.md ADR-2)', () => {
  test('a data-autoskeleton-radius attribute overrides the measured computed-style radius, and radiusSource reports "hint"', async ({
    measure,
  }) => {
    const { shapes, radiusSources } = await measure(
      `<div id="root" style="position:relative;width:300px;">
         <div data-autoskeleton-radius="20" style="background:#00ff00;width:120px;height:60px;border-radius:4px;"></div>
       </div>`,
    );
    expect(shapes).toHaveLength(1);
    expect(shapes![0]!.r).toBe(20);
    expect(radiusSources).toEqual(['hint']);
  });

  test('without the attribute, the same node measures its real computed-style radius', async ({ measure }) => {
    const { shapes, radiusSources } = await measure(
      `<div id="root" style="position:relative;width:300px;">
         <div style="background:#00ff00;width:120px;height:60px;border-radius:4px;"></div>
       </div>`,
    );
    expect(shapes).toHaveLength(1);
    expect(shapes![0]!.r).toBe(4);
    expect(radiusSources).toEqual(['measured']);
  });

  test('an invalid (non-numeric) attribute value falls back to the measured radius', async ({ measure }) => {
    const { shapes, radiusSources } = await measure(
      `<div id="root" style="position:relative;width:300px;">
         <div data-autoskeleton-radius="not-a-number" style="background:#00ff00;width:120px;height:60px;border-radius:4px;"></div>
       </div>`,
    );
    expect(shapes).toHaveLength(1);
    expect(shapes![0]!.r).toBe(4);
    expect(radiusSources).toEqual(['measured']);
  });
});

test.describe('DOM sensor — Ignore subtree', () => {
  test('data-autoskeleton-ignore excludes the entire subtree', async ({ measure }) => {
    const { shapes } = await measure(
      `<div id="root" style="position:relative;width:300px;">
         <p style="margin:0;font-size:16px;">Visible</p>
         <div data-autoskeleton-ignore="true">
           <p style="margin:0;font-size:16px;">Hidden text</p>
           <div style="background:#0000ff;width:20px;height:20px;"></div>
         </div>
       </div>`,
    );
    expect(shapes).toHaveLength(1);
  });
});

test.describe('DOM sensor — depth guard (unbounded recursion crash fix)', () => {
  test('a ~3000-level singly-nested tree truncates gracefully and reports depth-cap-reached, instead of crashing the renderer', async ({
    measure,
  }) => {
    const DEPTH = 3000;
    let html = '<div style="background:#333333;width:100%;height:4px;"></div>';
    for (let i = 0; i < DEPTH; i++) {
      html = `<div style="background:#333333;">${html}</div>`;
    }
    const { shapes, degraded } = await measure(`<div id="root" style="position:relative;width:100px;">${html}</div>`);
    // Graceful truncation, not a crash and not an uncaught RangeError: the
    // call resolves, degraded is non-empty, and the shape list is bounded
    // far below what a full 3000-level traversal would otherwise produce.
    expect(degraded).toContain('depth-cap-reached');
    expect(shapes).not.toBeNull();
    expect(shapes!.length).toBeLessThan(50);
  });

  test('a shallow, realistically-deep tree (40 levels) is unaffected by the depth guard', async ({ measure }) => {
    let html = '<p style="margin:0;font-size:16px;">Leaf text</p>';
    for (let i = 0; i < 40; i++) {
      html = `<div>${html}</div>`;
    }
    const { shapes, degraded } = await measure(`<div id="root" style="position:relative;width:300px;">${html}</div>`);
    expect(shapes).toHaveLength(1);
    expect(degraded).not.toContain('depth-cap-reached');
  });
});

test.describe('DOM sensor — overflow clipping (text-overflow ellipsis leak fix)', () => {
  const LONG_TITLE =
    'A very long card title that will definitely overflow eighty pixels of available width easily';

  test('an ancestor with overflow:hidden;white-space:nowrap;text-overflow:ellipsis clips the measured text shape to its own box, not the full laid-out text width', async ({
    measure,
  }) => {
    const { shapes } = await measure(
      `<div id="root" style="position:relative;width:300px;">
         <div style="width:80px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
           <p style="margin:0;font-size:16px;">${LONG_TITLE}</p>
         </div>
       </div>`,
    );
    expect(shapes!.length).toBeGreaterThan(0);
    for (const shape of shapes!) {
      // Real (unclamped) laid-out text at this font size is many times wider
      // than the 80px clipping ancestor — reproduces the reported "w:465px
      // against 80px of visible text" defect.
      expect(shape.w).toBeLessThanOrEqual(80);
    }
  });

  test('overflow:hidden set directly ON the text leaf itself (no separate wrapper) also clips', async ({
    measure,
  }) => {
    const { shapes } = await measure(
      `<div id="root" style="position:relative;width:300px;">
         <p style="margin:0;font-size:16px;width:80px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${LONG_TITLE}</p>
       </div>`,
    );
    expect(shapes!.length).toBeGreaterThan(0);
    for (const shape of shapes!) {
      expect(shape.w).toBeLessThanOrEqual(80);
    }
  });

  test('an overflow:auto scroll container clips the same way as overflow:hidden', async ({ measure }) => {
    const { shapes } = await measure(
      `<div id="root" style="position:relative;width:300px;">
         <div style="width:80px;height:20px;white-space:nowrap;overflow:auto;">
           <p style="margin:0;font-size:16px;">${LONG_TITLE}</p>
         </div>
       </div>`,
    );
    expect(shapes!.length).toBeGreaterThan(0);
    for (const shape of shapes!) {
      expect(shape.w).toBeLessThanOrEqual(80);
    }
  });

  test('a nested overflow:hidden inside a wider overflow:auto ancestor clips to the INNER (narrower) box — intersection, not just the nearest', async ({
    measure,
  }) => {
    const { shapes } = await measure(
      `<div id="root" style="position:relative;width:300px;">
         <div style="width:200px;overflow:auto;">
           <div style="width:60px;overflow:hidden;white-space:nowrap;">
             <p style="margin:0;font-size:16px;">${LONG_TITLE}</p>
           </div>
         </div>
       </div>`,
    );
    expect(shapes!.length).toBeGreaterThan(0);
    for (const shape of shapes!) {
      expect(shape.w).toBeLessThanOrEqual(60);
    }
  });

  test('no overflow ancestor: the full multi-line wrapped text is still measured, unaffected (no regression)', async ({
    measure,
  }) => {
    const { shapes } = await measure(
      `<div id="root" style="position:relative;width:300px;">
         <p style="margin:0;font-size:14px;line-height:18px;">${LONG_TITLE}</p>
       </div>`,
    );
    expect(shapes!.length).toBeGreaterThan(0);
  });
});

test.describe('DOM sensor — budgets and observability', () => {
  test('maxShapes truncates and reports shape-cap-reached', async ({ measure }) => {
    const boxes = Array.from(
      { length: 5 },
      (_, i) => `<div style="background:#333;width:10px;height:10px;margin-top:${i * 12}px;"></div>`,
    ).join('');
    const { shapes, degraded } = await measure(
      `<div id="root" style="position:relative;width:100px;">${boxes}</div>`,
      { maxShapes: 3 },
    );
    expect(shapes).toHaveLength(3);
    expect(degraded).toContain('shape-cap-reached');
  });

  test('emits performance.mark/measure around traversal (REQ-OBS-PROFILE-1)', async ({ measure }) => {
    const { hasProfileMarks } = await measure(
      `<div id="root" style="position:relative;width:100px;"><p style="margin:0;">Text</p></div>`,
    );
    expect(hasProfileMarks).toBe(true);
  });

  test('collectDebugSidecars populates the sources sidecar; disabling it omits sidecars', async ({ measure }) => {
    const html = `<div id="root" style="position:relative;width:100px;"><p style="margin:0;">Text</p></div>`;
    const withSidecars = await measure(html, { collectDebugSidecars: true });
    const withoutSidecars = await measure(html, { collectDebugSidecars: false });
    expect(withSidecars.sourcesLength).toBe(withSidecars.shapes!.length);
    expect(withoutSidecars.sourcesLength).toBeUndefined();
  });

  test('returns null for a zero-size target', async ({ measure }) => {
    const { shapes } = await measure(`<div id="root" style="width:0;height:0;overflow:hidden;"></div>`);
    expect(shapes).toBeNull();
  });
});

// The sensor's output is consumed as the root's OWN coordinate space:
// `ShapeInfo` is documented as "in the root/wrapper coordinate space, in CSS
// px", the snapshot is cached and replayed under that assumption, and
// `css-renderer.ts` writes `frameWidth`/`frameHeight` straight onto an
// overlay that lives INSIDE the measured subtree. `getBoundingClientRect()`
// does not return that space — it returns fully composed viewport
// coordinates. Under a scaling ancestor the two differ, the scale is applied
// once by the measurement and again by the ancestor's own transform when the
// overlay paints, and the skeleton renders at scale**2 of the layout it is
// supposed to cover.
//
// Three separate CSS mechanisms produce the same composition, which is why
// all three are pinned here rather than only the one that was reported:
// `transform: scale()`, the independent `scale` property (for which computed
// `transform` is the string `'none'`, so any guard written against
// `transform` alone silently misses it), and `zoom` (whose computed value
// appears on the ANCESTOR, never on the measured root).
const SCALED_CHILDREN = `<div id="a" style="width:100px;height:20px;background:#f00;"></div>
   <div id="b" style="width:60px;height:30px;background:#00f;"></div>`;

function scaledTree(wrapperStyle: string): string {
  return `<div style="${wrapperStyle}"><div id="root" style="position:relative;width:200px;">${SCALED_CHILDREN}</div></div>`;
}

/** The untransformed layout truth of `scaledTree`: a 200x50 root holding a
 *  100x20 box above a 60x30 one. Every scaling case must reproduce exactly
 *  this, because that is the space the overlay is drawn in. */
const LOCAL_SHAPES = [
  { x: 0, y: 0, w: 100, h: 20 },
  { x: 0, y: 20, w: 60, h: 30 },
];
const LOCAL_FRAME = { w: 200, h: 50 };

function expectLocalGeometry(result: MeasureResult): void {
  expect(result.shapes).not.toBeNull();
  expect(result.shapes!.length).toBe(LOCAL_SHAPES.length);
  LOCAL_SHAPES.forEach((expected, i) => {
    const actual = result.shapes![i]!;
    expectCloseTo(actual.x, expected.x, `shape ${i} x`);
    expectCloseTo(actual.y, expected.y, `shape ${i} y`);
    expectCloseTo(actual.w, expected.w, `shape ${i} w`);
    expectCloseTo(actual.h, expected.h, `shape ${i} h`);
  });
  expectCloseTo(result.frame!.w, LOCAL_FRAME.w, 'frame width');
  expectCloseTo(result.frame!.h, LOCAL_FRAME.h, 'frame height');
}

test.describe('DOM sensor — scaled ancestor (coordinate-space double-application)', () => {
  test('no scaling ancestor: the baseline this whole group is measured against', async ({ measure }) => {
    expectLocalGeometry(await measure(scaledTree('')));
  });

  test('transform: scale(2) ancestor', async ({ measure }) => {
    expectLocalGeometry(await measure(scaledTree('transform:scale(2);transform-origin:0 0;')));
  });

  test('the independent `scale` property (computed `transform` is "none")', async ({ measure }) => {
    expectLocalGeometry(await measure(scaledTree('scale:2;transform-origin:0 0;')));
  });

  test('zoom (computed only on the ancestor, never on the measured root)', async ({ measure }) => {
    expectLocalGeometry(await measure(scaledTree('zoom:2;')));
  });

  test('a non-uniform scale is normalised per axis, not by one shared factor', async ({ measure }) => {
    expectLocalGeometry(await measure(scaledTree('transform:scale(2,3);transform-origin:0 0;')));
  });

  test('a scale BELOW the measured root is real visual geometry and must survive untouched', async ({
    measure,
  }) => {
    // The transform is INSIDE the traversal root, so the overlay — a sibling
    // of the measured content, outside that transform — genuinely has to draw
    // the child at its scaled size. Normalising here would be the same bug
    // pointing the other way.
    const result = await measure(
      `<div id="root" style="position:relative;width:200px;">
         <div style="transform:scale(2);transform-origin:0 0;width:100px;height:20px;background:#f00;"></div>
       </div>`,
    );
    expect(result.shapes!.length).toBe(1);
    expectCloseTo(result.shapes![0]!.w, 200, 'inner-transform width stays scaled');
    expectCloseTo(result.shapes![0]!.h, 40, 'inner-transform height stays scaled');
  });
});
