// src/native/list/useTemplateMeasurement.ts
//
// Task 6.1/6.3 (tasks.md Phase 6) shared primitive: "measure ONE invisible
// template cell, once, deferred" — behind BOTH `SkeletonList`
// (REQ-LIST-EMPTY-2) and `useSkeletonCell` (REQ-LIST-CELL-1's unseen-
// itemType path). Mirrors `native/AutoSkeleton.tsx`'s `useColdMeasurement`
// (same viewRef+onLayout+`nativeSensor.measure()` mechanism), with two
// deliberate differences this phase's DoD demands:
//
//   1. Deferred via `InteractionManager.runAfterInteractions`, not a single
//      `requestAnimationFrame` — list template measurement is explicitly
//      allowed to wait for interactions/scroll to settle, unlike a
//      whole-screen cold load (tasks.md 6.1/6.3).
//   2. Runs AT MOST ONCE per `itemType` for the whole app session
//      (`templateRegistry`, `src/core/list.ts`, `decideCellBind`) — never
//      once per mounted list/cell instance. `decideCellBind` is the single
//      source of truth for whether THIS bind may schedule it; this hook
//      never calls the sensor on its own initiative.
//
// A caller with no `renderTemplate` never gets real content to traverse —
// documented as a deliberate v1 limitation (see `useSkeletonCell.ts`'s and
// `SkeletonList.tsx`'s own doc comments): the fallback keeps rendering
// forever, correctly (never a crash, never a stale/wrong shape), just never
// resolves to a measured one for that itemType.

import { useEffect, useRef, useState, type ComponentRef, type ReactNode, type RefObject } from 'react';
import { findNodeHandle, InteractionManager, View, type LayoutChangeEvent } from 'react-native';
import type { ShapeCacheKey } from '../../core/cache-key';
import { decideCellBind, type TemplateRegistry } from '../../core/list';
import type { MemoryShapeStore } from '../../core/snapshot';
import { nativeSensor } from '../nativeSensorInstance';
import { templateTraversalCounter } from './listRuntime';

/** Bounded retry budget while waiting for the invisible template's own
 *  `onLayout` to land before the deferred measurement runs — mirrors this
 *  project's established "bounded retry, never infinite polling" discipline
 *  (e.g. `PaintGateUITests`'s `pollUntilPixel`). ~10 frames is generous for
 *  a layout that has already committed by the time interactions settle. */
const MAX_LAYOUT_WAIT_FRAMES = 10;

export interface UseTemplateMeasurementOptions {
  readonly itemType: string;
  readonly cacheKey: ShapeCacheKey;
  readonly cacheHit: boolean;
  readonly renderTemplate?: () => ReactNode;
  readonly registry: TemplateRegistry;
  readonly store: MemoryShapeStore;
  readonly budgetMs: number;
  readonly maxShapes: number;
  readonly defaultRadius: number;
}

export interface UseTemplateMeasurementResult {
  /** Render this (if non-null) somewhere invisible in the tree — `null`
   *  once idle, already measured, or no `renderTemplate` was supplied. */
  readonly pendingTemplateNode: ReactNode | null;
  readonly templateRef: RefObject<ComponentRef<typeof View> | null>;
  readonly onTemplateLayout: (event: LayoutChangeEvent) => void;
}

export function useTemplateMeasurement(
  options: UseTemplateMeasurementOptions,
): UseTemplateMeasurementResult {
  const { itemType, cacheKey, cacheHit, renderTemplate, registry, store, budgetMs, maxShapes, defaultRadius } =
    options;
  const decision = decideCellBind(cacheHit, registry.stateFor(itemType));
  const shouldSchedule = decision.shouldScheduleTemplateMeasurement && renderTemplate !== undefined;

  const [mounted, setMounted] = useState(false);
  const layoutRef = useRef<{ width: number; height: number } | null>(null);
  const templateRef = useRef<ComponentRef<typeof View> | null>(null);

  // Claims the itemType (markScheduled) the instant this bind decides to
  // schedule, so no OTHER concurrently-binding cell for the same itemType
  // can ALSO decide to schedule before this one's deferred callback runs —
  // this is what makes "at most once, ever" hold under concurrent binds,
  // not just sequential ones.
  useEffect(() => {
    if (!shouldSchedule) {
      return;
    }
    registry.markScheduled(itemType);
    setMounted(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldSchedule, itemType]);

  const onTemplateLayout = (event: LayoutChangeEvent): void => {
    layoutRef.current = {
      width: event.nativeEvent.layout.width,
      height: event.nativeEvent.layout.height,
    };
  };

  useEffect(() => {
    if (!mounted) {
      return;
    }
    let cancelled = false;
    let frameHandle: number | null = null;

    const finish = (): void => {
      registry.markMeasured(itemType);
      setMounted(false);
    };

    const attemptMeasure = (attemptsLeft: number): void => {
      if (cancelled) {
        return;
      }
      const layout = layoutRef.current;
      const reactTag = findNodeHandle(templateRef.current);
      if ((!layout || reactTag == null) && attemptsLeft > 0) {
        frameHandle = requestAnimationFrame(() => attemptMeasure(attemptsLeft - 1));
        return;
      }
      if (!layout || reactTag == null) {
        // The template never laid out (e.g. `renderTemplate` returned
        // something with zero size) — give up cleanly rather than retry
        // forever. No cache entry is written; the fallback keeps rendering.
        finish();
        return;
      }
      const result = nativeSensor.measure(
        { reactTag, frameWidth: layout.width, frameHeight: layout.height },
        {
          key: cacheKey,
          hints: {
            linesFor: () => undefined,
            radiusFor: () => undefined,
            isIgnored: () => false,
          },
          budgetMs,
          maxShapes,
          defaultRadius,
          collectDebugSidecars: false,
        },
      );
      if (result) {
        store.set(result.snapshot.key, result.snapshot);
        templateTraversalCounter.increment();
      }
      finish();
    };

    const interactionHandle = InteractionManager.runAfterInteractions(() => {
      attemptMeasure(MAX_LAYOUT_WAIT_FRAMES);
    });

    return () => {
      cancelled = true;
      interactionHandle.cancel();
      if (frameHandle !== null) {
        cancelAnimationFrame(frameHandle);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, itemType, cacheKey, budgetMs, maxShapes, defaultRadius, store, registry]);

  return {
    pendingTemplateNode: mounted && renderTemplate ? renderTemplate() : null,
    templateRef,
    onTemplateLayout,
  };
}
