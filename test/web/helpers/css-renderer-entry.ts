// test/web/helpers/css-renderer-entry.ts
//
// esbuild entry for test/web/css-renderer.spec.ts (task 2.2). Attaches the
// REAL production `createCssRenderer`/`createShimmerClock` plus the small
// amount of core surface a test needs to build a `ShapeSnapshot` and
// `RenderProps` to `window.Autoskeleton`.

import { createCssRenderer, createShimmerClock, buildShimmerStylesheet } from '../../../src/web/css-renderer';
import { encodeWire } from '../../../src/core/wire';
import { WIRE_VERSION } from '../../../src/core/types';
import { composeCacheKey } from '../../../src/core/cache-key';

window.Autoskeleton = {
  createCssRenderer,
  createShimmerClock,
  buildShimmerStylesheet,
  encodeWire,
  WIRE_VERSION,
  composeCacheKey,
};
