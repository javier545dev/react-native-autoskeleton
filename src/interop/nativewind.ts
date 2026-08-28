// src/interop/nativewind.ts
//
// tasks.md 7.3 (spec REQ-THEME-2/3): optional `autoskeleton/nativewind`
// subpath export. Wraps the native `<AutoSkeleton>` with NativeWind's REAL
// `cssInterop(Component, mapping)` API (re-exported by `nativewind` from
// `react-native-css-interop` — verified against the installed
// `nativewind@4.2.6` / `react-native-css-interop@0.2.6` packages, not
// assumed). Current, stable NativeWind v4 API; the unreleased v5 deprecates
// `cssInterop` in favor of a unified `styled` API — a documented future
// migration risk (plan.md), not a v1 blocker.
//
// The "NativeWind doesn't work in Expo Go" claim floating in the ecosystem
// traces to NativewindUI, a SEPARATE third-party component kit — NativeWind
// core itself (what this file integrates with) has zero native code of its
// own. Confirmed via this repo's own ecosystem research.
//
// Never imported by any default entry (`src/index*.ts`) — see tasks.md 7.4's
// packaging assertion (`test/packaging/interop-exports.test.ts`). NativeWind
// is an OPTIONAL peer dependency (package.json `peerDependenciesMeta`).
//
// REQ-THEME-3: this module operates purely at the React props layer,
// upstream of `<AutoSkeleton>`'s own render path — `src/core/` is never
// imported here and never sees a className string (statically asserted by
// `test/packaging/core-styling-agnostic.test.ts`, tasks.md 7.2).

import { cssInterop } from 'nativewind';
import { AutoSkeleton } from '../native/AutoSkeleton';
import type { AutoSkeletonProps } from '../native/AutoSkeleton';

/** `<AutoSkeleton>` wrapped so a SINGLE `className` prop resolves
 *  `backgroundColor` -> `shimmerBaseColor`, `color` -> `shimmerHighlightColor`
 *  and `borderRadius` -> `defaultRadius` — the exact same REQ-THEME-2 mapping
 *  `src/interop/uniwind.ts` implements against uniwind's own API. `target:
 *  false` tells `cssInterop` not to produce a `style` prop at all; instead
 *  `nativeStyleToProp` redirects each individually resolved style property
 *  straight onto the named skeleton prop. */
export const ThemedAutoSkeleton = cssInterop(AutoSkeleton, {
  className: {
    target: false,
    nativeStyleToProp: {
      backgroundColor: 'shimmerBaseColor',
      color: 'shimmerHighlightColor',
      borderRadius: 'defaultRadius',
    },
  },
});

export type { AutoSkeletonProps };
