// src/native/reducedMotion.ts
//
// The platform reduce-motion preference, as a real external store.
//
// It lives in its own module for two reasons. The first is testability: the
// store half is where both of its defects lived, and it is only observable
// WITHOUT React — a `renderToStaticMarkup` test takes `getServerSnapshot`,
// a path React Native never runs, so a green test there would have proven
// nothing. The second is reach: `<AutoSkeleton>` read the preference and the
// three list entry points did not, so it has to be importable from somewhere
// that is not `AutoSkeleton.tsx` itself.
//
// Both defects it fixes were silent:
//
//  1. The snapshot was seeded by `AccessibilityInfo.isReduceMotionEnabled()
//     .then(v => { snapshot = v })` and notified nobody.
//     `useSyncExternalStore` only re-reads `getSnapshot` when a subscriber is
//     told to, so a user who already had the preference on before launch got a
//     shimmer on the first skeleton after every cold start.
//  2. `subscribe` handed React's own `onChange` straight to
//     `addEventListener('reduceMotionChanged', ...)`. The platform delivered
//     the new value to a callback that ignores its argument, React woke up and
//     re-read a snapshot nobody had written — so toggling the setting while the
//     app ran did nothing at all, permanently.
//
// Both come from the same root cause: "remember the value" and "tell React the
// value changed" were two different code paths, and only one of them ever ran.
// Here there is one writer, `publish`, and notifying is not optional.

import { useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';

let snapshot = false;
const listeners = new Set<() => void>();

/** The ONLY writer. Notifying is part of writing, not a separate step a caller
 *  can forget — which is exactly what both defects above were. */
function publish(next: boolean): void {
  // `useSyncExternalStore` re-renders whenever a subscriber fires and the
  // snapshot differs; firing on an unchanged value is pure wasted work, and
  // for a boolean store the identity check is the whole cache.
  if (next === snapshot) {
    return;
  }
  snapshot = next;
  for (const listener of listeners) {
    listener();
  }
}

// Seeded once per JS context. `?.()` because the method is absent on some
// platform shims; `catch` because a rejected probe must leave the store
// usable at its `false` default rather than surfacing an unhandled rejection.
AccessibilityInfo.isReduceMotionEnabled?.()
  .then(publish)
  .catch(() => undefined);

/** `useSyncExternalStore`'s `getSnapshot`. Exported for the store's own tests. */
export function getReducedMotionSnapshot(): boolean {
  return snapshot;
}

/** `useSyncExternalStore`'s `subscribe`. Exported for the store's own tests. */
export function subscribeReducedMotion(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  const platformSubscription = AccessibilityInfo.addEventListener('reduceMotionChanged', publish);
  return () => {
    listeners.delete(onStoreChange);
    platformSubscription.remove();
  };
}

/** The platform preference, synchronously readable and genuinely live.
 *
 *  The server snapshot is `false` because React Native never server-renders;
 *  it exists only to satisfy the hook's signature. Any test asserting real
 *  behaviour through a server renderer is asserting against this constant, not
 *  against the store — which is why this module's own tests use neither. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, getReducedMotionSnapshot, () => false);
}
