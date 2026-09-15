// test/web/react-native-web.spec.ts
//
// tasks.md G.17 — the react-native-web (Expo Web) sensor gate.
//
// WHY THIS FILE EXISTS. Every other spec under `test/web/` feeds the DOM
// sensor ordinary semantic markup: `<p>`, `<h2>`, `<img>`, `<input>`.
// `react-native-web` emits none of that. A `<View>` is a `<div class="css-
// view-…">` with `display:flex` and `background-color: rgba(0,0,0,0)`; a
// top-level `<Text>` is ALSO a `<div>` (a `<span>` when nested inside
// another `<Text>`), carrying `display:inline` and its content as a bare text
// node; an `<Image>` is a `<div>` wrapping a `background-image` div PLUS a
// `opacity:0` `<img>` kept only so the browser's image context menu works.
// "The sensor is fine on web" therefore does NOT imply "the sensor is fine on
// Expo Web", and a screenshot cannot tell the difference: a skeleton built
// from the wrong rects still looks like a skeleton. So every assertion here
// is geometric, and the covering assertions are made through Chromium's own
// `clip-path` hit testing rather than through our own arithmetic.
//
// DETERMINISM. Same rules as the rest of the suite (plan.md §7.3): the
// self-hosted test font, `deviceScaleFactor: 1`, 0.5 px tolerance. RNW's own
// `Text` base style hard-sets `font: 14px System`, which OVERRIDES the
// inherited `body { font-family }` the harness sets — so every `<Text>` below
// passes `fontFamily` explicitly, exactly as a real RN app does. Text-metric
// assertions compare against ground truth measured from the DOM in the same
// page (structure and relationships), never against hardcoded glyph widths.
//
// G.14 trap: no `.tsx` is imported here. The production module graph plus
// `react-native-web` is bundled by esbuild (`helpers/rnw-entry.ts`) and
// injected; elements are built with `React.createElement` inside
// `page.evaluate`.

import path from 'node:path';
import { expect, test } from '@playwright/test';
import { expectCloseTo, FONT_FAMILY, loadHarness } from './helpers/page';

const ENTRY = path.join(__dirname, 'helpers/rnw-entry.ts');

interface MeasuredShape {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly r: number;
  readonly source: string;
}

interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Runs the REAL `createDomSensor` over a react-native-web subtree and
 *  returns both the shapes it produced and independently-measured DOM ground
 *  truth for the named `testID`s, all in coordinates relative to the
 *  traversal root. */
async function measure(
  page: import('@playwright/test').Page,
  buildTree: string,
  probeIds: readonly string[],
): Promise<{
  shapes: readonly MeasuredShape[];
  boxes: Readonly<Record<string, Box>>;
  lineRects: Readonly<Record<string, readonly Box[]>>;
  degraded: readonly string[];
}> {
  return page.evaluate(
    async ([source, ids, fontFamily]) => {
      const rnw = window.AutoskeletonRnw;
      const host = document.getElementById('root') as HTMLElement;
      const root = rnw.createRoot(host);
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const factory = new Function('rnw', 'h', 'fontFamily', `return (${source});`) as (
        rnw: typeof window.AutoskeletonRnw,
        h: typeof window.AutoskeletonRnw.React.createElement,
        fontFamily: string,
      ) => React.ReactNode;
      root.render(factory(rnw, rnw.React.createElement, fontFamily) as never);
      await new Promise((resolve) => setTimeout(resolve, 300));
      await document.fonts.ready;
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

      const target = host.firstElementChild as HTMLElement;
      const result = rnw.createDomSensor().measure(target, {
        key: 'rnw-gate' as never,
        hints: rnw.createEmptyHintRegistry(),
        maxShapes: 500,
        budgetMs: 2000,
        defaultRadius: 4,
        collectDebugSidecars: true,
      });
      if (result === null) {
        throw new Error('sensor returned null for a non-degenerate react-native-web root');
      }
      const rootRect = target.getBoundingClientRect();
      const decoded = rnw.decodeWire(result.snapshot.data).shapes;
      const shapes = decoded.map((s, i) => ({
        x: s.x,
        y: s.y,
        w: s.w,
        h: s.h,
        r: s.r,
        source: rnw.SHAPE_SOURCES[result.snapshot.sources![i]!]!,
      }));

      const boxes: Record<string, Box> = {};
      const lineRects: Record<string, Box[]> = {};
      for (const id of ids) {
        const el = document.querySelector(`[data-testid="${id}"]`);
        if (el === null) {
          throw new Error(`no element with data-testid="${id}" in the rendered RNW output`);
        }
        const r = el.getBoundingClientRect();
        boxes[id] = { x: r.left - rootRect.left, y: r.top - rootRect.top, w: r.width, h: r.height };
        const range = document.createRange();
        range.selectNodeContents(el);
        lineRects[id] = Array.from(range.getClientRects())
          .filter((rect) => rect.width > 0.5 && rect.height > 0.5)
          .map((rect) => ({
            x: rect.left - rootRect.left,
            y: rect.top - rootRect.top,
            w: rect.width,
            h: rect.height,
          }));
      }
      return { shapes, boxes, lineRects, degraded: [...result.snapshot.degraded] };
    },
    [buildTree, [...probeIds], FONT_FAMILY] as const,
  );
}

test.beforeEach(async ({ page }) => {
  await loadHarness(page, ENTRY, '<div id="root"></div>');
});

test.describe('react-native-web sensor gate (spec.md §4 Expo Web row)', () => {
  test('a top-level <Text> is a plain <div>, and the sensor still resolves it as a TEXT leaf — one shape per visual line box, never one container-sized rect', async ({
    page,
  }) => {
    const { shapes, boxes, lineRects } = await measure(
      page,
      `h(rnw.View, { style: { width: 320 } },
         h(rnw.Text, { testID: 'para', style: { fontFamily, fontSize: 14, lineHeight: 36, color: '#111111' } },
           'The Analytical Engine weaves algebraic patterns just as the Jacquard loom weaves flowers and leaves.'))`,
      ['para'],
    );

    // Ground truth: RNW rendered a <div>, not a text-bearing semantic tag,
    // and it wrapped onto more than one line.
    const tag = await page.evaluate(
      () => document.querySelector('[data-testid="para"]')!.tagName,
    );
    expect(tag).toBe('DIV');
    expect(lineRects['para']!.length).toBeGreaterThan(1);

    const textShapes = shapes.filter((s) => s.source === 'text');
    // One shape per real line box. A container-rule fallback would produce
    // exactly ONE shape here, and a `<div>`-shaped `getBoundingClientRect`
    // rect rather than per-line rects.
    expect(textShapes.length).toBe(lineRects['para']!.length);

    for (const [i, expected] of lineRects['para']!.entries()) {
      const actual = textShapes[i]!;
      expectCloseTo(actual.x, expected.x, `line ${i} x`);
      expectCloseTo(actual.y, expected.y, `line ${i} y`);
      expectCloseTo(actual.w, expected.w, `line ${i} w`);
      expectCloseTo(actual.h, expected.h, `line ${i} h`);
    }

    // The discriminating structural claim, independent of the ground truth
    // above: the LAST line of a wrapped paragraph is narrower than the
    // element, and its glyph box is far shorter than the 36 px line box. A
    // sensor that fell back to the element's own border box would fail both.
    const last = textShapes[textShapes.length - 1]!;
    expect(last.w).toBeLessThan(boxes['para']!.w - 10);
    expect(last.h).toBeLessThan(boxes['para']!.h - 10);
    expect(last.h).toBeLessThan(30);
  });

  test('a <View> with backgroundColor and borderRadius becomes one shape with the measured radius; a transparent <View> wrapper contributes none of its own', async ({
    page,
  }) => {
    const { shapes, boxes } = await measure(
      page,
      `h(rnw.View, { testID: 'wrapper', style: { width: 320, padding: 16 } },
         h(rnw.View, { testID: 'avatar', style: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#cbd5e1' } }))`,
      ['wrapper', 'avatar'],
    );

    // RNW's View base style is `background-color: rgba(0, 0, 0, 0)` — the
    // container rule must read that as "no background", so the only shape is
    // the avatar, never a 320 px-wide wrapper rect.
    expect(shapes.length).toBe(1);
    const avatar = shapes[0]!;
    expect(avatar.source).toBe('background');
    expectCloseTo(avatar.x, boxes['avatar']!.x, 'avatar x');
    expectCloseTo(avatar.y, boxes['avatar']!.y, 'avatar y');
    expectCloseTo(avatar.w, 64, 'avatar w');
    expectCloseTo(avatar.h, 64, 'avatar h');
    expect(avatar.r).toBe(32);
    expect(boxes['wrapper']!.w).toBe(320);
  });

  test('a <TextInput> becomes a real <input> and is measured as an input leaf at its border box', async ({
    page,
  }) => {
    const { shapes, boxes } = await measure(
      page,
      `h(rnw.View, { style: { width: 320 } },
         h(rnw.TextInput, { testID: 'field', defaultValue: 'typed', style: { width: 200, height: 32, fontFamily } }))`,
      ['field'],
    );

    const tag = await page.evaluate(
      () => document.querySelector('[data-testid="field"]')!.tagName,
    );
    expect(tag).toBe('INPUT');
    expect(shapes.length).toBe(1);
    expect(shapes[0]!.source).toBe('input');
    expectCloseTo(shapes[0]!.w, 200, 'input w');
    expectCloseTo(shapes[0]!.h, 32, 'input h');
    expectCloseTo(shapes[0]!.x, boxes['field']!.x, 'input x');
    expectCloseTo(shapes[0]!.y, boxes['field']!.y, 'input y');
  });

  test('a loaded <Image> produces EXACTLY ONE shape — its hidden opacity:0 accessibility <img> must not be shaped a second time', async ({
    page,
  }) => {
    // A 1x1 transparent GIF as a data URI: no network, and RNW's
    // `ImageLoader` resolves it in the same tick class as any other image,
    // so the `background-image` div and the hidden `<img>` are both present
    // by the time the sensor runs.
    const gif =
      'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    const { shapes, boxes } = await measure(
      page,
      `h(rnw.View, { style: { width: 320 } },
         h(rnw.Image, { testID: 'photo', style: { width: 120, height: 60 }, source: { uri: '${gif}' } }))`,
      ['photo'],
    );

    // Control: RNW really did emit both nodes — otherwise this test would
    // pass vacuously on a build where the hidden <img> never appeared.
    const inner = await page.evaluate(() => {
      const host = document.querySelector('[data-testid="photo"]') as HTMLElement;
      const img = host.querySelector('img');
      const bgDiv = Array.from(host.children).find(
        (c) => getComputedStyle(c).backgroundImage !== 'none',
      );
      return {
        hasHiddenImg: img !== null,
        hiddenImgOpacity: img === null ? null : getComputedStyle(img).opacity,
        hiddenImgWidth: img === null ? 0 : img.getBoundingClientRect().width,
        hasBackgroundImageDiv: bgDiv !== undefined,
      };
    });
    expect(inner.hasHiddenImg).toBe(true);
    expect(inner.hiddenImgOpacity).toBe('0');
    // Laid out at full size — so it is NOT skipped by the degenerate-frame
    // guard, which is exactly why it needs its own rule.
    expect(inner.hiddenImgWidth).toBeGreaterThan(100);
    expect(inner.hasBackgroundImageDiv).toBe(true);

    expect(shapes.length).toBe(1);
    expectCloseTo(shapes[0]!.w, 120, 'image w');
    expectCloseTo(shapes[0]!.h, 60, 'image h');
    expectCloseTo(shapes[0]!.x, boxes['photo']!.x, 'image x');
    expectCloseTo(shapes[0]!.y, boxes['photo']!.y, 'image y');
  });

  test('a fully transparent (opacity:0) leaf paints nothing, so it must not become a skeleton shape', async ({
    page,
  }) => {
    const { shapes } = await measure(
      page,
      `h(rnw.View, { style: { width: 320 } },
         h(rnw.View, { testID: 'ghost', style: { width: 80, height: 24, backgroundColor: '#ff0000', opacity: 0 } }),
         h(rnw.View, { testID: 'real', style: { width: 40, height: 24, backgroundColor: '#00ff00' } }))`,
      ['ghost', 'real'],
    );

    // Anti-vacuity: the visible sibling IS shaped, so this cannot pass by the
    // sensor having produced nothing at all.
    expect(shapes.length).toBe(1);
    expectCloseTo(shapes[0]!.w, 40, 'visible sibling w');
  });

  test('an <Image> whose source never loads paints nothing in RNW and therefore has no shape — a backgroundColor on the same Image restores one', async ({
    page,
  }) => {
    // Documented behavior, not a defect this gate demands be fixed: RNW only
    // attaches `background-image` once `ImageLoader` reports LOADED, and it
    // only renders the hidden <img> at the same moment. Until then the whole
    // <Image> is a transparent box that paints nothing, so there is nothing
    // for a sensor to shape. spec.md §4 states this, and states the
    // one-property mitigation this test proves works.
    const { shapes } = await measure(
      page,
      `h(rnw.View, { style: { width: 320 } },
         h(rnw.Image, { testID: 'broken', style: { width: 100, height: 40 }, source: { uri: 'http://127.0.0.1:9/never.png' } }),
         h(rnw.Image, { testID: 'placeheld', style: { width: 100, height: 40, backgroundColor: '#dddddd' }, source: { uri: 'http://127.0.0.1:9/never2.png' } }))`,
      ['broken', 'placeheld'],
    );

    expect(shapes.length).toBe(1);
    expectCloseTo(shapes[0]!.w, 100, 'placeheld w');
    expectCloseTo(shapes[0]!.h, 40, 'placeheld h');
  });

  test('end to end: <AutoSkeleton> over react-native-web content paints a clip-path that Chromium hit-tests as covering the glyph runs and NOT the leading gaps or the empty tail of a short line', async ({
    page,
  }) => {
    const probes = await page.evaluate(async (fontFamily) => {
      const rnw = window.AutoskeletonRnw;
      const h = rnw.React.createElement;
      const host = document.getElementById('root') as HTMLElement;
      rnw.createRoot(host).render(
        h(
          rnw.AutoSkeleton,
          { isLoading: true, skeletonKey: 'rnw-hit-test' },
          h(
            rnw.View,
            { testID: 'card', style: { width: 320 } },
            h(
              rnw.View,
              { testID: 'avatar', style: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#cbd5e1' } },
            ),
            // 40 px leading over a ~14 px glyph box leaves >10 px of empty
            // space above and below the glyphs on every line.
            h(
              rnw.Text,
              { testID: 'short', style: { fontFamily, fontSize: 14, lineHeight: 40, color: '#111111' } },
              'Short',
            ),
          ) as never,
        ) as never,
      );
      await new Promise((resolve) => setTimeout(resolve, 500));
      await document.fonts.ready;

      const overlays = document.querySelectorAll('.askl-overlay');
      if (overlays.length !== 1) {
        throw new Error(`expected exactly one .askl-overlay, found ${overlays.length}`);
      }
      const overlay = overlays[0] as HTMLElement;
      const clipPath = getComputedStyle(overlay).clipPath;
      // `.askl-overlay` ships `pointer-events: none` so it never intercepts a
      // real user's clicks. Chromium applies `clip-path` to hit testing as
      // well as painting, so re-enabling pointer events for the duration of
      // this probe turns `elementFromPoint` into a read of the browser's OWN
      // rasterized clip region — a far stronger claim than re-deriving the
      // rects from the path string with our own arithmetic.
      overlay.style.pointerEvents = 'auto';

      const short = document.querySelector('[data-testid="short"]') as HTMLElement;
      const shortBox = short.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(short);
      const glyphs = range.getClientRects()[0]!;
      const avatarBox = (
        document.querySelector('[data-testid="avatar"]') as HTMLElement
      ).getBoundingClientRect();

      const covered = (x: number, y: number): boolean => {
        const hit = document.elementFromPoint(x, y);
        return hit === overlay || overlay.contains(hit);
      };

      return {
        clipPath,
        glyphHeight: glyphs.height,
        lineBoxHeight: shortBox.height,
        glyphWidth: glyphs.width,
        lineBoxWidth: shortBox.width,
        onGlyphs: covered(glyphs.left + glyphs.width / 2, glyphs.top + glyphs.height / 2),
        aboveGlyphs: covered(glyphs.left + glyphs.width / 2, shortBox.top + 2),
        belowGlyphs: covered(glyphs.left + glyphs.width / 2, shortBox.bottom - 2),
        emptyTail: covered(shortBox.right - 4, glyphs.top + glyphs.height / 2),
        avatarCentre: covered(avatarBox.left + 32, avatarBox.top + 32),
        avatarCorner: covered(avatarBox.left + 2, avatarBox.top + 2),
        outsideCard: covered(avatarBox.left + 300, avatarBox.top - 40),
      };
    }, FONT_FAMILY);

    expect(probes.clipPath).toContain('path(');

    // The geometry these probes discriminate on has to actually exist,
    // otherwise "not covered" would be trivially true everywhere.
    expect(probes.glyphHeight).toBeLessThan(probes.lineBoxHeight - 10);
    expect(probes.glyphWidth).toBeLessThan(probes.lineBoxWidth - 100);

    expect(probes.onGlyphs, 'the glyph run must be covered').toBe(true);
    expect(probes.avatarCentre, 'the avatar must be covered').toBe(true);
    // r=32 on a 64x64 box is a circle: the square corner is outside it.
    expect(probes.avatarCorner, 'the avatar corner is outside its 32 px radius').toBe(false);
    expect(probes.aboveGlyphs, 'the leading gap above the glyphs must stay uncovered').toBe(false);
    expect(probes.belowGlyphs, 'the leading gap below the glyphs must stay uncovered').toBe(false);
    expect(probes.emptyTail, 'the empty tail right of a short line must stay uncovered').toBe(false);
    expect(probes.outsideCard, 'nothing outside the measured subtree is covered').toBe(false);
  });
});
