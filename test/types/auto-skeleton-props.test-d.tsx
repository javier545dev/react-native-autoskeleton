// test/types/auto-skeleton-props.test-d.tsx
//
// COMPILE-TIME assertions for `<AutoSkeleton>`'s prop union. There is no
// runtime here and there is not meant to be: the whole contract under test is
// erased before anything executes, so the only instrument that can observe it
// is the compiler. `npx tsc --noEmit` at the repo root IS this file's test
// runner — the root `tsconfig.json` has no `include`, so `test/types/` is in
// scope, while neither Vitest's `include` globs nor `tsconfig.build.json`'s
// `["src", "cli"]` ever reach it.
//
// `@ts-expect-error` is the assertion: it FAILS the build if the error it
// marks ever stops happening. That is what makes "you must provide one of
// `isLoading` / `data`" a real, enforced requirement rather than a sentence in
// a doc comment.
//
// Both platforms are checked in one file, deliberately. This library's whole
// proposition is one API everywhere, so the strongest form of that claim is
// the same block of assertions passing against `src/web` and `src/native`
// side by side.

import type { ReactNode } from 'react';
import { AutoSkeleton as NativeAutoSkeleton } from '../../src/native/AutoSkeleton';
import type { AutoSkeletonProps as NativeAutoSkeletonProps } from '../../src/native/AutoSkeleton';
import { AutoSkeleton as WebAutoSkeleton } from '../../src/web/AutoSkeleton';
import type { AutoSkeletonProps as WebAutoSkeletonProps } from '../../src/web/AutoSkeleton';

interface Product {
  readonly name: string;
}

declare const product: Product | null;
declare const maybeProduct: Product | undefined;
declare const count: number;
declare function ProductContent(props: { readonly product: Product }): React.JSX.Element;

/** Nothing here is rendered; the assertions are the type-checking of the
 *  expressions themselves. Exported so `noUnusedLocals` stays satisfied
 *  without a suppression. */
export const webAssertions: readonly ReactNode[] = [
  // --- The `data` form -----------------------------------------------------

  // A function child receives the NARROWED value. `const narrowed: Product`
  // would not compile if the parameter were `Product | null`, which is the
  // entire point of the form: the caller never restates the condition.
  <WebAutoSkeleton skeletonKey="product-card" data={product}>
    {(value) => {
      const narrowed: Product = value;
      return <ProductContent product={narrowed} />;
    }}
  </WebAutoSkeleton>,

  // `undefined` narrows the same way as `null`.
  <WebAutoSkeleton skeletonKey="product-card" data={maybeProduct}>
    {(value) => {
      const narrowed: Product = value;
      return <ProductContent product={narrowed} />;
    }}
  </WebAutoSkeleton>,

  // A plain ReactNode child is still allowed in the `data` form.
  <WebAutoSkeleton skeletonKey="product-card" data={product}>
    <span />
  </WebAutoSkeleton>,

  // Falsy-but-present data is an ordinary value, and the child gets `number`.
  <WebAutoSkeleton skeletonKey="cart" data={count}>
    {(n) => <span>{n.toFixed(0)}</span>}
  </WebAutoSkeleton>,

  // No consumer should ever have to write `<AutoSkeleton<Product> …>`. Every
  // assertion above relies on inference alone; this one states it explicitly.
  <WebAutoSkeleton<Product | null> skeletonKey="explicit" data={product}>
    {(value) => <ProductContent product={value} />}
  </WebAutoSkeleton>,

  // --- The `isLoading` escape hatch (every pre-existing call site) ----------

  <WebAutoSkeleton isLoading={product === null} skeletonKey="product-card">
    {product !== null && <ProductContent product={product} />}
  </WebAutoSkeleton>,

  // Both together is legal — explicit wins at runtime.
  <WebAutoSkeleton isLoading skeletonKey="product-card" data={product}>
    {(value) => <ProductContent product={value} />}
  </WebAutoSkeleton>,

  // `fallback` is available in both forms.
  <WebAutoSkeleton isLoading skeletonKey="a" fallback={<span />} />,
  <WebAutoSkeleton skeletonKey="b" data={product} fallback={<span />} />,

  // --- Rejections ----------------------------------------------------------

  // THE requirement: neither prop must not compile. Without this, a component
  // with no loading source at all would silently render as permanently
  // loaded — the failure mode the union exists to make impossible.
  // @ts-expect-error one of `isLoading` or `data` is required
  <WebAutoSkeleton skeletonKey="no-loading-source">
    <span />
  </WebAutoSkeleton>,

  // A function child with no `data` has nothing to be handed, so it is
  // rejected rather than silently never invoked.
  // Kept on ONE line on purpose: with multi-line children TypeScript reports
  // this mismatch against the children expression, several lines below, and a
  // `@ts-expect-error` only suppresses the line it precedes.
  // @ts-expect-error a function child requires `data`
  <WebAutoSkeleton isLoading skeletonKey="fn-child-no-data">{(v: Product) => <ProductContent product={v} />}</WebAutoSkeleton>,
];

export const nativeAssertions: readonly ReactNode[] = [
  <NativeAutoSkeleton skeletonKey="product-card" data={product}>
    {(value) => {
      const narrowed: Product = value;
      return <ProductContent product={narrowed} />;
    }}
  </NativeAutoSkeleton>,

  <NativeAutoSkeleton skeletonKey="product-card" data={product}>
    <ProductContent product={{ name: 'placeholder' }} />
  </NativeAutoSkeleton>,

  <NativeAutoSkeleton isLoading={product === null} skeletonKey="product-card">
    {product !== null && <ProductContent product={product} />}
  </NativeAutoSkeleton>,

  <NativeAutoSkeleton skeletonKey="b" data={product} fallback={<ProductContent product={{ name: 'x' }} />} />,

  // Same requirement, same rejection, on the other platform — the assertion
  // that the two APIs really are one.
  // @ts-expect-error one of `isLoading` or `data` is required
  <NativeAutoSkeleton skeletonKey="no-loading-source" />,

  // @ts-expect-error a function child requires `data`
  <NativeAutoSkeleton isLoading skeletonKey="fn-child-no-data">{(v: Product) => <ProductContent product={v} />}</NativeAutoSkeleton>,
];

/** The exported prop TYPES stay nameable with no type argument — a consumer
 *  writing `const props: AutoSkeletonProps = …` (or wrapping the component)
 *  never has to think about the generic. */
export const webPropsValue: WebAutoSkeletonProps = { skeletonKey: 'x', isLoading: true };
export const nativePropsValue: NativeAutoSkeletonProps = { skeletonKey: 'x', isLoading: true };
export const webDataPropsValue: WebAutoSkeletonProps<Product | null> = { skeletonKey: 'x', data: product };
export const nativeDataPropsValue: NativeAutoSkeletonProps<Product | null> = { skeletonKey: 'x', data: product };

// @ts-expect-error the exported type carries the requirement too, not just JSX
export const rejectedPropsValue: WebAutoSkeletonProps = { skeletonKey: 'x' };
