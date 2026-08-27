// src/index.web.ts
//
// ADR-3: the mandatory, explicit web entry — Metro's `preferNativePlatform`
// is unconditionally `true` even on `web`, so step (1) of its extension
// search (`.web.js`) MUST win before step (2) (`.native.js`) can ever fire.
// This file, and never a bare `src/index.ts`, is the actual web resolution
// mechanism. It imports ONLY `src/web/**` and `src/core/**` — zero
// `react-native`, `@shopify/react-native-skia`, or `react-native-reanimated`
// specifiers anywhere in its transitive graph (task 2.5's packaging test).

export { AutoSkeleton, SkeletonProvider, IGNORE_ATTRIBUTE } from './web/AutoSkeleton';
export type { AutoSkeletonProps, SkeletonProviderProps } from './web/AutoSkeleton';
export type {
  AnimationKind,
  DegradationFlag,
  HandoffReason,
  OnMetrics,
  Platform,
  RadiusSource,
  RendererKind,
  ShapeInfo,
  ShapeSnapshot,
  ShapeSource,
  SkeletonMetrics,
} from './core/types';
