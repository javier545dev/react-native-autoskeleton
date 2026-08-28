// src/web/AutoSkeleton.tsx
//
// tasks.md 2.3: the `<AutoSkeleton>` web component. Wires task 2.1's DOM
// sensor, task 2.2's CSS renderer, and Phase 1's cache/handoff/metrics core
// modules into the public React surface (plan.md §3.8's `AutoSkeletonHandoff
// Props`, spec §1.1/§1.5/§1.6/§1.10, §2.1).
//
// no-use-effect skill compliance: this component function itself never calls
// `useEffect` directly. Every side effect below (mounting the imperative
// `RendererHandle`, running the synchronous-but-DOM-dependent cold
// traversal, calling `HandoffController.requestHandoff()`) is isolated in a
// small custom hook, which is the skill's explicitly documented escape
// hatch ("The only place useEffect may appear directly is inside reusable
// custom hooks"). "Has content ever been shown" (REQ-PTR-1) and "which load
// cycle is this" (fresh `HandoffController` per cycle) are tracked via
// React's own documented "adjusting state during render" pattern
// (https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-
// state-when-a-prop-changes) — comparing a previous-value STATE variable and
// calling `setState` conditionally during render, never a bare ref used as
// an effect-avoidance hack (Rule 6).

import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { bucketWidth, composeCacheKey, quantizeFontScale } from '../core/cache-key';
import type { RendererHandle, SkeletonTheme } from '../core/contracts';
import { createHandoffController } from '../core/handoff';
import type { HandoffController, SkeletonPipelinePhase } from '../core/handoff';
import {
  assembleMetrics,
  checkBudgets,
  checkRadiusFallback,
  DEFAULT_BUDGET_MS,
  DEFAULT_MAX_SHAPES,
  DEFAULT_RADIUS_FALLBACK_SHARE,
  emitBudgetWarnings,
  emitRadiusFallbackWarning,
} from '../core/metrics';
import { shouldRunHandoffCycle } from '../core/refresh-gate';
import { MemoryShapeStore } from '../core/snapshot';
import type { AnimationKind, OnMetrics, ShapeSnapshot } from '../core/types';
import { WIRE_HEADER_SLOTS, WIRE_STRIDE } from '../core/types';
import { createCssRenderer, createShimmerClock, DEFAULT_BASE_COLOR, DEFAULT_HIGHLIGHT_COLOR } from './css-renderer';
import { createDomSensor, createEmptyHintRegistry, IGNORE_ATTRIBUTE } from './dom-sensor';
import { DebugOverlay } from './DebugOverlay';

// tasks.md 7.1 / REQ-THEME-1: these MUST be the exact same values
// `css-renderer.ts`'s stylesheet uses as its `var(--skl-base, DEFAULT)`
// fallback — imported, not duplicated, so the renderer's "is this theme
// still the untouched default?" check (which decides whether to defer to
// the CSS cascade) can never silently drift from what a consumer actually
// gets when they never customize `SkeletonProvider`.
const DEFAULT_THEME: SkeletonTheme = {
  baseColor: DEFAULT_BASE_COLOR,
  highlightColor: DEFAULT_HIGHLIGHT_COLOR,
  defaultRadius: 4,
  speedMs: 1400,
};
const DEFAULT_HANDOFF_TIMEOUT_MS = 250;
const DEFAULT_HANDOFF_FADE_MS = 120;

interface SkeletonContextValue {
  readonly store: MemoryShapeStore;
  readonly theme: SkeletonTheme;
  readonly budgetMs: number;
  readonly maxShapes: number;
  /** REQ-OBS-BUDGET-2: share of a screen's shapes allowed to resolve their
   *  corner radius through the `default` rung before a dev warning fires. */
  readonly radiusFallbackShare: number;
  readonly handoffTimeoutMs: number;
  readonly handoffFadeMs: number;
}

/** Module-level default store: a shared cache across the whole page/app
 *  session, which is what makes REQ-NAV-1's hot path (navigate away, come
 *  back, get the cached shapes with zero traversal) work WITHOUT requiring
 *  every consumer to wire a `SkeletonProvider`. `SkeletonProvider` exists to
 *  OPT INTO a custom store/theme (e.g. test isolation), not because one is
 *  required. */
// Exported (not just module-private) so `src/web/ssr/hydrate.tsx`'s client
// hydration bridge (task 8.3) can `importIntoShapeStore` build-time-captured
// snapshots into the SAME store `<AutoSkeleton>` reads from by default —
// without this, a captured snapshot would only ever populate a store a
// consumer explicitly created and never wired to their own
// `<SkeletonProvider>`, defeating the whole point of the hydration bridge
// (a subsequent client-side-only re-render of the same key getting a real
// cache hit instead of a fresh cold traversal).
export const defaultStore = new MemoryShapeStore();
const defaultContextValue: SkeletonContextValue = {
  store: defaultStore,
  theme: DEFAULT_THEME,
  budgetMs: DEFAULT_BUDGET_MS,
  maxShapes: DEFAULT_MAX_SHAPES,
  radiusFallbackShare: DEFAULT_RADIUS_FALLBACK_SHARE,
  handoffTimeoutMs: DEFAULT_HANDOFF_TIMEOUT_MS,
  handoffFadeMs: DEFAULT_HANDOFF_FADE_MS,
};

const SkeletonContext = createContext<SkeletonContextValue>(defaultContextValue);

export interface SkeletonProviderProps {
  readonly store?: MemoryShapeStore;
  readonly theme?: Partial<SkeletonTheme>;
  readonly budgetMs?: number;
  readonly maxShapes?: number;
  readonly radiusFallbackShare?: number;
  readonly handoffTimeoutMs?: number;
  readonly handoffFadeMs?: number;
  readonly children?: ReactNode;
}

export function SkeletonProvider(props: SkeletonProviderProps): React.JSX.Element {
  const value: SkeletonContextValue = {
    store: props.store ?? defaultContextValue.store,
    theme: { ...defaultContextValue.theme, ...props.theme },
    budgetMs: props.budgetMs ?? defaultContextValue.budgetMs,
    maxShapes: props.maxShapes ?? defaultContextValue.maxShapes,
    radiusFallbackShare: props.radiusFallbackShare ?? defaultContextValue.radiusFallbackShare,
    handoffTimeoutMs: props.handoffTimeoutMs ?? defaultContextValue.handoffTimeoutMs,
    handoffFadeMs: props.handoffFadeMs ?? defaultContextValue.handoffFadeMs,
  };
  return <SkeletonContext.Provider value={value}>{props.children}</SkeletonContext.Provider>;
}

/** `<AutoSkeleton.Ignore>` — `display: contents` keeps the wrapper out of the
 *  box model (spec REQ-THEME-3 / brief §8: no layout impact from the Ignore
 *  channel) while still giving the sensor a DOM node carrying the `data-*`
 *  attribute it checks (task 2.1's `IGNORE_ATTRIBUTE`). */
function Ignore(props: { readonly children: ReactNode }): React.JSX.Element {
  return (
    <div data-autoskeleton-ignore="true" style={{ display: 'contents' }}>
      {props.children}
    </div>
  );
}

const sensor = createDomSensor();
const renderer = createCssRenderer();
const sharedClock = createShimmerClock();

export interface AutoSkeletonProps {
  readonly isLoading: boolean;
  readonly skeletonKey: string;
  readonly itemType?: string;
  readonly animation?: AnimationKind;
  /** Delay before the skeleton becomes visible, avoiding a flash for loads
   *  that resolve almost immediately. */
  readonly delay?: number;
  readonly onMetrics?: OnMetrics;
  readonly debugOverlay?: boolean;
  /** REQ-PTR-1 opt-out: by default, `isLoading=true` over already-rendered
   *  content (pull-to-refresh) keeps showing that content instead of a
   *  skeleton. Setting this renders the skeleton on every refresh too. */
  readonly skeletonOnRefresh?: boolean;
  /** ADR-16 / plan.md §3.8 handoff props. */
  readonly onSuccessorPainted?: () => void;
  readonly expectsPlaceholder?: boolean;
  readonly children?: ReactNode;
}

function reducedMotionPreferred(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function currentDirection(): 'ltr' | 'rtl' {
  if (typeof document === 'undefined') {
    return 'ltr';
  }
  return document.documentElement.getAttribute('dir') === 'rtl' ? 'rtl' : 'ltr';
}

/** `useSyncExternalStore` over `window`'s `resize` event (no-use-effect
 *  skill: "subscribing to an external store"). Re-rendering on a width-
 *  bucket change is what makes REQ-NAV-1's rotation-invalidation scenario
 *  work: `cacheKey` is a plain value derived from this during render, so a
 *  bucket change naturally produces a cache miss and a fresh traversal. */
function useViewportWidthBucket(): number {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === 'undefined') {
        return () => {};
      }
      window.addEventListener('resize', onChange);
      return () => window.removeEventListener('resize', onChange);
    },
    () => bucketWidth(typeof window !== 'undefined' ? window.innerWidth : 0),
    () => 0,
  );
}

/** Mounts/updates/destroys the imperative `RendererHandle` (plan.md §3.5).
 *  `RendererHandle` is a deliberate, non-React-owned DOM-mutation escape
 *  hatch BY THE CONTRACT'S OWN DESIGN (geometry-only updates that must not
 *  restart the shimmer phase or allocate per frame) — exactly the "DOM
 *  integration / external system" case the no-use-effect skill's Rule 4
 *  grants a custom hook for. */
function useOverlayRenderer(
  hostRef: React.RefObject<HTMLDivElement | null>,
  snapshot: ShapeSnapshot | null,
  theme: SkeletonTheme,
  animation: AnimationKind,
  debugOverlayEnabled: boolean,
): void {
  const handleRef = useRef<RendererHandle | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !snapshot) {
      return;
    }
    if (!handleRef.current) {
      handleRef.current = renderer.mount(host, {
        snapshot,
        theme,
        animation,
        clock: sharedClock,
        reducedMotion: reducedMotionPreferred(),
        debugOverlay: debugOverlayEnabled,
      });
    } else {
      handleRef.current.update(snapshot);
      handleRef.current.setAnimation(animation);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, theme, animation, debugOverlayEnabled]);

  useEffect(
    () => () => {
      handleRef.current?.destroy();
      handleRef.current = null;
    },
    [],
  );
}

/** `process.env.NODE_ENV !== 'production'` is this platform layer's dev/prod
 *  signal (matches `debugOverlayEnabled` below). REQ-OBS-BUDGET-1/2 warnings
 *  are development-only by requirement; core stays platform-agnostic
 *  (ADR-4: zero platform imports), so the gate belongs here, not in
 *  `src/core/metrics.ts`. */
function devWarningsEnabled(): boolean {
  return process.env.NODE_ENV !== 'production';
}

/** Runs the synchronous cold traversal (task 2.1) when there is no cache hit
 *  and no cold snapshot yet for the current `cacheKey`. A real DOM sensor
 *  read is genuine external-system synchronization (the browser's layout
 *  engine), not derivable state — the skill's Rule 4 case.
 *
 *  Observability: this is the REAL measurement path REQ-OBS-BUDGET-1 and
 *  REQ-OBS-BUDGET-2 require — `checkBudgets`/`checkRadiusFallback` run
 *  against this traversal's OWN real `traversalMs`/shapeCount/radiusSources,
 *  never a value constructed only for a test. A formatter unit-tested in
 *  isolation but never invoked here would NOT satisfy either requirement. */
function useColdMeasurement(
  wrapperRef: React.RefObject<HTMLDivElement | null>,
  active: boolean,
  cacheKey: string,
  hintsIgnored: boolean,
  budgetMs: number,
  maxShapes: number,
  defaultRadius: number,
  radiusFallbackShare: number,
  store: MemoryShapeStore,
  onMeasured: (snapshot: ShapeSnapshot, traversalMs: number) => void,
): void {
  useEffect(() => {
    if (!active || hintsIgnored) {
      return;
    }
    const wrapper = wrapperRef.current;
    if (!wrapper) {
      return;
    }
    const result = sensor.measure(wrapper, {
      key: cacheKey as unknown as Parameters<typeof sensor.measure>[1]['key'],
      hints: createEmptyHintRegistry(),
      budgetMs,
      maxShapes,
      defaultRadius,
      collectDebugSidecars: true,
    });
    if (result) {
      store.set(result.snapshot.key, result.snapshot);
      onMeasured(result.snapshot, result.traversalMs);

      if (devWarningsEnabled()) {
        const measuredShapeCount = (result.snapshot.data.length - WIRE_HEADER_SLOTS) / WIRE_STRIDE;
        // dom-sensor.ts's `pushShape` stops accepting shapes the instant
        // `ctx.shapes.length` reaches `maxShapes`, so a truncated snapshot's
        // OWN count can never literally exceed `maxShapes` — the sensor's
        // `shape-cap-reached` degradation flag is what actually proves the
        // real traversal found more than the budget allows (it fires
        // exactly when a shape beyond the cap was rejected), so it is the
        // authoritative signal `checkBudgets` needs here, not a naive
        // count > maxShapes comparison against already-capped data.
        const shapeCountForBudgetCheck = result.degraded.includes('shape-cap-reached')
          ? maxShapes + 1
          : measuredShapeCount;
        emitBudgetWarnings(checkBudgets(result.traversalMs, shapeCountForBudgetCheck, { budgetMs, maxShapes }));
        emitRadiusFallbackWarning(checkRadiusFallback(result.snapshot.radiusSources, { radiusFallbackShare }));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, cacheKey]);
}

/** Withholds the skeleton until `delayMs` has elapsed since this loading
 *  cycle started, so a load that resolves almost immediately never shows a
 *  skeleton at all. Closes a real gap found this session: `delay` was
 *  declared in `AutoSkeletonProps` (and documented as doing exactly this)
 *  but never read anywhere in this file — a prop that is accepted and
 *  silently ignored is worse than a missing one. `delayMs <= 0` (the
 *  default/omitted case) elapses immediately, so every existing consumer
 *  that never set `delay` keeps today's exact behavior. Mirrors
 *  `native/AutoSkeleton.tsx`'s identically-named hook so the two platforms
 *  agree on semantics. */
function useSkeletonDelayGate(delayMs: number, cycleId: number): boolean {
  const [state, setState] = useState<{ cycleId: number; elapsed: boolean }>(() => ({
    cycleId,
    elapsed: delayMs <= 0,
  }));
  if (state.cycleId !== cycleId) {
    setState({ cycleId, elapsed: delayMs <= 0 });
  }

  useEffect(() => {
    if (delayMs <= 0) {
      return;
    }
    const handle = setTimeout(() => {
      setState((prev) => (prev.cycleId === cycleId ? { cycleId, elapsed: true } : prev));
    }, delayMs);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cycleId, delayMs]);

  return state.cycleId === cycleId ? state.elapsed : delayMs <= 0;
}

/** Calls `requestHandoff()` the render after `isLoading` transitions from
 *  true to false, and assembles/fires `onMetrics` exactly once when the
 *  controller settles (REQ-OBS-METRICS-1). This is genuine synchronization
 *  with an external, imperative state machine reacting to a value this
 *  component does not own the transition of (the parent's data resolving) —
 *  the skill's Rule 4 case, isolated in its own hook. */
/** Task 6.5 fix (REQ-PTR-1 observability, tasks.md Phase 6): when
 *  `skeletonSuppressed` is true (the default stale-while-revalidate PTR
 *  path), no skeleton-to-content lifecycle ever visually occurred for this
 *  cycle, so neither `requestHandoff()` nor `onMetrics` may fire. Prior to
 *  this fix both ran unconditionally — mirrors the identical bug found and
 *  fixed in `native/AutoSkeleton.tsx`'s own `useHandoffAndMetrics`; see that
 *  file's doc comment for the full account. `shouldRunHandoffCycle`
 *  (`core/refresh-gate.ts`) is the single, Vitest-tested source of truth
 *  both platforms defer to. */
function useHandoffAndMetrics(
  isLoading: boolean,
  controller: HandoffController,
  skeletonSuppressed: boolean,
  metricsInput: {
    readonly snapshot: ShapeSnapshot | null;
    readonly cacheHit: boolean;
    readonly traversalMs: number;
    readonly loadStartedAt: number;
    readonly platform: 'web';
    readonly cacheKey: string;
  },
  onMetrics: OnMetrics | undefined,
): void {
  const runCycle = shouldRunHandoffCycle(skeletonSuppressed);

  useEffect(() => {
    if (!runCycle) {
      return;
    }
    if (!isLoading) {
      controller.requestHandoff();
    }
  }, [runCycle, isLoading, controller]);

  // The `settled` subscription itself must attach exactly ONCE per
  // controller (deps=[controller]) so `onMetrics` fires exactly once
  // (REQ-OBS-METRICS-1) — but by the time the promise actually resolves
  // (after the cold traversal AND the handoff fade), `metricsInput` has
  // changed across several intervening renders. A ref updated on every
  // render (an unconditional passthrough, not a conditional effect-avoidance
  // hack — Rule 6) is what lets the `.then()` callback read the LATEST
  // values instead of the stale closure from the render that first attached
  // the subscription.
  const latestRef = useRef(metricsInput);
  latestRef.current = metricsInput;
  const onMetricsRef = useRef(onMetrics);
  onMetricsRef.current = onMetrics;

  useEffect(() => {
    if (!runCycle) {
      return;
    }
    let cancelled = false;
    controller.settled.then((reason) => {
      const latest = latestRef.current;
      const onMetricsCallback = onMetricsRef.current;
      if (cancelled || !onMetricsCallback || !latest.snapshot) {
        return;
      }
      const ttfsMs = Math.max(0, performance.now() - latest.loadStartedAt);
      onMetricsCallback(
        assembleMetrics({
          sensorResult: {
            snapshot: latest.snapshot,
            traversalMs: latest.traversalMs,
            degraded: latest.snapshot.degraded,
          },
          cacheHit: latest.cacheHit,
          ttfsMs,
          handoff: {
            displayDurationMs: controller.displayDurationMs ?? 0,
            handoffMs: controller.handoffMs ?? 0,
            handoffReason: reason,
          },
          platform: latest.platform,
          renderer: 'css',
        }),
      );
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller, runCycle]);
}

/** ADR-16 / plan.md §3.8's "unwired default" paint-detection heuristic:
 *  "a double `requestAnimationFrame` after the content commit, plus
 *  `img.decode()`/`load` when a same-origin `img` leaf is present." Runs
 *  automatically whenever the controller enters the `'placeholder'` phase
 *  (i.e. `requestHandoff()` was called AND a successor is expected) — this
 *  is what makes `expectsPlaceholder` useful with ZERO consumer wiring,
 *  closing task 8.4's real gap: `onSuccessorPainted` was declared in
 *  `AutoSkeletonProps` (and `expectsSuccessor` already gated the
 *  timeout-vs-immediate-fade branch on it) but nothing ever actually called
 *  `controller.notifyPainted()` from a real paint signal — the handoff tail
 *  always silently fell through to the `handoffTimeoutMs` timeout path,
 *  even with a real, already-painted `<img>` successor in the tree.
 *
 *  `onSuccessorPainted` (the prop) is called ALONGSIDE `notifyPainted()`
 *  once this heuristic confirms paint — an explicit, documented deviation
 *  from plan.md §3.8's literal "consumer calls this from e.g. expo-image's
 *  onLoad" phrasing: a plain callback PROP received by `AutoSkeleton` has no
 *  way to be invoked BY the consumer's own separately-rendered image element
 *  without additional plumbing (a Context/hook) plan.md never specified.
 *  Treating it as an OUTPUT notification (fired when this component itself
 *  detects paint) is the interpretation that is actually wireable from the
 *  shipped `() => void` prop type without inventing new public API surface —
 *  flagged here for anyone revisiting this contract later.
 *
 *  Idempotent by construction: `HandoffController.notifyPainted()` is
 *  itself a no-op once `phase !== 'placeholder'` (already timed out, already
 *  faded, or `expectsSuccessor: false` already fired `beginFade('no-
 *  successor')` synchronously inside `requestHandoff()`), so this heuristic
 *  is always safe to run unconditionally rather than gated on
 *  `expectsPlaceholder` itself. */
function usePaintDetectionHeuristic(
  wrapperRef: React.RefObject<HTMLDivElement | null>,
  phase: SkeletonPipelinePhase,
  controller: HandoffController,
  expectsSuccessor: boolean,
  onSuccessorPainted: (() => void) | undefined,
): void {
  const onSuccessorPaintedRef = useRef(onSuccessorPainted);
  onSuccessorPaintedRef.current = onSuccessorPainted;

  useEffect(() => {
    // `expectsSuccessor: false` means `requestHandoff()` ALREADY called
    // `beginFade('no-successor')` synchronously — the controller's
    // INTERNAL `phase` (checked by `notifyPainted()`'s own guard) stays
    // `'placeholder'` for the full `handoffFadeMs` window regardless, so
    // without this guard the heuristic would still race to call
    // `notifyPainted()` and corrupt `handoffReason`/schedule a second,
    // orphaned fade timer for a cycle that never expected a successor at
    // all. Caught by a real regression test (`test/web/handoff.spec.ts`)
    // during this task — the bug was otherwise invisible because
    // `HandoffController.settled` resolves with whichever `beginFade` call
    // fires FIRST, silently masking the corruption for anything reading
    // metrics only through `settled`/`onMetrics` rather than the live
    // `controller.handoffReason` getter.
    if (phase !== 'placeholder' || !expectsSuccessor) {
      return;
    }
    let cancelled = false;

    async function waitForImageDecode(img: HTMLImageElement): Promise<void> {
      if (img.complete && img.naturalWidth > 0) {
        return;
      }
      if (typeof img.decode === 'function') {
        try {
          await img.decode();
          return;
        } catch {
          // Falls through to the load/error listener below — `decode()`
          // rejects on some browsers for a cross-origin or failed image;
          // either way, this heuristic must not hang the handoff forever.
        }
      }
      await new Promise<void>((resolve) => {
        img.addEventListener('load', () => resolve(), { once: true });
        img.addEventListener('error', () => resolve(), { once: true });
      });
    }

    async function detect(): Promise<void> {
      // "a double requestAnimationFrame after the content commit" —
      // ensures the browser has had a chance to paint the just-revealed
      // subtree before this heuristic looks at it.
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
      const wrapper = wrapperRef.current;
      if (wrapper) {
        const images = Array.from(wrapper.querySelectorAll('img'));
        await Promise.all(images.map(waitForImageDecode));
      }
      if (!cancelled) {
        controller.notifyPainted();
        onSuccessorPaintedRef.current?.();
      }
    }

    void detect();
    return () => {
      cancelled = true;
    };
  }, [phase, controller, wrapperRef, expectsSuccessor]);
}

export function AutoSkeleton(props: AutoSkeletonProps): React.JSX.Element {
  const ctx = useContext(SkeletonContext);
  const theme = ctx.theme;
  const animation = props.animation ?? 'shimmer';
  const debugOverlayEnabled = props.debugOverlay === true && process.env.NODE_ENV !== 'production';

  // REQ-PTR-1: "has real content ever been shown" — the FACT of "ever" needs
  // one bit of history, tracked via React's documented "adjusting state
  // during render" pattern (a real prior-value comparison against STATE, not
  // a bare ref-as-effect-avoidance — Rule 6).
  const [everShownContent, setEverShownContent] = useState(!props.isLoading);
  if (!props.isLoading && !everShownContent) {
    setEverShownContent(true);
  }

  // Fresh `HandoffController`/load-timer per loading CYCLE (isLoading
  // false->true transition, OR the very first render), tracked the same
  // documented way. Whether THIS cycle suppresses the skeleton (REQ-PTR-1)
  // is decided ONCE, at cycle start, from `everShownContent`'s value at that
  // exact moment — it must stay stable for the cycle's whole lifetime
  // (including its handoff teardown, well after `isLoading` has already
  // flipped back to `false`), not be recomputed live every render.
  const [wasLoading, setWasLoading] = useState(props.isLoading);
  const [cycleId, setCycleId] = useState(0);
  if (props.isLoading !== wasLoading) {
    setWasLoading(props.isLoading);
    if (props.isLoading && !wasLoading) {
      setCycleId((c) => c + 1);
    }
  }
  const cycleRef = useRef<{
    id: number;
    controller: HandoffController;
    loadStartedAt: number;
    skeletonSuppressed: boolean;
  } | null>(null);
  if (cycleRef.current === null || cycleRef.current.id !== cycleId) {
    cycleRef.current = {
      id: cycleId,
      controller: createHandoffController({
        expectsSuccessor: props.expectsPlaceholder ?? false,
        handoffTimeoutMs: ctx.handoffTimeoutMs,
        handoffFadeMs: ctx.handoffFadeMs,
      }),
      loadStartedAt: performance.now(),
      skeletonSuppressed: everShownContent && props.skeletonOnRefresh !== true,
    };
  }
  const { controller, loadStartedAt, skeletonSuppressed } = cycleRef.current;

  // Reactive read of the handoff phase (no-use-effect skill: "subscribing to
  // an external store"). This is what keeps the overlay mounted through the
  // ADR-16 handoff tail (`placeholder`) after `isLoading` has already
  // flipped `false`, and removes it only once the controller settles
  // (`content`) — never tied directly to `isLoading` itself, which would
  // tear the overlay down instantly and lose the whole reveal-before-hide
  // guarantee.
  const phase = useSyncExternalStore(
    controller.subscribe,
    () => controller.phase,
    () => controller.phase,
  );
  const delayElapsed = useSkeletonDelayGate(props.delay ?? 0, cycleId);
  const showSkeleton = !skeletonSuppressed && phase !== 'content' && delayElapsed;

  const widthBucket = useViewportWidthBucket();
  const direction = currentDirection();
  const cacheKey = composeCacheKey({
    skeletonKey: props.skeletonKey,
    itemType: props.itemType,
    viewportWidth: widthBucket,
    fontScale: quantizeFontScale(1),
    direction,
    platform: 'web',
  });

  // `cacheHit` MUST be decided ONCE per `cacheKey`, not recomputed live every
  // render: once the cold-measurement effect below writes this cycle's OWN
  // fresh traversal result into `ctx.store`, a live `ctx.store.has(cacheKey)`
  // read would flip to `true` on the very next render — turning a genuine
  // cold traversal into a false-positive "cache hit" for its own result.
  const cacheStateRef = useRef<{ key: string; cacheHit: boolean; snapshot: ShapeSnapshot | null } | null>(null);
  if (cacheStateRef.current === null || cacheStateRef.current.key !== cacheKey) {
    const existing = ctx.store.get(cacheKey) ?? null;
    cacheStateRef.current = { key: cacheKey, cacheHit: existing !== null, snapshot: existing };
  }
  const cacheHit = cacheStateRef.current.cacheHit;
  // `coldSnapshot` is tagged with the `cacheKey` it was measured FOR. Without
  // this, a leftover snapshot from a PREVIOUS `cacheKey` (e.g. before a
  // rotation-invalidation width-bucket change) would look like "already
  // measured" for the NEW key too, permanently skipping the fresh traversal
  // REQ-NAV-1's rotation scenario requires.
  const [coldSnapshot, setColdSnapshot] = useState<{ key: string; snapshot: ShapeSnapshot } | null>(null);
  const traversalMsRef = useRef(0);
  const coldSnapshotForKey = coldSnapshot?.key === cacheKey ? coldSnapshot.snapshot : null;
  const snapshot = cacheHit ? cacheStateRef.current.snapshot : coldSnapshotForKey;

  const wrapperRef = useRef<HTMLDivElement>(null);
  const overlayHostRef = useRef<HTMLDivElement>(null);

  useColdMeasurement(
    wrapperRef,
    showSkeleton && !cacheHit && snapshot === null,
    cacheKey,
    false,
    ctx.budgetMs,
    ctx.maxShapes,
    theme.defaultRadius,
    ctx.radiusFallbackShare,
    ctx.store,
    (measured, traversalMs) => {
      traversalMsRef.current = traversalMs;
      setColdSnapshot({ key: cacheKey, snapshot: measured });
    },
  );

  useOverlayRenderer(overlayHostRef, showSkeleton ? snapshot : null, theme, animation, debugOverlayEnabled);

  useHandoffAndMetrics(
    props.isLoading,
    controller,
    skeletonSuppressed,
    {
      snapshot,
      cacheHit,
      traversalMs: cacheHit ? 0 : traversalMsRef.current,
      loadStartedAt,
      platform: 'web',
      cacheKey,
    },
    props.onMetrics,
  );

  usePaintDetectionHeuristic(
    wrapperRef,
    phase,
    controller,
    props.expectsPlaceholder ?? false,
    props.onSuccessorPainted,
  );

  // ADR-16 reveal-before-hide: `props.children` is ALWAYS mounted (never
  // `display:none`) so it is already painted underneath the still-visible
  // overlay by the time the overlay is removed — there is no instant where
  // neither is on screen. Only the accessibility exposure of that content
  // toggles, and only while genuinely loading (`phase === 'skeleton'`);
  // during the handoff tail the content is already considered "shown".
  return (
    <div ref={wrapperRef} style={{ position: 'relative' }}>
      <div aria-hidden={phase === 'skeleton' ? true : undefined} style={{ display: 'contents' }}>
        {props.children}
      </div>
      {showSkeleton && (
        <div
          ref={overlayHostRef}
          aria-busy="true"
          role="status"
          // The overlay is a sibling of `wrapperRef`'s measured subtree
          // (mounted before the first cold snapshot even exists, since it
          // does not itself depend on `snapshot`). Without this, the
          // sensor's own "Loading" screen-reader label and outline/debug
          // markup would be traversed as if they were part of the real
          // content — task 2.1's Ignore channel is exactly the mechanism
          // that keeps the sensor from measuring itself.
          data-autoskeleton-ignore="true"
          style={{ position: 'absolute', inset: 0 }}
        >
          <span
            style={{
              position: 'absolute',
              width: 1,
              height: 1,
              padding: 0,
              margin: -1,
              overflow: 'hidden',
              clip: 'rect(0,0,0,0)',
              whiteSpace: 'nowrap',
              border: 0,
            }}
          >
            Loading
          </span>
          {debugOverlayEnabled && snapshot && <DebugOverlay snapshot={snapshot} cacheHit={cacheHit} />}
        </div>
      )}
    </div>
  );
}

AutoSkeleton.Ignore = Ignore;
// tasks.md 8.3 / NFR-6 (task 2.5 precedent): `AutoSkeletonSSR`/
// `AutoSkeletonSSRHydrate` are DELIBERATELY NOT attached here as
// `AutoSkeleton.SSR`/`AutoSkeleton.SSRHydrate` static properties. Task 2.5
// already established that a bundler cannot tree-shake a value ALWAYS
// assigned onto an object every consumer imports — the same problem that
// forced `ShapeStore.export()`/`.import()` off the hot-path class entirely.
// Measured here: attaching them pushed the NFR-6 gzip gate from 7674 B to
// 8187 B (of an 8192 B hard-failing budget) even though most consumers never
// touch SSR. `AutoSkeletonSSR`/`AutoSkeletonSSRHydrate` are exported as
// PLAIN NAMED exports from `index.web.ts` instead (import them directly:
// `import { AutoSkeletonSSR } from 'autoskeleton'`) — a bundler CAN
// tree-shake an unused named re-export from a side-effect-free barrel file,
// unlike a property write. See `src/web/ssr/AutoSkeletonSSR.tsx` and
// `src/web/ssr/hydrate.tsx`.

export { IGNORE_ATTRIBUTE };
