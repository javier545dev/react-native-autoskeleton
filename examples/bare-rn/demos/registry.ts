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
 */

import type { ComponentType } from 'react';
import { ColdLoadDemo } from './ColdLoadDemo';
import { DelayDemo } from './DelayDemo';
import { HintDemo } from './HintDemo';
import { IgnoreDemo } from './IgnoreDemo';
import { ImageDemo } from './ImageDemo';
import { ListDemo } from './ListDemo';
import { MetricsDemo } from './MetricsDemo';
import { MotionDemo } from './MotionDemo';
import { RefreshDemo } from './RefreshDemo';
import { SkiaDemo } from './SkiaDemo';
import { TextDemo } from './TextDemo';
import { ThemingDemo } from './ThemingDemo';

export interface DemoEntry {
  readonly id: string;
  readonly title: string;
  /** One line, on the index card. What this demo makes obvious. */
  readonly summary: string;
  /** Where to read the code for it. */
  readonly source: string;
  readonly component: ComponentType;
}

export const DEMOS: readonly DemoEntry[] = [
  {
    id: 'cold-load',
    title: 'Cold load',
    summary: 'Wrap real UI. The skeleton comes from the measured layout — you never author one.',
    source: 'demos/ColdLoadDemo.tsx',
    component: ColdLoadDemo,
  },
  {
    id: 'text',
    title: 'Text',
    summary: 'A <Text> is one detected leaf. One <Text> per line of meaning is the text-shaped skeleton.',
    source: 'demos/TextDemo.tsx',
    component: TextDemo,
  },
  {
    id: 'images',
    title: 'Images',
    summary: "An image is its own detected leaf: the placeholder keeps the picture's real frame.",
    source: 'demos/ImageDemo.tsx',
    component: ImageDemo,
  },
  {
    id: 'hint',
    title: 'Radius hint',
    summary: 'A square view with no borderRadius — the rounded corner comes only from the hint.',
    source: 'demos/HintDemo.tsx',
    component: HintDemo,
  },
  {
    id: 'ignore',
    title: 'Ignore',
    summary: 'A live badge keeps ticking while everything around it is a placeholder.',
    source: 'demos/IgnoreDemo.tsx',
    component: IgnoreDemo,
  },
  {
    id: 'list',
    title: 'Virtualized lists',
    summary: 'SkeletonList, SkeletonCell, SkeletonListFooter, useSkeletonCell — and zero traversal on bind.',
    source: 'demos/ListDemo.tsx',
    component: ListDemo,
  },
  {
    id: 'refresh',
    title: 'Refresh',
    summary: 'Stale-while-revalidate is the default; skeletonOnRefresh opts out. Same button, both cards.',
    source: 'demos/RefreshDemo.tsx',
    component: RefreshDemo,
  },
  {
    id: 'delay',
    title: 'Delay',
    summary: 'A load that resolves in 120 ms should not flash a skeleton. delay is why it does not.',
    source: 'demos/DelayDemo.tsx',
    component: DelayDemo,
  },
  {
    id: 'motion',
    title: 'Motion',
    summary: 'shimmer / pulse / none, and the automatic downgrade when the OS asks for reduced motion.',
    source: 'demos/MotionDemo.tsx',
    component: MotionDemo,
  },
  {
    id: 'theming',
    title: 'Theming',
    summary: 'Provider defaults, overridden per instance. The same props the uniwind interop maps onto.',
    source: 'demos/ThemingDemo.tsx',
    component: ThemingDemo,
  },
  {
    id: 'metrics',
    title: 'Metrics & debug overlay',
    summary: 'What it measured, what it cached, and what actually drew.',
    source: 'demos/MetricsDemo.tsx',
    component: MetricsDemo,
  },
  {
    id: 'skia',
    title: 'Tier 2 — Skia',
    summary: 'The opt-in upgrade, wired the way a consumer wires it. Two instances, one shared clock.',
    source: 'demos/SkiaDemo.tsx',
    component: SkiaDemo,
  },
];
