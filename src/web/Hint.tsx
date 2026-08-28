// src/web/Hint.tsx
//
// `<AutoSkeleton.Hint>` — the web half of the typed-hint channel (spec
// §1.9/§8, plan.md ADR-2 R0). Added 2026-08-28, after NFR-6 was revised a
// SECOND time (8 kB -> 9 kB, spec.md NFR-6) specifically to buy this back:
// web previously had NO `<AutoSkeleton.Hint>` at all, only a raw
// `data-autoskeleton-radius` JSX attribute a consumer set by hand
// (`dom-sensor.ts`'s `HINT_RADIUS_ATTRIBUTE`). That asymmetry was a direct
// consequence of the FIRST NFR-6 measurement: reusing native's id+registry
// mechanism (`core/hint-registry.ts`) here pushed the bundle to 8390 B
// against an 8192 B budget. The maintainer's judgment: a per-platform API
// divergence is a worse outcome than ~250 bytes for a library whose entire
// proposition is "one package, all platforms" — so the budget moved instead
// of the API.
//
// MECHANISM, deliberately NOT the id+registry one: this component does not
// import `core/hint-registry.ts` at all. It clones the single element child
// (`React.Children.only` + `cloneElement`, exactly `src/native/Hint.tsx`'s
// ergonomics — hookless, plain function, directly callable/testable without
// a React renderer) and stamps the SAME self-sufficient `data-*` attributes
// `dom-sensor.ts` already reads directly off any element, registry-free:
// `HINT_ID_ATTRIBUTE` (`data-autoskeleton-id`) and, when `radius` is given,
// `HINT_RADIUS_ATTRIBUTE` (`data-autoskeleton-radius`) — see that module's
// doc comments for why an attribute, not a registry, is what keeps web's
// `<AutoSkeleton.Ignore>` and its hint channel self-sufficient. A consumer
// who already sets `data-autoskeleton-radius` BY HAND keeps working
// unchanged: this component is sugar over the same channel, not a
// replacement for it.
//
// API SYMMETRY, precisely scoped: `id` is required and developer-supplied
// (never `useId()`, for the same hookless-testability reason
// `src/native/Hint.tsx` gives) and `radius` behaves identically to native.
// `lines` is DELIBERATELY NOT a prop here — a real, pre-existing, documented
// asymmetry, not an oversight: `dom-sensor.ts`'s `textLeafShapes` never
// calls `hints.linesFor()` at all, and its one theoretical consultation
// point (the `clientrects-empty` fallback) was live-probed in Playwright and
// found unreachable under non-degenerate geometry given `isTextLeaf`'s
// current gate. Adding a `lines` prop that stamps an attribute nothing ever
// reads would be a silent no-op footgun, exactly the kind of undocumented
// drift this whole revision was raised to avoid. Wiring it for real needs a
// separate `isTextLeaf` redesign (real surgery, out of scope here) — see
// `dom-sensor.ts`'s `HINT_RADIUS_ATTRIBUTE` doc comment for the full
// analysis.
//
// LAYOUT NEUTRALITY: `cloneElement` on the consumer's own element, never a
// wrapping `<div>` — unlike web's `Ignore` (which wraps with
// `display: contents` because it must ALSO carry a boolean marker
// attribute independent of the child's own props), `Hint` only needs to add
// attributes to the child that is already there, so no extra DOM node is
// needed at all. This is also the smaller bundle-size option, which mattered
// given how tight NFR-6's headroom was even after the revision.

import { Children, cloneElement, type ReactElement, type ReactNode } from 'react';
import { HINT_ID_ATTRIBUTE, HINT_RADIUS_ATTRIBUTE } from './dom-sensor';

export interface AutoSkeletonHintProps {
  /** Developer-supplied identifier, stamped onto `HINT_ID_ATTRIBUTE`
   *  (`data-autoskeleton-id`) — required for API symmetry with
   *  `src/native/Hint.tsx`'s `id`, even though web's own sensor does not
   *  currently key any consultation off it (kept for the same
   *  debuggability rationale native's doc comment gives, and so the
   *  attribute is available to a future consumer of `HintRegistry.isIgnored`
   *  or `radiusSourceHistogram`/debug-overlay tooling). */
  readonly id: string;
  /** Corner-radius override, in the leaf's own coordinate units. Web always
   *  knows the exact measured radius directly (unlike Android's ADR-2
   *  degradation ladder), so this OVERRIDES the measured value rather than
   *  filling a gap — the same deliberate cross-platform-consistency choice
   *  `src/native/Hint.tsx`'s iOS behavior makes. */
  readonly radius?: number;
  readonly children: ReactNode;
}

export function Hint(props: AutoSkeletonHintProps): React.JSX.Element {
  const child = Children.only(props.children) as ReactElement<Record<string, unknown>>;
  const extra: Record<string, unknown> = {
    [HINT_ID_ATTRIBUTE]: props.id,
  };
  if (props.radius !== undefined) {
    extra[HINT_RADIUS_ATTRIBUTE] = props.radius;
  }
  return cloneElement(child, extra);
}
