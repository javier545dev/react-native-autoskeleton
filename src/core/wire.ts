// src/core/wire.ts
//
// plan.md §4: the `Float32Array` wire schema — encode/decode + version
// negotiation. Slot 0 is VERSION; slots 1.. are shapes packed tightly as
// x, y, w, h, r with no padding, in traversal order.
//
// This module produces the `snapshot-version-mismatch` degradation flag on a
// forward-migrated older snapshot; it never calls `onMetrics` or any warning
// function itself — `assembleMetrics` (task 1.8) is the sole place that
// composes `onMetrics.degraded`.

import type { DegradationFlag, ShapeInfo } from './types';
import { WIRE_HEADER_SLOTS, WIRE_STRIDE, WIRE_VERSION } from './types';

export class WireVersionMismatchError extends Error {
  constructor(readonly foundVersion: number, readonly readerVersion: number) {
    super(
      `Wire snapshot version ${foundVersion} is newer than this reader's version ` +
        `${readerVersion}; refusing to guess the layout.`,
    );
    this.name = 'WireVersionMismatchError';
  }
}

export class WireMalformedLengthError extends Error {
  /** `reason`, when supplied, overrides the default length/byteOffset
   *  message — reused (not duplicated into a second error class) for the
   *  corrupted-version-slot case in `decodeWire` below, which is malformed
   *  for a different structural reason than a bad length/byteOffset but is
   *  still exactly "a wire buffer this reader refuses to trust", the same
   *  class of failure this error type already exists to name. */
  constructor(readonly length: number, readonly byteOffset: number, reason?: string) {
    super(
      reason ??
        `Malformed wire buffer: length=${length}, byteOffset=${byteOffset}. Expected ` +
          `byteOffset === 0 and (length - ${WIRE_HEADER_SLOTS}) % ${WIRE_STRIDE} === 0.`,
    );
    this.name = 'WireMalformedLengthError';
  }
}

export interface DecodedWire {
  readonly version: number;
  readonly shapes: readonly ShapeInfo[];
  /** Non-empty only when the buffer was forward-migrated from an older schema
   *  version; contains 'snapshot-version-mismatch' in that case. */
  readonly degraded: readonly DegradationFlag[];
}

/** Encodes shapes into the flat wire layout. Always produces a buffer with
 *  `byteOffset === 0` (a fresh `Float32Array` owns its own buffer). */
export function encodeWire(
  shapes: readonly ShapeInfo[],
  version: number = WIRE_VERSION,
): Float32Array {
  const data = new Float32Array(WIRE_HEADER_SLOTS + shapes.length * WIRE_STRIDE);
  data[0] = version;
  shapes.forEach((shape, i) => {
    const offset = WIRE_HEADER_SLOTS + i * WIRE_STRIDE;
    data[offset] = shape.x;
    data[offset + 1] = shape.y;
    data[offset + 2] = shape.w;
    data[offset + 3] = shape.h;
    data[offset + 4] = shape.r;
  });
  return data;
}

/** Forward-migrates an older wire snapshot to the current in-memory shape.
 *  v1 is the only schema that has ever shipped, so migration is currently the
 *  identity transform on layout — the mechanism exists so a real future
 *  version bump has somewhere to add real field remapping. */
function migrateForward(data: Float32Array): Float32Array {
  return data;
}

/** Decodes a wire buffer, asserting `byteOffset === 0` and the length modulus,
 *  rejecting a newer schema version, and forward-migrating an older one. */
export function decodeWire(data: Float32Array): DecodedWire {
  if (
    data.byteOffset !== 0 ||
    data.length < WIRE_HEADER_SLOTS ||
    (data.length - WIRE_HEADER_SLOTS) % WIRE_STRIDE !== 0
  ) {
    throw new WireMalformedLengthError(data.length, data.byteOffset);
  }

  const foundVersion = data[0]!;
  // Adversarial-review defect: `foundVersion > WIRE_VERSION` and
  // `foundVersion < WIRE_VERSION` below are BOTH false for NaN under
  // IEEE-754 (and `> WIRE_VERSION` alone is also satisfied by +/-Infinity
  // and any fractional value, which are not legitimate "newer version"
  // negotiation outcomes either), so a corrupted version slot must be
  // rejected explicitly, before either comparison runs, or it silently
  // decodes as garbage instead of failing. `Number.isInteger` already
  // implies finiteness, so this one check rejects NaN, +/-Infinity,
  // fractional and negative slots without a separate `Number.isFinite` call.
  if (!Number.isInteger(foundVersion) || foundVersion < 0) {
    throw new WireMalformedLengthError(
      data.length,
      data.byteOffset,
      `Malformed wire buffer: version slot must be a finite non-negative integer, found ${foundVersion}.`,
    );
  }
  if (foundVersion > WIRE_VERSION) {
    throw new WireVersionMismatchError(foundVersion, WIRE_VERSION);
  }

  const degraded: DegradationFlag[] = [];
  const migrated = foundVersion < WIRE_VERSION ? migrateForward(data) : data;
  if (foundVersion < WIRE_VERSION) {
    degraded.push('snapshot-version-mismatch');
  }

  const n = (migrated.length - WIRE_HEADER_SLOTS) / WIRE_STRIDE;
  const shapes: ShapeInfo[] = [];
  for (let i = 0; i < n; i++) {
    const offset = WIRE_HEADER_SLOTS + i * WIRE_STRIDE;
    shapes.push({
      x: migrated[offset]!,
      y: migrated[offset + 1]!,
      w: migrated[offset + 2]!,
      h: migrated[offset + 3]!,
      r: migrated[offset + 4]!,
    });
  }

  return { version: foundVersion, shapes, degraded };
}
