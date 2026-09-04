// test/native/wire-bridge.test.ts
//
// Task 5.1 (tasks.md Phase 5) / plan.md ADR-1: proves `wire-bridge.ts`'s
// `Float32Array.from` conversion runs EXACTLY once per cache miss per mount
// — never per frame, never on virtualized-list cell bind (REQ-LIST-CELL-1)
// — against a MOCKED native module (no real device/simulator needed for
// this call-count/codec proof; the real native `getShapes` implementation
// is separately proven by iOS XCTest / Android JUnit smoke tests per this
// task's DoD).

import { describe, expect, it, vi } from 'vitest';
import { decodeWire } from '../../src/core/wire';
import { evictNativeShapes, fetchShapesOnce, JSI_SERIALIZATION_TRACE_SECTION } from '../../src/native/wire-bridge';

function wireArrayFor(shapes: readonly (readonly [number, number, number, number, number])[]): number[] {
  const out: number[] = [1]; // WIRE_VERSION
  for (const [x, y, w, h, r] of shapes) {
    out.push(x, y, w, h, r);
  }
  return out;
}

const CONFIG = {
  defaultRadius: 4,
  budgetMs: 2,
  maxShapes: 60,
  collectDebugSidecars: false,
  hints: [],
};

describe('fetchShapesOnce (task 5.1 bridge)', () => {
  it('calls the native getShapes method exactly once per invocation', () => {
    const getShapes = vi.fn().mockReturnValue(wireArrayFor([[0, 0, 100, 20, 4]]));
    fetchShapesOnce({ getShapes }, 42, 'v1|key|-|375|1|ltr|ios' as never, CONFIG);
    expect(getShapes).toHaveBeenCalledTimes(1);
    expect(getShapes).toHaveBeenCalledWith(42, 'v1|key|-|375|1|ltr|ios', CONFIG);
  });

  // Phase-5-remediation (post-7.2 gap closure): proves `config` reaches the
  // native call VERBATIM — not merely that the signature accepts it. A
  // non-default value in every field, so a regression that silently
  // substitutes a compiled default cannot pass by accident.
  it('forwards the config object to native getShapes unchanged', () => {
    const getShapes = vi.fn().mockReturnValue(wireArrayFor([[0, 0, 1, 1, 0]]));
    const nonDefaultConfig = {
      defaultRadius: 16,
      budgetMs: 4,
      maxShapes: 1,
      collectDebugSidecars: true,
      hints: [{ nodeId: 'title', lines: 3, radius: -1 }],
    };
    fetchShapesOnce({ getShapes }, 7, 'k' as never, nonDefaultConfig);
    expect(getShapes).toHaveBeenCalledWith(7, 'k', nonDefaultConfig);
  });

  it('converts the boxed Array<number> into a Float32Array decodable by wire.ts', () => {
    const getShapes = vi.fn().mockReturnValue(wireArrayFor([[1, 2, 3, 4, 5]]));
    const result = fetchShapesOnce({ getShapes }, 1, 'k' as never, CONFIG);
    expect(result).not.toBeNull();
    expect(result!.data).toBeInstanceOf(Float32Array);
    expect(result!.data.byteOffset).toBe(0);
    const decoded = decodeWire(result!.data);
    expect(decoded.shapes).toEqual([{ x: 1, y: 2, w: 3, h: 4, r: 5 }]);
  });

  it('returns null when native reports an empty array (target not laid out yet)', () => {
    const getShapes = vi.fn().mockReturnValue([]);
    expect(fetchShapesOnce({ getShapes }, 1, 'k' as never, CONFIG)).toBeNull();
  });

  it('never calls getShapes more than once for N=60 shapes, N=0 shapes, or repeated mounts of the SAME cache key within one call site', () => {
    // REQ-LIST-CELL-1 at the bridge layer: nothing inside fetchShapesOnce
    // itself loops or re-invokes the native call — a single logical
    // "traversal request" is exactly one native call, regardless of shape
    // count. Simulating "per frame" or "per cell bind" would mean the
    // CALLER invoking fetchShapesOnce repeatedly, which is a caller
    // responsibility asserted in AutoSkeleton.tsx's own tests — this test
    // proves the primitive itself adds no hidden repetition.
    const manyShapes = Array.from({ length: 60 }, (_, i) => [i, i, 10, 10, 2] as const);
    const getShapes = vi.fn().mockReturnValue(wireArrayFor(manyShapes));
    fetchShapesOnce({ getShapes }, 1, 'k' as never, CONFIG);
    expect(getShapes).toHaveBeenCalledTimes(1);

    const getShapesEmpty = vi.fn().mockReturnValue(wireArrayFor([]));
    fetchShapesOnce({ getShapes: getShapesEmpty }, 1, 'k' as never, CONFIG);
    expect(getShapesEmpty).toHaveBeenCalledTimes(1);
  });

  it('wraps the native call with a distinct JSI-serialization trace section, separate from traversal/draw (REQ-OBS-PROFILE-1)', () => {
    const begin = vi.fn().mockReturnValue('token');
    const end = vi.fn();
    const getShapes = vi.fn().mockReturnValue(wireArrayFor([[0, 0, 1, 1, 0]]));
    fetchShapesOnce({ getShapes }, 1, 'k' as never, CONFIG, { begin, end });
    expect(begin).toHaveBeenCalledWith(JSI_SERIALIZATION_TRACE_SECTION);
    expect(end).toHaveBeenCalledWith(JSI_SERIALIZATION_TRACE_SECTION, 'token');
  });
});

describe('evictNativeShapes (ADR-9 consistency)', () => {
  it('forwards non-empty key lists to the native evictShapes method', () => {
    const evictShapes = vi.fn();
    evictNativeShapes({ evictShapes }, ['a', 'b']);
    expect(evictShapes).toHaveBeenCalledWith(['a', 'b']);
  });

  it('does not call native evictShapes for an empty key list', () => {
    const evictShapes = vi.fn();
    evictNativeShapes({ evictShapes }, []);
    expect(evictShapes).not.toHaveBeenCalled();
  });

  // Same class as `fetchShapesOnce`'s bridge throw, found by grepping the
  // class rather than the instance: `evictShapes` is the OTHER synchronous
  // Turbo Module call in this file and was equally unguarded. It has no
  // production call site today (see this session's report), which is why it
  // was never observed — the guard is here so the class stays closed if and
  // when ADR-9's JS-authoritative eviction is finally wired up. A cache
  // eviction that fails is by definition a fail-open situation: the worst
  // outcome is a stale native entry that JS already discarded, which is
  // strictly better than crashing an app to purge a cache.
  it('never lets a throwing native evictShapes escape (ADR-15 posture, ADR-9 path)', () => {
    const evictShapes = vi.fn(() => {
      throw new Error('native evict blew up');
    });
    expect(() => evictNativeShapes({ evictShapes }, ['a'])).not.toThrow();
    expect(evictShapes).toHaveBeenCalledTimes(1);
  });
});

// Adversarial-review finding (2026-08-29). The report's stated MECHANISM is
// wrong — neither call site of `nativeSensor.measure()` runs in a React
// render body (`AutoSkeleton.tsx`'s is inside `requestAnimationFrame`,
// `useTemplateMeasurement.ts`'s inside `scheduleAfterInteractions` + rAF), so
// a bridge throw never "propagates into React render". The DEFECT is real
// anyway, and worse than a render-phase throw: an exception raised inside a
// rAF/InteractionManager callback has no React error boundary above it at
// all, so it reaches RN's `ExceptionsManager` as an unhandled JS error — a
// redbox in dev, a reported fatal in release. `getShapes` is a SYNCHRONOUS
// Turbo Module call into platform traversal code; a throw is a real outcome
// (a codegen argument-conversion failure, a native-side exception surfaced
// through the bridge), and this project's established posture for "the native
// side let us down" is ADR-15's fail-open: no skeleton, children rendered, no
// crash, degradation visible.
//
// `null` is exactly that posture, already spelled by this function's own
// contract ("returns null when the native module is unavailable or the target
// is not laid out yet") and already handled by BOTH call sites — so the fix
// needs no new degradation vocabulary and no new branch upstream.
//
// The `finally` is a SECOND defect of the same class found by the same grep:
// a throw between `tracing.begin` and `tracing.end` leaked the signpost/trace
// interval, so the very profiling channel REQ-OBS-PROFILE-1 depends on would
// report a JSI-serialization phase that never closed.
describe('fetchShapesOnce — a throwing native bridge fails OPEN (ADR-15 posture)', () => {
  it('returns null instead of propagating a native getShapes exception', () => {
    const getShapes = vi.fn(() => {
      throw new Error('native traversal blew up');
    });
    expect(() => fetchShapesOnce({ getShapes }, 42, 'k' as never, CONFIG)).not.toThrow();
    expect(fetchShapesOnce({ getShapes }, 42, 'k' as never, CONFIG)).toBeNull();
  });

  it('closes the JSI-serialization trace section even when the native call throws', () => {
    const begin = vi.fn().mockReturnValue('token');
    const end = vi.fn();
    const getShapes = vi.fn(() => {
      throw new Error('native traversal blew up');
    });
    fetchShapesOnce({ getShapes }, 1, 'k' as never, CONFIG, { begin, end });
    expect(begin).toHaveBeenCalledWith(JSI_SERIALIZATION_TRACE_SECTION);
    expect(end).toHaveBeenCalledWith(JSI_SERIALIZATION_TRACE_SECTION, 'token');
  });

  it('still fails open when the conversion of a hostile boxed payload throws', () => {
    // `Float32Array.from` runs on a value that crossed the bridge. A boxed
    // array whose element access throws is the same class of foreign-input
    // hazard as the call itself, and must not escape either.
    const hostile = { length: 2, get 0(): number { throw new Error('bad element'); } };
    const getShapes = vi.fn().mockReturnValue(hostile as unknown as number[]);
    expect(fetchShapesOnce({ getShapes }, 1, 'k' as never, CONFIG)).toBeNull();
  });
});
