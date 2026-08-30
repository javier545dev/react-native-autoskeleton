// src/core/animation.test.ts
//
// The `animation` prop is public API (`AnimationKind`), and before this file
// existed it had FOUR renderer implementations that disagreed with each other:
//
//   - web:     'pulse' animated the opacity of `.askl-overlay-base`, an element
//              with no background — a running animation that painted a static
//              block (`test/web/css-renderer.spec.ts` now samples pixels).
//   - SSR CSS: `cli/media-bundle.ts` copied that same defect verbatim.
//   - tier-1:  `reducedMotion || animation == "none"` — 'pulse' was not in the
//              predicate at all, so an explicit 'pulse' played the full
//              travelling shimmer, while 'none' played the reduced-motion PULSE
//              (an animation, for the value that means "do not animate").
//   - tier-2:  never received `animation` at all.
//
// One prop cannot have four meanings. This table is the single definition every
// renderer is now derived from; the Kotlin and Swift mirrors of this function
// are pinned against the SAME table in `AutoskeletonOverlayViewTest.kt` and
// `AutoskeletonOverlayViewHostTests.swift`.

import { describe, expect, it } from 'vitest';
import { effectiveAnimation } from './animation';
import type { AnimationKind } from './types';

const KINDS: readonly AnimationKind[] = ['shimmer', 'pulse', 'none'];

describe('effectiveAnimation — the one definition of the `animation` prop', () => {
  it.each([
    // requested,  reducedMotion, effective
    ['shimmer', false, 'shimmer'],
    ['pulse', false, 'pulse'],
    ['none', false, 'none'],
    // REQ-A11Y-3: reduce-motion degrades the travelling sweep to the pulse.
    ['shimmer', true, 'pulse'],
    // Already non-directional — reduce-motion has nothing left to take away.
    ['pulse', true, 'pulse'],
    // 'none' is the one value reduce-motion must NOT turn into an animation.
    // Tier-1 used to route it into the pulse path on both platforms.
    ['none', true, 'none'],
  ] as const)('%s + reducedMotion=%s -> %s', (requested, reducedMotion, expected) => {
    expect(effectiveAnimation(requested, reducedMotion)).toBe(expected);
  });

  // Both the JS caller and the native side compute this, so a value that has
  // already been degraded must survive a second pass unchanged — otherwise
  // "who degrades it" becomes load-bearing and the two can disagree.
  it('is idempotent for every kind and both preference states', () => {
    for (const kind of KINDS) {
      for (const reduced of [false, true]) {
        const once = effectiveAnimation(kind, reduced);
        expect(effectiveAnimation(once, reduced)).toBe(once);
      }
    }
  });

  it('never invents a fourth value', () => {
    for (const kind of KINDS) {
      for (const reduced of [false, true]) {
        expect(KINDS).toContain(effectiveAnimation(kind, reduced));
      }
    }
  });

  it('only ever degrades — it never escalates a kind back into more motion', () => {
    const motion: Readonly<Record<AnimationKind, number>> = { none: 0, pulse: 1, shimmer: 2 };
    for (const kind of KINDS satisfies readonly AnimationKind[]) {
      expect(motion[effectiveAnimation(kind, true)]).toBeLessThanOrEqual(motion[kind]);
    }
  });
});
