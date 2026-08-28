// src/web/dom-sensor.ts
//
// plan.md §2 / tasks.md 2.1: the web `Sensor<HTMLElement>`. Real DOM traversal
// via `TreeWalker`-equivalent recursive `element.children` walking, leaf
// detection, `getBoundingClientRect`/`getComputedStyle`/`getClientRects`
// geometry — exactly the API surface jsdom cannot provide (jsdom #653, #3729),
// which is why this module is tested exclusively under Playwright
// (test/web/dom-sensor.spec.ts), never Vitest/jsdom (plan.md §7.3).
//
// Observability: wraps traversal in `performance.mark`/`performance.measure`
// (REQ-OBS-PROFILE-1); populates the `sources`/`radiusSources` dev sidecars
// when `collectDebugSidecars` is set. Performance: soft `budgetMs`/`maxShapes`
// truncation (NFR-3 local guard; the authoritative gate is the CI benchmark
// suite, task 9.1).

import type { HintRegistry, InvalidationReason, Sensor, SensorOptions, SensorResult } from '../core/contracts';
import { synthesizeLines } from '../core/lines';
import type { DegradationFlag, RadiusSource, ShapeInfo, ShapeSource } from '../core/types';
import { RADIUS_SOURCES, WIRE_VERSION } from '../core/types';
import { encodeWire } from '../core/wire';

/** `data-*` Ignore channel (spec §1: "Ignore via data-*"). Consumed directly by
 *  the sensor; `<AutoSkeleton.Ignore>` (task 2.3) sets this attribute. */
export const IGNORE_ATTRIBUTE = 'data-autoskeleton-ignore';
/** Typed-prop hint channel keyed off this attribute — never className
 *  (REQ-THEME-3). Optional; absent nodes simply get no hint. Kept for the
 *  pre-existing `isIgnored` registry consultation below (unrelated to the
 *  typed-hint channel this attribute's name suggests — see
 *  `HINT_RADIUS_ATTRIBUTE`'s doc comment for why the `radius` hint does NOT
 *  use this id+registry mechanism). */
export const HINT_ID_ATTRIBUTE = 'data-autoskeleton-id';

/** Typed-hint channel (radius, plan.md ADR-2 R0) — a SELF-SUFFICIENT data
 *  attribute, not an id+registry lookup. NFR-6 forced this design: an
 *  id+registry (`core/hint-registry.ts`, built for the NATIVE bridge-
 *  crossing constraint — a `HintRegistry`'s functions cannot cross a Turbo
 *  Module boundary, so native genuinely needs a marshaled-array-to-Map
 *  registry) pushed the web entry gzip size over the 8192-byte budget when
 *  reused here. Web has NO equivalent bridge constraint — a consumer sets
 *  this attribute directly as a plain JSX prop on their own element
 *  (`<div data-autoskeleton-radius={20}>`, no wrapper component needed —
 *  see `src/web/AutoSkeleton.tsx`'s header comment for the full rationale,
 *  including why the web `lines` hint is NOT wired: its only consultation
 *  point, the `clientrects-empty` fallback below, is unreachable with
 *  non-degenerate geometry under this module's current `isTextLeaf` gate —
 *  a real, pre-existing structural gap flagged here, not silently
 *  papered over — so wiring it would have spent NFR-6's tight remaining
 *  budget on genuinely dead code). */
export const HINT_RADIUS_ATTRIBUTE = 'data-autoskeleton-radius';

function hintRadiusAttr(el: Element): number | undefined {
  const raw = el.getAttribute(HINT_RADIUS_ATTRIBUTE);
  if (raw === null) {
    return undefined;
  }
  const parsed = Number(raw);
  return Number.isNaN(parsed) ? undefined : parsed;
}

const IMAGE_TAGS = new Set(['IMG']);
const INPUT_TAGS = new Set(['INPUT', 'BUTTON', 'TEXTAREA', 'SELECT']);

/** Local index<->ShapeSource table for the `sources` dev sidecar (mirrors the
 *  pattern `RADIUS_SOURCES` uses in `src/core/types.ts` for `radiusSources`).
 *  Kept web-local rather than added to core: nothing outside this module's
 *  own debug-overlay consumer (task 2.4) decodes it generically today. */
export const SHAPE_SOURCES: readonly ShapeSource[] = [
  'text',
  'image',
  'input',
  'background',
  'synthetic-line',
  'container',
];

export function createEmptyHintRegistry(): HintRegistry {
  return {
    linesFor: () => undefined,
    radiusFor: () => undefined,
    isIgnored: () => false,
  };
}

function nodeId(el: Element): string {
  return el.getAttribute(HINT_ID_ATTRIBUTE) ?? '';
}

function isIgnored(el: Element, hints: HintRegistry): boolean {
  return el.hasAttribute(IGNORE_ATTRIBUTE) || hints.isIgnored(nodeId(el));
}

/** `true` when the element paints something of its own (a solid color or an
 *  image) rather than being a purely structural, invisible wrapper. Treats a
 *  fully transparent `rgba(...)`/`rgb(... / 0)` color as "no background",
 *  matching the container-vs-leaf resolution scenario (spec §1.1). */
function hasNonTransparentBackground(style: CSSStyleDeclaration): boolean {
  const backgroundImage = style.backgroundImage;
  if (backgroundImage && backgroundImage !== 'none') {
    return true;
  }
  const backgroundColor = style.backgroundColor;
  if (!backgroundColor || backgroundColor === 'transparent') {
    return false;
  }
  const match = /rgba?\(([^)]+)\)/.exec(backgroundColor);
  if (match) {
    const parts = match[1]!.split(/[,/]/).map((p) => Number.parseFloat(p.trim()));
    const alpha = parts.length >= 4 ? parts[3] : 1;
    if (!Number.isNaN(alpha) && alpha === 0) {
      return false;
    }
  }
  return true;
}

/** Reads the resolved pixel radius from computed style. Web always knows the
 *  exact value directly (unlike Android's ADR-2 degradation ladder), so a
 *  typed `radius` hint is the only case a shape's radius is not `'measured'`. */
function parseRadius(style: CSSStyleDeclaration): number {
  const raw = style.borderTopLeftRadius || style.borderRadius;
  if (!raw) {
    return 0;
  }
  const first = raw.split(' ')[0] ?? '0px';
  const px = Number.parseFloat(first);
  return Number.isNaN(px) ? 0 : px;
}

function parseLineHeight(style: CSSStyleDeclaration): number {
  const fontSize = Number.parseFloat(style.fontSize) || 16;
  const raw = style.lineHeight;
  if (!raw || raw === 'normal') {
    return fontSize * 1.2;
  }
  const px = Number.parseFloat(raw);
  return Number.isNaN(px) ? fontSize * 1.2 : px;
}

function isTextLeaf(el: Element): boolean {
  if (el.children.length > 0) {
    return false;
  }
  return (el.textContent ?? '').trim().length > 0;
}

interface RelativeFrame {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

function frameOf(rect: DOMRect, rootRect: DOMRect): RelativeFrame {
  return {
    x: rect.left - rootRect.left,
    y: rect.top - rootRect.top,
    w: rect.width,
    h: rect.height,
  };
}

interface TraversalContext {
  readonly rootRect: DOMRect;
  readonly hints: HintRegistry;
  readonly maxShapes: number;
  readonly budgetMs: number;
  readonly startedAt: number;
  readonly shapes: ShapeInfo[];
  readonly shapeSources: ShapeSource[];
  readonly shapeRadiusSources: RadiusSource[];
  readonly degraded: Set<DegradationFlag>;
  truncated: boolean;
}

/** Soft budget check (NFR-3 local guard): called before descending into each
 *  node rather than after every single element, which keeps the check's own
 *  overhead from dominating a fast traversal while still truncating a
 *  runaway subtree well before it blows the budget by orders of magnitude. */
function overBudget(ctx: TraversalContext): boolean {
  if (ctx.truncated) {
    return true;
  }
  if (performance.now() - ctx.startedAt > ctx.budgetMs) {
    ctx.truncated = true;
    ctx.degraded.add('budget-exceeded');
    return true;
  }
  return false;
}

function isDegenerateFrame(frame: RelativeFrame): boolean {
  return frame.w <= 0 || frame.h <= 0;
}

/** Pushes a shape once capacity allows it. Returns `false` for two DIFFERENT
 *  reasons callers must not conflate: a degenerate (zero-size) frame, which
 *  simply should not become a shape and MUST NOT stop a caller's loop over
 *  sibling rects (e.g. the zero-width filler rect `Range.getClientRects()`
 *  emits at a `\n`); or `maxShapes` being reached, which sets `ctx.truncated`
 *  and DOES mean "stop everything". Callers branch on `ctx.truncated`, never
 *  on this return value alone, to tell the two apart. */
function pushShape(
  ctx: TraversalContext,
  frame: RelativeFrame,
  r: number,
  source: ShapeSource,
  radiusSource: RadiusSource,
): boolean {
  if (isDegenerateFrame(frame)) {
    return false;
  }
  if (ctx.shapes.length >= ctx.maxShapes) {
    ctx.truncated = true;
    ctx.degraded.add('shape-cap-reached');
    return false;
  }
  ctx.shapes.push({ x: frame.x, y: frame.y, w: frame.w, h: frame.h, r });
  ctx.shapeSources.push(source);
  ctx.shapeRadiusSources.push(radiusSource);
  return true;
}

function leafShape(el: Element, ctx: TraversalContext, source: ShapeSource, styleIn?: CSSStyleDeclaration): boolean {
  const style = styleIn ?? getComputedStyle(el);
  const frame = frameOf(el.getBoundingClientRect(), ctx.rootRect);
  const hintRadius = hintRadiusAttr(el);
  const r = hintRadius ?? parseRadius(style);
  const radiusSource: RadiusSource = hintRadius !== undefined ? 'hint' : 'measured';
  return pushShape(ctx, frame, r, source, radiusSource);
}

/** `Element.getClientRects()` returns a single border-box rect for a normal
 *  block-level element — it does NOT fragment per line box. Per-line
 *  fragments only come from `Range.getClientRects()` (or a naturally inline
 *  element), so a `Range` spanning the text node's contents is required here
 *  regardless of the leaf element's own `display`. This is real DOM geometry
 *  jsdom cannot produce at all (jsdom #653, #3729), on either API. */
function textLeafShapes(el: Element, ctx: TraversalContext): boolean {
  const range = document.createRange();
  range.selectNodeContents(el);
  const rects = range.getClientRects();
  let pushedAny = false;

  if (rects.length === 0) {
    ctx.degraded.add('clientrects-empty');
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    const lineHeight = parseLineHeight(style);
    const lines = synthesizeLines({
      x: rect.left - ctx.rootRect.left,
      y: rect.top - ctx.rootRect.top,
      w: rect.width,
      h: rect.height,
      lineHeight,
    });
    for (const line of lines) {
      if (overBudget(ctx)) break;
      // synthesizeLines never produces a degenerate frame, so any `false`
      // here is unambiguously the maxShapes cap.
      if (!pushShape(ctx, line, 0, 'synthetic-line', 'measured')) break;
      pushedAny = true;
    }
    return pushedAny;
  }

  for (let i = 0; i < rects.length; i++) {
    if (overBudget(ctx)) break;
    const frame = frameOf(rects[i]!, ctx.rootRect);
    const pushed = pushShape(ctx, frame, 0, 'text', 'measured');
    if (pushed) {
      pushedAny = true;
    } else if (ctx.truncated) {
      // maxShapes cap reached — stop entirely.
      break;
    }
    // else: a degenerate rect (e.g. the zero-width filler `Range` emits at a
    // `\n`) — skip it and keep scanning the remaining line rects.
  }
  return pushedAny;
}

/** Recursive traversal. Returns whether `el`'s subtree contributed at least
 *  one real shape, which is exactly the signal the container-vs-leaf
 *  resolution rule (spec §1.1) needs: a non-transparent container with
 *  detected leaves omits its own shape; with none, it renders its own frame
 *  instead. */
function traverse(el: Element, ctx: TraversalContext): boolean {
  if (overBudget(ctx)) {
    return false;
  }
  if (isIgnored(el, ctx.hints)) {
    return false;
  }

  const tag = el.tagName;
  if (IMAGE_TAGS.has(tag)) {
    return leafShape(el, ctx, 'image');
  }
  if (INPUT_TAGS.has(tag)) {
    return leafShape(el, ctx, 'input');
  }
  if (isTextLeaf(el)) {
    return textLeafShapes(el, ctx);
  }

  let childContributed = false;
  for (const child of Array.from(el.children)) {
    if (traverse(child, ctx)) {
      childContributed = true;
    }
    if (ctx.truncated) {
      break;
    }
  }
  if (childContributed) {
    return true;
  }

  const style = getComputedStyle(el);
  if (hasNonTransparentBackground(style)) {
    const source: ShapeSource = el.children.length > 0 ? 'container' : 'background';
    return leafShape(el, ctx, source, style);
  }
  return false;
}

function buildSnapshot(
  ctx: TraversalContext,
  key: SensorOptions['key'],
  frameWidth: number,
  frameHeight: number,
  collectDebugSidecars: boolean,
): SensorResult['snapshot'] {
  const data = encodeWire(ctx.shapes);
  const sources = collectDebugSidecars
    ? Uint8Array.from(ctx.shapeSources.map((s) => SHAPE_SOURCES.indexOf(s)))
    : undefined;
  const radiusSources = collectDebugSidecars
    ? Uint8Array.from(ctx.shapeRadiusSources.map((s) => RADIUS_SOURCES.indexOf(s)))
    : undefined;
  return {
    key,
    version: WIRE_VERSION,
    capturedAt: Date.now(),
    frameWidth,
    frameHeight,
    data,
    sources,
    radiusSources,
    degraded: Array.from(ctx.degraded),
  };
}

/** Creates the web `Sensor<HTMLElement>` (plan.md §3.4). Stateless: a single
 *  instance is safe to share across every `<AutoSkeleton>` on the page. */
export function createDomSensor(): Sensor<HTMLElement> {
  return {
    platform: 'web',

    measure(target, options) {
      const rootRect = target.getBoundingClientRect();
      if (rootRect.width === 0 && rootRect.height === 0) {
        return null;
      }

      performance.mark('autoskeleton-traversal-start');
      const startedAt = performance.now();
      const ctx: TraversalContext = {
        rootRect,
        hints: options.hints,
        maxShapes: options.maxShapes,
        budgetMs: options.budgetMs,
        startedAt,
        shapes: [],
        shapeSources: [],
        shapeRadiusSources: [],
        degraded: new Set(),
        truncated: false,
      };
      traverse(target, ctx);
      const traversalMs = performance.now() - startedAt;
      performance.mark('autoskeleton-traversal-end');
      performance.measure(
        'autoskeleton-traversal',
        'autoskeleton-traversal-start',
        'autoskeleton-traversal-end',
      );

      const snapshot = buildSnapshot(
        ctx,
        options.key,
        rootRect.width,
        rootRect.height,
        options.collectDebugSidecars,
      );
      return { snapshot, traversalMs, degraded: Array.from(ctx.degraded) };
    },

    observe(target, onInvalidate: (reason: InvalidationReason) => void) {
      const resizeObserver = new ResizeObserver(() => onInvalidate('resize'));
      resizeObserver.observe(target);
      const mutationObserver = new MutationObserver(() => onInvalidate('mutation'));
      mutationObserver.observe(target, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });
      return () => {
        resizeObserver.disconnect();
        mutationObserver.disconnect();
      };
    },

    dispose() {
      // Stateless: nothing to release.
    },
  };
}
