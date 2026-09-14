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

// PRELOADED GEOMETRY — the only way to have a skeleton in the FIRST frame.
//
// A cold key cannot be measured in time, and that is physics, not a defect:
// the sensor measures the real view tree, so the tree must be mounted and laid
// out before there is anything to measure. `test/native/mount-order.test.ts`
// pins the resulting sequence. The library covers that window with a neutral
// block that resolves into the measured shapes, which makes it look right —
// but the only way to REMOVE it is to already have the geometry.
//
// So: measure once, `exportShapeStore` the result, persist it however this app
// already persists things (MMKV, AsyncStorage, a checked-in JSON file), and
// `importIntoShapeStore` it into a store handed to `SkeletonProvider` before
// the first render. Cache hit on the first commit, no cold window at all —
// `test/native/preloaded-geometry.test.ts` proves exactly that round trip.
//
// The import is SYNCHRONOUS on purpose, and that is what makes this work where
// a `hydrate()` on the store would not: geometry that arrives a tick late has
// already missed the frame it was needed for.
//
// NATIVE ONLY, and not an oversight. Web already has a preloaded-geometry
// path — `AutoSkeleton.SSR` replays a build-time manifest captured by this
// package's own CLI, which is strictly better there because it also fixes the
// server render. Native had nothing. Exporting the same two functions from the
// web entry as well measured +302 gzip bytes against 79 bytes of NFR-6
// headroom, to duplicate a capability web already has in a better form and to
// shorten a window that is one frame there (its traversal runs synchronously
// inside the measurement effect, unlike Fabric's mounting-phase round trip).
// Each platform gets the mechanism that fits it; that is not the same thing as
// one platform missing an API.
//
// THE TRAP, stated plainly: persisted geometry outlives the layout it
// describes. Ship a build that changes a card's padding and the stored
// snapshot will paint a confidently WRONG skeleton instantly — worse than the
// neutral block, because it looks deliberate. Key whatever is persisted by
// something that changes with the UI (app build number is the blunt, correct
// choice) and drop it on mismatch. The library cannot do this for you: it has
// no idea which of its consumers' layouts changed.
export { exportShapeStore, importIntoShapeStore } from './core/snapshot-io';
export type { SerializedShapeSnapshot } from './core/types';
export type { ImportReport } from './core/contracts';

// Cross-platform radius telemetry. The same rounded view reports `measured` on
// iOS and web but `style` on Android — all three exact, different rungs — so a
// consumer aggregating the histogram needs this predicate rather than a single
// bucket name. See `isExactRadiusSource`'s own doc comment.
export { isExactRadiusSource } from './core/types';
