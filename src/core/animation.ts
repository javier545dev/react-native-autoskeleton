// src/core/animation.ts
//
// The ONE definition of what the public `animation` prop means, shared by
// every renderer that draws a skeleton (ADR-4: `src/core/` has zero platform
// imports, which is what lets web, tier-1's JS host and tier-2 all reach it).
//
// It exists because `animation` used to be interpreted independently in four
// places and no two agreed — see `animation.test.ts`'s header for the full
// inventory of what each one did. The Kotlin and Swift sides cannot import
// this module, so they carry a three-line mirror pinned against the SAME
// table this file's test drives.
//
// The vocabulary, stated once so the four renderers implement the same thing:
//
//   'shimmer' — an opaque base fill with the highlight band TRAVELLING across
//               it once per clock period (ADR-6: via `transform` only).
//   'pulse'   — an opaque base fill, the highlight band PARKED at the
//               container's centre, and only its OPACITY breathing between
//               `PULSE_MIN_OPACITY` and 1 once per clock period. No
//               directional movement of any kind. The base fill never becomes
//               translucent, so real content can never bleed through at the
//               trough.
//   'none'    — an opaque base fill, no highlight, nothing animating.
//
// "Parked at the CENTRE" is a deliberate choice, not an implementation
// accident: the natural thing to do — leave the sweep's transform wherever it
// happened to be — is exactly the Android defect where stopping the frame loop
// froze the gradient at an arbitrary phase, so the streak could sit anywhere.
// A named resting position is the only version of this that is reproducible
// and identical across platforms.
//
// What is deliberately NOT part of the contract: the exact easing curve of the
// breath. CSS says `ease-in-out`, Reanimated's `withTiming` default is
// `Easing.inOut(Easing.quad)`, Core Animation is told `easeInEaseOut`, and
// Android derives a raised cosine from the shared clock because it draws every
// frame itself. Those are four spellings of "smooth in, smooth out" and they
// are sub-perceptual against each other; the AMPLITUDE, the PERIOD and the
// RESTING POSITION are the contract, and those are identical.

import type { AnimationKind } from './types';

/** The trough of the pulse. Chosen to match the value iOS's `applyPulse()`
 *  already used, since that was the only implementation of the three that
 *  genuinely pulsed something visible. */
export const PULSE_MIN_OPACITY = 0.6;

/** REQ-A11Y-3 ("degrade the shimmer animation to a pulse or static
 *  presentation") resolved against an explicit `animation` prop.
 *
 *  Reduce-motion only ever removes motion: `shimmer` loses its travel and
 *  becomes the pulse, `pulse` is already non-directional and is unchanged, and
 *  `none` stays `none` — the value that means "do not animate" must never be
 *  turned INTO an animation, which is precisely what tier-1 used to do on both
 *  platforms by folding `animation == "none"` into its reduced-motion branch.
 *
 *  Idempotent by construction, so it does not matter whether JS degraded the
 *  value before sending it to a native view or the native view degrades it
 *  itself — both do, and they cannot disagree. */
export function effectiveAnimation(animation: AnimationKind, reducedMotion: boolean): AnimationKind {
  if (!reducedMotion || animation === 'none') {
    return animation;
  }
  return 'pulse';
}
