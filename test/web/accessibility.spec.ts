// test/web/accessibility.spec.ts
//
// G.16 / REQ-A11Y-1 on the WEB surface. The native counterpart (G.15) is
// gated on device by `AccessibilityGateInstrumentedTest` (Android) and
// `PaintGateUITests` (iOS); this is the equivalent gate for the browser.
//
// Runs the REAL production `<AutoSkeleton>` (React + ReactDOM + the actual
// module graph, bundled by esbuild and injected — the G.14 workaround for
// `@playwright/test`'s own JSX transform, which rewrites any `.tsx` a spec
// imports into `__pw_type` objects the library's renderers reject) and reads
// CHROMIUM'S OWN accessibility tree over CDP. jsdom is banned project-wide for
// anything layout- or geometry-adjacent (plan.md §7.3) and would be doubly
// wrong here: what is under test is what an accessibility tree CONTAINS, and
// jsdom computes no accessibility tree at all.
//
// Every absence assertion carries two controls, exactly like the native gates:
//   1. `#outside-control` — a node rendered OUTSIDE `<AutoSkeleton>`, so a
//      broken harness or a dead CDP session can never make an absence pass.
//   2. `.askl-overlay` count — positive proof of whether the skeleton is
//      actually painted at the instant the content's exposure is read, which
//      is the entire question this file exists to answer.

import path from 'node:path';
import { expect, test as base } from '@playwright/test';
import { axStateOf } from './helpers/ax';
import { loadHarness } from './helpers/page';

const ENTRY = path.join(__dirname, 'helpers/component-entry.ts');

interface RenderProps {
  readonly isLoading: boolean;
  readonly delay?: number;
  readonly skeletonOnRefresh?: boolean;
  readonly expectsPlaceholder?: boolean;
}

interface ProviderProps {
  readonly handoffTimeoutMs?: number;
  readonly handoffFadeMs?: number;
}

const test = base.extend<{
  mountHarness: (provider?: ProviderProps) => Promise<void>;
  renderTree: (props: RenderProps) => Promise<void>;
}>({
  mountHarness: async ({ page }, use) => {
    await use(async (provider = {}) => {
      await loadHarness(page, ENTRY, `<div id="root"></div>`);
      await page.evaluate((providerProps) => {
        const { React, createRoot, AutoSkeleton, SkeletonProvider, MemoryShapeStore } =
          window.AutoskeletonComponent;
        (window as unknown as { __harness: unknown }).__harness = {
          React,
          AutoSkeleton,
          SkeletonProvider,
          store: new MemoryShapeStore(),
          root: createRoot(document.getElementById('root')!),
          providerProps,
        };
      }, provider);
    });
  },
  renderTree: async ({ page }, use) => {
    await use(async (props) => {
      await page.evaluate((componentProps) => {
        const harness = (window as unknown as { __harness: any }).__harness;
        const { React } = harness;
        harness.root.render(
          React.createElement(
            'div',
            null,
            // Control: outside `<AutoSkeleton>` entirely. If this ever goes
            // missing from the accessibility tree, the harness is broken and
            // every absence assertion below is vacuous.
            React.createElement('h2', { id: 'outside-control' }, 'Outside control'),
            React.createElement(
              harness.SkeletonProvider,
              { store: harness.store, ...harness.providerProps },
              React.createElement(
                harness.AutoSkeleton,
                { skeletonKey: 'a11y-tree-screen', ...componentProps },
                React.createElement('h2', { id: 'real-content', style: { margin: 0, fontSize: 16 } }, 'Real content'),
              ),
            ),
          ),
        );
      }, props);
    });
  },
});

/** Two animation frames — long enough for the cold-measurement effect (runs
 *  after commit) and the resulting re-render/overlay mount to settle. Same
 *  helper the sibling component suite uses. */
async function settle(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

async function overlayCount(page: import('@playwright/test').Page): Promise<number> {
  return page.locator('.askl-overlay').count();
}

/** Asserts the harness itself is alive. Called immediately before or after
 *  every assertion about `#real-content`'s absence. */
async function expectControlExposed(page: import('@playwright/test').Page): Promise<void> {
  const control = await axStateOf(page, '#outside-control');
  expect(control.present, 'control node missing from the DOM — harness is broken').toBe(true);
  expect(control.ignored, 'control node was ignored by the accessibility tree — harness is broken').toBe(
    false,
  );
}

test.describe('AutoSkeleton — REQ-A11Y-1: content is excluded from the accessibility tree exactly while the skeleton covers it', () => {
  test('control: real content is exposed to assistive technology when nothing is loading', async ({
    page,
    mountHarness,
    renderTree,
  }) => {
    await mountHarness();
    await renderTree({ isLoading: false });
    await settle(page);

    await expectControlExposed(page);
    expect(await overlayCount(page)).toBe(0);
    const content = await axStateOf(page, '#real-content');
    expect(content.ignored).toBe(false);
    expect(content.name).toBe('Real content');
  });

  test('covered: real content is excluded, for the right reason, while the overlay is painted', async ({
    page,
    mountHarness,
    renderTree,
  }) => {
    await mountHarness();
    await renderTree({ isLoading: true });
    await settle(page);

    await expectControlExposed(page);
    // Positive proof the skeleton really is on screen at this instant —
    // without it, "content is hidden" could be true for the wrong reason.
    expect(await overlayCount(page)).toBe(1);
    const content = await axStateOf(page, '#real-content');
    expect(content.ignored).toBe(true);
    expect(content.ignoredReasons).toContain('ariaHiddenSubtree');
    // The user is not left in an empty region: the status element is reachable.
    await expect(page.locator('[role="status"]')).toHaveText(/Loading/);
  });

  // FAILURE MODE 1 (the severe one). `phase` is initialised to `'skeleton'`
  // and only ever leaves it inside the handoff cycle, which
  // `shouldRunHandoffCycle` suppresses entirely on the DEFAULT
  // stale-while-revalidate path (`everShownContent && !skeletonOnRefresh`).
  // With `aria-hidden={phase === 'skeleton'}` the content is therefore hidden
  // from assistive technology PERMANENTLY, while fully visible, with no
  // skeleton on screen to explain why.
  test('REQ-PTR-1 default refresh: content stays in the accessibility tree during AND after a suppressed refresh', async ({
    page,
    mountHarness,
    renderTree,
  }) => {
    await mountHarness();

    // Cycle 1 — a genuine cold load, so the cache key is warm and
    // `everShownContent` becomes true, exactly like a first visit.
    await renderTree({ isLoading: true });
    await settle(page);
    await renderTree({ isLoading: false });
    await page.waitForTimeout(300);

    const afterFirstLoad = await axStateOf(page, '#real-content');
    expect(afterFirstLoad.ignored, 'content must be readable after the first load completes').toBe(false);

    // Cycle 2 — pull-to-refresh over warm content. REQ-PTR-1's default:
    // existing content remains visible, no skeleton overlay.
    await renderTree({ isLoading: true });
    await settle(page);

    await expectControlExposed(page);
    expect(await overlayCount(page), 'REQ-PTR-1 default must show no skeleton').toBe(0);
    const duringRefresh = await axStateOf(page, '#real-content');
    expect(
      duringRefresh.ignored,
      'content is fully visible with no skeleton over it, so it must stay readable by a screen reader',
    ).toBe(false);
    expect(duringRefresh.name).toBe('Real content');

    // Cycle 2 resolves. Nothing in the suppressed path ever advances `phase`,
    // so this is where the defect becomes PERMANENT for the page's lifetime.
    await renderTree({ isLoading: false });
    await page.waitForTimeout(400);

    await expectControlExposed(page);
    expect(await overlayCount(page)).toBe(0);
    const afterRefresh = await axStateOf(page, '#real-content');
    expect(
      afterRefresh.ignored,
      'content must not be permanently hidden from assistive technology after a suppressed refresh',
    ).toBe(false);
    expect(afterRefresh.name).toBe('Real content');
  });

  // FAILURE MODE 2. `showSkeleton` additionally requires `delayElapsed`, but
  // `phase` is already `'skeleton'` from the very first render — so for the
  // whole `delay` window the content is visible AND hidden from assistive
  // technology, with nothing painted over it.
  test('delay window: content stays in the accessibility tree before the skeleton is allowed to appear', async ({
    page,
    mountHarness,
    renderTree,
  }) => {
    await mountHarness();
    await renderTree({ isLoading: true, delay: 600 });
    await settle(page);

    await expectControlExposed(page);
    expect(await overlayCount(page), 'the delay window must not paint a skeleton yet').toBe(0);
    const duringDelay = await axStateOf(page, '#real-content');
    expect(
      duringDelay.ignored,
      'nothing is painted over the content during the delay window, so it must stay readable',
    ).toBe(false);

    // The other half of the same assertion: once the delay elapses and the
    // skeleton genuinely covers the content, exclusion MUST take effect. A
    // gate that only checked the first half could be satisfied by deleting
    // `aria-hidden` altogether.
    await expect(page.locator('.askl-overlay')).toHaveCount(1, { timeout: 5_000 });
    const afterDelay = await axStateOf(page, '#real-content');
    expect(afterDelay.ignored).toBe(true);
    expect(afterDelay.ignoredReasons).toContain('ariaHiddenSubtree');
  });

  // FAILURE MODE 3, found while establishing the predicate rather than taken
  // from the report: the INVERSE defect, and the exact one G.15 fixed on
  // native. During the ADR-16 handoff tail the controller's phase is
  // `'placeholder'`, so `phase === 'skeleton'` is false — yet `showSkeleton`
  // is still true and the overlay is still fully painted. Assistive
  // technology reaches content the sighted user cannot see.
  test('handoff tail: content stays excluded while the overlay is still painted after isLoading flips false', async ({
    page,
    mountHarness,
    renderTree,
  }) => {
    // `expectsPlaceholder` makes the controller WAIT in `'placeholder'` for
    // `handoffTimeoutMs` (no successor ever paints here), which is what makes
    // the tail long enough to observe deterministically instead of racing a
    // 120 ms default fade.
    await mountHarness({ handoffTimeoutMs: 3_000, handoffFadeMs: 1_000 });
    await renderTree({ isLoading: true, expectsPlaceholder: true });
    await settle(page);
    expect(await overlayCount(page)).toBe(1);

    await renderTree({ isLoading: false, expectsPlaceholder: true });
    await settle(page);

    await expectControlExposed(page);
    expect(await overlayCount(page), 'the overlay must still be painted during the handoff tail').toBe(1);
    const duringTail = await axStateOf(page, '#real-content');
    expect(
      duringTail.ignored,
      'the skeleton is still covering the content during the handoff tail, so it must stay excluded',
    ).toBe(true);
    expect(duringTail.ignoredReasons).toContain('ariaHiddenSubtree');

    // And it must come back once the overlay is gone — the "both states in
    // one run" rule the native gates follow.
    await expect(page.locator('.askl-overlay')).toHaveCount(0, { timeout: 10_000 });
    const afterTail = await axStateOf(page, '#real-content');
    expect(afterTail.ignored).toBe(false);
    expect(afterTail.name).toBe('Real content');
  });
});

test.describe('AutoSkeleton — REQ-A11Y-1: aria-busy tracks "this region is loading", not "the skeleton is painted"', () => {
  test('busy is announced while the skeleton covers the content', async ({ page, mountHarness, renderTree }) => {
    await mountHarness();
    await renderTree({ isLoading: true });
    await settle(page);

    expect(await overlayCount(page)).toBe(1);
    const status = await axStateOf(page, '[role="status"]');
    expect(status.busy).toBe(true);
  });

  // The stale-while-revalidate path deliberately keeps stale content readable
  // (REQ-PTR-1). Readable is not the same as current: without a busy signal a
  // screen-reader user has no way to know the data underneath them is being
  // refreshed, because the one cue a sighted user gets (the skeleton) is
  // suppressed by design.
  test('busy is announced on the content region during a suppressed refresh, with the content still readable', async ({
    page,
    mountHarness,
    renderTree,
  }) => {
    await mountHarness();
    await renderTree({ isLoading: true });
    await settle(page);
    await renderTree({ isLoading: false });
    await page.waitForTimeout(300);

    const idle = await axStateOf(page, '#real-content');
    expect(idle.busy, 'nothing is loading, so nothing may be marked busy').toBe(false);

    await renderTree({ isLoading: true });
    await settle(page);

    await expectControlExposed(page);
    expect(await overlayCount(page)).toBe(0);
    const refreshing = await axStateOf(page, '#real-content');
    expect(refreshing.ignored, 'stale content stays readable — that is the point of REQ-PTR-1').toBe(false);
    expect(refreshing.busy, 'the region is being refreshed and must say so').toBe(true);

    await renderTree({ isLoading: false });
    await page.waitForTimeout(400);

    const settled = await axStateOf(page, '#real-content');
    expect(settled.ignored).toBe(false);
    expect(settled.busy, 'the refresh finished, so the region is no longer busy').toBe(false);
  });

  test('the control outside AutoSkeleton is never marked busy', async ({ page, mountHarness, renderTree }) => {
    await mountHarness();
    await renderTree({ isLoading: true });
    await settle(page);

    const control = await axStateOf(page, '#outside-control');
    expect(control.ignored).toBe(false);
    expect(control.busy).toBe(false);
  });
});
