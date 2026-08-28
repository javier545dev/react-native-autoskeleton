// test/native/ignore.test.ts
//
// `<AutoSkeleton.Ignore>` bug fix — the native marker-channel unit coverage.
// Needs no `react-native` mock at all: `Ignore` (`src/native/Ignore.tsx`)
// depends only on `react`'s `Children`/`cloneElement`, and this suite
// exercises it as a plain function against synthetic elements built with
// `createElement('View', ...)` (a string host-component tag needs no
// `react-native` import to construct or inspect).
//
// The on-device visual paint gate
// (`examples/bare-rn/android/.../PaintGateInstrumentedTest.kt`,
// `examples/bare-rn/ios/.../PaintGateUITests.swift`) is the real proof this
// fix works end to end on both platforms; this suite proves the JS-side
// mechanism in isolation — that `Ignore` actually stamps the sentinel onto
// the child, on both prop channels, and enforces its documented API
// constraint.

import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { AUTOSKELETON_IGNORE_MARKER_ID, Ignore } from '../../src/native/Ignore';

interface ClonedElement {
  readonly type: unknown;
  readonly props: Record<string, unknown>;
}

describe('Ignore (native) — sentinel marker channel (src/native/Ignore.tsx)', () => {
  it('clones the single child, stamping BOTH nativeID and testID with the marker', () => {
    const child = createElement('View', { foo: 'bar' });
    const result = Ignore({ children: child }) as unknown as ClonedElement;

    expect(result.type).toBe('View');
    expect(result.props.nativeID).toBe(AUTOSKELETON_IGNORE_MARKER_ID);
    expect(result.props.testID).toBe(AUTOSKELETON_IGNORE_MARKER_ID);
    // Other props on the child survive the clone untouched.
    expect(result.props.foo).toBe('bar');
  });

  it('overwrites a nativeID/testID the child already set (documented API constraint)', () => {
    const child = createElement('View', { nativeID: 'consumer-id', testID: 'consumer-test-id' });
    const result = Ignore({ children: child }) as unknown as ClonedElement;

    expect(result.props.nativeID).toBe(AUTOSKELETON_IGNORE_MARKER_ID);
    expect(result.props.testID).toBe(AUTOSKELETON_IGNORE_MARKER_ID);
  });

  it('never returns a bare pass-through fragment (the exact prior bug)', () => {
    const child = createElement('View', { accessibilityLabel: 'known-content' });
    const result = Ignore({ children: child }) as unknown as ClonedElement;

    // A Fragment's `type` is the `react.fragment` symbol, never a host tag —
    // asserting a concrete `View`-typed clone rules out the prior
    // `return <>{props.children}</>` pass-through implementation.
    expect(result.type).toBe('View');
  });

  it('throws (React.Children.only contract) when given zero or multiple children', () => {
    expect(() => Ignore({ children: [] })).toThrow();
    expect(() => Ignore({ children: [createElement('View'), createElement('View')] })).toThrow();
  });
});
