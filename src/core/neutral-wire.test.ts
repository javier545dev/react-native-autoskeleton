import { describe, expect, it } from 'vitest';

import { neutralWire } from './neutral-wire';
import { WIRE_HEADER_SLOTS, WIRE_STRIDE, WIRE_VERSION } from './types';

describe('neutralWire', () => {
  it('is a real wire buffer carrying exactly one full-bleed rect', () => {
    const wire = neutralWire(320, 200, 8);
    // The same layout a traversal returns, so the renderer cannot tell the
    // difference — which is the whole point: it mounts on this and then
    // UPDATES to the measured one instead of being replaced by it.
    expect((wire.length - WIRE_HEADER_SLOTS) % WIRE_STRIDE).toBe(0);
    expect(wire).toEqual([WIRE_VERSION, 0, 0, 320, 200, 8]);
  });

  it.each([
    ['zero width', 0, 200],
    ['zero height', 320, 0],
    ['negative', -10, 200],
    ['NaN', Number.NaN, 200],
    ['Infinity', Number.POSITIVE_INFINITY, 200],
  ])('returns nothing to paint for a %s frame', (_label, w, h) => {
    // Not a degenerate rect: an invisible shape would still make the overlay
    // mount and claim it had something to paint. Empty means "not yet".
    expect(neutralWire(w, h, 8)).toEqual([]);
  });

  it('clamps a hostile radius rather than propagating it', () => {
    expect(neutralWire(320, 200, Number.NaN)[5]).toBe(0);
    expect(neutralWire(320, 200, -4)[5]).toBe(0);
  });

  // Anti-vacuity: every assertion above would hold for a function that always
  // returned []. The ordinary case must produce a paintable buffer.
  it('produces a paintable buffer for an ordinary frame', () => {
    expect(neutralWire(1, 1, 0).length).toBe(WIRE_HEADER_SLOTS + WIRE_STRIDE);
  });
});
