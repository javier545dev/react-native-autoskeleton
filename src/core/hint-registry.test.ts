import { afterEach, describe, expect, it } from 'vitest';
import {
  clearHintRegistry,
  createHintRegistry,
  registerHint,
  snapshotHintEntries,
  unregisterHint,
} from './hint-registry';

// Typed-hint channel (radius/lines): the producer-side registry both
// `<AutoSkeleton.Hint>` implementations (`src/native/Hint.tsx`,
// `src/web/AutoSkeleton.tsx`'s `Hint`) write into during render, and both the
// web sensor (in-process `HintRegistry` consultation) and the native bridge
// (serialized entries crossing the Turbo Module boundary) read from at
// measurement time. Kept in `src/core/` (ADR-4: zero platform imports) so it
// is Vitest-tested exactly like the rest of the shared hint algebra.

describe('hint-registry (src/core/hint-registry.ts)', () => {
  afterEach(() => {
    clearHintRegistry();
  });

  describe('registerHint / snapshotHintEntries', () => {
    it('starts empty', () => {
      expect(snapshotHintEntries()).toEqual([]);
    });

    it('records a registered entry, keyed by nodeId', () => {
      registerHint('row-title', { lines: 3, radius: 8 });
      expect(snapshotHintEntries()).toEqual([{ nodeId: 'row-title', lines: 3, radius: 8 }]);
    });

    it('supports a lines-only or radius-only entry (the other stays undefined)', () => {
      registerHint('a', { lines: 2 });
      registerHint('b', { radius: 12 });
      expect(snapshotHintEntries()).toEqual(
        expect.arrayContaining([
          { nodeId: 'a', lines: 2 },
          { nodeId: 'b', radius: 12 },
        ]),
      );
    });

    it('re-registering the same nodeId overwrites the previous values (idempotent on repeated renders)', () => {
      registerHint('row-title', { lines: 2 });
      registerHint('row-title', { lines: 5, radius: 10 });
      expect(snapshotHintEntries()).toEqual([{ nodeId: 'row-title', lines: 5, radius: 10 }]);
    });
  });

  describe('unregisterHint', () => {
    it('removes a previously registered entry', () => {
      registerHint('row-title', { lines: 3 });
      unregisterHint('row-title');
      expect(snapshotHintEntries()).toEqual([]);
    });

    it('is a no-op for a nodeId that was never registered', () => {
      expect(() => unregisterHint('never-registered')).not.toThrow();
      expect(snapshotHintEntries()).toEqual([]);
    });
  });

  describe('createHintRegistry', () => {
    it('builds a HintRegistry whose linesFor/radiusFor resolve registered entries', () => {
      const hints = createHintRegistry([
        { nodeId: 'a', lines: 4 },
        { nodeId: 'b', radius: 16 },
      ]);
      expect(hints.linesFor('a')).toBe(4);
      expect(hints.radiusFor('a')).toBeUndefined();
      expect(hints.linesFor('b')).toBeUndefined();
      expect(hints.radiusFor('b')).toBe(16);
    });

    it('returns undefined for an unregistered nodeId', () => {
      const hints = createHintRegistry([]);
      expect(hints.linesFor('missing')).toBeUndefined();
      expect(hints.radiusFor('missing')).toBeUndefined();
    });

    it('isIgnored is always false — Ignore uses its own self-sufficient marker channel, never this registry', () => {
      const hints = createHintRegistry([{ nodeId: 'a', lines: 1, radius: 1 }]);
      expect(hints.isIgnored('a')).toBe(false);
    });
  });
});
