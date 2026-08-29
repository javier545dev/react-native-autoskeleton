import { describe, expect, it } from 'vitest';
import type { ShapeInfo } from './types';
import { WIRE_VERSION } from './types';
import {
  encodeWire,
  decodeWire,
  WireVersionMismatchError,
  WireMalformedLengthError,
} from './wire';

// Task 1.2 (tasks.md Phase 1): produces the `snapshot-version-mismatch` flag
// consumed by `onMetrics.degraded` (assembled in 1.8) — no emission call here,
// so this task has no observability call of its own beyond the returned flag.

function shape(x: number): ShapeInfo {
  return { x, y: x + 1, w: 10, h: 20, r: 4 };
}

describe('encodeWire / decodeWire round-trip', () => {
  it('round-trips N=0 shapes (header only)', () => {
    const data = encodeWire([]);
    expect(data.byteOffset).toBe(0);
    expect(data.length).toBe(1);
    const decoded = decodeWire(data);
    expect(decoded.version).toBe(WIRE_VERSION);
    expect(decoded.shapes).toEqual([]);
    expect(decoded.degraded).toEqual([]);
  });

  it('round-trips N=1 shape', () => {
    const shapes = [shape(0)];
    const data = encodeWire(shapes);
    expect(data.length).toBe(6); // 1 header + 5 stride
    const decoded = decodeWire(data);
    expect(decoded.shapes).toEqual(shapes);
  });

  it('round-trips N=60 shapes in traversal order', () => {
    const shapes = Array.from({ length: 60 }, (_, i) => shape(i));
    const data = encodeWire(shapes);
    expect(data.length).toBe(1 + 60 * 5);
    const decoded = decodeWire(data);
    expect(decoded.shapes).toHaveLength(60);
    expect(decoded.shapes).toEqual(shapes);
  });
});

describe('malformed-length rejection', () => {
  it('rejects a buffer with zero length (missing version slot)', () => {
    expect(() => decodeWire(new Float32Array(0))).toThrow(WireMalformedLengthError);
  });

  it('rejects a buffer whose length fails the (length - 1) % 5 === 0 modulus', () => {
    // 3 floats: header + 2 stray values, not a whole shape
    expect(() => decodeWire(new Float32Array([WIRE_VERSION, 1, 2]))).toThrow(
      WireMalformedLengthError,
    );
  });
});

describe('byteOffset alignment', () => {
  it('rejects a Float32Array view with a non-zero byteOffset', () => {
    const buffer = new ArrayBuffer(4 * 8);
    const view = new Float32Array(buffer, 4, 6); // byteOffset === 4, not 0
    expect(() => decodeWire(view)).toThrow(WireMalformedLengthError);
  });
});

describe('version negotiation', () => {
  it('rejects a NEWER schema version than this reader understands', () => {
    const data = encodeWire([shape(0)], WIRE_VERSION + 1);
    expect(() => decodeWire(data)).toThrow(WireVersionMismatchError);
  });

  it('forward-migrates an OLDER schema version and raises snapshot-version-mismatch', () => {
    const olderVersion = WIRE_VERSION - 1;
    const data = encodeWire([shape(0), shape(1)], olderVersion);
    const decoded = decodeWire(data);
    expect(decoded.version).toBe(olderVersion);
    expect(decoded.shapes).toHaveLength(2);
    expect(decoded.degraded).toContain('snapshot-version-mismatch');
  });

  it('does not raise snapshot-version-mismatch for a snapshot at the current version', () => {
    const data = encodeWire([shape(0)]);
    const decoded = decodeWire(data);
    expect(decoded.degraded).not.toContain('snapshot-version-mismatch');
  });
});

// Adversarial-review defect: `foundVersion > WIRE_VERSION` and
// `foundVersion < WIRE_VERSION` are BOTH false for NaN under IEEE-754, so a
// corrupted version slot previously fell through every branch untouched —
// `decodeWire(new Float32Array([NaN, 1, 2, 3, 4, 5]))` returned
// `{ version: NaN, shapes: [...], degraded: [] }` with no throw and no
// `snapshot-version-mismatch` flag, exactly the "buffer that decodes to
// silent garbage rather than an error" the versioned schema exists to
// prevent. `Number.isInteger(NaN)` and `Number.isInteger(Infinity)` are both
// `false`, so `!Number.isInteger(foundVersion) || foundVersion < 0` rejects
// NaN, +/-Infinity, negative and fractional slots in one check, without a
// separate `Number.isFinite` call.
describe('corrupted version slot rejection', () => {
  it('rejects a NaN version slot instead of silently returning version:NaN with an empty degraded array', () => {
    const data = new Float32Array([NaN, 1, 2, 3, 4, 5]);
    expect(() => decodeWire(data)).toThrow(WireMalformedLengthError);
  });

  it('rejects a negative version slot', () => {
    const data = new Float32Array([-1, 1, 2, 3, 4, 5]);
    expect(() => decodeWire(data)).toThrow(WireMalformedLengthError);
  });

  it('rejects a fractional (non-integer) version slot', () => {
    const data = new Float32Array([1.5, 1, 2, 3, 4, 5]);
    expect(() => decodeWire(data)).toThrow(WireMalformedLengthError);
  });

  it('rejects a +Infinity version slot', () => {
    const data = new Float32Array([Infinity, 1, 2, 3, 4, 5]);
    expect(() => decodeWire(data)).toThrow(WireMalformedLengthError);
  });

  it('still accepts version 0 (a valid non-negative integer, not to be confused with "corrupted")', () => {
    const data = encodeWire([shape(0)], 0);
    expect(() => decodeWire(data)).not.toThrow();
  });
});
