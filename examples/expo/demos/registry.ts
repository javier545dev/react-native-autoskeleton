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
 */

import type { ComponentType } from 'react';
import { BasicsDemo } from './BasicsDemo';
import { ImagePipelineDemo } from './ImagePipelineDemo';
import { ThemingDemo } from './ThemingDemo';

export interface DemoEntry {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly source: string;
  readonly component: ComponentType;
}

export const DEMOS: readonly DemoEntry[] = [
  {
    id: 'theming',
    title: 'Theming with uniwind',
    summary: 'One className drives the shimmer colours, checked against swatches carrying the same classes.',
    source: 'demos/ThemingDemo.tsx',
    component: ThemingDemo,
  },
  {
    id: 'image',
    title: 'Image pipeline',
    summary: 'Skeleton → expo-image blurhash → decoded image, and the handoff reason it really reports.',
    source: 'demos/ImagePipelineDemo.tsx',
    component: ImagePipelineDemo,
  },
  {
    id: 'basics',
    title: 'Basics under Expo',
    summary: 'The same tarball, resolved by Expo autolinking instead of the RN CLI.',
    source: 'demos/BasicsDemo.tsx',
    component: BasicsDemo,
  },
];
