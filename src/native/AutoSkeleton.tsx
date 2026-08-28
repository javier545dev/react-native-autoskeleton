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
// Tier selection (task 5.4/ADR-5): tier-2 (Skia+Reanimated) is used ONLY
// when BOTH optional peers are present at a compatible version
// (`tier2PeersAvailable()`); otherwise tier-1 (the always-available native
// draw pass) renders, and `onMetrics.renderer` reports which one actually
// ran (RISK-8's detection signal).
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
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  AccessibilityInfo,
  findNodeHandle,
  I18nManager,
  PixelRatio,
  Platform,
  StyleSheet,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { bucketWidth, composeCacheKey, quantizeFontScale } from '../core/cache-key';
import type { SkeletonTheme } from '../core/contracts';
import { createHandoffController, type HandoffController } from '../core/handoff';
import { assembleMetrics } from '../core/metrics';
import { shouldRunHandoffCycle } from '../core/refresh-gate';
import { MemoryShapeStore } from '../core/snapshot';
import type { AnimationKind, OnMetrics, RendererKind, ShapeSnapshot } from '../core/types';
import { nativeSensor } from './nativeSensorInstance';
import { resolveAutoskeletonOverlayNativeComponent } from './renderer/AutoskeletonOverlayHostComponent';
import type { NativeSensorTarget } from './sensor';
import { tier2PeersAvailable } from './tier2/peerAvailability';
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
const DEFAULT_HANDOFF_TIMEOUT_MS = 250;
const DEFAULT_HANDOFF_FADE_MS = 120;

export interface SkeletonContextValue {
  readonly store: MemoryShapeStore;
  readonly theme: SkeletonTheme;
  readonly budgetMs: number;
  readonly maxShapes: number;
  readonly handoffTimeoutMs: number;
  readonly handoffFadeMs: number;
}

/** Module-level default store, mirroring `web/AutoSkeleton.tsx`'s rationale
 *  verbatim: a shared cache across the whole app session is what makes
 *  REQ-NAV-1's hot path work without requiring every consumer to wire a
 *  `SkeletonProvider`. */
const defaultStore = new MemoryShapeStore();
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

function Ignore(props: { readonly children: ReactNode }): React.JSX.Element {
  return <>{props.children}</>;
}

export interface AutoSkeletonProps {
  readonly isLoading: boolean;
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
  readonly children?: ReactNode;
}

function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', onChange);
      return () => sub.remove();
    },
    () => reducedMotionSnapshot,
    () => false,
  );
}
let reducedMotionSnapshot = false;
AccessibilityInfo.isReduceMotionEnabled?.()
  .then((v) => {
    reducedMotionSnapshot = v;
  })
  .catch(() => undefined);

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
      const target: NativeSensorTarget = {
        reactTag,
        frameWidth: layout.width,
        frameHeight: layout.height,
      };
      const result = nativeSensor.measure(target, {
        key: cacheKey as unknown as Parameters<typeof nativeSensor.measure>[1]['key'],
        hints: {
          linesFor: () => undefined,
          radiusFor: () => undefined,
          isIgnored: () => false,
        },
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, cacheKey, layoutTick, platform]);

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

export function AutoSkeleton(props: AutoSkeletonProps): React.JSX.Element {
  const ctx = useContext(SkeletonContext);
  const theme = ctx.theme;
  const reducedMotion = useReducedMotion();
  const requestedAnimation = props.animation ?? 'shimmer';
  const animation: AnimationKind = reducedMotion && requestedAnimation === 'shimmer' ? 'pulse' : requestedAnimation;
  const debugOverlayEnabled = props.debugOverlay === true && typeof __DEV__ !== 'undefined' && __DEV__;

  const [everShownContent, setEverShownContent] = useState(!props.isLoading);
  if (!props.isLoading && !everShownContent) {
    setEverShownContent(true);
  }

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
  const snapshot = cacheHit ? cacheStateRef.current.snapshot : coldSnapshotForKey;

  const { viewRef, onLayout } = useColdMeasurement(
    showSkeleton && !cacheHit && snapshot === null && !nativeUnavailable,
    cacheKey,
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

  const rendererKind: RendererKind = tier2PeersAvailable() ? 'skia' : 'native';

  useHandoffAndMetrics(
    props.isLoading,
    controller,
    skeletonSuppressed,
    {
      snapshot,
      cacheHit,
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
    return <>{props.children}</>;
  }

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
  return (
    <View ref={viewRef} onLayout={onLayout} collapsable={false} style={styles.wrapper}>
      {props.children}
      {showSkeleton && snapshot && OverlayComponent && (
        <OverlayComponent
          cacheKey={cacheKey}
          baseColor={theme.baseColor}
          highlightColor={theme.highlightColor}
          defaultRadius={theme.defaultRadius}
          speedMs={theme.speedMs}
          animation={animation}
          reducedMotion={reducedMotion}
          debugOverlay={debugOverlayEnabled}
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          style={StyleSheet.absoluteFill}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { position: 'relative' },
});

AutoSkeleton.Ignore = Ignore;
