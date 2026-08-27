import { describe, expect, expectTypeOf, it } from 'vitest';
import type { ShapeCacheKey } from './cache-key';
import { composeCacheKey } from './cache-key';
import type { AnimationKind, RendererKind, ShapeSnapshot } from './types';
import { WIRE_VERSION } from './types';
import { encodeWire } from './wire';
import type {
  ClockPhase,
  HintRegistry,
  InvalidationReason,
  RenderProps,
  Renderer,
  RendererHandle,
  Sensor,
  SensorOptions,
  SensorResult,
  ShimmerClock,
  SkeletonTheme,
} from './contracts';

// Task 1.8 (tasks.md Phase 1): finalizes Sensor<TTarget>, Renderer<TSurface>,
// ShimmerClock, HintRegistry, SensorOptions/SensorResult — types only;
// platform layers implement these in Phases 2-5. Proven here via compile
// assertions: a minimal conforming mock must typecheck against each contract.

const KEY: ShapeCacheKey = composeCacheKey({
  skeletonKey: 'profile',
  itemType: undefined,
  viewportWidth: 390,
  fontScale: 1,
  direction: 'ltr',
  platform: 'ios',
});

function makeSnapshot(): ShapeSnapshot {
  return {
    key: KEY,
    version: WIRE_VERSION,
    capturedAt: 0,
    frameWidth: 390,
    frameHeight: 844,
    data: encodeWire([{ x: 0, y: 0, w: 10, h: 10, r: 0 }]),
    degraded: [],
  };
}

describe('HintRegistry — compile assertion', () => {
  it('accepts a minimal conforming implementation', () => {
    const hints: HintRegistry = {
      linesFor: () => undefined,
      radiusFor: () => undefined,
      isIgnored: () => false,
    };
    expect(hints.isIgnored('node-1')).toBe(false);
  });
});

describe('SensorOptions / SensorResult — compile assertion', () => {
  it('types every SensorOptions field and lets SensorResult carry a snapshot', () => {
    const options: SensorOptions = {
      key: KEY,
      hints: { linesFor: () => undefined, radiusFor: () => undefined, isIgnored: () => false },
      budgetMs: 2,
      maxShapes: 60,
      defaultRadius: 4,
      collectDebugSidecars: false,
    };
    const result: SensorResult = {
      snapshot: makeSnapshot(),
      traversalMs: 1.2,
      degraded: [],
    };
    expectTypeOf(options.budgetMs).toEqualTypeOf<number>();
    expect(result.snapshot.key).toBe(KEY);
  });
});

describe('Sensor<TTarget> — compile assertion', () => {
  it('accepts a minimal conforming implementation with an optional refine()', () => {
    const sensor: Sensor<{ id: string }> = {
      platform: 'ios',
      measure: () => null,
      observe: () => () => {},
      dispose: () => {},
    };
    expect(sensor.measure({ id: 'a' }, {} as SensorOptions)).toBeNull();

    const reason: InvalidationReason = 'resize';
    expect(reason).toBe('resize');
    expectTypeOf<InvalidationReason>().toEqualTypeOf<
      'resize' | 'mutation' | 'font-scale' | 'direction' | 'orientation' | 'manual'
    >();
  });
});

describe('Renderer<TSurface> — compile assertion', () => {
  it('accepts a minimal conforming implementation', () => {
    const theme: SkeletonTheme = {
      baseColor: '#eee',
      highlightColor: '#fff',
      defaultRadius: 4,
      speedMs: 1200,
    };
    const clock: ShimmerClock = {
      id: 'clock-1',
      driver: 'css',
      periodMs: 1200,
      startedAt: 0,
      phaseAt: (): ClockPhase => 0,
      phaseOffsetMs: () => 0,
      subscribe: () => () => {},
      setPeriod: () => {},
      pause: () => {},
      resume: () => {},
    };
    const props: RenderProps = {
      snapshot: makeSnapshot(),
      theme,
      animation: 'shimmer' as AnimationKind,
      clock,
      reducedMotion: false,
      debugOverlay: false,
    };
    const handle: RendererHandle = {
      update: () => {},
      setAnimation: () => {},
      destroy: () => {},
    };
    const renderer: Renderer<{ id: string }> = {
      kind: 'css' as RendererKind,
      supportsRadius: true,
      isAvailable: () => true,
      mount: () => handle,
    };
    expect(renderer.mount({ id: 'surface' }, props)).toBe(handle);
  });
});
