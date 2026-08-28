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
import { buildClipPath } from '../core/clip-path';
import type { AnimationKind } from '../core/types';
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
    '.askl-anim-pulse .askl-overlay-base{animation-name:askl-pulse;',
    'animation-timing-function:ease-in-out;animation-iteration-count:infinite;',
    'animation-duration:var(--askl-speed, 1400ms);}',
    '.askl-anim-pulse .askl-shimmer-layer{animation:none;opacity:0;}',
    '.askl-anim-none .askl-shimmer-layer{animation:none;opacity:0;}',
    '@keyframes askl-shimmer{from{transform:translateX(-50%);}to{transform:translateX(50%);}}',
    '@keyframes askl-pulse{0%,100%{opacity:0.45;}50%{opacity:1;}}',
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

function effectiveAnimation(animation: AnimationKind, reducedMotion: boolean): AnimationKind {
  if (!reducedMotion) {
    return animation;
  }
  // REQ-A11Y-3 / spec §1.10: reduce-motion degrades shimmer to pulse; 'none'
  // stays 'none'. No transform-based shimmer sweep is ever applied here.
  return animation === 'none' ? 'none' : 'pulse';
}

function applyGeometry(overlay: HTMLDivElement, props: RenderProps): void {
  const decoded = decodeWire(props.snapshot.data);
  const path = buildClipPath(
    decoded.shapes.map((s) => ({ x: s.x, y: s.y, w: s.w, h: s.h, r: s.r })),
    {
      defaultRadius: props.theme.defaultRadius,
      // Live web measurement already reflects the page's actual direction
      // (getBoundingClientRect returns final visual coordinates), so no
      // additional RTL mirroring is applied here — see dom-sensor.ts's
      // module doc. `buildClipPath`'s mirroring exists for platforms/replays
      // where shapes are captured in a canonical space.
      direction: 'ltr',
      containerWidth: props.snapshot.frameWidth,
    },
  );
  overlay.style.width = `${props.snapshot.frameWidth}px`;
  overlay.style.height = `${props.snapshot.frameHeight}px`;
  overlay.style.clipPath = path;
}

function applyAnimation(overlay: HTMLDivElement, shimmerLayer: HTMLDivElement, props: RenderProps): void {
  overlay.classList.remove('askl-anim-shimmer', 'askl-anim-pulse', 'askl-anim-none');
  overlay.classList.add(`askl-anim-${effectiveAnimation(props.animation, props.reducedMotion)}`);
  overlay.style.setProperty('--askl-speed', `${props.clock.periodMs}ms`);
  const delayMs = props.clock.phaseOffsetMs(Date.now());
  shimmerLayer.style.animationDelay = `${-delayMs}ms`;

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
      const baseLayer = document.createElement('div');
      baseLayer.className = 'askl-overlay-base';
      baseLayer.style.position = 'absolute';
      baseLayer.style.inset = '0';
      const shimmerLayer = document.createElement('div');
      shimmerLayer.className = 'askl-shimmer-layer';
      overlay.appendChild(baseLayer);
      overlay.appendChild(shimmerLayer);
      surface.appendChild(overlay);

      applyGeometry(overlay, initialProps);
      applyAnimation(overlay, shimmerLayer, initialProps);

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
          applyAnimation(overlay, shimmerLayer, latest);
        },
        destroy() {
          overlay.remove();
        },
      };
      return handle;
    },
  };
}
