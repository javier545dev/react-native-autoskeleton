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
import { afterEach, describe, expect, it } from 'vitest';
import { clearHintRegistry, snapshotHintEntries } from '../../src/core/hint-registry';
import { Hint } from '../../src/native/Hint';

interface ClonedElement {
  readonly type: unknown;
  readonly props: Record<string, unknown>;
}

describe('Hint (native) — typed-hint channel (src/native/Hint.tsx)', () => {
  afterEach(() => {
    clearHintRegistry();
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

  it('overwrites a nativeID/testID the child already set (same documented constraint as Ignore)', () => {
    const child = createElement('View', { nativeID: 'consumer-id', testID: 'consumer-test-id' });
    const result = Hint({ id: 'row-title', lines: 1, children: child }) as unknown as ClonedElement;

    expect(result.props.nativeID).toBe('row-title');
    expect(result.props.testID).toBe('row-title');
  });

  it('throws (React.Children.only contract) when given zero or multiple children', () => {
    expect(() => Hint({ id: 'x', children: [] })).toThrow();
    expect(() => Hint({ id: 'x', children: [createElement('View'), createElement('View')] })).toThrow();
  });
});
