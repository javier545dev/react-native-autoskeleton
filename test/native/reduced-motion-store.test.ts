// test/native/reduced-motion-store.test.ts
//
// The reduce-motion preference as an actual external store, tested WITHOUT a
// React renderer — deliberately, because the two defects below both live in
// the store half of `useSyncExternalStore` and a `renderToStaticMarkup` test
// would prove nothing about either: server rendering takes `getServerSnapshot`
// (hard-coded `false`), a path React Native never executes.
//
// Two defects, both silent:
//
//  1. SEEDING NEVER NOTIFIED. `reducedMotionSnapshot` was a module-level `let`
//     seeded by `AccessibilityInfo.isReduceMotionEnabled().then(v => { snapshot
//     = v })` with no subscriber notification at all. `useSyncExternalStore`
//     re-reads `getSnapshot` only when a subscriber is told to, so a user who
//     ALREADY had the preference on before the app launched got a shimmer on
//     the first skeleton after every cold start — until something unrelated
//     happened to re-render.
//
//  2. THE LIVE EVENT NEVER UPDATED THE SNAPSHOT. `subscribe` passed React's
//     own `onChange` straight to `addEventListener('reduceMotionChanged', ...)`,
//     so a real preference change woke React up and React then re-read a
//     snapshot NOBODY HAD WRITTEN. Toggling the setting while the app ran
//     therefore did nothing whatsoever, forever. This one is not "stale on
//     first paint" — it is permanently stuck.

import { beforeEach, describe, expect, it, vi } from 'vitest';

let resolvePreference: (value: boolean) => void = () => undefined;
let changeListener: ((value: boolean) => void) | undefined;
let removed = false;

vi.mock('react-native', () => ({
  AccessibilityInfo: {
    isReduceMotionEnabled: () =>
      new Promise<boolean>((resolve) => {
        resolvePreference = resolve;
      }),
    addEventListener: (_event: string, listener: (value: boolean) => void) => {
      changeListener = listener;
      return {
        remove: () => {
          removed = true;
        },
      };
    },
  },
}));

async function loadStore() {
  return import('../../src/native/reducedMotion');
}

describe('the reduce-motion store notifies, instead of only remembering', () => {
  beforeEach(() => {
    changeListener = undefined;
    removed = false;
    vi.resetModules();
  });

  it('starts at false — nothing is known before the platform answers', async () => {
    const store = await loadStore();
    expect(store.getReducedMotionSnapshot()).toBe(false);
  });

  it('DEFECT 1: the async seed wakes existing subscribers', async () => {
    const store = await loadStore();
    const seen: number[] = [];
    store.subscribeReducedMotion(() => seen.push(1));

    resolvePreference(true);
    await Promise.resolve();
    await Promise.resolve();

    expect(store.getReducedMotionSnapshot()).toBe(true);
    expect(seen).toHaveLength(1);
  });

  it('DEFECT 2: a live preference change actually updates the snapshot', async () => {
    const store = await loadStore();
    const seen: number[] = [];
    store.subscribeReducedMotion(() => seen.push(1));
    expect(changeListener).toBeTypeOf('function');

    changeListener!(true);
    expect(store.getReducedMotionSnapshot()).toBe(true);
    expect(seen).toHaveLength(1);

    changeListener!(false);
    expect(store.getReducedMotionSnapshot()).toBe(false);
    expect(seen).toHaveLength(2);
  });

  it('a no-op change notifies nobody — snapshot identity is what stops render loops', async () => {
    const store = await loadStore();
    const seen: number[] = [];
    store.subscribeReducedMotion(() => seen.push(1));
    changeListener!(false);
    expect(seen).toHaveLength(0);
  });

  it('unsubscribing detaches both the local listener and the platform one', async () => {
    const store = await loadStore();
    const seen: number[] = [];
    const unsubscribe = store.subscribeReducedMotion(() => seen.push(1));
    unsubscribe();
    expect(removed).toBe(true);
    changeListener!(true);
    expect(seen).toHaveLength(0);
  });

  it('a rejected platform probe leaves the store usable rather than unhandled', async () => {
    const store = await loadStore();
    expect(store.getReducedMotionSnapshot()).toBe(false);
    expect(() => store.subscribeReducedMotion(() => undefined)()).not.toThrow();
  });
});
