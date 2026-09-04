// src/web/ssr/neutral-block.tsx
//
// tasks.md 8.3 / ADR-12: the uncaptured-`skeletonKey` fallback (spec §1.8
// scenario: "the server renders a defined neutral generic block for that
// key... the client renders the identical neutral generic block before any
// client-side traversal... no hydration mismatch occurs, because server and
// client rendered the same fallback"). A plain, deterministic function
// component with ZERO props and ZERO hooks — the simplest possible way to
// guarantee byte-identical server/client output: there is no data it could
// diverge on.

import type { ReactElement } from 'react';
import { NEUTRAL_SKELETON_HEIGHT_PX, NEUTRAL_SKELETON_RADIUS_PX } from './neutral-geometry';
import { SR_ONLY_STYLE } from './sr-only-style';

// Re-exported for backwards compatibility: the constant moved to
// `neutral-geometry.ts` so `cli/media-bundle.ts` can emit the SAME dimensions
// for its drift-fallback rule without pulling React into the CLI bundle.
export { NEUTRAL_SKELETON_HEIGHT_PX, NEUTRAL_SKELETON_RADIUS_PX };

/** The ADR-12 neutral generic block. Deliberately NOT shape-replay geometry
 *  (no captured frame exists for an uncaptured key) — a single full-width
 *  rounded rectangle, styled entirely by the base shimmer stylesheet
 *  (`css-renderer.ts`'s `.askl-overlay`/`.askl-shimmer-layer` classes,
 *  reused — never a second animation implementation) plus one inline
 *  `border-radius`/height pair, which is itself a pure function of nothing
 *  (a hard-coded constant), keeping this component pure. */
export function NeutralSkeletonBlock(): ReactElement {
  return (
    <div
      aria-busy="true"
      role="status"
      data-autoskeleton-ignore="true"
      data-askl-ssr-neutral="true"
      className="askl-overlay askl-anim-shimmer"
      style={{
        position: 'relative',
        height: NEUTRAL_SKELETON_HEIGHT_PX,
        borderRadius: NEUTRAL_SKELETON_RADIUS_PX,
        overflow: 'hidden',
      }}
    >
      <div className="askl-shimmer-layer" />
      <span style={SR_ONLY_STYLE}>Loading</span>
    </div>
  );
}
