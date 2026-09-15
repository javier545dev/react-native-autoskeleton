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

import { createElement, forwardRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTOSKELETON_IGNORE_MARKER_ID,
  formatIgnoreCompositeChildWarning,
  Ignore,
  ignoreMarkerMayNotReachHost,
} from '../../src/native/Ignore';

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

// The silent no-op this warning exists to surface, and the reason it is a
// heuristic rather than a fact.
//
// `cloneElement` sets props on the element it is handed. On a host component
// they land on the view; on a plain function or class component they are just
// props, and unless that component forwards them the marker never reaches a
// native view — the subtree is measured anyway and the skeleton covers content
// the consumer asked to exclude. Nothing fails: `Children.only` is satisfied,
// the clone succeeds, and the only symptom is a skeleton that is too big.
//
// It was found by writing the demo, not by reading the code:
// `examples/bare-rn/demos/IgnoreDemo.tsx` says so in its own header — the file
// first wrapped `<LiveClock />` and "did not work".
//
// The predicate cannot be exact. React Native's `View`/`Text`/`Image` are
// `forwardRef` OBJECTS, not strings, so "warn unless the type is a string"
// would fire on the most common correct usage. Warning on plain
// functions/classes is the closest safe rule, and it over-warns on a component
// that spreads `{...props}` onto a host view. The accurate alternative — attach
// a ref, check after mount — was rejected: it overwrites the consumer's own ref
// on React 18, and breaking working code for a dev warning is the wrong trade.
describe('Ignore (native) — composite-child warning', () => {
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

  beforeEach(() => {
    warnSpy.mockClear();
  });

  it('warns when the child is a plain function component', () => {
    function LiveClock(): null {
      return null;
    }
    Ignore({ children: createElement(LiveClock, {}) });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain('<LiveClock>');
  });

  it('does NOT warn for a host element, which is the correct usage', () => {
    Ignore({ children: createElement('View', {}) });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('does NOT warn for a forwardRef, which is what View and Text actually are', () => {
    // Checked rather than assumed: `react-native`'s View is
    // `React.forwardRef(...)`, so a naive `typeof type === 'string'` rule would
    // warn on every correct call. This is the case that rule got wrong.
    const ForwardedView = forwardRef<unknown, Record<string, unknown>>(() => null);
    Ignore({ children: createElement(ForwardedView, {}) });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('warns once per distinct child, not once per render', () => {
    function Badge(): null {
      return null;
    }
    Ignore({ children: createElement(Badge, {}) });
    Ignore({ children: createElement(Badge, {}) });
    Ignore({ children: createElement(Badge, {}) });
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('ignoreMarkerMayNotReachHost is a pure predicate', () => {
    expect(ignoreMarkerMayNotReachHost('View')).toBe(false);
    expect(ignoreMarkerMayNotReachHost(function C() { return null; })).toBe(true);
    expect(ignoreMarkerMayNotReachHost({ $$typeof: Symbol.for('react.forward_ref') })).toBe(false);
  });

  it('the message names the escape hatch, and hedges instead of accusing', () => {
    const msg = formatIgnoreCompositeChildWarning('<LiveClock>');
    // The way out, not just the diagnosis.
    expect(msg).toContain('<View>');
    // The predicate is a heuristic and over-warns on a component that spreads
    // its props, so the text has to leave that door open. A warning that
    // asserts a defect on correct code is how developers learn to ignore
    // warnings.
    expect(msg).toContain('only if');
    expect(msg).toContain('ignore this');
  });
});
