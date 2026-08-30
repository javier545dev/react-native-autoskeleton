// test/web/helpers/ssr-hydrate-entry.ts
//
// esbuild entry for `test/web/ssr-hydrate.spec.ts`. Bundles React + ReactDOM
// with the REAL `<AutoSkeleton.SSRHydrate>` client bridge and the REAL
// `<AutoSkeleton>` runtime component together, so the spec exercises the exact
// production module graph the Next.js example's `app/layout.tsx` wires up —
// never a stand-in for it.
//
// `defaultStore` is exported deliberately: the production wiring under test is
// the one with NO `<SkeletonProvider>` anywhere, where the bridge writes into
// the same module-level store `<AutoSkeleton>` reads from. Passing an explicit
// store would prove a different, easier claim.

import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { AutoSkeleton, defaultStore, __resetFontScaleForTests } from '../../../src/web/AutoSkeleton';
import { AutoSkeletonSSRHydrate } from '../../../src/web/ssr/hydrate';

declare global {
  interface Window {
    AutoskeletonSsrHydrate: {
      React: typeof React;
      createRoot: typeof createRoot;
      AutoSkeleton: typeof AutoSkeleton;
      AutoSkeletonSSRHydrate: typeof AutoSkeletonSSRHydrate;
      defaultStore: typeof defaultStore;
      __resetFontScaleForTests: typeof __resetFontScaleForTests;
    };
  }
}

window.AutoskeletonSsrHydrate = {
  React,
  createRoot,
  AutoSkeleton,
  AutoSkeletonSSRHydrate,
  defaultStore,
  __resetFontScaleForTests,
};
