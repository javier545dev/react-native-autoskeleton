// src/native/renderer/wireProp.ts
//
// The wire buffer, shaped for the `shapes` prop on `AutoskeletonOverlayView`.
//
// The overlay used to receive only `cacheKey` and resolve geometry against
// `AutoskeletonNativeShapeCache[cacheKey]` (ADR-9). That cache held a second
// copy of a buffer JS already had — `native/sensor.ts` decodes the very same
// `getShapes` payload to populate the JS store — kept alive by a key and
// evicted by nothing, since `evictNativeShapes` had no call site anywhere in
// `src/`. Passing the buffer is what let the whole native cache go.
//
// `Array.from` is required, not incidental: codegen types this prop as
// `ReadonlyArray<Double>` and a `Float32Array` does not cross as one. It is
// memoized per snapshot because a fresh array on every render would re-send
// the prop across the bridge each time, which is the cost this whole path
// exists to avoid.
import { useMemo } from 'react';

import type { ShapeSnapshot } from '../../core/types';

/** Shared so an absent snapshot is always the SAME empty array: a new `[]`
 *  per render would defeat the memoization above for the commonest case. */
const NO_SHAPES: readonly number[] = [];

export function wireOf(snapshot: ShapeSnapshot | null | undefined): readonly number[] {
  return snapshot ? Array.from(snapshot.data) : NO_SHAPES;
}

export function useWireProp(snapshot: ShapeSnapshot | null | undefined): readonly number[] {
  return useMemo(() => wireOf(snapshot), [snapshot]);
}
