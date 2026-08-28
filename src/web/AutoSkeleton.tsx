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
import type { HandoffController } from '../core/handoff';
import { assembleMetrics, DEFAULT_BUDGET_MS, DEFAULT_MAX_SHAPES } from '../core/metrics';
import { MemoryShapeStore } from '../core/snapshot';
import type { AnimationKind, OnMetrics, ShapeSnapshot } from '../core/types';
import { createCssRenderer, createShimmerClock } from './css-renderer';
import { createDomSensor, createEmptyHintRegistry, IGNORE_ATTRIBUTE } from './dom-sensor';
import { DebugOverlay } from './DebugOverlay';

const DEFAULT_THEME: SkeletonTheme = {
  baseColor: '#e2e2e2',
  highlightColor: '#f5f5f5',
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
  readonly handoffTimeoutMs: number;
  readonly handoffFadeMs: number;
}

/** Module-level default store: a shared cache across the whole page/app
 *  session, which is what makes REQ-NAV-1's hot path (navigate away, come
 *  back, get the cached shapes with zero traversal) work WITHOUT requiring
 *  every consumer to wire a `SkeletonProvider`. `SkeletonProvider` exists to
 *  OPT INTO a custom store/theme (e.g. test isolation), not because one is
 *  required. */
const defaultStore = new MemoryShapeStore();
const defaultContextValue: SkeletonContextValue = {
  store: defaultStore,
  theme: DEFAULT_THEME,
  budgetMs: DEFAULT_BUDGET_MS,
  maxShapes: DEFAULT_MAX_SHAPES,
  handoffTimeoutMs: DEFAULT_HANDOFF_TIMEOUT_MS,
  handoffFadeMs: DEFAULT_HANDOFF_FADE_MS,
};

const SkeletonContext = createContext<SkeletonContextValue>(defaultContextValue);

export interface SkeletonProviderProps {
  readonly store?: MemoryShapeStore;
  readonly theme?: Partial<SkeletonTheme>;
  readonly budgetMs?: number;
  readonly maxShapes?: number;
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

/** Runs the synchronous cold traversal (task 2.1) when there is no cache hit
 *  and no cold snapshot yet for the current `cacheKey`. A real DOM sensor
 *  read is genuine external-system synchronization (the browser's layout
 *  engine), not derivable state — the skill's Rule 4 case. */
function useColdMeasurement(
  wrapperRef: React.RefObject<HTMLDivElement | null>,
  active: boolean,
  cacheKey: string,
  hintsIgnored: boolean,
  budgetMs: number,
  maxShapes: number,
  defaultRadius: number,
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
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, cacheKey]);
}

/** Calls `requestHandoff()` the render after `isLoading` transitions from
 *  true to false, and assembles/fires `onMetrics` exactly once when the
 *  controller settles (REQ-OBS-METRICS-1). This is genuine synchronization
 *  with an external, imperative state machine reacting to a value this
 *  component does not own the transition of (the parent's data resolving) —
 *  the skill's Rule 4 case, isolated in its own hook. */
function useHandoffAndMetrics(
  isLoading: boolean,
  controller: HandoffController,
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
  useEffect(() => {
    if (!isLoading) {
      controller.requestHandoff();
    }
  }, [isLoading, controller]);

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
  }, [controller]);
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
  const showSkeleton = !skeletonSuppressed && phase !== 'content';

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

export { IGNORE_ATTRIBUTE };
