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
 *  registry) pushed the web entry gzip size over the (then-8192-byte, now
 *  9216-byte — see spec.md NFR-6's second revision) budget when reused here.
 *  Web has NO equivalent bridge constraint — a consumer sets this attribute
 *  directly as a plain JSX prop on their own element
 *  (`<div data-autoskeleton-radius={20}>`), which is exactly what
 *  `src/web/Hint.tsx`'s `<AutoSkeleton.Hint>` now stamps too (added after
 *  the NFR-6 revision, registry-free, `cloneElement`-only) — see that
 *  module's header comment for the full rationale, including why the web
 *  `lines` hint is STILL NOT wired even after `<AutoSkeleton.Hint>` was
 *  added: its only consultation point, the `clientrects-empty` fallback
 *  below, is unreachable with non-degenerate geometry under this module's
 *  current `isTextLeaf` gate — a real, pre-existing structural gap flagged
 *  here, not silently papered over. Wiring it would require redesigning
 *  `isTextLeaf` itself (real surgery), not just adding an attribute read. */
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

function frameOf(rect: DOMRect, ctx: TraversalContext): RelativeFrame {
  return {
    x: (rect.left - ctx.rootRect.left) / ctx.sx,
    y: (rect.top - ctx.rootRect.top) / ctx.sy,
    w: rect.width / ctx.sx,
    h: rect.height / ctx.sy,
  };
}

/** Accumulated scale between the root's own layout box and its composed
 *  viewport rect, so `frameOf` reports the space the overlay is drawn in.
 *  Ratio-based, so `transform`, the `scale` property and `zoom` are all
 *  covered by one rule. `offsetWidth` is integer-rounded, so a difference of
 *  at most 1px is that rounding, never a transform. */
function axisScale(extent: number, box: number): number {
  return box > 0 && Math.abs(extent - box) > 1 ? extent / box : 1;
}

/** `true` when `el` establishes a CSS clipping context for its own content
 *  (`overflow-x`/`overflow-y` anything other than `'visible'` — covers
 *  `hidden`, `clip`, `auto` and `scroll` alike, so a scroll container clips
 *  exactly the same way as `overflow:hidden`). */
function clipsOverflow(el: Element): boolean {
  const style = getComputedStyle(el);
  return style.overflowX !== 'visible' || style.overflowY !== 'visible';
}

function intersectFrames(a: RelativeFrame, b: RelativeFrame): RelativeFrame {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.w, b.x + b.w);
  const bottom = Math.min(a.y + a.h, b.y + b.h);
  return { x, y, w: Math.max(0, right - x), h: Math.max(0, bottom - y) };
}

/** Walks from `el` (inclusive — a leaf can carry `overflow:hidden` directly,
 *  with no separate wrapper) up through every ancestor, INTERSECTING the box
 *  of every clipping ancestor found, stopping at (and including) the
 *  traversal root. Returns `undefined` when nothing on the path clips, the
 *  overwhelmingly common case, so the fast path stays a no-op.
 *
 *  Why intersect every clipping ancestor rather than stop at the nearest
 *  one: nested scrollable regions compound in real UI (a horizontally
 *  scrollable row inside a vertically scrollable panel), so a narrower OUTER
 *  clip must still win over a wider inner box, and vice versa — only the
 *  intersection of all of them is the actual visible box.
 *
 *  Why stop at the traversal root (inclusive, not beyond): nothing outside
 *  the measured subtree is this sensor's concern — the root's own frame is
 *  already the coordinate origin every shape is relative to, so walking
 *  further up the real page's DOM would clip against boxes the caller never
 *  asked this sensor to reason about. The root itself is still checked
 *  (`overflow:hidden` on the root legitimately clips its own descendants). */
function computeClipBox(el: Element, ctx: TraversalContext): RelativeFrame | undefined {
  let clip: RelativeFrame | undefined;
  let node: Element | null = el;
  while (node) {
    if (clipsOverflow(node)) {
      const rect = frameOf(node.getBoundingClientRect(), ctx);
      clip = clip ? intersectFrames(clip, rect) : rect;
    }
    if (node === ctx.root) {
      break;
    }
    node = node.parentElement;
  }
  return clip;
}

function applyClip(frame: RelativeFrame, clip: RelativeFrame | undefined): RelativeFrame {
  return clip ? intersectFrames(frame, clip) : frame;
}

interface TraversalContext {
  readonly root: Element;
  readonly rootRect: DOMRect;
  readonly sx: number;
  readonly sy: number;
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

/** Hard depth bound (defect fix: unbounded recursion crashed the renderer on
 *  a ~3000-level singly-nested tree — real trees get this deep: nested
 *  comment threads, recursive tree/list components). `overBudget()` alone
 *  cannot prevent this: it is TIME-based and only stops FUTURE recursive
 *  calls, so a tree that blows the call stack (or overwhelms the renderer)
 *  in well under `budgetMs` of wall-clock time is never caught by it. 300 is
 *  generous headroom over any realistically deep real-world UI tree (deeply
 *  nested comment threads and recursive components rarely exceed a few dozen
 *  levels) while staying far below any stack-overflow/renderer-crash risk. A
 *  fixed internal constant, not a `SensorOptions` field, since this is a
 *  safety bound rather than a per-consumer tunable, and keeps the fix
 *  scoped to the web sensor (native sensors are a separate traversal). */
const MAX_TRAVERSAL_DEPTH = 300;

/** Depth guard, checked at the very top of `traverse()` — mirrors
 *  `overBudget()`'s placement and truncation contract exactly (same
 *  `ctx.truncated` flag, same `ctx.degraded` set, same "stop everything"
 *  semantics the caller's `if (ctx.truncated) break;` loops already handle),
 *  so a runaway subtree degrades the same way every other limit in this
 *  sensor does: truncate and raise a flag the caller can see, never throw. */
function overDepth(ctx: TraversalContext, depth: number): boolean {
  if (ctx.truncated) {
    return true;
  }
  if (depth > MAX_TRAVERSAL_DEPTH) {
    ctx.truncated = true;
    ctx.degraded.add('depth-cap-reached');
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
  // A fully transparent leaf paints nothing, so covering it with an opaque
  // skeleton block draws a shape where the user sees empty space. Found
  // empirically against react-native-web (tasks.md G.17): every RNW `<Image>`
  // renders a `background-image` div AND a full-size `opacity: 0` `<img>`
  // kept only so the browser's image context menu works, so an image used to
  // produce TWO exactly-coincident shapes — invisible in a screenshot,
  // but double the shape count against `maxShapes`, double the traversal
  // work, and double the clip-path payload on an image-heavy screen.
  //
  // Deliberately checked HERE and not at the top of `traverse()`: every
  // caller of this function has already paid for `getComputedStyle`, so this
  // rule is free, whereas hoisting it would force a `getComputedStyle` on
  // every text leaf and every recursing container in the tree — a real NFR-3
  // traversal-budget regression to catch a rarer case. Consequences,
  // recorded rather than hidden: an `opacity: 0` TEXT leaf is still shaped,
  // and an `opacity: 0` CONTAINER still has its descendants shaped.
  // `getComputedStyle` normalizes the property to a bare number string, so
  // `'0'` is the whole domain of "invisible" here.
  if (style.opacity === '0') {
    return false;
  }
  const frame = frameOf(el.getBoundingClientRect(), ctx);
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
  // Computed once per leaf (invariant across every line box below), not
  // per-line: `Range.getClientRects()` reports the text's LAID-OUT box, not
  // its visually clipped box — an `overflow:hidden` + `text-overflow:
  // ellipsis` container reports its full untruncated text width even though
  // only a fraction is visible. Every pushed frame below is intersected
  // against this clip box before becoming a shape.
  const clip = computeClipBox(el, ctx);
  const range = document.createRange();
  range.selectNodeContents(el);
  const rects = range.getClientRects();
  let pushedAny = false;

  if (rects.length === 0) {
    ctx.degraded.add('clientrects-empty');
    const lines = synthesizeLines({
      ...frameOf(el.getBoundingClientRect(), ctx),
      lineHeight: parseLineHeight(getComputedStyle(el)) / ctx.sy,
    });
    for (const line of lines) {
      if (overBudget(ctx)) break;
      // synthesizeLines never produces a degenerate frame, so any `false`
      // here is unambiguously the maxShapes cap.
      if (!pushShape(ctx, applyClip(line, clip), 0, 'synthetic-line', 'measured')) break;
      pushedAny = true;
    }
    return pushedAny;
  }

  for (let i = 0; i < rects.length; i++) {
    if (overBudget(ctx)) break;
    const frame = applyClip(frameOf(rects[i]!, ctx), clip);
    const pushed = pushShape(ctx, frame, 0, 'text', 'measured');
    if (pushed) {
      pushedAny = true;
    } else if (ctx.truncated) {
      // maxShapes cap reached — stop entirely.
      break;
    }
    // else: a degenerate rect — either the zero-width filler `Range` emits
    // at a `\n`, or (now) a line box fully clipped away by an ancestor's
    // overflow — skip it and keep scanning the remaining line rects.
  }
  return pushedAny;
}

/** Recursive traversal. Returns whether `el`'s subtree contributed at least
 *  one real shape, which is exactly the signal the container-vs-leaf
 *  resolution rule (spec §1.1) needs: a non-transparent container with
 *  detected leaves omits its own shape; with none, it renders its own frame
 *  instead. */
function traverse(el: Element, ctx: TraversalContext, depth: number = 0): boolean {
  if (overBudget(ctx) || overDepth(ctx, depth)) {
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
  // An open shadow root is laid out but invisible to `el.children`. Slotted
  // light children are reached through `el.children` only, so still shaped
  // once. Closed roots report `null`, indistinguishable from having none.
  const shadow = el.shadowRoot;
  for (const child of shadow ? [...shadow.children, ...el.children] : Array.from(el.children)) {
    if (traverse(child, ctx, depth + 1)) {
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
        root: target,
        rootRect,
        sx: axisScale(rootRect.width, target.offsetWidth),
        sy: axisScale(rootRect.height, target.offsetHeight),
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
        rootRect.width / ctx.sx,
        rootRect.height / ctx.sy,
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
