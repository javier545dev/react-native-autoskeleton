// test/web/helpers/component-entry.ts
//
// esbuild entry for test/web/auto-skeleton.spec.ts (tasks 2.3/2.4). Bundles
// React + ReactDOM + the REAL production `<AutoSkeleton>`/`SkeletonProvider`
// component graph together (this test bundle's size is irrelevant — task
// 2.5's packaging test measures the PRODUCTION consumer bundle separately,
// never this harness).

import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { AutoSkeleton, SkeletonProvider, __resetFontScaleForTests } from '../../../src/web/AutoSkeleton';
import { MemoryShapeStore } from '../../../src/core/snapshot';

declare global {
  interface Window {
    AutoskeletonComponent: {
      React: typeof React;
      createRoot: typeof createRoot;
      AutoSkeleton: typeof AutoSkeleton;
      SkeletonProvider: typeof SkeletonProvider;
      MemoryShapeStore: typeof MemoryShapeStore;
      __resetFontScaleForTests: typeof __resetFontScaleForTests;
    };
  }
}

window.AutoskeletonComponent = {
  React,
  createRoot,
  AutoSkeleton,
  SkeletonProvider,
  MemoryShapeStore,
  __resetFontScaleForTests,
};
