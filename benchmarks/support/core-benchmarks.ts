// benchmarks/support/core-benchmarks.ts
//
// tasks.md 9.1 — the two benchmarks that need no browser, no simulator, and
// no device: synchronous cache lookup (NFR-4) and JS-side wire serialization
// (ADR-1's exit criterion). Both run against the REAL production modules
// (`MemoryShapeStore`, `encodeWire`/`decodeWire`), never a reimplementation.
//
// Honest scope note (see tasks.md 9.1's own DoD and the apply-progress
// report): this measures the JS-SIDE cost of building/reading the wire
// buffer. It does NOT cross a real JSI/Turbo Module boundary — there is no
// live native module to call from a headless Node process. ADR-1's own
// estimate ("301 doubles at 60 shapes, order 10^2 µs") was for the native
// boxed-array conversion specifically; this benchmark measures the adjacent,
// but distinct, `Float32Array` construction cost on the JS side, which is
// the part actually reachable without a device.

import { composeCacheKey } from '../../src/core/cache-key';
import { MemoryShapeStore } from '../../src/core/snapshot';
import type { ShapeInfo, ShapeSnapshot } from '../../src/core/types';
import { WIRE_VERSION } from '../../src/core/types';
import { decodeWire, encodeWire } from '../../src/core/wire';
import { percentile } from './percentiles';

export interface CacheLookupBenchmarkOptions {
  readonly shapeCount: number;
  readonly iterations: number;
}

export interface CacheLookupBenchmarkResult {
  readonly samples: readonly number[];
  readonly p95Ms: number;
  /** true iff the warmed key was genuinely present for every sampled lookup
   *  (proves this measured a cache HIT, not a miss). */
  readonly hit: boolean;
}

function syntheticShapes(count: number): ShapeInfo[] {
  return Array.from({ length: count }, (_, i) => ({
    x: (i % 10) * 40,
    y: Math.floor(i / 10) * 24,
    w: 32,
    h: 16,
    r: 4,
  }));
}

export function benchmarkCacheLookup(options: CacheLookupBenchmarkOptions): CacheLookupBenchmarkResult {
  const store = new MemoryShapeStore();
  const key = composeCacheKey({
    skeletonKey: 'benchmarks/reference-screen',
    viewportWidth: 375,
    fontScale: 1,
    direction: 'ltr',
    platform: 'ios',
  });
  const snapshot: ShapeSnapshot = {
    key,
    version: WIRE_VERSION,
    capturedAt: Date.now(),
    frameWidth: 375,
    frameHeight: 812,
    data: encodeWire(syntheticShapes(options.shapeCount)),
    degraded: [],
  };
  store.set(key, snapshot);

  const samples: number[] = [];
  let hit = true;
  for (let i = 0; i < options.iterations; i++) {
    const start = performance.now();
    const result = store.get(key);
    const end = performance.now();
    samples.push(end - start);
    if (result === undefined) {
      hit = false;
    }
  }

  return { samples, p95Ms: percentile(samples, 95), hit };
}

export interface SerializationBenchmarkOptions {
  readonly shapeCount: number;
  readonly iterations: number;
}

export interface SerializationBenchmarkResult {
  readonly samples: readonly number[];
  readonly p95Ms: number;
  readonly shapeCount: number;
  readonly decodedShapeCount: number;
}

export function benchmarkSerialization(options: SerializationBenchmarkOptions): SerializationBenchmarkResult {
  const shapes = syntheticShapes(options.shapeCount);
  const samples: number[] = [];
  let decodedShapeCount = 0;

  for (let i = 0; i < options.iterations; i++) {
    const start = performance.now();
    const data = encodeWire(shapes);
    const end = performance.now();
    samples.push(end - start);
    decodedShapeCount = decodeWire(data).shapes.length;
  }

  return {
    samples,
    p95Ms: percentile(samples, 95),
    shapeCount: options.shapeCount,
    decodedShapeCount,
  };
}
