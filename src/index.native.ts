// src/index.native.ts
//
// ADR-3: the mandatory, explicit native entry. Metro's `preferNativePlatform`
// (unconditionally true) makes `.native.js` win over bare `.js` on iOS and
// Android; this file, and never the web entry, is what those platforms
// resolve to. Task 5.5's `native/AutoSkeleton.tsx` is the public component;
// task 5.4's tier-2 Skia overlay is exported from its own subpath so it is
// never pulled into a consumer's bundle unless explicitly imported (opt-in,
// ADR-5) — see `SkiaRenderer.tsx`'s header for why neither optional peer is
// ever statically imported by this file's own transitive graph either.

export { AutoSkeleton, SkeletonProvider } from './native/AutoSkeleton';
export type { AutoSkeletonProps, SkeletonProviderProps } from './native/AutoSkeleton';
export {
  AutoskeletonNativeModuleUnavailableError,
  AUTOSKELETON_NATIVE_MODULE_UNAVAILABLE_DOCS_URL,
} from './native/nativeModuleAccessor';
// Phase 6 (tasks.md 6.1-6.5): virtualized-list skeletons.
export { SkeletonList } from './native/list/SkeletonList';
export type { SkeletonListProps } from './native/list/SkeletonList';
export { SkeletonListFooter } from './native/list/SkeletonListFooter';
export type { SkeletonListFooterProps } from './native/list/SkeletonListFooter';
export { useSkeletonCell } from './native/list/useSkeletonCell';
export type { UseSkeletonCellOptions, UseSkeletonCellResult } from './native/list/useSkeletonCell';
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
