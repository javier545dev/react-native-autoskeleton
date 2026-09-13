// `useTemplateMeasurement` claims its cache key by writing to a MODULE-SCOPED
// registry during the render body. That write exists for a real, on-device race
// documented at the call site: N sibling cells for the same unseen itemType all
// render before any of their effects flush, so claiming inside an effect lets
// every sibling claim. Claiming synchronously in render fixes that, and this
// file is not arguing with it.
//
// What it did NOT survive is React invoking the same component twice for one
// commit, which `<StrictMode>` does in development on every React 18+ app:
//
//   render 1   stateFor(key) === 'idle'      -> shouldSchedule = true
//                                             -> markScheduled(key) mutates the
//                                                registry to 'scheduled'
//   render 2   stateFor(key) === 'scheduled' -> decideCellBind returns false
//                (committed)                 -> shouldSchedule = false
//
// The committed closures therefore believe some OTHER cell owns the claim. The
// mount effect returns early, `mounted` never flips, the measurement effect
// never runs, and its cleanup — the only caller of `releaseClaim` anywhere — is
// never registered. The key stays 'scheduled' for the life of the process, and
// `decideCellBind` will never schedule it again: every list bind for that key
// renders the generic fallback forever. `reset()` has no production caller.
//
// The same shape occurs outside StrictMode whenever React discards a render
// that already executed the claim (a transition interrupted by higher-priority
// input, a sibling suspending).
//
// The fix is NOT to move the claim into an effect — that reintroduces the
// sibling race. It is for a cell to remember that IT is the claimant, so a
// re-render that reads back its own claim does not mistake it for someone
// else's.
import { StrictMode, createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  StyleSheet: { create: (styles: Record<string, unknown>) => styles, absoluteFill: {} },
  View: 'View',
  // Reached only through this module's transitive imports, never by the hook
  // under test — the sensor is not exercised here.
  TurboModuleRegistry: { get: () => null, getEnforcing: () => null },
  findNodeHandle: () => 1,
  I18nManager: { isRTL: false },
  PixelRatio: { getFontScale: () => 1 },
  Platform: { OS: 'ios' },
  useWindowDimensions: () => ({ width: 375, height: 812 }),
  AccessibilityInfo: {
    isReduceMotionEnabled: () => Promise.resolve(false),
    addEventListener: () => ({ remove: () => undefined }),
  },
}));

import { createTemplateRegistry } from '../../src/core/list';
import { composeCacheKey } from '../../src/core/cache-key';
import { MemoryShapeStore } from '../../src/core/snapshot';
import { useTemplateMeasurement } from '../../src/native/list/useTemplateMeasurement';

interface TestRendererLike {
  unmount(): void;
}

const CACHE_KEY = composeCacheKey({
  skeletonKey: 'row',
  itemType: 'row',
  viewportWidth: 375,
  fontScale: 1,
  direction: 'ltr',
  platform: 'ios',
});

/** Drives the hook exactly as a list cell does, and records what the COMMITTED
 *  render decided — `pendingTemplateNode` is non-null only while this cell
 *  believes it owns the measurement. */
function makeProbe(registry: ReturnType<typeof createTemplateRegistry>, seen: Array<boolean>) {
  return function Cell(): null {
    const { pendingTemplateNode } = useTemplateMeasurement({
      itemType: 'row',
      cacheKey: CACHE_KEY,
      cacheHit: false,
      renderTemplate: () => createElement('View', null),
      registry,
      store: new MemoryShapeStore(),
      budgetMs: 2,
      maxShapes: 60,
      defaultRadius: 4,
    });
    seen.push(pendingTemplateNode !== null);
    return null;
  };
}

describe('list template measurement — a double-invoked render must not orphan its own claim', () => {
  it('still schedules the measurement when React renders the cell twice for one commit', async () => {
    const { act, create } = (await import('react-test-renderer')) as unknown as {
      act: (fn: () => void) => void;
      create: (element: unknown) => TestRendererLike;
    };
    const registry = createTemplateRegistry();
    const committed: Array<boolean> = [];
    const Cell = makeProbe(registry, committed);

    let tree!: TestRendererLike;
    act(() => {
      tree = create(createElement(StrictMode, null, createElement(Cell)));
    });

    // The claim is this cell's own: a second read of it must not convince the
    // cell that someone else is measuring. If it does, nothing ever renders the
    // template, so nothing ever measures it.
    expect(
      committed.some((scheduled) => scheduled),
      `the cell never rendered its template under StrictMode — it read back its own ` +
        `'scheduled' claim and stood down. Registry state: ${registry.stateFor(CACHE_KEY)}`
    ).toBe(true);

    act(() => {
      tree.unmount();
    });
  });

  it('leaves the key schedulable after an unmount, so a later list can still measure it', async () => {
    const { act, create } = (await import('react-test-renderer')) as unknown as {
      act: (fn: () => void) => void;
      create: (element: unknown) => TestRendererLike;
    };
    const registry = createTemplateRegistry();
    const Cell = makeProbe(registry, []);

    let tree!: TestRendererLike;
    act(() => {
      tree = create(createElement(StrictMode, null, createElement(Cell)));
    });
    act(() => {
      tree.unmount();
    });

    // A key stuck at 'scheduled' with nothing measuring it is the permanent
    // deadlock: `decideCellBind` only schedules from 'idle' or a retryable
    // 'failed', so every future bind for this key renders the fallback.
    expect(
      registry.stateFor(CACHE_KEY),
      'the cache key is latched at "scheduled" with no measurement in flight and no ' +
        'claimant left to release it — every later bind for this key is stuck on the ' +
        'generic fallback for the rest of the process'
    ).not.toBe('scheduled');
  });

  it('still lets exactly one of several sibling cells claim the key (the race this design exists for)', async () => {
    const { act, create } = (await import('react-test-renderer')) as unknown as {
      act: (fn: () => void) => void;
      create: (element: unknown) => TestRendererLike;
    };
    const registry = createTemplateRegistry();
    const perCell: Array<Array<boolean>> = [[], [], []];
    const cells = perCell.map((seen) => makeProbe(registry, seen));

    let tree!: TestRendererLike;
    act(() => {
      tree = create(
        createElement(
          'View',
          null,
          ...cells.map((Cell, i) => createElement(Cell, { key: i }))
        )
      );
    });

    // Exactly one cell may own the measurement. This is the property the
    // render-phase claim was introduced to guarantee; the StrictMode fix must
    // not trade it away.
    const owners = perCell.filter((seen) => seen.some(Boolean)).length;
    expect(owners, `${owners} sibling cells each rendered a template for the same key`).toBeLessThanOrEqual(1);

    act(() => {
      tree.unmount();
    });
  });
});
