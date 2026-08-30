// test/web/helpers/window.d.ts
//
// Shared ambient `window.Autoskeleton` shape for every Playwright test-harness
// entry file under test/web/helpers/*-entry.ts. Each entry bundles and
// exposes a DIFFERENT subset of the production module graph (dom-sensor.ts
// only needs the sensor; css-renderer.ts only needs the renderer, etc.), so
// every field here is optional — a single shared, additive declaration avoids
// "subsequent property declarations must have the same type" TS conflicts
// that per-entry `declare global` blocks would otherwise cause when multiple
// spec files are typechecked together (tsconfig.tests.json includes all of
// test/web).

import type { composeCacheKey } from '../../../src/core/cache-key';
import type { createHintRegistry } from '../../../src/core/hint-registry';
import type { MemoryShapeStore } from '../../../src/core/snapshot';
import type { AnimationKind, RadiusSource, ShapeSnapshot } from '../../../src/core/types';
import type { decodeWire, encodeWire } from '../../../src/core/wire';
import type { createCssRenderer, createShimmerClock, buildShimmerStylesheet } from '../../../src/web/css-renderer';
import type {
  createDomSensor,
  createEmptyHintRegistry,
  HINT_ID_ATTRIBUTE,
  IGNORE_ATTRIBUTE,
} from '../../../src/web/dom-sensor';

export interface AutoskeletonTestGlobal {
  createDomSensor?: typeof createDomSensor;
  createEmptyHintRegistry?: typeof createEmptyHintRegistry;
  createHintRegistry?: typeof createHintRegistry;
  IGNORE_ATTRIBUTE?: typeof IGNORE_ATTRIBUTE;
  HINT_ID_ATTRIBUTE?: typeof HINT_ID_ATTRIBUTE;
  composeCacheKey?: typeof composeCacheKey;
  decodeWire?: typeof decodeWire;
  encodeWire?: typeof encodeWire;
  WIRE_VERSION?: number;
  createCssRenderer?: typeof createCssRenderer;
  createShimmerClock?: typeof createShimmerClock;
  buildShimmerStylesheet?: typeof buildShimmerStylesheet;
  AnimationKind?: AnimationKind;
  ShapeSnapshot?: ShapeSnapshot;
  RADIUS_SOURCES?: readonly RadiusSource[];
}

/** Per-test control surface a spec's own mounted React tree publishes so the
 *  Playwright side can drive it (`setLoading`) and inspect what the real
 *  production component actually cached (`store`). Declared here rather than
 *  cast inline in each spec, for the same reason the block above is shared. */
export interface AutoskeletonHarness {
  store: MemoryShapeStore;
  setLoading: (isLoading: boolean) => void;
  setSized: (sized: boolean) => void;
}

declare global {
  interface Window {
    Autoskeleton: AutoskeletonTestGlobal;
    __autoskeletonHarness: AutoskeletonHarness;
  }
}
