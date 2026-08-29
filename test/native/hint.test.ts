// test/native/hint.test.ts
//
// `<AutoSkeleton.Hint>` — the native half of the typed-hint channel. Mirrors
// `test/native/ignore.test.ts` exactly: `Hint` (`src/native/Hint.tsx`)
// depends only on `react`'s `Children`/`cloneElement` plus
// `core/hint-registry.ts` (itself platform-agnostic), so it needs no
// `react-native` mock and is exercised as a plain function against synthetic
// elements built with `createElement('View', ...)`.
//
// The on-device visual paint gate
// (`examples/bare-rn/android/.../PaintGateInstrumentedTest.kt`) is the real
// proof a `radius` hint changes the painted corner; this suite proves the
// JS-side marker + registration mechanism in isolation.

import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { clearHintRegistry, snapshotHintEntries } from '../../src/core/hint-registry';
import {
  formatHintTestIdConflictWarning,
  Hint,
  __resetHintTestIdConflictWarningsForTests,
} from '../../src/native/Hint';

interface ClonedElement {
  readonly type: unknown;
  readonly props: Record<string, unknown>;
}

describe('Hint (native) — typed-hint channel (src/native/Hint.tsx)', () => {
  let warnSpy: MockInstance<(...args: unknown[]) => void>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined) as unknown as MockInstance<
      (...args: unknown[]) => void
    >;
  });

  afterEach(() => {
    warnSpy.mockRestore();
    clearHintRegistry();
    __resetHintTestIdConflictWarningsForTests();
  });

  it('clones the single child, stamping BOTH nativeID and testID with the given id', () => {
    const child = createElement('View', { foo: 'bar' });
    const result = Hint({ id: 'row-title', lines: 3, children: child }) as unknown as ClonedElement;

    expect(result.type).toBe('View');
    expect(result.props.nativeID).toBe('row-title');
    expect(result.props.testID).toBe('row-title');
    expect(result.props.foo).toBe('bar');
  });

  it('registers lines/radius into the shared hint registry, keyed by id', () => {
    const child = createElement('View');
    Hint({ id: 'avatar', radius: 24, children: child });

    expect(snapshotHintEntries()).toEqual([{ nodeId: 'avatar', radius: 24 }]);
  });

  it('registers both lines and radius when both are provided', () => {
    const child = createElement('View');
    Hint({ id: 'title', lines: 2, radius: 4, children: child });

    expect(snapshotHintEntries()).toEqual([{ nodeId: 'title', lines: 2, radius: 4 }]);
  });

  it('re-rendering with new props overwrites the previous registration for the same id', () => {
    const child = createElement('View');
    Hint({ id: 'title', lines: 2, children: child });
    Hint({ id: 'title', lines: 5, radius: 8, children: child });

    expect(snapshotHintEntries()).toEqual([{ nodeId: 'title', lines: 5, radius: 8 }]);
  });

  it('overwrites a nativeID the child already set (nativeID is OUR Android lookup channel, not an e2e handle)', () => {
    const child = createElement('View', { nativeID: 'consumer-id' });
    const result = Hint({ id: 'row-title', lines: 1, children: child }) as unknown as ClonedElement;

    expect(result.props.nativeID).toBe('row-title');
  });

  describe("never destroys the consumer's own testID (their e2e suite's element handle)", () => {
    it("keeps the child's existing testID instead of overwriting it with the hint id", () => {
      const child = createElement('View', { testID: 'checkout-button' });
      const result = Hint({ id: 'row-title', lines: 1, children: child }) as unknown as ClonedElement;

      expect(result.props.testID).toBe('checkout-button');
    });

    it('still stamps nativeID with the hint id so the Android lookup channel keeps working', () => {
      const child = createElement('View', { testID: 'checkout-button' });
      const result = Hint({ id: 'row-title', lines: 1, children: child }) as unknown as ClonedElement;

      expect(result.props.nativeID).toBe('row-title');
    });

    it("also registers the hint under the consumer's testID, so iOS's accessibilityIdentifier lookup still resolves it", () => {
      const child = createElement('View', { testID: 'checkout-button' });
      Hint({ id: 'row-title', radius: 12, children: child });

      expect(snapshotHintEntries()).toEqual([
        { nodeId: 'row-title', radius: 12 },
        { nodeId: 'checkout-button', radius: 12 },
      ]);
    });

    it('registers exactly one entry (no alias) when the hint id and the consumer testID are the same string', () => {
      const child = createElement('View', { testID: 'row-title' });
      Hint({ id: 'row-title', radius: 12, children: child });

      expect(snapshotHintEntries()).toEqual([{ nodeId: 'row-title', radius: 12 }]);
    });

    it('falls through to stamping the hint id when the child set no testID', () => {
      const child = createElement('View');
      const result = Hint({ id: 'row-title', children: child }) as unknown as ClonedElement;

      expect(result.props.testID).toBe('row-title');
      expect(snapshotHintEntries()).toEqual([{ nodeId: 'row-title' }]);
    });

    it('treats an explicitly-undefined testID as unset', () => {
      const child = createElement('View', { testID: undefined });
      const result = Hint({ id: 'row-title', children: child }) as unknown as ClonedElement;

      expect(result.props.testID).toBe('row-title');
    });
  });

  describe('dev-build conflict warning (mirrors core/metrics.ts\'s format/emit split)', () => {
    it('warns naming the hint id, the consumer testID and the element', () => {
      const child = createElement('View', { testID: 'checkout-button' });
      Hint({ id: 'row-title', children: child });

      expect(warnSpy).toHaveBeenCalledTimes(1);
      const message = String(warnSpy.mock.calls[0]?.[0]);
      expect(message).toContain('[autoskeleton]');
      expect(message).toContain('row-title');
      expect(message).toContain('checkout-button');
      expect(message).toContain('View');
    });

    it('warns ONCE for the same conflict, not once per render', () => {
      const child = createElement('View', { testID: 'checkout-button' });
      Hint({ id: 'row-title', children: child });
      Hint({ id: 'row-title', children: child });
      Hint({ id: 'row-title', children: child });

      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it('warns again for a genuinely different conflict', () => {
      Hint({ id: 'row-title', children: createElement('View', { testID: 'checkout-button' }) });
      Hint({ id: 'row-title', children: createElement('View', { testID: 'cart-button' }) });

      expect(warnSpy).toHaveBeenCalledTimes(2);
    });

    it('stays silent when the child set no testID', () => {
      Hint({ id: 'row-title', children: createElement('View') });

      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('stays silent when the consumer testID already equals the hint id', () => {
      Hint({ id: 'row-title', children: createElement('View', { testID: 'row-title' }) });

      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('names a composite child by its displayName rather than a useless "[object Object]"', () => {
      function Avatar(): null {
        return null;
      }
      Avatar.displayName = 'Avatar';
      Hint({ id: 'row-title', children: createElement(Avatar, { testID: 'checkout-button' }) });

      expect(String(warnSpy.mock.calls[0]?.[0])).toContain('<Avatar>');
    });

    it('formatHintTestIdConflictWarning is a pure formatter (core/metrics.ts convention)', () => {
      const message = formatHintTestIdConflictWarning('row-title', 'checkout-button', '<View>');

      expect(message).toContain('[autoskeleton]');
      expect(message).toContain('id="row-title"');
      expect(message).toContain('testID="checkout-button"');
      expect(message).toContain('<View>');
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  it('throws (React.Children.only contract) when given zero or multiple children', () => {
    expect(() => Hint({ id: 'x', children: [] })).toThrow();
    expect(() => Hint({ id: 'x', children: [createElement('View'), createElement('View')] })).toThrow();
  });
});
