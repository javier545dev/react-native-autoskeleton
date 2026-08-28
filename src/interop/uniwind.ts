// src/interop/uniwind.ts
//
// tasks.md 7.2 (spec REQ-THEME-2/3): optional `autoskeleton/uniwind` subpath
// export. Wraps the native `<AutoSkeleton>` (task 5.5, extended by 7.2 with
// `shimmerBaseColor`/`shimmerHighlightColor`/`defaultRadius` per-instance
// override props) with uniwind's REAL manual-mapping `withUniwind(Component,
// options)` API — verified directly against the installed `uniwind@1.11.0`
// package (`node_modules/uniwind/dist/module/hoc/types.d.ts`), not assumed
// from the product brief. `uniwind` (uni-stack/uniwind) is a COMPETING
// project from the Unistyles team, not NativeWind's engine — confirmed via
// this repo's own ecosystem research; the two interops in this directory are
// independent, unrelated integrations, not two faces of the same library.
//
// Never imported by any default entry (`src/index*.ts`) — see tasks.md 7.4's
// packaging assertion (`test/packaging/interop-exports.test.ts`). `uniwind`
// is an OPTIONAL peer dependency (package.json `peerDependenciesMeta`): a
// consumer who never imports this subpath never needs it installed at all.
//
// REQ-THEME-3: this module operates purely at the React props layer,
// upstream of `<AutoSkeleton>`'s own render path — `src/core/` is never
// imported here and never sees a className string (statically asserted by
// `test/packaging/core-styling-agnostic.test.ts`, tasks.md 7.2).

import { withUniwind } from 'uniwind';
import { AutoSkeleton } from '../native/AutoSkeleton';
import type { AutoSkeletonProps } from '../native/AutoSkeleton';

/** `<AutoSkeleton>` wrapped so a SINGLE `className` prop resolves
 *  `backgroundColor` -> `shimmerBaseColor`, `color` -> `shimmerHighlightColor`
 *  and `borderRadius` -> `defaultRadius` (REQ-THEME-2's exact mapping). A
 *  consumer writes `<ThemedAutoSkeleton className="bg-slate-200 rounded-lg"
 *  isLoading={...} skeletonKey={...} />` and supplies no other
 *  skeleton-specific styling prop — `withUniwind`'s manual-mapping form
 *  (the `options` argument) is what lets three DIFFERENT resolved style
 *  properties all read from that one `className`, rather than each needing
 *  its own separately-named className prop. */
export const ThemedAutoSkeleton = withUniwind(AutoSkeleton, {
  shimmerBaseColor: { fromClassName: 'className', styleProperty: 'backgroundColor' },
  shimmerHighlightColor: { fromClassName: 'className', styleProperty: 'color' },
  defaultRadius: { fromClassName: 'className', styleProperty: 'borderRadius' },
});

export type { AutoSkeletonProps };
