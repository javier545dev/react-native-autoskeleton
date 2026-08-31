// test/web/data-fallback.spec.ts
//
// The `data` / function-child / `fallback` API, against the REAL production
// component in a real browser (plan.md §7.3). The pure rules are already
// gated in `src/core/data-props.test.ts`; what only a browser can prove is
// the part that motivated the change:
//
//   - a function child renders NOTHING while `data` is nullish, so the cold
//     traversal has nothing to measure and caches an EMPTY snapshot — the
//     defect `fallback` exists for, asserted here rather than asserted about;
//   - `fallback` is actually painted in that state, and is NOT measured
//     (otherwise the library would cache a skeleton of a skeleton);
//   - `fallback` yields the moment real geometry exists;
//   - and, the constraint that matters most for a purely additive change:
//     with the prop omitted the wrapper's DOM is exactly what it was.

import path from 'node:path';
import { expect, test } from '@playwright/test';
import { loadHarness } from './helpers/page';

const ENTRY = path.join(__dirname, 'helpers/component-entry.ts');

/** Two animation frames — the cold-measurement effect runs after commit and
 *  the resulting re-render/overlay mount needs one more. Same helper, same
 *  rationale as `auto-skeleton.spec.ts` and `empty-measurement.spec.ts`. */
async function settle(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

interface MountOptions {
  /** Initial `data`. `null` is the loading state; `0` and `''` are not. */
  readonly initialData: unknown;
  readonly withFallback: boolean;
  /** When true the child is a plain always-mounted node instead of a
   *  function — the shape of consumer whose subtree the sensor CAN measure
   *  during a loading cycle. */
  readonly staticChild?: boolean;
  /** Passed through verbatim when defined, to prove explicit precedence. */
  readonly isLoading?: boolean;
  /** REQ-PTR-1 opt-out. Needed by any test that drives a SECOND loading
   *  cycle: once content has been shown, the default suppresses the skeleton
   *  — and `fallback`, which follows the same gate on purpose (it must not
   *  cover content a reader is still looking at during a refresh). */
  readonly skeletonOnRefresh?: boolean;
}

async function mount(page: import('@playwright/test').Page, options: MountOptions): Promise<void> {
  await loadHarness(page, ENTRY, `<div id="root"></div>`);
  await page.evaluate((opts) => {
    const { React, createRoot, AutoSkeleton, SkeletonProvider, MemoryShapeStore } = window.AutoskeletonComponent;
    const store = new MemoryShapeStore();
    let calls = 0;

    function App(): React.ReactNode {
      const [data, setData] = React.useState<unknown>(opts.initialData);
      const [isLoading, setLoading] = React.useState<boolean | undefined>(opts.isLoading);
      window.__autoskeletonHarness = {
        store,
        setLoading: (next: boolean) => setLoading(next),
        setSized: () => {},
        setData: (next: unknown) => setData(next),
        functionChildCalls: () => calls,
      };

      // A real 220x44 box, so "was this measured?" is answerable: if the
      // fallback ever reached the sensor the snapshot would carry a shape.
      const fallback = React.createElement('div', {
        id: 'hand-authored-fallback',
        style: { width: 220, height: 44, background: '#cccccc' },
      });

      const children = opts.staticChild
        ? React.createElement('p', { id: 'real-content', style: { margin: 0, fontSize: 16 } }, 'Hello world')
        : (value: { label: string } | number | string) => {
            calls += 1;
            return React.createElement('p', { id: 'real-content', style: { margin: 0, fontSize: 16 } }, String(
              typeof value === 'object' ? value.label : value,
            ));
          };

      return React.createElement(
        SkeletonProvider,
        { store },
        React.createElement(
          AutoSkeleton,
          {
            skeletonKey: 'data-fallback',
            data,
            ...(opts.skeletonOnRefresh ? { skeletonOnRefresh: true } : {}),
            ...(isLoading === undefined ? {} : { isLoading }),
            ...(opts.withFallback ? { fallback } : {}),
            // `as never`: the props object is assembled dynamically here, so
            // it cannot satisfy the discriminated union structurally. The
            // TYPE contract is gated separately and properly, at compile
            // time, in `test/types/auto-skeleton-props.test-d.tsx`; this file
            // is only about what the component DOES.
          } as never,
          children as never,
        ),
      );
    }

    createRoot(document.getElementById('root')!).render(React.createElement(App));
  }, options);
  await settle(page);
}

function storedShapeCounts(page: import('@playwright/test').Page): Promise<readonly number[]> {
  return page.evaluate(() =>
    Array.from(window.__autoskeletonHarness.store.values(), (s) => (s.data.length - 1) / 5),
  );
}

test.describe('the `data` form', () => {
  test('nullish data means loading: the function child never runs and nothing is measured', async ({ page }) => {
    await mount(page, { initialData: null, withFallback: false });

    // The defect, stated as an assertion instead of a paragraph: the child is
    // absent during loading, so the traversal finds an empty subtree.
    expect(await page.evaluate(() => window.__autoskeletonHarness.functionChildCalls?.())).toBe(0);
    await expect(page.locator('#real-content')).toHaveCount(0);
    expect(await storedShapeCounts(page)).toEqual([0]);
  });

  test('a present value ends the loading state and reaches the child narrowed', async ({ page }) => {
    await mount(page, { initialData: null, withFallback: false });
    await page.evaluate(() => window.__autoskeletonHarness.setData?.({ label: 'Widget' }));
    await settle(page);

    await expect(page.locator('#real-content')).toHaveText('Widget');
    expect(await page.evaluate(() => window.__autoskeletonHarness.functionChildCalls?.())).toBeGreaterThan(0);
  });

  test('0 is an ordinary loaded value, not a loading state', async ({ page }) => {
    // The single rule a reader of this API can most easily get wrong. A
    // truthiness test here would leave `<AutoSkeleton data={cartItemCount}>`
    // on a skeleton forever the moment the cart empties.
    await mount(page, { initialData: 0, withFallback: true });

    await expect(page.locator('#real-content')).toHaveText('0');
    await expect(page.locator('#hand-authored-fallback')).toHaveCount(0);
    await expect(page.locator('[role="status"]')).toHaveCount(0);
  });

  test('an explicit isLoading wins over data, in both directions', async ({ page }) => {
    await mount(page, { initialData: null, withFallback: true, isLoading: false, skeletonOnRefresh: true });
    // `data` is null, which alone would mean loading — the explicit flag says
    // otherwise, so no skeleton and no fallback.
    await expect(page.locator('[role="status"]')).toHaveCount(0);
    await expect(page.locator('#hand-authored-fallback')).toHaveCount(0);

    await page.evaluate(() => window.__autoskeletonHarness.setLoading(true));
    await settle(page);
    await expect(page.locator('[role="status"]')).toHaveCount(1);
  });
});

test.describe('`fallback` — the cold-miss answer', () => {
  test('is painted when a loading cycle has no usable geometry', async ({ page }) => {
    await mount(page, { initialData: null, withFallback: true });

    await expect(page.locator('#hand-authored-fallback')).toBeVisible();
    // And the state it is covering for is real: an existing, EMPTY snapshot.
    // Gating on `snapshot === null` would have hidden the fallback here.
    expect(await storedShapeCounts(page)).toEqual([0]);
  });

  test('survives further loading cycles, because the empty snapshot does too', async ({ page }) => {
    await mount(page, { initialData: null, withFallback: true, skeletonOnRefresh: true });
    for (let cycle = 0; cycle < 4; cycle += 1) {
      await page.evaluate(() => window.__autoskeletonHarness.setData?.({ label: 'Widget' }));
      await settle(page);
      await page.evaluate(() => window.__autoskeletonHarness.setData?.(null));
      await settle(page);
    }
    // Past `MAX_EMPTY_MEASUREMENTS`, the empty result is permanent for this
    // key. A `snapshot === null` gate would have shown the fallback exactly
    // once in the session and left the reader with a blank box ever after.
    expect(await storedShapeCounts(page)).toEqual([0]);
    await expect(page.locator('#hand-authored-fallback')).toBeVisible();
  });

  test('is never measured — no skeleton of a skeleton', async ({ page }) => {
    await mount(page, { initialData: null, withFallback: true });

    // The fallback is a real 220x44 filled box. If it reached the sensor the
    // snapshot would carry at least one shape, and that geometry would then
    // be served as if it were the consumer's content.
    expect(await storedShapeCounts(page)).toEqual([0]);
    const marked = await page.locator('#hand-authored-fallback').evaluate(
      (el) => el.parentElement?.getAttribute('data-autoskeleton-ignore'),
    );
    expect(marked).toBe('true');
  });

  test('yields to the measured skeleton once real geometry exists', async ({ page }) => {
    // The consumer whose children stay mounted through the loading cycle —
    // the case where the sensor has something to find. Note this is NOT
    // "the second cycle": it is the first cycle in which content is mounted.
    await mount(page, { initialData: null, withFallback: true, staticChild: true });

    expect((await storedShapeCounts(page))[0]).toBeGreaterThan(0);
    await expect(page.locator('.askl-overlay')).toHaveCount(1);
    await expect(page.locator('#hand-authored-fallback')).toHaveCount(0);
  });

  test('is kept out of the accessibility tree; the role=status element speaks instead', async ({ page }) => {
    await mount(page, { initialData: null, withFallback: true });

    const hidden = await page.locator('#hand-authored-fallback').evaluate(
      (el) => el.parentElement?.getAttribute('aria-hidden'),
    );
    expect(hidden).toBe('true');
    await expect(page.locator('[role="status"]')).toContainText('Loading');
  });

  test('with the prop omitted, the wrapper renders exactly the nodes it did before', async ({ page }) => {
    // The hard constraint of this change. The gate is `props.fallback !==
    // undefined` FIRST, so with the prop absent the extra JSX slot evaluates
    // to `false` and React mounts no node at all — this asserts that, rather
    // than trusting it.
    await mount(page, { initialData: null, withFallback: false });

    const shape = await page.evaluate(() => {
      const wrapper = document.querySelector('#root > div')!;
      return {
        childCount: wrapper.children.length,
        ignoreMarked: wrapper.querySelectorAll('[data-autoskeleton-ignore]').length,
        roles: Array.from(wrapper.children, (c) => c.getAttribute('role')),
      };
    });
    // Content wrapper + overlay host, and the overlay host is the ONE
    // ignore-marked node — exactly the pre-change tree.
    expect(shape.childCount).toBe(2);
    expect(shape.ignoreMarked).toBe(1);
    expect(shape.roles).toEqual([null, 'status']);
  });
});
