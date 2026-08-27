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

describe('fetchShapesOnce (task 5.1 bridge)', () => {
  it('calls the native getShapes method exactly once per invocation', () => {
    const getShapes = vi.fn().mockReturnValue(wireArrayFor([[0, 0, 100, 20, 4]]));
    fetchShapesOnce({ getShapes }, 42, 'v1|key|-|375|1|ltr|ios' as never);
    expect(getShapes).toHaveBeenCalledTimes(1);
    expect(getShapes).toHaveBeenCalledWith(42, 'v1|key|-|375|1|ltr|ios');
  });

  it('converts the boxed Array<number> into a Float32Array decodable by wire.ts', () => {
    const getShapes = vi.fn().mockReturnValue(wireArrayFor([[1, 2, 3, 4, 5]]));
    const result = fetchShapesOnce({ getShapes }, 1, 'k' as never);
    expect(result).not.toBeNull();
    expect(result!.data).toBeInstanceOf(Float32Array);
    expect(result!.data.byteOffset).toBe(0);
    const decoded = decodeWire(result!.data);
    expect(decoded.shapes).toEqual([{ x: 1, y: 2, w: 3, h: 4, r: 5 }]);
  });

  it('returns null when native reports an empty array (target not laid out yet)', () => {
    const getShapes = vi.fn().mockReturnValue([]);
    expect(fetchShapesOnce({ getShapes }, 1, 'k' as never)).toBeNull();
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
    fetchShapesOnce({ getShapes }, 1, 'k' as never);
    expect(getShapes).toHaveBeenCalledTimes(1);

    const getShapesEmpty = vi.fn().mockReturnValue(wireArrayFor([]));
    fetchShapesOnce({ getShapes: getShapesEmpty }, 1, 'k' as never);
    expect(getShapesEmpty).toHaveBeenCalledTimes(1);
  });

  it('wraps the native call with a distinct JSI-serialization trace section, separate from traversal/draw (REQ-OBS-PROFILE-1)', () => {
    const begin = vi.fn().mockReturnValue('token');
    const end = vi.fn();
    const getShapes = vi.fn().mockReturnValue(wireArrayFor([[0, 0, 1, 1, 0]]));
    fetchShapesOnce({ getShapes }, 1, 'k' as never, { begin, end });
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
});
