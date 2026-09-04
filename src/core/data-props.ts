// src/core/data-props.ts
//
// The `data` / children-as-function / `fallback` prop contract, shared by
// `web/AutoSkeleton.tsx` and `native/AutoSkeleton.tsx`. Same precedent as
// `core/refresh-gate.ts`: the two components already agree on the WORDS of a
// rule, so the rule itself lives in one testable place rather than as two
// near-identical inline expressions that drift.
//
// THE DEFECT THIS EXISTS TO FIX. The documented pattern used to be:
//
//     <AutoSkeleton isLoading={product === null} skeletonKey="product-card">
//       {product !== null && <ProductContent product={product} />}
//     </AutoSkeleton>
//
// One fact — "the product has not arrived" — stated twice, inverted, because
// `ProductContent` cannot take `null`. That is not merely verbose:
//
//   1. The two conditions can drift out of sync, and nothing catches it.
//   2. While loading, `children` is `false`. There is therefore NOTHING in
//      the subtree for the sensor to measure AND nothing to paint. The cold
//      traversal (`useColdMeasurement` in both components) only ever runs
//      WHILE the skeleton is up, and it measures the wrapper's children — so
//      for strictly conditional children it measures an empty subtree on
//      every loading cycle and stores an EMPTY snapshot, permanently once the
//      `MAX_EMPTY_MEASUREMENTS` re-measure budget in `core/snapshot.ts` runs
//      out. An empty snapshot paints zero shapes. The reader sees blank
//      space, not a skeleton, and never stops seeing it.
//
// `data` fixes (1) by making the condition a value instead of a predicate,
// and the caller-narrowing function child removes the second, inverted copy.
// `fallback` fixes (2): it is the only thing this library can put on screen
// while the subtree it is supposed to measure is, by construction, not there.
// Note what this implies for the fallback's render gate, and why both
// components spell it `snapshot === null || isEmptySnapshot(snapshot)`: "no
// snapshot" is the wrong test, because after the first cycle there IS one —
// it is simply empty.
//
// Deliberately React-free (`TNode` is a type parameter, not `ReactNode`), so
// `src/core/` keeps its zero-platform-import property (ADR-4) and stays
// unit-testable under the plain Vitest `node` environment.

/** Children in the `data` form: either an ordinary node (unchanged
 *  behaviour) or a function invoked ONLY when `data` is non-nullish, with
 *  the narrowed value. `NonNullable<T>` is the whole point of the form — the
 *  caller gets `Product`, never `Product | null`, without restating the
 *  condition. */
export type SkeletonDataChildren<T, TNode> = TNode | ((value: NonNullable<T>) => TNode);

/** The discriminated union that makes "you must say how loading is decided"
 *  a COMPILE error rather than a silent always-loaded component.
 *
 *  - First member: the explicit `isLoading` escape hatch. `data` is pinned to
 *    `undefined` so this member cannot swallow a `data` prop that the second
 *    member should type; a function child is rejected here because there
 *    would be no value to hand it.
 *  - Second member: the `data` form. `isLoading` stays optional, which is
 *    what makes passing BOTH legal (explicit wins at runtime — see
 *    `isLoadingFromProps`).
 *
 *  Neither member is satisfied by `{ skeletonKey }` alone, so omitting both
 *  props fails to typecheck. That is the one requirement a plain
 *  `isLoading?: boolean` could not express. */
export type SkeletonLoadingSource<T, TNode> =
  | {
      readonly isLoading: boolean;
      readonly data?: undefined;
      readonly children?: TNode;
    }
  | {
      readonly isLoading?: boolean;
      readonly data: T;
      readonly children?: SkeletonDataChildren<T, TNode>;
    };

/** Loading is `isLoading` when that prop was provided, otherwise `data == null`.
 *
 *  `== null` — loose on purpose, the one place in this codebase where that is
 *  the correct operator — is EXACTLY nullish: `null` and `undefined` and
 *  nothing else. `0`, `''`, `false` and `NaN` are ordinary loaded values. A
 *  truthiness test here would make `<AutoSkeleton data={cartItemCount}>` hang
 *  on a skeleton forever the moment the cart is empty, which is the single
 *  rule a reader of this API can most easily get wrong.
 *
 *  Explicit always wins, because `data` cannot express every loading state:
 *  an `isFetching` flag from a data library, a state derived from several
 *  sources, or a skeleton shown deliberately. Passing both is legal and
 *  discouraged — the `data` value then decides only what the function child
 *  receives, never whether the skeleton shows. */
export function isLoadingFromProps(isLoading: boolean | undefined, data: unknown): boolean {
  return isLoading === undefined ? data == null : isLoading;
}

/** Resolves the children a component should actually render.
 *
 *  `typeof children === 'function'` is a safe discriminator: a function is
 *  not a valid `ReactNode`, so no existing call site can reach the function
 *  branch. With a non-function child this returns the SAME reference it was
 *  given — which is what makes the whole change additive, because every
 *  existing call site renders a value identical by reference to `children`.
 *
 *  A function child with nullish `data` renders nothing at all. That is not a
 *  new hole, it is the pre-existing one made honest and visible: the old
 *  `{product !== null && …}` pattern also rendered nothing while loading.
 *  `fallback` is what fills it. */
export function resolveSkeletonChildren<T, TNode>(
  children: SkeletonDataChildren<T, TNode> | undefined,
  data: T | undefined,
): TNode | undefined {
  if (typeof children !== 'function') {
    return children;
  }
  const render = children as (value: NonNullable<T>) => TNode;
  return data == null ? undefined : render(data as NonNullable<T>);
}
