// src/native/list/useSkeletonCell.ts
//
// Task 6.3 (tasks.md Phase 6) — REQ-LIST-CELL-1 / ADR-13's HARD RULE, "zero
// traversal on bind, ever". Every render/bind of this hook does EXACTLY ONE
// thing synchronously: `ctx.store.get(cacheKey)`. There is NO code path in
// this function's render body that reaches the native sensor — the only
// call to `nativeSensor.measure()` anywhere in this file's dependency graph
// lives inside `useTemplateMeasurement`'s `InteractionManager
// .runAfterInteractions` callback, gated by `decideCellBind`
// (`src/core/list.ts`, Vitest-tested in isolation) so it fires AT MOST ONCE
// per itemType for the app session.
//
// API deviation from spec.md's abbreviated example, stated explicitly: the
// spec's Given/When text for REQ-LIST-CELL-1 doesn't show how the deferred
// traversal gets real content to measure. `useSkeletonCell` accepts an
// optional `renderTemplate` for exactly that — omitting it is valid and
// documented: the fallback keeps rendering correctly, forever, for that
// itemType (never a crash, never a stale shape), it just never resolves to
// a measured one. This mirrors `SkeletonList`'s identical `renderTemplate`
// prop (task 6.1) — both entry points share the SAME underlying mechanism
// (`useTemplateMeasurement`) and the SAME per-itemType registry, so a
// template supplied at EITHER entry point satisfies every other bind of
// that itemType across the whole app.

import { useContext, type ReactNode } from 'react';
import { I18nManager, PixelRatio, Platform, useWindowDimensions } from 'react-native';
import { bucketWidth, composeCacheKey } from '../../core/cache-key';
import { quantizeFontScale } from '../../core/cache-key';
import type { ShapeSnapshot } from '../../core/types';
import { SkeletonContext } from '../AutoSkeleton';
import { templateRegistry } from './listRuntime';
import { useTemplateMeasurement } from './useTemplateMeasurement';

export interface UseSkeletonCellOptions {
  readonly itemType: string;
  /** Disambiguates multiple lists/cell kinds on the same screen; defaults to
   *  `itemType` (plan.md §3.2's composite key requires SOME `skeletonKey`,
   *  and the literal spec example — `useSkeletonCell('feedCard')` — supplies
   *  none). */
  readonly skeletonKey?: string;
  /** One real cell's content, mounted invisibly at most once per itemType
   *  for the app session, to seed the shared cache (see file header). */
  readonly renderTemplate?: () => ReactNode;
}

export interface UseSkeletonCellResult {
  /** The real measured snapshot on a cache hit; `null` on the fallback path. */
  readonly snapshot: ShapeSnapshot | null;
  readonly cacheHit: boolean;
  /** True while resolving via `FallbackSkeletonBlock` rather than a real
   *  measured snapshot — REQ-LIST-CELL-1's "distinguishable dev-sidecar
   *  flag" for the unseen-itemType path. */
  readonly isFallback: boolean;
  readonly cacheKey: string;
  /** Render this (if non-null) somewhere invisible while a template
   *  measurement is in flight for this itemType. */
  readonly pendingTemplateNode: ReactNode | null;
  readonly templateRef: ReturnType<typeof useTemplateMeasurement>['templateRef'];
  readonly onTemplateLayout: ReturnType<typeof useTemplateMeasurement>['onTemplateLayout'];
}

export function useSkeletonCell(options: UseSkeletonCellOptions): UseSkeletonCellResult {
  const ctx = useContext(SkeletonContext);
  const { width: windowWidth } = useWindowDimensions();
  const widthBucket = bucketWidth(windowWidth);
  const direction = I18nManager.isRTL ? 'rtl' : 'ltr';
  const platform: 'ios' | 'android' = Platform.OS === 'android' ? 'android' : 'ios';

  const cacheKey = composeCacheKey({
    skeletonKey: options.skeletonKey ?? options.itemType,
    itemType: options.itemType,
    viewportWidth: widthBucket,
    fontScale: quantizeFontScale(PixelRatio.getFontScale()),
    direction,
    platform,
  });

  // THE ONLY SYNCHRONOUS ACTION ON BIND: a sync cache read. No sensor call
  // exists on this line, or anywhere reachable from it, on the bind path.
  const snapshot = ctx.store.get(cacheKey) ?? null;
  const cacheHit = snapshot !== null;

  const { pendingTemplateNode, templateRef, onTemplateLayout } = useTemplateMeasurement({
    itemType: options.itemType,
    cacheKey,
    cacheHit,
    renderTemplate: options.renderTemplate,
    registry: templateRegistry,
    store: ctx.store,
    budgetMs: ctx.budgetMs,
    maxShapes: ctx.maxShapes,
    defaultRadius: ctx.theme.defaultRadius,
  });

  return {
    snapshot,
    cacheHit,
    isFallback: !cacheHit,
    cacheKey,
    pendingTemplateNode,
    templateRef,
    onTemplateLayout,
  };
}
