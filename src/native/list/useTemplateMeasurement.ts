// src/native/list/useTemplateMeasurement.ts
//
// Task 6.1/6.3 (tasks.md Phase 6) shared primitive: "measure ONE invisible
// template cell, once, deferred" — behind BOTH `SkeletonList`
// (REQ-LIST-EMPTY-2) and `useSkeletonCell` (REQ-LIST-CELL-1's unseen-
// itemType path). Mirrors `native/AutoSkeleton.tsx`'s `useColdMeasurement`
// (same viewRef+onLayout+`nativeSensor.measure()` mechanism), with two
// deliberate differences this phase's DoD demands:
//
//   1. Deferred via `scheduleAfterInteractions` (`InteractionManager
//      .runAfterInteractions` when available, `requestIdleCallback`
//      otherwise — see that file's header for why: `InteractionManager` was
//      found REMOVED on RN 0.87.1 during this phase's own on-device
//      testing), not a single `requestAnimationFrame` — list template
//      measurement is explicitly allowed to wait for interactions/scroll to
//      settle, unlike a whole-screen cold load (tasks.md 6.1/6.3).
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
import { findNodeHandle, View, type LayoutChangeEvent } from 'react-native';
import type { ShapeCacheKey } from '../../core/cache-key';
import { decideCellBind, type TemplateRegistry } from '../../core/list';
import type { MemoryShapeStore } from '../../core/snapshot';
import { nativeSensor } from '../nativeSensorInstance';
import { templateTraversalCounter } from './listRuntime';
import { scheduleAfterInteractions } from './scheduleAfterInteractions';

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

  // REAL, on-device-found race (Phase 6 apply session): when N sibling list
  // cells for the SAME unseen itemType render in the SAME commit (the
  // common case — a fresh list mounts with many loading rows at once),
  // EVERY one of them independently reads `registry.stateFor(itemType)` as
  // `'idle'` during React's render phase, because render phases for ALL
  // siblings complete BEFORE any of their effects flush. Claiming the
  // itemType inside `useEffect` (this file's own first version) is
  // therefore too late: by the time cell 1's effect calls
  // `markScheduled`, cells 2..N have ALREADY computed `shouldSchedule=true`
  // from the same still-`'idle'` read and will ALSO claim it in their own
  // effects — violating "at most once, ever" (ADR-13/RISK-3) under
  // concurrent binds, the exact case list rendering guarantees will happen.
  //
  // Fix: claim SYNCHRONOUSLY, in the render body, the instant this cell
  // decides to schedule. React evaluates each sibling's render function
  // one at a time within a single synchronous pass (component render
  // execution is never parallel), so cell 1's claim is visible to cell 2's
  // render a statement later — well before ANY effect for either has run.
  // This is a deliberate, idempotent, monotonic external-state write during
  // render (never affects what THIS render produces), the same category of
  // pattern this codebase already uses for "adjust state during render"
  // (`everShownContent`/`cycleId` in `AutoSkeleton.tsx`), just against a
  // shared module-scoped registry instead of local component state.
  if (shouldSchedule) {
    registry.markScheduled(itemType);
  }

  const [mounted, setMounted] = useState(false);
  const layoutRef = useRef<{ width: number; height: number } | null>(null);
  const templateRef = useRef<ComponentRef<typeof View> | null>(null);

  useEffect(() => {
    if (!shouldSchedule) {
      return;
    }
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
        finish();
        return;
      }
      // A resolved `reactTag` with a `null` measure result means the JS-side
      // shadow-tree layout has committed, but the corresponding NATIVE view
      // has not finished mounting yet — `Sensor.measure()`'s contract
      // documents this exact case (`fetchShapesOnce` returns `null` when
      // native reports an empty array), and `native/AutoSkeleton.tsx`'s own
      // `useColdMeasurement` hit and fixed the identical timing gap for the
      // whole-screen cold path (its doc comment: "onLayout fires from the
      // shadow tree commit... which genuinely precedes the separate native
      // MOUNTING phase"). This is a REAL, on-device-confirmed instance of
      // the same gap for the list template path — retry across the SAME
      // bounded frame budget already used for the layout/reactTag wait,
      // rather than giving up on the first frame.
      if (attemptsLeft > 0) {
        frameHandle = requestAnimationFrame(() => attemptMeasure(attemptsLeft - 1));
        return;
      }
      finish();
    };

    const interactionHandle = scheduleAfterInteractions(() => {
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
