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
// tasks.md 8.3 / NFR-6: SSR support (`AutoSkeletonSSR`/`AutoSkeletonSSRHydrate`)
// is DELIBERATELY NOT exported from this `.` entry. `test/packaging/web-bundle
// .test.ts` measures NFR-6 by bundling this ENTIRE file in Vite library mode,
// which retains every export as public API surface regardless of whether a
// given consumer imports it — unlike a normal app import, library-mode
// bundling does NOT tree-shake unused entry exports. Measured here: even as
// plain named (non-attached) exports, pulling in `AutoSkeletonSSRHydrate`
// (which imports `snapshot-io.ts`'s `importIntoShapeStore` — the exact
// function task 2.5 already fought to keep off this hot path) pushed the
// gate from 7674 B to ~8175 B of the then-8192 B hard-failing budget (since
// revised to 9216 B — see spec.md NFR-6's second revision). SSR is a
// genuinely opt-in, Next.js-specific feature (like `uniwind` theming) — it
// lives at its own subpath, `autoskeleton/ssr` (`src/index.ssr.ts`), which
// this entry's transitive graph never reaches.
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

// The scoped-store surface behind `<SkeletonProvider store>` — see
// `index.native.ts` for the full account. `MemoryShapeStore` is already in
// this entry's transitive graph (`web/AutoSkeleton.tsx` instantiates the
// module-level `defaultStore` from it), so naming it here adds an export
// binding rather than a new class body; `test/packaging/web-bundle.test.ts`
// holds the NFR-6 gzip gate that keeps that claim honest.
export { MemoryShapeStore } from './core/snapshot';
export type { MemoryShapeStoreOptions } from './core/snapshot';
export type { ShapeStore } from './core/contracts';

// Cross-platform radius telemetry. The same rounded view reports `measured` on
// iOS and web but `style` on Android — all three exact, different rungs — so a
// consumer aggregating the histogram needs this predicate rather than a single
// bucket name. See `isExactRadiusSource`'s own doc comment.
export { isExactRadiusSource } from './core/types';
