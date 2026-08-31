/**
 * The Expo demo index.
 *
 * This app covers what is specific to Expo: the `autoskeleton/uniwind`
 * theming interop (native-only, and this is the app with uniwind installed),
 * the `expo-image` handoff, and the core component resolved through Expo
 * autolinking rather than the RN CLI. Everything platform-neutral —
 * lists, hints, ignore, delay, motion, tier-2 Skia — lives in
 * `examples/bare-rn/demos`, which has the peers for it.
 *
 * RULE: nothing goes in this list until it has been observed working on a
 * device.
 *
 * The `group` field is the taxonomy shared by all four example apps. Three
 * demos do not strictly need grouping, but the ids and their reading order do
 * not belong to this app — a reader who learns them in `examples/vite` or
 * `examples/bare-rn` should find the same shelf labels here.
 */

import type { ComponentType } from 'react';
import { BasicsDemo } from './BasicsDemo';
import { ImagePipelineDemo } from './ImagePipelineDemo';
import { ThemingDemo } from './ThemingDemo';

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
 * The full taxonomy, in reading order. This app has demos in three of these
 * nine groups; `DemoGallery` renders only the ones with entries. The list
 * stays complete on purpose — a group with nothing under it here is a fact
 * about this app's scope, not a hole in the system.
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
  readonly summary: string;
  readonly source: string;
  readonly group: GroupId;
  readonly component: ComponentType;
}

export const DEMOS: readonly DemoEntry[] = [
  {
    id: 'theming',
    title: 'Theming with uniwind',
    summary: 'One className drives the shimmer colours, checked against swatches carrying the same classes.',
    source: 'demos/ThemingDemo.tsx',
    group: 'theming',
    component: ThemingDemo,
  },
  {
    id: 'image',
    title: 'Image pipeline',
    summary: 'Skeleton → expo-image blurhash → decoded image, and the handoff reason it really reports.',
    source: 'demos/ImagePipelineDemo.tsx',
    group: 'detection',
    component: ImagePipelineDemo,
  },
  {
    id: 'basics',
    title: 'Basics under Expo',
    summary: 'The same tarball, resolved by Expo autolinking instead of the RN CLI.',
    source: 'demos/BasicsDemo.tsx',
    group: 'start-here',
    component: BasicsDemo,
  },
];

/** The index, in taxonomy order, with empty groups dropped. One place decides
 *  the gallery's reading order; `DemoGallery` just renders it. */
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
