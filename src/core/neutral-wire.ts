// src/core/neutral-wire.ts
//
// The one-shape wire buffer a skeleton paints while it is still measuring.
//
// A cold key has no geometry for the frames the traversal needs (roughly 150ms
// on a device, measured — see `test/native/mount-order.test.ts` for the
// sequence). Something has to cover the live content in that window, and the
// naive answer is a separate placeholder view. That produces three unrelated
// visuals with two hard cuts: blank, then a dead slab, then a shimmering
// skeleton that is a different element entirely.
//
// This is the other answer. It is the SAME wire layout a real traversal
// returns, carrying exactly one full-bleed rounded rect, so the overlay
// renderer can mount on it immediately and then take its in-place
// `update(shapes)` path when the measured buffer arrives under the same
// `cacheKey` — a path both native hosts already implement and whose contract
// states it "MUST NOT restart the shimmer phase" (`core/contracts.ts`). The
// slab resolves INTO the measured shapes on one already-animating surface
// instead of being swapped for another.
//
// Deliberately NOT a `ShapeSnapshot`: it must never reach `ctx.store`,
// `cacheHit`, `onMetrics`, or `noUsableGeometry` — that last one also gates the
// consumer's `fallback` and the `MAX_EMPTY_MEASUREMENTS` retry pacing, so a
// synthetic snapshot there would silently switch off a consumer's fallback and
// report a measurement that never happened. A wire buffer is a draw-call
// argument, which is the only layer where this is free of side effects.
import { WIRE_VERSION } from './types';

/** `[VERSION, x, y, w, h, r]` — one rect covering the whole frame.
 *
 *  Returns an empty buffer for a non-positive or non-finite frame, because a
 *  degenerate rect is not a placeholder: it is an invisible shape that would
 *  still make the overlay mount and claim it had something to paint. Callers
 *  treat empty as "nothing to show yet", the same no-op a cache miss is. */
export function neutralWire(width: number, height: number, radius: number): readonly number[] {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return [];
  }
  const r = Number.isFinite(radius) && radius > 0 ? radius : 0;
  return [WIRE_VERSION, 0, 0, width, height, r];
}
