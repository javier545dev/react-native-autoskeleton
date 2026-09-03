// src/web/css-renderer.ts
//
// plan.md ADR-7 / tasks.md 2.2: the web `Renderer<HTMLElement>` — a single CSS
// overlay clipped with `clip-path: path()` (reuses task 1.5's `buildClipPath`,
// no CanvasKit/wasm). ADR-6: the shimmer sweep animates `transform` only;
// `background-position` never participates in any `@keyframes` rule anywhere
// in this file (banned codebase-wide — see `src/lint/banned-css-properties.
// test.ts` for the static half of that guard, and `test/web/css-renderer.
// spec.ts` for the rendered-CSS half).
//
// Observability: `performance.mark`/`performance.measure` around `mount()`
// (REQ-OBS-PROFILE-1); `debugOverlay` itself is task 2.4.
// Performance: NFR-1 (shimmer keeps compositing), NFR-7 (zero React
// re-renders — the animation runs entirely via CSS `animation-delay`, never a
// JS tick loop; `ShimmerClock.subscribe` below is DEV/TEST ONLY per the
// contract, and is never called by this renderer's own mount/update path).

import type { ClockPhase, Renderer, RenderProps, RendererHandle, ShimmerClock } from '../core/contracts';
import { effectiveAnimation, PULSE_MIN_OPACITY } from '../core/animation';
import { buildClipPath } from '../core/clip-path';
import { decodeWire } from '../core/wire';

const STYLE_ELEMENT_ID = 'autoskeleton-css-renderer-styles';
const DEFAULT_PERIOD_MS = 1400;

/** tasks.md 7.1 / spec REQ-THEME-1: the single source of truth for the
 *  library's built-in shimmer colors, shared between the injected
 *  stylesheet's `var(--skl-base, DEFAULT)` fallback below AND
 *  `applyAnimation()`'s "was this explicitly overridden?" check. A consumer
 *  who never customizes `SkeletonProvider`'s `theme` gets exactly these two
 *  values back from `AutoSkeleton.tsx`'s own `DEFAULT_THEME` (which imports
 *  them from here rather than duplicating the literals) — which is what lets
 *  `applyAnimation()` tell "default, defer to CSS cascade" apart from "the
 *  consumer explicitly asked for this color via a React prop". */
export const DEFAULT_BASE_COLOR = '#e2e2e2';
export const DEFAULT_HIGHLIGHT_COLOR = '#f5f5f5';

/** The stylesheet text is a pure function of nothing (no per-instance
 *  variance is baked in — speed/geometry travel via CSS custom properties and
 *  inline styles instead), which makes it trivially Vitest-testable without a
 *  browser: `src/web/css-renderer.test.ts` snapshots this string and asserts
 *  it never contains `background-position`. NEVER add a per-instance
 *  `@keyframes` variant here; that is exactly the kind of unbounded
 *  stylesheet growth ADR-7's "one CSS overlay" decision exists to avoid. */
export function buildShimmerStylesheet(): string {
  return [
    `.askl-overlay{position:absolute;inset:0;overflow:hidden;pointer-events:none;`,
    `background-color:var(--skl-base, ${DEFAULT_BASE_COLOR});}`,
    '.askl-shimmer-layer{position:absolute;top:0;bottom:0;left:-50%;width:200%;',
    `background-image:linear-gradient(90deg, transparent 0%, var(--skl-highlight, ${DEFAULT_HIGHLIGHT_COLOR}) 50%, transparent 100%);`,
    'will-change:transform;}',
    '.askl-anim-shimmer .askl-shimmer-layer{animation-name:askl-shimmer;',
    'animation-timing-function:linear;animation-iteration-count:infinite;',
    'animation-duration:var(--askl-speed, 1400ms);}',
    // `core/animation.ts`'s 'pulse': the HIGHLIGHT breathes in place. It is
    // deliberately the same element the shimmer travels on, because that is
    // the only element carrying the highlight — the previous rule targeted
    // `.askl-overlay-base`, a div with no background of any kind, so the
    // animation ran perfectly and moved zero pixels. Pulsing `.askl-overlay`
    // instead would be the OTHER wrong answer: it holds the opaque base fill,
    // so the whole skeleton would go translucent at the trough and let real
    // content bleed through (the mistake `ios/AutoskeletonRendererTier1.swift`
    // `applyPulse()`'s own doc comment already warns about). With no transform
    // applied, the layer's `left:-50%;width:200%` box puts the gradient's 50%
    // stop exactly at the overlay's centre — the named resting position every
    // renderer parks at.
    '.askl-anim-pulse .askl-shimmer-layer{animation-name:askl-pulse;',
    'animation-timing-function:ease-in-out;animation-iteration-count:infinite;',
    'animation-duration:var(--askl-speed, 1400ms);}',
    '.askl-anim-none .askl-shimmer-layer{animation:none;opacity:0;}',
    '@keyframes askl-shimmer{from{transform:translateX(-50%);}to{transform:translateX(50%);}}',
    `@keyframes askl-pulse{0%,100%{opacity:${PULSE_MIN_OPACITY};}50%{opacity:1;}}`,
  ].join('');
}

function ensureStylesheet(): void {
  if (typeof document === 'undefined') {
    return;
  }
  if (document.getElementById(STYLE_ELEMENT_ID)) {
    return;
  }
  const styleEl = document.createElement('style');
  styleEl.id = STYLE_ELEMENT_ID;
  styleEl.textContent = buildShimmerStylesheet();
  document.head.appendChild(styleEl);
}

/** `ShimmerClock` driven purely by wall-clock math (plan.md §3.6). Renderers
 *  read `startedAt`/`phaseOffsetMs` once at mount to compute a negative
 *  `animation-delay`, which is what actually keeps every mounted instance in
 *  phase — `subscribe` exists ONLY for dev tooling/tests (NFR-7: production
 *  code path here never calls it). */
export function createShimmerClock(periodMs: number = DEFAULT_PERIOD_MS): ShimmerClock {
  let period = periodMs;
  let startedAt = Date.now();
  let pausedAt: number | undefined;
  const listeners = new Set<(phase: ClockPhase, timestampMs: number) => void>();

  return {
    id: 'css-shimmer-clock',
    driver: 'css',
    get periodMs() {
      return period;
    },
    get startedAt() {
      return startedAt;
    },
    phaseAt(timestampMs: number): ClockPhase {
      const elapsed = ((timestampMs - startedAt) % period + period) % period;
      return elapsed / period;
    },
    phaseOffsetMs(now: number): number {
      return ((now - startedAt) % period + period) % period;
    },
    subscribe(listener) {
      if (typeof process !== 'undefined' && process.env?.['NODE_ENV'] === 'production') {
        console.warn(
          '[autoskeleton] ShimmerClock.subscribe() was called in production. Production ' +
            'animation never ticks through JS (NFR-7) — this is a DEV/TEST-ONLY seam.',
        );
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setPeriod(ms: number) {
      period = ms;
    },
    pause() {
      pausedAt ??= Date.now();
    },
    resume() {
      if (pausedAt === undefined) {
        return;
      }
      // Shift `startedAt` forward by the paused duration so `phaseAt`
      // resumes from exactly the phase it was paused at, rather than jumping.
      startedAt += Date.now() - pausedAt;
      pausedAt = undefined;
    },
  };
}

function applyGeometry(overlay: HTMLDivElement, props: RenderProps): void {
  const decoded = decodeWire(props.snapshot.data);

  // A snapshot with no shapes must paint NOTHING, and saying so explicitly is
  // load-bearing rather than defensive. `buildClipPath([])` returns
  // `path("")` — `[].join(' ')` is the empty string — which is not a valid
  // `clip-path` value, so Chromium drops the declaration and the property
  // computes to `none`. With no clip, `.askl-overlay`'s `inset: 0` plus its
  // `background-color: var(--skl-base, …)` fills the ENTIRE wrapper with the
  // base colour.
  //
  // That is worst precisely where it is most likely: the empty-snapshot path
  // is the one `fallback` exists to cover, so a consumer's hand-authored
  // fallback was being painted over by a plain grey block — measured at
  // 296x111 with `computed clip-path: none` while the fallback sat underneath
  // it. Found by `examples/vite`'s `#/cold-fallback` demo, 2026-09-02.
  if (decoded.shapes.length === 0) {
    overlay.style.display = 'none';
    return;
  }
  overlay.style.display = '';

  const path = buildClipPath(
    decoded.shapes.map((s) => ({ x: s.x, y: s.y, w: s.w, h: s.h, r: s.r })),
    {
      defaultRadius: props.theme.defaultRadius,
      // Live web measurement already reflects the page's actual direction
      // (real laid-out geometry, mirrored by the browser), so no additional
      // RTL mirroring is applied here. `buildClipPath`'s mirroring exists
      // for platforms/replays captured in a canonical space.
      direction: 'ltr',
      containerWidth: props.snapshot.frameWidth,
    },
  );
  overlay.style.width = `${props.snapshot.frameWidth}px`;
  overlay.style.height = `${props.snapshot.frameHeight}px`;
  overlay.style.clipPath = path;
}

/** ADR-8 phase lock. Writing a negative `animation-delay` seeks the element's
 *  CSS animation to the shared clock's current phase, so a skeleton mounting
 *  now lands mid-sweep exactly where every already-mounted skeleton is.
 *
 *  This is correct ONLY at the instant the element's animation starts, where
 *  the browser sets `startTime ≈ now` and effective progress is therefore
 *  `(t − clockStart) mod period`. `startTime` is never re-set afterwards, so
 *  re-deriving the delay from a fresh `Date.now()` on an update subtracts the
 *  elapsed time a SECOND time and the sweep teleports — measured at 287px
 *  (~72% of a 400px overlay, period 1400ms) when it was rewritten 500ms after
 *  mount, which also drops that instance out of phase with its siblings, i.e.
 *  destroys the one guarantee the shared clock exists to provide. It used to
 *  live inside `applyAnimation()`, which `setAnimation()` also calls on ANY
 *  provider re-render (see `useOverlayRenderer` in `web/AutoSkeleton.tsx`), so
 *  the jump was on an ordinary steady-state path rather than an edge case.
 *  Hence: called from `mount()` and nowhere else. */
function anchorPhase(shimmerLayer: HTMLDivElement, props: RenderProps): void {
  const delayMs = props.clock.phaseOffsetMs(Date.now());
  shimmerLayer.style.animationDelay = `${-delayMs}ms`;
}

/** Everything that is safe to (re)write on every update: the animation KIND,
 *  the period, and the theme custom properties. Deliberately does NOT touch
 *  `animation-delay` — see `anchorPhase()` above. */
function applyAnimation(overlay: HTMLDivElement, props: RenderProps): void {
  overlay.classList.remove('askl-anim-shimmer', 'askl-anim-pulse', 'askl-anim-none');
  overlay.classList.add(`askl-anim-${effectiveAnimation(props.animation, props.reducedMotion)}`);
  overlay.style.setProperty('--askl-speed', `${props.clock.periodMs}ms`);

  // REQ-THEME-1 / tasks.md 7.1: an inline style on this element beats ANY
  // stylesheet declaration of the same custom property, no matter how it
  // cascaded in (`:root`, a Tailwind v4 `@theme`, a `.dark` class override,
  // etc.) — so the ONLY correct thing to do when the theme is still the
  // library's own default is to leave `--skl-base`/`--skl-highlight` alone
  // and let the stylesheet's `var(--skl-base, DEFAULT_BASE_COLOR)` fallback
  // (and the page's own cascade above it) resolve the color. An inline
  // override is written ONLY when the consumer explicitly customized the
  // theme via `SkeletonProvider`/a prop — a deliberate, different mechanism
  // this does not take away. `removeProperty` un-does a previous explicit
  // override on `update()`/`setAnimation()` calls if the theme reference
  // later reverts to the default object.
  if (props.theme.baseColor === DEFAULT_BASE_COLOR) {
    overlay.style.removeProperty('--skl-base');
  } else {
    overlay.style.setProperty('--skl-base', props.theme.baseColor);
  }
  if (props.theme.highlightColor === DEFAULT_HIGHLIGHT_COLOR) {
    overlay.style.removeProperty('--skl-highlight');
  } else {
    overlay.style.setProperty('--skl-highlight', props.theme.highlightColor);
  }
}

/** Creates the web `Renderer<HTMLElement>` (plan.md §3.5, ADR-7). No
 *  dependency beyond the DOM — `isAvailable()` is unconditionally `true`,
 *  unlike the native tier-2 renderer's Skia/Reanimated peer check. */
export function createCssRenderer(): Renderer<HTMLElement> {
  return {
    kind: 'css',
    supportsRadius: true,
    isAvailable: () => true,

    mount(surface, initialProps) {
      ensureStylesheet();
      performance.mark('autoskeleton-draw-start');

      const overlay = document.createElement('div');
      overlay.className = 'askl-overlay';
      overlay.setAttribute('aria-hidden', 'true');
      // `.askl-overlay-base` used to be created here. It never had a
      // background, existed only to be the pulse's target, and therefore only
      // ever painted nothing — deleting it removes the element AND the bytes
      // rather than leaving a dead div in every skeleton on every page.
      const shimmerLayer = document.createElement('div');
      shimmerLayer.className = 'askl-shimmer-layer';
      overlay.appendChild(shimmerLayer);
      surface.appendChild(overlay);

      applyGeometry(overlay, initialProps);
      applyAnimation(overlay, initialProps);
      // Mount-only, and it must stay that way: `anchorPhase`'s doc comment
      // explains why re-running it on an update makes the sweep jump.
      anchorPhase(shimmerLayer, initialProps);

      performance.mark('autoskeleton-draw-end');
      performance.measure('autoskeleton-draw', 'autoskeleton-draw-start', 'autoskeleton-draw-end');

      let latest = initialProps;

      const handle: RendererHandle = {
        update(next) {
          latest = { ...latest, snapshot: next };
          applyGeometry(overlay, latest);
        },
        setAnimation(kind) {
          latest = { ...latest, animation: kind };
          applyAnimation(overlay, latest);
        },
        destroy() {
          overlay.remove();
        },
      };
      return handle;
    },
  };
}
