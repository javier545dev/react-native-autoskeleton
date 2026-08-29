// src/native/overlayContract.ts
//
// The contract between `<AutoSkeleton>` and an OPT-IN alternative overlay
// renderer (today: tier-2 Skia, `src/index.skia.ts`).
//
// It lives in its own file, with no imports beyond `core/types` and React's
// type-only surface, so that `native/AutoSkeleton.tsx` can reference it
// without pulling any part of `native/tier2/**` — and therefore neither
// optional peer's name — into `index.native.ts`'s transitive graph. That is
// the property `test/packaging/entries.test.ts` asserts and ADR-5 requires.
//
// Everything the overlay needs is passed as plain data. In particular the
// SHAPES are passed decoded, not as a `cacheKey` for the native shape cache
// the way the tier-1 host component takes them (ADR-9): a JS/Skia renderer
// has no route to the native cache, and `<AutoSkeleton>` already holds the
// decoded snapshot for metrics and list sizing, so nothing is measured twice.

import type { ComponentType } from 'react';
import type { ShapeInfo } from '../core/types';

export interface SkeletonOverlayProps {
  /** Decoded shapes, in wire order, relative to the wrapper's top-left. */
  readonly shapes: readonly ShapeInfo[];
  readonly baseColor: string;
  readonly highlightColor: string;
  /** Already arbitrated by `core/shimmer-period.ts` — ADR-8's one period. */
  readonly speedMs: number;
  /** The measured wrapper frame the shapes are relative to. */
  readonly width: number;
  readonly height: number;
  readonly reducedMotion: boolean;
}

export type SkeletonOverlayComponent = ComponentType<SkeletonOverlayProps>;
