// src/core/data-props.test.ts
//
// The `data` / function-child contract, tested where it actually lives.
// Both `<AutoSkeleton>` components call exactly these two functions, in this
// order, so a rule proven here is proven for web and native at once — the
// same reason `refresh-gate.test.ts` exists rather than two component tests
// asserting the same predicate twice.
//
// The DOM-level consequences (`fallback` appearing on a cold miss, never over
// a cached snapshot, and nothing at all when the prop is omitted) are not
// assertable here: they need real layout, so they live in
// `test/web/data-fallback.spec.ts` under Playwright, per plan.md §7.3's ban
// on jsdom for anything that reads geometry.

import { describe, expect, it } from 'vitest';
import { isLoadingFromProps, resolveSkeletonChildren } from './data-props';

describe('isLoadingFromProps — nullish means loading, nothing else does', () => {
  it('treats null and undefined data as loading', () => {
    expect(isLoadingFromProps(undefined, null)).toBe(true);
    expect(isLoadingFromProps(undefined, undefined)).toBe(true);
  });

  // The one rule a reader of this API can most easily get wrong, and the
  // reason `isLoadingFromProps` uses `== null` rather than a truthiness test:
  // `<AutoSkeleton data={cartItemCount}>` must not sit on a skeleton forever
  // the moment the cart is empty.
  it('treats every falsy-but-present value as loaded', () => {
    expect(isLoadingFromProps(undefined, 0)).toBe(false);
    expect(isLoadingFromProps(undefined, '')).toBe(false);
    expect(isLoadingFromProps(undefined, false)).toBe(false);
    expect(isLoadingFromProps(undefined, Number.NaN)).toBe(false);
  });

  it('treats ordinary values as loaded', () => {
    expect(isLoadingFromProps(undefined, { name: 'widget' })).toBe(false);
    expect(isLoadingFromProps(undefined, [])).toBe(false);
  });

  it('lets an explicit isLoading win over data, in both directions', () => {
    // The escape hatch: an `isFetching` flag while the previous data is still
    // in hand.
    expect(isLoadingFromProps(true, { name: 'widget' })).toBe(true);
    // And the inverse: data has not arrived, but the caller says the load is
    // done (an empty result modelled as null, say).
    expect(isLoadingFromProps(false, null)).toBe(false);
  });

  it('is exactly today behaviour when only isLoading is given', () => {
    expect(isLoadingFromProps(true, undefined)).toBe(true);
    expect(isLoadingFromProps(false, undefined)).toBe(false);
  });
});

describe('resolveSkeletonChildren', () => {
  it('returns a non-function child by reference, unchanged', () => {
    // This identity is what makes the whole change additive: every call site
    // that predates it renders the very same node object it did before.
    const node = { kind: 'element' };
    expect(resolveSkeletonChildren<never, typeof node>(node, undefined)).toBe(node);
  });

  it('passes undefined children through', () => {
    expect(resolveSkeletonChildren<never, string>(undefined, undefined)).toBeUndefined();
  });

  it('invokes a function child with the non-nullish value', () => {
    const seen: unknown[] = [];
    const result = resolveSkeletonChildren<{ name: string }, string>(
      (value) => {
        seen.push(value);
        return value.name;
      },
      { name: 'widget' },
    );
    expect(result).toBe('widget');
    expect(seen).toEqual([{ name: 'widget' }]);
  });

  it('does NOT invoke a function child while data is nullish', () => {
    let calls = 0;
    const render = (): string => {
      calls += 1;
      return 'never';
    };
    expect(resolveSkeletonChildren<string | null, string>(render, null)).toBeUndefined();
    expect(resolveSkeletonChildren<string, string>(render, undefined)).toBeUndefined();
    expect(calls).toBe(0);
  });

  it('DOES invoke a function child for falsy-but-present data', () => {
    // Same nullish-only rule as `isLoadingFromProps`, and it has to be the
    // same one: a component that considered `0` loaded but refused to hand it
    // to the child would render a blank box with no skeleton over it.
    expect(resolveSkeletonChildren<number, string>((n) => `#${n}`, 0)).toBe('#0');
    expect(resolveSkeletonChildren<string, string>((s) => `[${s}]`, '')).toBe('[]');
    expect(resolveSkeletonChildren<boolean, string>((b) => String(b), false)).toBe('false');
  });

  it('invokes the function child even when isLoading was also passed', () => {
    // Precedence is split on purpose: `isLoading` decides whether the
    // skeleton shows, `data` decides what the child receives. The component
    // asks these two functions separately for exactly that reason.
    expect(isLoadingFromProps(true, { name: 'widget' })).toBe(true);
    expect(resolveSkeletonChildren<{ name: string }, string>((v) => v.name, { name: 'widget' })).toBe('widget');
  });
});
