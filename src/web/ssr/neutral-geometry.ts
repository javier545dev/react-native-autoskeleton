// src/web/ssr/neutral-geometry.ts
//
// The ADR-12 neutral block's geometry, extracted from `neutral-block.tsx` so
// the BUILD-TIME CSS generator (`cli/media-bundle.ts`) can emit the exact same
// dimensions for its drift-fallback rule without importing a `.tsx` module
// (which would drag React and JSX into the CLI's esbuild graph for two
// numbers).
//
// These two constants are the definition of "degrades to the neutral block":
// whether a page reaches it because a `skeletonKey` was never captured
// (`AutoSkeletonSSR`'s own branch) or because `manifest.json` and `bundle.css`
// drifted apart (the CSS fallback rule), it must LOOK the same. Duplicating
// the numbers in the generator is how those two paths would quietly diverge.

/** Height of the neutral generic block, in CSS pixels. */
export const NEUTRAL_SKELETON_HEIGHT_PX = 80;

/** Corner radius of the neutral generic block, in CSS pixels. */
export const NEUTRAL_SKELETON_RADIUS_PX = 8;
