// src/index.native.ts
//
// ADR-3: the mandatory, explicit native entry. Metro's `preferNativePlatform`
// (unconditionally true) makes `.native.js` win over bare `.js` on iOS and
// Android; this file, and never the web entry, is what those platforms
// resolve to. Task 5.5's `native/AutoSkeleton.tsx` is the public component.
//
// Task 5.4's tier-2 Skia overlay is exported from the `autoskeleton/skia`
// subpath (`src/index.skia.ts`, wired into `package.json#exports` as
// `"./skia"`), so it is never pulled into a consumer's bundle unless they
// explicitly import it (opt-in, ADR-5). Until 2026-08-29 this comment claimed
// that subpath existed while `package.json#exports` had no entry for it, and
// nothing in the library ever rendered the overlay — see `SkiaRenderer.tsx`'s
// header. Neither optional peer is named anywhere in THIS file's transitive
// graph, which is what keeps the default tier dependency-free.

export { AutoSkeleton, SkeletonProvider } from './native/AutoSkeleton';
export type { AutoSkeletonProps, SkeletonProviderProps } from './native/AutoSkeleton';
/** ADR-5 tier-2 opt-in contract. The TYPES live here so a consumer can name
 *  them without importing `autoskeleton/skia`; the implementation, and the
 *  optional peers it needs, live only in that subpath. */
export type { SkeletonOverlayComponent, SkeletonOverlayProps } from './native/overlayContract';
export {
  AutoskeletonNativeModuleUnavailableError,
  AUTOSKELETON_NATIVE_MODULE_UNAVAILABLE_DOCS_URL,
} from './native/nativeModuleAccessor';
// Phase 6 (tasks.md 6.1-6.5): virtualized-list skeletons.
export { SkeletonList } from './native/list/SkeletonList';
export type { SkeletonListProps } from './native/list/SkeletonList';
export { SkeletonListFooter } from './native/list/SkeletonListFooter';
export type { SkeletonListFooterProps } from './native/list/SkeletonListFooter';
export { SkeletonCell } from './native/list/SkeletonCell';
export type { SkeletonCellProps } from './native/list/SkeletonCell';
export { useSkeletonCell } from './native/list/useSkeletonCell';
export type { UseSkeletonCellOptions, UseSkeletonCellResult } from './native/list/useSkeletonCell';
/** RISK-3/ADR-13 dev-only observability seam: counts template measurements
 *  that actually executed (never a bind-time count). Exposed for the
 *  on-device paint-gate harness (`examples/bare-rn`) to prove the
 *  zero-traversal-on-bind/zero-traversal-under-recycling assertions against
 *  the REAL running app, not a formatter in isolation. Not a stable public
 *  API for production consumers. */
export { templateTraversalCounter } from './native/list/listRuntime';
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

// The scoped-store surface behind `<SkeletonProvider store>`. The prop has
// been public on both platforms since Phase 1, but the class that types it was
// never exported, so a consumer could read the prop's type and had no way to
// construct a value for it. `ShapeStore` is the narrower interface the store
// satisfies — enough to type a custom implementation without depending on the
// LRU one.
export { MemoryShapeStore } from './core/snapshot';
export type { MemoryShapeStoreOptions } from './core/snapshot';
export type { ShapeStore } from './core/contracts';

// Cross-platform radius telemetry. The same rounded view reports `measured` on
// iOS and web but `style` on Android — all three exact, different rungs — so a
// consumer aggregating the histogram needs this predicate rather than a single
// bucket name. See `isExactRadiusSource`'s own doc comment.
export { isExactRadiusSource } from './core/types';
