// test/native/skia-renderer-rtl.test.ts
//
// The shimmer sweep must travel WITH the reader's writing direction.
//
// THE DEFECT THIS PINS. `direction` has been part of the composite shape cache
// key since `src/core/cache-key.ts` was written, so the library already stores
// a separate snapshot per writing direction — an RTL layout genuinely measures
// different geometry. But no renderer read it: grepping `I18nManager`,
// `isRTL`, `layoutDirection` and `effectiveUserInterfaceLayoutDirection`
// across `ios/AutoskeletonRendererTier1.swift`,
// `android/.../AutoskeletonRendererTier1.kt` and `tier2/SkiaRenderer.tsx`
// returned nothing at all. Every skeleton in every app swept left-to-right, so
// an RTL reader watched the highlight travel against their reading direction.
// SkeletonView (iOS) picks `isRTL ? .rightLeft : .leftRight` for the same
// reason.
//
// SCOPE, STATED HONESTLY. This file proves the tier-2 travel FORMULA and its
// wiring, as arithmetic. It cannot prove that Skia paints it, and it cannot
// execute the Swift or Kotlin flip at all — those are one `1 - x` reflection
// each (`applyShimmer`'s `fromValue`/`toValue`, and `onDraw`'s
// `sweepTranslateX`), reviewed by reading and left to the on-device paint
// gates. A green run here is NOT evidence that all three agree.
//
// WHY THIS IS A SEPARATE FILE from `skia-renderer.test.ts`: that file is under
// concurrent edit in this working tree, and a new independent concern does not
// need to contend for the same lines.

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import {
  pulseParkDriveFor,
  SkiaShimmerOverlay,
  travelSignFor,
  type ReanimatedModule,
  type SkiaModule,
} from '../../src/native/tier2/SkiaRenderer';
import { createSkiaOverlay } from '../../src/index.skia';
import type { SkeletonOverlayProps } from '../../src/native/overlayContract';

const WIDTH = 300;

// ---------------------------------------------------------------------------
// The travel sign
// ---------------------------------------------------------------------------

/** The band centre the renderer's two updaters compute, restated here so the
 *  pulse's parked position can be asserted as a POSITION rather than as a drive
 *  value. It is not a second implementation to keep in sync: the sweep itself
 *  is asserted below through the real rendered updaters, not through this. */
function bandCentre(drive01: number, width: number, direction: 'ltr' | 'rtl'): number {
  return (-width + drive01 * width * 2) * travelSignFor(direction);
}

describe('travelSignFor — the only term the writing direction touches', () => {
  it('leaves LTR at +1, so the pre-existing expression is multiplied by one', () => {
    // `x * 1` is exact for every double, which is what makes the default path
    // byte-identical rather than merely equivalent.
    expect(travelSignFor('ltr')).toBe(1);
  });

  it('reverses RTL', () => {
    expect(travelSignFor('rtl')).toBe(-1);
  });

  it('LTR travels -width -> +width, exactly the span both native tiers sweep', () => {
    // `ios/AutoskeletonRendererTier1.swift` `applyShimmer()`: fromValue
    // `-width`, toValue `width`. Android: `((phase * 2) - 1) * w`.
    expect(bandCentre(0, WIDTH, 'ltr')).toBe(-WIDTH);
    expect(bandCentre(0.5, WIDTH, 'ltr')).toBe(0);
    expect(bandCentre(1, WIDTH, 'ltr')).toBe(WIDTH);
  });

  it('RTL travels the SAME span the other way, +width -> -width', () => {
    expect(bandCentre(0, WIDTH, 'rtl')).toBe(WIDTH);
    // `toBeCloseTo`, not `toBe`: negating LTR's exact `0` yields `-0`, and
    // `toBe` is `Object.is`, which separates the two zeroes. The distinction
    // is real in JS and meaningless as a band position.
    expect(bandCentre(0.5, WIDTH, 'rtl')).toBeCloseTo(0, 10);
    expect(bandCentre(1, WIDTH, 'rtl')).toBe(-WIDTH);
  });

  it('is a reflection, not a different wave: rtl(d) === ltr(1 - d) at every phase', () => {
    // This is the property that lets the pulse park mirror by mirroring its
    // DRIVE, and the property both native flips implement as a sign change.
    for (const d of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      expect(bandCentre(d, WIDTH, 'rtl')).toBeCloseTo(bandCentre(1 - d, WIDTH, 'ltr'), 10);
    }
  });

  it('travels in genuinely opposite directions — not merely a phase offset', () => {
    // A pure phase shift would keep the sign of the step; a flip inverts it.
    const ltrStep = bandCentre(0.6, WIDTH, 'ltr') - bandCentre(0.5, WIDTH, 'ltr');
    const rtlStep = bandCentre(0.6, WIDTH, 'rtl') - bandCentre(0.5, WIDTH, 'rtl');
    expect(ltrStep).toBeGreaterThan(0);
    expect(rtlStep).toBeLessThan(0);
    expect(rtlStep).toBeCloseTo(-ltrStep, 10);
  });
});

// ---------------------------------------------------------------------------
// The parked pulse
// ---------------------------------------------------------------------------

describe('the pulse parks at the container centre in BOTH directions', () => {
  // The pulse does not travel, so it has no direction — but it is positioned
  // THROUGH the same `drive` value the sweep uses, so the reflection above
  // would have parked an RTL pulse at `-width / 2`: half a container off the
  // skeleton, which is the "frozen at an arbitrary point" failure the named
  // park constant exists to prevent. Both native tiers translate the parked
  // band by `width / 2` with no direction term at all.
  it.each(['ltr', 'rtl'] as const)('parks at width / 2 under %s', (direction) => {
    expect(bandCentre(pulseParkDriveFor(direction), WIDTH, direction)).toBeCloseTo(WIDTH / 2, 10);
  });
});

// ---------------------------------------------------------------------------
// The wiring: prop -> gradient endpoints
// ---------------------------------------------------------------------------

function stubSkia(): SkiaModule {
  const passthrough = (props: { children?: unknown }): unknown => props.children ?? null;
  return {
    Skia: {
      Path: {
        Make: () => ({
          addRRect() {
            return this;
          },
          addRect() {
            return this;
          },
        }),
      },
    },
    rrect: () => ({}),
    rect: () => ({}),
    vec: (x: number, y: number) => ({ x, y }),
    Canvas: passthrough,
    Group: passthrough,
    Path: passthrough,
    LinearGradient: () => null,
  };
}

/** Renders the overlay and returns the two `useDerivedValue` results, in
 *  order: `gradientStart` then `gradientEnd`. Same technique
 *  `skia-renderer.test.ts` uses for the band geometry — the stub evaluates
 *  each updater eagerly, so this reads the FORMULA, not a rasterized frame. */
async function gradientEndpoints(
  direction: 'ltr' | 'rtl' | undefined,
): Promise<Array<{ x: number; y: number }>> {
  const derived: Array<{ x: number; y: number }> = [];
  const reanimated: ReanimatedModule = {
    useSharedValue: <T,>(initial: T) => ({ value: initial }),
    useDerivedValue: <T,>(updater: () => T) => {
      const v = updater();
      derived.push(v as unknown as { x: number; y: number });
      return { value: v };
    },
    withRepeat: (a: unknown) => a,
    withTiming: () => undefined,
    withSequence: (...a: unknown[]) => a,
    withDelay: (_d: number, a: unknown) => a,
    cancelAnimation: () => undefined,
    Easing: { linear: 'LINEAR' },
  };
  const { renderToStaticMarkup } = await import('react-dom/server');
  renderToStaticMarkup(
    createElement(SkiaShimmerOverlay, {
      shapes: [{ x: 0, y: 0, w: 100, h: 20, r: 4 }],
      baseColor: '#eee',
      highlightColor: '#fff',
      speedMs: 1400,
      width: WIDTH,
      height: 200,
      reducedMotion: false,
      direction,
      peers: { skia: stubSkia(), reanimated },
    }),
  );
  return derived;
}

describe('SkiaShimmerOverlay places the band from `direction`', () => {
  // `drive` starts at 0 in every case below, so these compare the SAME phase
  // across directions — the difference is travel, not timing.

  it('LTR is unchanged: the band still starts one full width to the left', async () => {
    // Byte-identical to the expectation `skia-renderer.test.ts` has always
    // pinned (`{ x: -width - width }` / `{ x: -width + width }`), which is
    // what makes the default behaviour provably untouched rather than
    // merely intended to be.
    const [start, end] = await gradientEndpoints('ltr');
    expect(start).toEqual({ x: -WIDTH - WIDTH, y: 0 });
    expect(end).toEqual({ x: -WIDTH + WIDTH, y: 0 });
  });

  it('an ABSENT direction is LTR, so no existing consumer moves', async () => {
    const [start, end] = await gradientEndpoints(undefined);
    expect(start).toEqual({ x: -WIDTH - WIDTH, y: 0 });
    expect(end).toEqual({ x: -WIDTH + WIDTH, y: 0 });
  });

  it('RTL starts one full width to the RIGHT — the sweep is mirrored', async () => {
    const [start, end] = await gradientEndpoints('rtl');
    expect(start).toEqual({ x: WIDTH - WIDTH, y: 0 });
    expect(end).toEqual({ x: WIDTH + WIDTH, y: 0 });
  });

  it('the band keeps its 2 x width span in both directions (only the centre moves)', async () => {
    for (const direction of ['ltr', 'rtl'] as const) {
      const [start, end] = await gradientEndpoints(direction);
      expect(end!.x - start!.x).toBe(WIDTH * 2);
    }
  });
});

// ---------------------------------------------------------------------------
// The prop actually reaching the renderer
// ---------------------------------------------------------------------------

describe('createSkiaOverlay forwards `direction`', () => {
  // The factory builds its element from an explicit prop list, and a dropped
  // prop there cannot fail to compile — `SkiaRenderer` reads
  // `props.direction ?? 'ltr'`, so losing it silently means "always LTR",
  // i.e. exactly the defect this change fixes, reintroduced one layer up.
  // `animation` was lost this way once already.
  it.each(['ltr', 'rtl'] as const)('passes direction=%s through to the renderer', (direction) => {
    const props: SkeletonOverlayProps = {
      shapes: [],
      baseColor: '#eee',
      highlightColor: '#fff',
      speedMs: 1400,
      width: WIDTH,
      height: 200,
      reducedMotion: false,
      direction,
    };
    const Overlay = createSkiaOverlay({ skia: {} as SkiaModule, reanimated: {} as ReanimatedModule });
    const element = (Overlay as (p: SkeletonOverlayProps) => unknown)(props) as {
      props: Record<string, unknown>;
    };
    expect(element.props['direction']).toBe(direction);
  });
});
