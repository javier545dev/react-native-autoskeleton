/**
 * The demo index.
 *
 * One entry per capability. Each demo file starts with a comment saying what
 * it proves — an example app is documentation that runs, so the code has to
 * be findable from the screen you are looking at.
 *
 * RULE (see `docs/product-brief.md` §7 and this repo's history of shipping
 * "complete, tested, never called" features): nothing goes in this list until
 * it has been observed working ON A DEVICE. A gallery entry is a promise to a
 * user, and a promise the library cannot keep is worse than a missing demo.
 *
 * The `group` field is the shared taxonomy below. It is what turns a flat list
 * of fifteen equally-weighted cards into a reading order: a newcomer starts at
 * `start-here` and never has to guess whether `delay` is more fundamental than
 * `hint`. Array order is unchanged and stays the tie-breaker within a group.
 */

import type { ComponentType } from 'react';
import { ColdLoadDemo } from './ColdLoadDemo';
import { DataDemo } from './DataDemo';
import { DelayDemo } from './DelayDemo';
import { FallbackDemo } from './FallbackDemo';
import { HintDemo } from './HintDemo';
import { IgnoreDemo } from './IgnoreDemo';
import { ImageDemo } from './ImageDemo';
import { ListDemo } from './ListDemo';
import { MetricsDemo } from './MetricsDemo';
import { MotionDemo } from './MotionDemo';
import { RefreshDemo } from './RefreshDemo';
import { ScrollClipDemo } from './ScrollClipDemo';
import { SkiaDemo } from './SkiaDemo';
import { TextDemo } from './TextDemo';
import { ThemingDemo } from './ThemingDemo';

/** Ids and order are shared by all four example apps (`examples/vite`,
 *  `examples/next`, `examples/bare-rn`, `examples/expo`) so that a reader who
 *  learns the taxonomy in one recognises it in the next. */
export type GroupId =
  | 'start-here'
  | 'detection'
  | 'lifecycle'
  | 'control'
  | 'lists'
  | 'theming'
  | 'diagnostics'
  | 'server'
  | 'tier2';

export interface DemoGroup {
  readonly id: GroupId;
  /** Section header on the index. */
  readonly title: string;
  /** One line under the header. What the whole group is about. */
  readonly blurb: string;
}

/**
 * The full taxonomy, in reading order. This app has no `server` demos, so
 * `DemoGallery` renders only the groups that have entries — the list stays
 * complete on purpose, because a group with no demos here is a fact about this
 * app, not a hole in the system.
 */
export const GROUPS: readonly DemoGroup[] = [
  {
    id: 'start-here',
    title: 'Start here',
    blurb: 'Wrap real UI. The skeleton comes from the measured layout — you never author one.',
  },
  {
    id: 'detection',
    title: 'What gets detected',
    blurb: 'Which parts of your tree become shapes, and what each leaf kind turns into.',
  },
  {
    id: 'lifecycle',
    title: 'Lifecycle',
    blurb: 'When a skeleton appears, replays and leaves — the timing rules that surprise people.',
  },
  {
    id: 'control',
    title: 'Control & opt-out',
    blurb: 'Steering the automatic answer: shape hints, exclusions, timing, refresh policy.',
  },
  {
    id: 'lists',
    title: 'Lists',
    blurb: 'Virtualized lists are their own API surface and their own performance contract.',
  },
  {
    id: 'theming',
    title: 'Theming & motion',
    blurb: 'How the skeleton looks and moves, and what happens when the reader asks for less motion.',
  },
  {
    id: 'diagnostics',
    title: 'Diagnostics',
    blurb: 'What it measured, what it cached, and what actually drew.',
  },
  {
    id: 'server',
    title: 'Server rendering',
    blurb: 'Geometry captured at build time and replayed as a Suspense fallback.',
  },
  {
    id: 'tier2',
    title: 'Tier 2 (opt-in)',
    blurb: 'The upgrade path, not the default.',
  },
];

export interface DemoEntry {
  readonly id: string;
  readonly title: string;
  /** One line, on the index card. What this demo makes obvious. */
  readonly summary: string;
  /** Where to read the code for it. */
  readonly source: string;
  readonly group: GroupId;
  readonly component: ComponentType;
}

export const DEMOS: readonly DemoEntry[] = [
  {
    id: 'cold-load',
    title: 'Cold load',
    summary: 'Wrap real UI. The skeleton comes from the measured layout — you never author one.',
    source: 'demos/ColdLoadDemo.tsx',
    group: 'start-here',
    component: ColdLoadDemo,
  },
  {
    id: 'data',
    title: 'data-driven loading',
    summary: 'Pass the value, not a predicate. Nullish means loading; 0 and \'\' are loaded values.',
    source: 'demos/DataDemo.tsx',
    group: 'start-here',
    component: DataDemo,
  },
  {
    id: 'text',
    title: 'Text',
    summary: 'A <Text> is one detected leaf. One <Text> per line of meaning is the text-shaped skeleton.',
    source: 'demos/TextDemo.tsx',
    group: 'detection',
    component: TextDemo,
  },
  {
    id: 'images',
    title: 'Images',
    summary: "An image is its own detected leaf: the placeholder keeps the picture's real frame.",
    source: 'demos/ImageDemo.tsx',
    group: 'detection',
    component: ImageDemo,
  },
  {
    id: 'scroll-clip',
    title: 'Scroll clipping',
    summary: 'A leaf below the fold of a scroll container is clipped away, and never spends the shape budget.',
    source: 'demos/ScrollClipDemo.tsx',
    group: 'detection',
    component: ScrollClipDemo,
  },
  {
    id: 'fallback',
    title: 'Cold miss & fallback',
    summary: 'A strictly conditional child leaves nothing to measure. fallback is the only thing that can paint.',
    source: 'demos/FallbackDemo.tsx',
    group: 'lifecycle',
    component: FallbackDemo,
  },
  {
    id: 'hint',
    title: 'Radius hint',
    summary: 'A square view with no borderRadius — the rounded corner comes only from the hint.',
    source: 'demos/HintDemo.tsx',
    group: 'control',
    component: HintDemo,
  },
  {
    id: 'ignore',
    title: 'Ignore',
    summary: 'A live badge keeps ticking while everything around it is a placeholder.',
    source: 'demos/IgnoreDemo.tsx',
    group: 'control',
    component: IgnoreDemo,
  },
  {
    id: 'list',
    title: 'Virtualized lists',
    summary: 'SkeletonList, SkeletonCell, SkeletonListFooter, useSkeletonCell — and zero traversal on bind.',
    source: 'demos/ListDemo.tsx',
    group: 'lists',
    component: ListDemo,
  },
  {
    id: 'refresh',
    title: 'Refresh',
    summary: 'Stale-while-revalidate is the default; skeletonOnRefresh opts out. Same button, both cards.',
    source: 'demos/RefreshDemo.tsx',
    group: 'control',
    component: RefreshDemo,
  },
  {
    id: 'delay',
    title: 'Delay',
    summary: 'A load that resolves in 120 ms should not flash a skeleton. delay is why it does not.',
    source: 'demos/DelayDemo.tsx',
    group: 'control',
    component: DelayDemo,
  },
  {
    id: 'motion',
    title: 'Motion',
    summary: 'shimmer / pulse / none, and the automatic downgrade when the OS asks for reduced motion.',
    source: 'demos/MotionDemo.tsx',
    group: 'theming',
    component: MotionDemo,
  },
  {
    id: 'theming',
    title: 'Theming',
    summary: 'Provider defaults, overridden per instance. The same props the uniwind interop maps onto.',
    source: 'demos/ThemingDemo.tsx',
    group: 'theming',
    component: ThemingDemo,
  },
  {
    id: 'metrics',
    title: 'Metrics & debug overlay',
    summary: 'What it measured, what it cached, and what actually drew.',
    source: 'demos/MetricsDemo.tsx',
    group: 'diagnostics',
    component: MetricsDemo,
  },
  {
    id: 'skia',
    title: 'Tier 2 — Skia',
    summary: 'The opt-in upgrade, wired the way a consumer wires it. Two instances, one shared clock.',
    source: 'demos/SkiaDemo.tsx',
    group: 'tier2',
    component: SkiaDemo,
  },
];

/** The index, in taxonomy order, with empty groups dropped. One place decides
 *  what the gallery's reading order is; `DemoGallery` just renders it. */
export function groupedDemos(): ReadonlyArray<{
  readonly group: DemoGroup;
  readonly demos: readonly DemoEntry[];
}> {
  return GROUPS.map((group) => ({
    group,
    demos: DEMOS.filter((demo) => demo.group === group.id),
  })).filter((section) => section.demos.length > 0);
}

export function findDemo(id: string): DemoEntry | null {
  return DEMOS.find((demo) => demo.id === id) ?? null;
}

export function findGroup(id: GroupId): DemoGroup | null {
  return GROUPS.find((group) => group.id === id) ?? null;
}
