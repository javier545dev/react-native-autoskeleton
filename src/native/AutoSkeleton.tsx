// src/native/AutoSkeleton.tsx
//
// Task 5.5 (tasks.md Phase 5): the native `<AutoSkeleton>` public component.
// Structurally mirrors `src/web/AutoSkeleton.tsx` (task 2.3) — same
// cache-key/handoff/metrics core, same REQ-PTR-1 stale-while-revalidate
// default, same reveal-before-hide handoff mechanism (ADR-16) — but the
// cold-measurement and draw paths are native: `getShapes` (task 5.1, via
// `sensor.ts`) instead of DOM reads, and the native `AutoskeletonOverlayView`
// host component (task 3.2/4.4, wired through
// `AutoskeletonOverlayNativeComponent.ts`) instead of a CSS overlay.
//
// Tier selection (task 5.4/ADR-5): tier-2 (Skia+Reanimated) draws ONLY when
// the consumer explicitly opted in by passing `<SkeletonProvider overlay>` an
// overlay built with `createSkiaOverlay` from the `autoskeleton/skia` subpath;
// otherwise tier-1 (the always-available native draw pass) renders.
// `onMetrics.renderer` reports which one actually ran (RISK-8's detection
// signal) — see the comment at the `rendererKind` assignment below for why
// this is no longer a runtime peer probe, and for what the probe actually did
// on a real device.
//
// `delay` (this session's brief: "the delay prop is a lie in the public
// API"): the skeleton overlay is withheld until `delay` ms have elapsed
// since the loading cycle started, so a load that resolves before `delay`
// never shows a skeleton at all — the standard flash-avoidance semantics
// the prop's own doc comment already promised on web without ever reading
// it. Implemented identically on `src/web/AutoSkeleton.tsx` in this same
// change (see that file's `useSkeletonDelayGate`).
//
// no-use-effect skill compliance: mirrors the web component's approach —
// every `useEffect` lives inside a small custom hook (Rule 4: external-
// system synchronization — a real native bridge call, an imperative timer,
// an imperative native-view mount), and "which load cycle is this" /
// "has content ever been shown" are tracked via React's documented
// "adjusting state during render" pattern, never a bare effect-avoidance
// ref (Rule 6).

import type { ComponentRef, ReactNode } from 'react';
import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  findNodeHandle,
  I18nManager,
  PixelRatio,
  Platform,
  StyleSheet,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { useReducedMotion } from './reducedMotion';
import { effectiveAnimation } from '../core/animation';
import { bucketWidth, composeCacheKey, quantizeFontScale } from '../core/cache-key';
import type { SkeletonTheme } from '../core/contracts';
import { isLoadingFromProps, resolveSkeletonChildren } from '../core/data-props';
import type { SkeletonLoadingSource } from '../core/data-props';
import { createHandoffController, type HandoffController } from '../core/handoff';
import { assembleMetrics } from '../core/metrics';
import { shouldRunHandoffCycle } from '../core/refresh-gate';
import { isEmptySnapshot, MAX_EMPTY_MEASUREMENTS, MemoryShapeStore } from '../core/snapshot';
import { createHintRegistry, snapshotHintEntries } from '../core/hint-registry';
import { resolveSharedShimmerPeriodMs } from '../core/shimmer-period';
import { applyThemeOverride } from '../core/theme-override';
import type { AnimationKind, OnMetrics, RendererKind, ShapeSnapshot } from '../core/types';
import { decodeWire } from '../core/wire';
import { Hint } from './Hint';
import { AUTOSKELETON_IGNORE_MARKER_ID, Ignore } from './Ignore';
import { nativeSensor } from './nativeSensorInstance';
import { resolveAutoskeletonOverlayNativeComponent } from './renderer/AutoskeletonOverlayHostComponent';
import type { NativeSensorTarget } from './sensor';
import type { SkeletonOverlayComponent } from './overlayContract';
import {
  AutoskeletonNativeModuleUnavailableError,
  logNativeModuleUnavailableOnce,
  resolveNativeModule,
} from './nativeModuleAccessor';

const DEFAULT_THEME: SkeletonTheme = {
  baseColor: '#e2e2e2',
  highlightColor: '#f5f5f5',
  defaultRadius: 4,
  speedMs: 1400,
};
const DEFAULT_BUDGET_MS = 2;
const DEFAULT_MAX_SHAPES = 60;

/** REQ-A11Y-2. The exact string `src/web/AutoSkeleton.tsx` already renders in
 *  its visually-hidden `<span>` inside the `role="status"` overlay — one
 *  user-facing contract across all three platforms, asserted verbatim by the
 *  on-device gates (`AccessibilityGateInstrumentedTest.kt`,
 *  `PaintGateUITests.swift`). */
const LOADING_ACCESSIBILITY_LABEL = 'Loading';
const DEFAULT_HANDOFF_TIMEOUT_MS = 250;
const DEFAULT_HANDOFF_FADE_MS = 120;

export interface SkeletonContextValue {
  readonly store: MemoryShapeStore;
  readonly theme: SkeletonTheme;
  readonly budgetMs: number;
  readonly maxShapes: number;
  readonly handoffTimeoutMs: number;
  readonly handoffFadeMs: number;
  /** ADR-5 tier-2 opt-in. `undefined` — the default — means the always-
   *  available tier-1 native overlay draws, with no optional peer anywhere in
   *  this module's graph. A consumer opts in by building one with
   *  `createSkiaOverlay` from the `autoskeleton/skia` subpath and passing it
   *  here; see `src/index.skia.ts` for why the peers are injected rather than
   *  detected. */
  readonly overlay?: SkeletonOverlayComponent;
}

/** Module-level default store, mirroring `web/AutoSkeleton.tsx`'s rationale
 *  verbatim: a shared cache across the whole app session is what makes
 *  REQ-NAV-1's hot path work without requiring every consumer to wire a
 *  `SkeletonProvider`. */
const defaultStore = new MemoryShapeStore();

/** Stable empty array so tier-1 (which never decodes shapes here) does not
 *  churn `useMemo`'s identity on every snapshot change. */
const EMPTY_SHAPES: readonly import('../core/types').ShapeInfo[] = [];
const defaultContextValue: SkeletonContextValue = {
  store: defaultStore,
  theme: DEFAULT_THEME,
  budgetMs: DEFAULT_BUDGET_MS,
  maxShapes: DEFAULT_MAX_SHAPES,
  handoffTimeoutMs: DEFAULT_HANDOFF_TIMEOUT_MS,
  handoffFadeMs: DEFAULT_HANDOFF_FADE_MS,
};

export const SkeletonContext = createContext<SkeletonContextValue>(defaultContextValue);

export interface SkeletonProviderProps {
  readonly store?: MemoryShapeStore;
  readonly theme?: Partial<SkeletonTheme>;
  readonly budgetMs?: number;
  readonly maxShapes?: number;
  readonly handoffTimeoutMs?: number;
  readonly handoffFadeMs?: number;
  /** ADR-5 tier-2 opt-in; see `SkeletonContextValue.overlay`. */
  readonly overlay?: SkeletonOverlayComponent;
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
    overlay: props.overlay,
  };
  return <SkeletonContext.Provider value={value}>{props.children}</SkeletonContext.Provider>;
}

interface AutoSkeletonBaseProps {
  readonly skeletonKey: string;
  readonly itemType?: string;
  readonly animation?: AnimationKind;
  /** Delay before the skeleton becomes visible; a load that resolves before
   *  `delay` elapses never shows a skeleton at all. */
  readonly delay?: number;
  readonly onMetrics?: OnMetrics;
  readonly debugOverlay?: boolean;
  readonly skeletonOnRefresh?: boolean;
  readonly onSuccessorPainted?: () => void;
  readonly expectsPlaceholder?: boolean;
  /** tasks.md 7.2 (spec REQ-THEME-2): per-instance theme overrides, layered
   *  on top of (never replacing) `SkeletonProvider`'s context theme via
   *  `applyThemeOverride` (`core/theme-override.ts`). These are the EXACT
   *  prop names the theming interop (`autoskeleton/uniwind` — the sole
   *  theming interop, see tasks.md 7.5) maps a resolved `className`'s
   *  `backgroundColor`/`color`/`borderRadius` onto — a plain consumer can
   *  also set them directly without any interop at all. */
  readonly shimmerBaseColor?: string;
  readonly shimmerHighlightColor?: string;
  readonly defaultRadius?: number;
  /** Shown ONLY on a cold miss: this cycle would paint a skeleton, and there
   *  is no usable measured geometry for the cache key yet. Identical prop
   *  name, identical gate and identical semantics to `web/AutoSkeleton.tsx`
   *  — the shared contract lives in `core/data-props.ts`, which also records
   *  WHY the hole exists (the sensor can only measure a subtree that is
   *  already mounted, and on the first loading cycle of a session it is not).
   *
   *  Omitting it changes nothing: the render gate starts with
   *  `props.fallback !== undefined`, so no existing tree gains a `View`, and
   *  the native paint-gate fixtures — which pass no `fallback` — cannot be
   *  affected. */
  readonly fallback?: ReactNode;
}

export type AutoSkeletonProps<T = unknown> = AutoSkeletonBaseProps & SkeletonLoadingSource<T, ReactNode>;

/** Withholds the skeleton until `delayMs` has elapsed since this loading
 *  cycle started (see file header: "the delay prop is a lie" gap closure).
 *  `delayMs <= 0` elapses immediately, preserving today's behavior for
 *  every consumer that never set the prop. */
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

/** Bridges the wrapper `<View>`'s layout into a `NativeSensorTarget`
 *  (reactTag + frame size — see `sensor.ts`'s header comment for why the
 *  frame size travels alongside the tag rather than through the wire).
 *  Runs the cold `getShapes` call once layout is known and no snapshot
 *  exists yet for this `cacheKey` — genuine external-system
 *  synchronization with the native layout engine and the Turbo Module
 *  bridge (no-use-effect skill Rule 4), isolated in its own hook exactly
 *  like `web/AutoSkeleton.tsx`'s `useColdMeasurement`.
 *
 *  Visual-paint-gate remediation: the native `getShapes` call is deferred
 *  by ONE `requestAnimationFrame` after `onLayout` fires, matching this
 *  file's own already-documented ADR-16 convention ("native = one frame
 *  after `onLayout`" — see the `HandoffController`/paint-detection doc
 *  comment above). This is not a stylistic choice: on Fabric, `onLayout`
 *  fires from the SHADOW TREE commit (layout calculation), which
 *  genuinely precedes the separate native MOUNTING phase that creates and
 *  registers the real Android `View` Fabric's `MountingManager` tracks —
 *  confirmed empirically via `PaintGateInstrumentedTest` plus targeted
 *  logging: `FabricUIManager.resolveView(reactTag)` returned `null` for
 *  every call made synchronously inside the `onLayout` effect (same
 *  `reactTag`, correctly on the UI thread), even though the SAME tag
 *  resolved fine one frame later. Calling `getShapes` before the view is
 *  mounted is indistinguishable from an unresolved tag (`Sensor.measure`
 *  returns `null`), which is why the overlay never rendered at all — not
 *  a ViewManager registration defect on its own. */
function useColdMeasurement(
  active: boolean,
  cacheKey: string,
  cycleId: number,
  budgetMs: number,
  maxShapes: number,
  defaultRadius: number,
  store: MemoryShapeStore,
  platform: 'ios' | 'android',
  onMeasured: (snapshot: ShapeSnapshot) => void,
  onNativeModuleUnavailable: () => void,
) {
  const layoutRef = useRef<{ width: number; height: number } | null>(null);
  const viewRef = useRef<ComponentRef<typeof View>>(null);
  const [layoutTick, setLayoutTick] = useState(0);

  const onLayout = (event: LayoutChangeEvent): void => {
    layoutRef.current = {
      width: event.nativeEvent.layout.width,
      height: event.nativeEvent.layout.height,
    };
    setLayoutTick((t) => t + 1);
  };

  useEffect(() => {
    if (!active) {
      return;
    }
    const layout = layoutRef.current;
    if (!layout || layout.width === 0) {
      return;
    }

    const measure = (): void => {
      const reactTag = findNodeHandle(viewRef.current);
      if (reactTag == null) {
        return;
      }
      const nativeModule = resolveNativeModule();
      if (!nativeModule) {
        onNativeModuleUnavailable();
        return;
      }
      // Typed-hint channel: `hintEntries` is the raw, serializable snapshot
      // of every currently-registered `<AutoSkeleton.Hint>` — taken HERE,
      // at the same instant as `reactTag`, so `sensor.ts`'s
      // `toWireHintEntries` marshals exactly what was mounted for this
      // measurement. `hints:` (the `HintRegistry` functions) still satisfies
      // the shared `SensorOptions` contract for API conformance, even though
      // the native bridge path (`sensor.ts`) never reads it — only
      // `target.hintEntries` crosses the Turbo Module boundary.
      const hintEntries = snapshotHintEntries();
      const target: NativeSensorTarget = {
        reactTag,
        frameWidth: layout.width,
        frameHeight: layout.height,
        hintEntries,
      };
      const result = nativeSensor.measure(target, {
        key: cacheKey as unknown as Parameters<typeof nativeSensor.measure>[1]['key'],
        hints: createHintRegistry(hintEntries),
        budgetMs,
        maxShapes,
        defaultRadius,
        collectDebugSidecars: false,
      });
      if (result) {
        store.set(result.snapshot.key, result.snapshot);
        onMeasured(result.snapshot);
      }
    };

    const frameHandle = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(frameHandle);
    // `cycleId` PACES the bounded empty-measurement retry (`layoutTick` cannot:
    // a subtree that is laid out but not yet populated fires no new layout
    // event when its content finally arrives). Same rationale, same bound and
    // same shared-core budget as `web/AutoSkeleton.tsx`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, cacheKey, cycleId, layoutTick, platform]);

  return { viewRef, onLayout };
}

/** Calls `requestHandoff()` and fires `onMetrics` exactly once when the
 *  controller settles — identical rationale to `web/AutoSkeleton.tsx`'s
 *  `useHandoffAndMetrics`.
 *
 *  Task 6.5 fix (REQ-PTR-1 observability): when `skeletonSuppressed` is
 *  true (the default stale-while-revalidate PTR path — REQ-PTR-1's own
 *  scenario, "existing content remains visible, no skeleton overlay"), NO
 *  skeleton-to-content lifecycle ever visually occurred for this cycle, so
 *  neither `requestHandoff()` nor `onMetrics` may fire. Before this fix,
 *  both ran unconditionally — a real, pre-existing gap (present since
 *  Phase 2/5, on both native and web) of the exact shape this project's own
 *  REQ-OBS-BUDGET-1 amendment warns about, just as a wrongly-firing call
 *  instead of a never-invoked formatter. `shouldRunHandoffCycle`
 *  (`core/refresh-gate.ts`) is the single, Vitest-tested source of truth
 *  both platforms now defer to. */
function useHandoffAndMetrics(
  isLoading: boolean,
  controller: HandoffController,
  skeletonSuppressed: boolean,
  metricsInput: {
    readonly snapshot: ShapeSnapshot | null;
    readonly cacheHit: boolean;
    readonly loadStartedAt: number;
    readonly platform: 'ios' | 'android';
    readonly renderer: RendererKind;
    readonly degraded: readonly import('../core/types').DegradationFlag[];
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
      if (cancelled || !onMetricsCallback) {
        return;
      }
      const ttfsMs = Math.max(0, Date.now() - latest.loadStartedAt);
      if (!latest.snapshot) {
        // ADR-15 production fail-open path: no snapshot was ever measured
        // because the native module was unavailable. `onMetrics` still
        // fires (RISK-10's field-visibility signal), with a zero/degraded
        // shape rather than a fabricated one.
        onMetricsCallback({
          traversalMs: 0,
          shapeCount: 0,
          cacheHit: false,
          ttfsMs,
          displayDurationMs: controller.displayDurationMs ?? 0,
          handoffMs: controller.handoffMs ?? 0,
          handoffReason: reason,
          platform: latest.platform,
          renderer: latest.renderer,
          radiusSourceHistogram: { measured: 0, outline: 0, 'raster-probe': 0, hint: 0, default: 0 },
          degraded: latest.degraded,
          cacheKey: '',
        });
        return;
      }
      onMetricsCallback(
        assembleMetrics({
          sensorResult: { snapshot: latest.snapshot, traversalMs: 0, degraded: latest.degraded },
          cacheHit: latest.cacheHit,
          ttfsMs,
          handoff: {
            displayDurationMs: controller.displayDurationMs ?? 0,
            handoffMs: controller.handoffMs ?? 0,
            handoffReason: reason,
          },
          platform: latest.platform,
          renderer: latest.renderer,
        }),
      );
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller, runCycle]);
}

export function AutoSkeleton<T = unknown>(props: AutoSkeletonProps<T>): React.JSX.Element {
  const ctx = useContext(SkeletonContext);
  // tasks.md 7.2/7.3: per-instance overrides (plain props OR whatever a
  // theming interop resolved from `className`) layer on top of the
  // context theme — `applyThemeOverride` only touches fields that are
  // actually defined, so an unconfigured consumer's theme is unchanged.
  const theme = applyThemeOverride(ctx.theme, {
    baseColor: props.shimmerBaseColor,
    highlightColor: props.shimmerHighlightColor,
    defaultRadius: props.defaultRadius,
  });
  const reducedMotion = useReducedMotion();
  // One shared definition of what `animation` means, rather than this
  // component's own inline ternary. The ternary was subtly narrower than the
  // renderers it fed: it only ever rewrote 'shimmer', which was correct, but it
  // left every renderer downstream to re-derive the same rule for itself, and
  // none of them agreed. See `core/animation.ts`.
  const animation: AnimationKind = effectiveAnimation(props.animation ?? 'shimmer', reducedMotion);
  const debugOverlayEnabled = props.debugOverlay === true && typeof __DEV__ !== 'undefined' && __DEV__;

  // The `data` form's two derivations, from `core/data-props.ts` — the same
  // two calls `web/AutoSkeleton.tsx` makes, in the same order, so the two
  // platforms cannot drift on what "loading" means or on when a function
  // child runs. With neither `data` nor a function child (every call site
  // that predates this change) `isLoading` is `props.isLoading` and
  // `children` is `props.children` by reference.
  const isLoading = isLoadingFromProps(props.isLoading, props.data);
  const children = resolveSkeletonChildren<T, ReactNode>(props.children, props.data);

  const [everShownContent, setEverShownContent] = useState(!isLoading);
  if (!isLoading && !everShownContent) {
    setEverShownContent(true);
  }

  const [wasLoading, setWasLoading] = useState(isLoading);
  const [cycleId, setCycleId] = useState(0);
  if (isLoading !== wasLoading) {
    setWasLoading(isLoading);
    if (isLoading && !wasLoading) {
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
      loadStartedAt: Date.now(),
      skeletonSuppressed: everShownContent && props.skeletonOnRefresh !== true,
    };
  }
  const { controller, loadStartedAt, skeletonSuppressed } = cycleRef.current;

  const phase = useSyncExternalStore(
    controller.subscribe,
    () => controller.phase,
    () => controller.phase,
  );
  const delayElapsed = useSkeletonDelayGate(props.delay ?? 0, cycleId);
  const showSkeleton = !skeletonSuppressed && phase !== 'content' && delayElapsed;

  const { width: windowWidth } = useWindowDimensions();
  const widthBucket = bucketWidth(windowWidth);
  const direction = I18nManager.isRTL ? 'rtl' : 'ltr';
  const platform: 'ios' | 'android' = Platform.OS === 'android' ? 'android' : 'ios';
  const cacheKey = composeCacheKey({
    skeletonKey: props.skeletonKey,
    itemType: props.itemType,
    viewportWidth: widthBucket,
    fontScale: quantizeFontScale(PixelRatio.getFontScale()),
    direction,
    platform,
  });

  const cacheStateRef = useRef<{ key: string; cacheHit: boolean; snapshot: ShapeSnapshot | null } | null>(null);
  if (cacheStateRef.current === null || cacheStateRef.current.key !== cacheKey) {
    const existing = ctx.store.get(cacheKey) ?? null;
    cacheStateRef.current = { key: cacheKey, cacheHit: existing !== null, snapshot: existing };
  }
  const cacheHit = cacheStateRef.current.cacheHit;
  const [coldSnapshot, setColdSnapshot] = useState<{ key: string; snapshot: ShapeSnapshot } | null>(null);
  const [nativeUnavailable, setNativeUnavailable] = useState(false);
  const coldSnapshotForKey = coldSnapshot?.key === cacheKey ? coldSnapshot.snapshot : null;
  // A fresh traversal this instance just took ALWAYS wins over whatever the
  // store answered with when this `cacheKey` was first seen — see the
  // identically-shaped comment in `web/AutoSkeleton.tsx`.
  const snapshot = coldSnapshotForKey ?? cacheStateRef.current.snapshot;

  // A zero-shape snapshot is provisional, not the truth about this subtree:
  // it is equally the signature of a subtree the native sensor reached before
  // it had any laid-out, mounted content to report. Re-measure on the next
  // loading cycle while the key's bounded, inspectable budget lasts. Shared
  // policy with web, by construction — see `core/snapshot.ts`'s
  // `MAX_EMPTY_MEASUREMENTS`.
  //
  // `noUsableGeometry` names the same fact for the `fallback` gate below, and
  // is deliberately NOT `snapshot === null` — see the identically-shaped
  // comment in `web/AutoSkeleton.tsx` for the reasoning (an unmounted subtree
  // measures EMPTY, not missing, and an empty snapshot paints zero shapes).
  const noUsableGeometry = snapshot === null || isEmptySnapshot(snapshot);
  const remeasureEmpty =
    snapshot !== null &&
    noUsableGeometry &&
    ctx.store.emptyMeasurementsFor(cacheKey) < MAX_EMPTY_MEASUREMENTS;
  const cacheHitForCycle = cacheHit && !remeasureEmpty;

  const { viewRef, onLayout } = useColdMeasurement(
    showSkeleton && (snapshot === null || remeasureEmpty) && !nativeUnavailable,
    cacheKey,
    cycleId,
    ctx.budgetMs,
    ctx.maxShapes,
    theme.defaultRadius,
    ctx.store,
    platform,
    (measured) => setColdSnapshot({ key: cacheKey, snapshot: measured }),
    () => {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        throw new AutoskeletonNativeModuleUnavailableError();
      }
      logNativeModuleUnavailableOnce();
      setNativeUnavailable(true);
    },
  );

  // ADR-5/RISK-8 tier selection. This used to be `tier2PeersAvailable()`, a
  // runtime probe. It is now purely "did the consumer opt in", for two
  // independent reasons, both established on a real device this session:
  //
  //  1. The probe could never return true. It resolved both peers through a
  //     `require()` with a VARIABLE specifier, which Metro rewrites into an
  //     unconditional `throw new Error('Dynamic require … not supported by
  //     Metro')`; the probe's own `try/catch` turned that into "peer absent".
  //     Verified with both peers genuinely installed, pods built and linked:
  //     `onMetrics.renderer` reported `native`.
  //  2. Even if it had worked, it selected the tier without asking. Reanimated
  //     is a hard requirement of React Navigation, so "the peers are installed"
  //     says nothing about whether the consumer wants a Skia skeleton.
  //
  // `renderer` in `onMetrics` therefore now reports the tier that ACTUALLY
  // drew, which is what RISK-8 uses it for. Before this change it reported
  // whatever the probe said while tier-1 drew regardless, because
  // `SkiaShimmerOverlay` had no call site anywhere in the library.
  const overlayRenderer = ctx.overlay;
  const rendererKind: RendererKind = overlayRenderer ? 'skia' : 'native';

  useHandoffAndMetrics(
    isLoading,
    controller,
    skeletonSuppressed,
    {
      snapshot,
      cacheHit: cacheHitForCycle,
      loadStartedAt,
      platform,
      renderer: nativeUnavailable ? 'native' : rendererKind,
      degraded: nativeUnavailable ? ['native-module-unavailable'] : [],
    },
    props.onMetrics,
  );

  const OverlayComponent = resolveAutoskeletonOverlayNativeComponent();

  // ADR-15 production fail-open: render children unwrapped, no skeleton,
  // no crash. `__DEV__` never reaches here — `useColdMeasurement`'s
  // `onNativeModuleUnavailable` callback throws first.
  if (nativeUnavailable) {
    return <>{children}</>;
  }

  // REQ-A11Y-1 (G.15). `overlayVisible` is the single predicate for "the
  // skeleton is actually painted over the real content RIGHT NOW" — the exact
  // condition that already gated the overlay's own JSX below, now named so the
  // accessibility state and the visual state can never drift apart.
  //
  // It is deliberately NOT `phase === 'skeleton'` (what `web/AutoSkeleton.tsx`
  // uses) and deliberately NOT `showSkeleton` alone:
  //  - `phase` alone stays `'skeleton'` forever on the REQ-PTR-1
  //    stale-while-revalidate path, where `shouldRunHandoffCycle` suppresses
  //    `requestHandoff()` entirely — content that is fully visible would be
  //    permanently hidden from assistive technology. (This is a real, still-open
  //    defect on the WEB surface; see this session's tasks.md entry. Native does
  //    not copy it.)
  //  - `showSkeleton` alone is true during the cold `getShapes` round-trip,
  //    BEFORE any snapshot exists and therefore before any overlay is mounted.
  //    Hiding content that is still plainly visible on screen is the same class
  //    of bug in the other direction.
  //
  // Tier-2 (`overlayRenderer`) needs no native host component: it draws with
  // Skia into its own canvas. Tier-1 still requires `OverlayComponent`, so the
  // two arms of this predicate differ only in what "there is something that
  // can draw" means for the selected tier.
  const overlayVisible = showSkeleton && snapshot !== null && (overlayRenderer !== undefined || OverlayComponent !== null);

  // The cold-miss gate, term for term the same expression `web/AutoSkeleton
  // .tsx` uses. `props.fallback !== undefined` leads, which is what makes
  // this addition unable to touch an existing render path: with the prop
  // omitted it is `false` in every state, and `false` mounts no `View`. The
  // on-device paint gates and every existing fixture pass no `fallback`, so
  // the native view hierarchy they assert against is unchanged by
  // construction rather than by luck.
  const showFallback = props.fallback !== undefined && showSkeleton && noUsableGeometry;

  // Decoded once per snapshot, only for tier-2. Tier-1 never needs it: the
  // native view reads geometry straight out of the native shape cache by
  // `cacheKey` (ADR-9), so decoding here for tier-1 would be pure waste.
  const overlayShapes = useMemo(
    () => (overlayRenderer !== undefined && snapshot !== null ? decodeWire(snapshot.data).shapes : EMPTY_SHAPES),
    [overlayRenderer, snapshot],
  );

  // ADR-16 reveal-before-hide: children are ALWAYS mounted underneath the
  // still-painted overlay.
  //
  // `collapsable={false}` is REQUIRED, not defensive styling: this wrapper
  // has no visual properties of its own (`position: 'relative'` is
  // layout-only), so both Paper and Fabric are free to "view-flatten" it —
  // optimize it out of the native tree entirely rather than create a real
  // native `View` for it. A flattened node has NO backing native view, so
  // `findNodeHandle`'s reactTag never resolves via
  // `FabricUIManager.resolveView` no matter how long native code waits —
  // confirmed empirically via `PaintGateInstrumentedTest` (a 20-attempt,
  // ~320ms retry loop on the native side never once resolved it). This is
  // the actual root cause of the paint gate's persistent RED state, not a
  // one-frame timing race the earlier `requestAnimationFrame` deferral
  // (still kept above, since it is a real and separate improvement) could
  // ever have fixed on its own.
  //
  // REQ-A11Y-1: the accessibility props go on THIS wrapper, not on a new
  // wrapper around `props.children`. Both are correct in principle; this one is
  // correct without cost. `accessibilityElementsHidden` (iOS) and
  // `importantForAccessibility="no-hide-descendants"` (Android) are SUBTREE
  // mechanisms — they map to exactly the platform APIs
  // (`UIView.accessibilityElementsHidden`,
  // `View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS`) that the now-deleted
  // native `AutoskeletonAccessibility` helpers called, so React Native already
  // gives us the whole mechanism declaratively, with no bridge call, no UI-thread
  // dispatch, and no `resolveView(reactTag)` race (the exact race documented at
  // length in `useColdMeasurement` above).
  //
  // Hiding the wrapper hides the overlay too, which is not a loss: the overlay
  // is already `accessible={false}` + `no-hide-descendants` below, so it
  // contributes nothing to the accessibility tree either way. Putting the props
  // here instead of on a new inner `<View>` keeps the native view hierarchy the
  // sensor traverses, and every consumer's flex layout, byte-for-byte unchanged.
  return (
    <>
      <View
        ref={viewRef}
        onLayout={onLayout}
        collapsable={false}
        accessibilityElementsHidden={overlayVisible}
        importantForAccessibility={overlayVisible ? 'no-hide-descendants' : 'auto'}
        style={styles.wrapper}
      >
        {children}
        {/* IN FLOW, above the absolutely-positioned overlays below: on a cold
         *  miss the real content is typically not mounted yet, so an
         *  `absoluteFill` box would have a zero-height parent to fill —
         *  exactly the blank state `fallback` exists to escape.
         *
         *  The marker `nativeID`/`testID` is `<AutoSkeleton.Ignore>`'s own
         *  channel (see `Ignore.tsx` for why BOTH props are needed: Android
         *  reads `nativeID`, iOS reads `testID` via `accessibilityIdentifier`),
         *  and both native sensors skip an ignored view's whole subtree. That
         *  is not optional here: the cold traversal runs during precisely this
         *  window, so without the marker the library would measure the
         *  hand-authored skeleton and cache a skeleton OF a skeleton.
         *
         *  A real wrapping `View` — not `Ignore`'s `cloneElement` — because
         *  `fallback` is an arbitrary `ReactNode`, not the single element child
         *  `Children.only` demands. It is layout-visible by design (it must
         *  occupy the space the missing content would), and it only ever exists
         *  for a consumer who passed the prop. `accessibilityElementsHidden` /
         *  `no-hide-descendants` keep a decorative placeholder out of the
         *  accessibility tree; the sibling "Loading" element below is what a
         *  screen-reader user gets instead. */}
        {showFallback && (
          <View
            nativeID={AUTOSKELETON_IGNORE_MARKER_ID}
            testID={AUTOSKELETON_IGNORE_MARKER_ID}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            {props.fallback}
          </View>
        )}
        {overlayVisible && overlayRenderer !== undefined && snapshot !== null && (
          <View
            accessible={false}
            importantForAccessibility="no-hide-descendants"
            pointerEvents="none"
            style={StyleSheet.absoluteFill}
          >
            {createElement(overlayRenderer, {
              shapes: overlayShapes,
              baseColor: theme.baseColor,
              highlightColor: theme.highlightColor,
              // ADR-8: the shared clock has ONE period, arbitrated in JS
              // upstream of every renderer — identical call to tier-1's below.
              speedMs: resolveSharedShimmerPeriodMs(theme.speedMs),
              width: snapshot.frameWidth,
              height: snapshot.frameHeight,
              // Tier-2 used to receive ONLY `reducedMotion`, so an explicit
              // `animation="none"` — and `"pulse"` — never reached it at all
              // and it drew the full travelling shimmer for both. Already
              // resolved above; `effectiveAnimation` is idempotent, so tier-2
              // re-deriving it changes nothing.
              animation,
              reducedMotion,
            })}
          </View>
        )}
        {overlayVisible && overlayRenderer === undefined && OverlayComponent !== null && (
          <OverlayComponent
            cacheKey={cacheKey}
            baseColor={theme.baseColor}
            highlightColor={theme.highlightColor}
            defaultRadius={theme.defaultRadius}
            // ADR-8: the shared clock has ONE period. `core/shimmer-period.ts`
            // arbitrates here, in JS, upstream of both native clocks, so the
            // Swift/Kotlin `setPeriod` calls can never receive two different
            // values within one JS context — which is what makes this
            // behaviour identical on iOS, Android and web instead of three
            // near-misses.
            speedMs={resolveSharedShimmerPeriodMs(theme.speedMs)}
            animation={animation}
            reducedMotion={reducedMotion}
            debugOverlay={debugOverlayEnabled}
            accessible={false}
            importantForAccessibility="no-hide-descendants"
            style={StyleSheet.absoluteFill}
          />
        )}
      </View>
      {/* REQ-A11Y-2. With the real content hidden above, a screen-reader user
       *  would otherwise reach an EMPTY region with no indication anything is
       *  loading. This mirrors what `web/AutoSkeleton.tsx` actually renders —
       *  a visually-hidden, statically READABLE "Loading" element — rather than
       *  `AccessibilityInfo.announceForAccessibility`, which INTERRUPTS the
       *  screen reader mid-utterance. An interrupting announcement would need a
       *  slowness threshold this codebase does not have (`delay` defaults to 0,
       *  and `handoffTimeoutMs` is about the tail, not about slowness), plus
       *  once-per-cycle bookkeeping — and for a load that resolves in 50ms it is
       *  strictly worse than silence. A readable element needs none of that: it
       *  says nothing until the user navigates to it, and it is correct for a
       *  50ms load and a 5s load alike.
       *
       *  `accessibilityLiveRegion="polite"` is Android's real analogue of web's
       *  `role="status"`: TalkBack announces it WITHOUT interrupting. React
       *  Native exposes no iOS equivalent, which is precisely why the readable
       *  element — not the announcement — is the portable mechanism.
       *
       *  It is a SIBLING of the wrapper because the wrapper's own subtree is
       *  hidden above; `position: 'absolute'` keeps it out of flow so it can
       *  never shift a consumer's layout, and it has no background, so it paints
       *  nothing. `pointerEvents="none"` keeps it out of the touch path.
       *  Deliberately no `testID`: it is identified by the string a screen reader
       *  actually speaks, so no production identifier exists purely for a test. */}
      {/* `|| showFallback` (parity with web, which reaches this state already):
       *  web's `role="status"` host is gated on `showSkeleton`, so it announces
       *  during a cold miss whether or not geometry exists. Native's gate is
       *  `overlayVisible`, which is false while a `fallback` is the only thing
       *  painted — a screen-reader user would get silence in front of a visible
       *  placeholder. `showFallback` is false whenever the prop is omitted, so
       *  no existing tree changes. */}
      {(overlayVisible || showFallback) && (
        <View
          accessible
          accessibilityLabel={LOADING_ACCESSIBILITY_LABEL}
          accessibilityLiveRegion="polite"
          pointerEvents="none"
          style={styles.loadingStatus}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  wrapper: { position: 'relative' },
  loadingStatus: { position: 'absolute', width: 1, height: 1 },
});

AutoSkeleton.Ignore = Ignore;
AutoSkeleton.Hint = Hint;
