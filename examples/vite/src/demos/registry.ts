// examples/vite/src/demos/registry.ts
//
// One entry per demo, in reading order. Each entry carries its own source
// text, imported with Vite's `?raw` so the snippet shown under a demo is
// literally the file that just ran — a copy-pasted excerpt would be free to
// drift, and an example app that documents something it no longer does is
// worse than no example at all.
//
// Reading order and GROUPING are two different things. The array below stays
// in the order it has always been in — it is the order the demos were written
// in and the order the diffs are easiest to read in — while the page's
// information architecture comes from each entry's `group`. Reordering the
// array would change nothing on screen and lose that history.

import type { ComponentType } from 'react'

import { CacheReplay } from './CacheReplay'
import { ColdLoad } from './ColdLoad'
import { ColdMissFallback } from './ColdMissFallback'
import { CssVariableTheme } from './CssVariableTheme'
import { DataChildFunction } from './DataChildFunction'
import { DataNullish } from './DataNullish'
import { DebugOverlayDemo } from './DebugOverlayDemo'
import { HiddenContent } from './HiddenContent'
import { HintRadius } from './HintRadius'
import { IgnoreSubtree } from './IgnoreSubtree'
import { ImageHandoff } from './ImageHandoff'
import { LoadingWins } from './LoadingWins'
import { ReducedMotion } from './ReducedMotion'
import { RefreshPolicy } from './RefreshPolicy'
import { TailwindTheme } from './TailwindTheme'
import { TextLines } from './TextLines'

import hiddenContentSource from './HiddenContent.tsx?raw'
import cacheReplaySource from './CacheReplay.tsx?raw'
import coldLoadSource from './ColdLoad.tsx?raw'
import coldMissFallbackSource from './ColdMissFallback.tsx?raw'
import cssVariableThemeSource from './CssVariableTheme.tsx?raw'
import dataChildFunctionSource from './DataChildFunction.tsx?raw'
import dataNullishSource from './DataNullish.tsx?raw'
import debugOverlaySource from './DebugOverlayDemo.tsx?raw'
import hintRadiusSource from './HintRadius.tsx?raw'
import ignoreSubtreeSource from './IgnoreSubtree.tsx?raw'
import imageHandoffSource from './ImageHandoff.tsx?raw'
import loadingWinsSource from './LoadingWins.tsx?raw'
import reducedMotionSource from './ReducedMotion.tsx?raw'
import refreshPolicySource from './RefreshPolicy.tsx?raw'
import tailwindThemeSource from './TailwindTheme.tsx?raw'
import textLinesSource from './TextLines.tsx?raw'

/** The group taxonomy is shared by all four example apps, so a reader who
 *  arrives from `examples/next` or either native gallery meets the same six
 *  headings in the same order. This app has demos for six of the nine groups;
 *  `lists`, `server` and `tier2` are demonstrated in the apps that can
 *  actually show them. */
export type GroupId =
  | 'start-here'
  | 'detection'
  | 'lifecycle'
  | 'control'
  | 'theming'
  | 'diagnostics'

export interface DemoGroup {
  readonly id: GroupId
  readonly title: string
  /** Shown under the header on the index; answers "why is this a group?". */
  readonly line: string
}

export const GROUPS: readonly DemoGroup[] = [
  {
    id: 'start-here',
    title: 'Start here',
    line: 'Wrap real UI. The skeleton comes from the measured layout — you never author one.',
  },
  {
    id: 'detection',
    title: 'What gets detected',
    line: 'Which parts of your tree become shapes, and what each leaf kind turns into.',
  },
  {
    id: 'lifecycle',
    title: 'Lifecycle',
    line: 'When a skeleton appears, replays and leaves — the timing rules that surprise people.',
  },
  {
    id: 'control',
    title: 'Control & opt-out',
    line: 'Steering the automatic answer: shape hints, exclusions, timing, refresh policy.',
  },
  {
    id: 'theming',
    title: 'Theming & motion',
    line: 'How the skeleton looks and moves, and what happens when the reader asks for less motion.',
  },
  {
    id: 'diagnostics',
    title: 'Diagnostics',
    line: 'What it measured, what it cached, and what actually drew.',
  },
]

export interface Demo {
  /** Slug used for the `#/<id>` deep link and the section's DOM id. */
  readonly id: string
  readonly title: string
  /** Which section of the page and of the sidebar this demo belongs under. */
  readonly group: GroupId
  /** The single thing this demo is supposed to make obvious. */
  readonly shows: string
  readonly file: string
  readonly source: string
  readonly Component: ComponentType
}

export const DEMOS: readonly Demo[] = [
  {
    id: 'cold-load',
    title: 'Cold load',
    group: 'start-here',
    shows:
      'No skeleton was authored for this card. The shapes come from a real traversal of the content’s own laid-out geometry, on the first frame of the loading state.',
    file: 'src/demos/ColdLoad.tsx',
    source: coldLoadSource,
    Component: ColdLoad,
  },
  {
    id: 'text-lines',
    title: 'Text resolves per line',
    group: 'detection',
    shows:
      'A wrapped paragraph is one element with one box, but the skeleton has one bar per line box — fragmented through Range.getClientRects(), ragged last line included.',
    file: 'src/demos/TextLines.tsx',
    source: textLinesSource,
    Component: TextLines,
  },
  {
    id: 'hidden-content',
    title: 'Hidden content is not measured',
    group: 'detection',
    shows:
      'A `visibility: hidden` element keeps its box and its rect, so it is easy to shape by accident — a skeleton block over a region that stays empty. It is skipped instead. Toggle the badge and watch the shape count drop by one.',
    file: 'src/demos/HiddenContent.tsx',
    source: hiddenContentSource,
    Component: HiddenContent,
  },
  {
    id: 'cache-replay',
    title: 'Cached replay after navigation',
    group: 'lifecycle',
    shows:
      'Unmount the panel and open it again: the skeleton is drawn from the snapshot measured the first time, with a 0.00 ms traversal and a cache HIT.',
    file: 'src/demos/CacheReplay.tsx',
    source: cacheReplaySource,
    Component: CacheReplay,
  },
  {
    id: 'image-handoff',
    title: 'Images: reveal before hide',
    group: 'detection',
    shows:
      'The skeleton is removed only after the real image has actually painted, so there is never a frame with neither on screen.',
    file: 'src/demos/ImageHandoff.tsx',
    source: imageHandoffSource,
    Component: ImageHandoff,
  },
  {
    id: 'ignore',
    title: 'Opting a subtree out',
    group: 'control',
    shows:
      'AutoSkeleton.Ignore and the exported IGNORE_ATTRIBUTE remove a subtree from detection, leaving a hole in the skeleton and moving the shape count.',
    file: 'src/demos/IgnoreSubtree.tsx',
    source: ignoreSubtreeSource,
    Component: IgnoreSubtree,
  },
  {
    id: 'hint',
    title: 'Hints override geometry',
    group: 'control',
    shows:
      'Two identical square cards; the one wrapped in AutoSkeleton.Hint radius={40} gets a pill-shaped skeleton. A typed prop, never a parsed className.',
    file: 'src/demos/HintRadius.tsx',
    source: hintRadiusSource,
    Component: HintRadius,
  },
  {
    id: 'css-variables',
    title: 'Theming with CSS variables',
    group: 'theming',
    shows:
      'Three identical components paint three different skeleton colours, purely from --skl-base/--skl-highlight inherited through the cascade. No props.',
    file: 'src/demos/CssVariableTheme.tsx',
    source: cssVariableThemeSource,
    Component: CssVariableTheme,
  },
  {
    id: 'tailwind-theme',
    title: 'Theming with Tailwind v4 @theme',
    group: 'theming',
    shows:
      'The same contract driven by Tailwind v4 design tokens, with dark mode as a pure class flip on <html> — no prop change, no remount, no renderer call.',
    file: 'src/demos/TailwindTheme.tsx',
    source: tailwindThemeSource,
    Component: TailwindTheme,
  },
  {
    id: 'refresh',
    title: 'Refresh does not blank your content',
    group: 'lifecycle',
    shows:
      'Identical prop sequences, one difference: skeletonOnRefresh. By default a refresh over already-shown content keeps the content (REQ-PTR-1).',
    file: 'src/demos/RefreshPolicy.tsx',
    source: refreshPolicySource,
    Component: RefreshPolicy,
  },
  {
    id: 'reduced-motion',
    title: 'Reduced motion',
    group: 'theming',
    // Kept in step with `ReducedMotion.tsx`'s own on-screen note by hand: the
    // two sentences describe the same behaviour and drifted apart once
    // already, when commit f464f11 moved the pulse onto the element that
    // actually carries the highlight.
    shows:
      'What the reader asked for wins: with prefers-reduced-motion: reduce the sweep stops and the highlight breathes in place — which is NOT what animation="none" gives you, since that animates nothing at all.',
    file: 'src/demos/ReducedMotion.tsx',
    source: reducedMotionSource,
    Component: ReducedMotion,
  },
  {
    id: 'debug-overlay',
    title: 'Debug overlay (dev builds)',
    group: 'diagnostics',
    shows:
      'Every detected shape outlined and labelled with the source the sensor classified it as, plus a cache HIT/MISS badge. Compiled out of production builds.',
    file: 'src/demos/DebugOverlayDemo.tsx',
    source: debugOverlaySource,
    Component: DebugOverlayDemo,
  },
  {
    id: 'data-nullish',
    title: 'What data counts as loading',
    group: 'start-here',
    shows:
      'Only nullish data means loading. This cart sits on a measured skeleton while its count is null and leaves it the instant the value becomes 0 — falsy, and an ordinary loaded value.',
    file: 'src/demos/DataNullish.tsx',
    source: dataNullishSource,
    Component: DataNullish,
  },
  {
    id: 'data-child',
    title: 'One condition instead of two',
    group: 'start-here',
    shows:
      'Same value, same moment, same result on screen: data={user} with a function child does what isLoading={user === null} plus the inverted {user !== null && …} guard did — and the child is handed a non-null User, so nothing restates the condition.',
    file: 'src/demos/DataChildFunction.tsx',
    source: dataChildFunctionSource,
    Component: DataChildFunction,
  },
  {
    id: 'cold-fallback',
    title: 'Cold miss: what fallback is for',
    group: 'lifecycle',
    shows:
      'A function child leaves nothing mounted to measure. Without fallback the wrapper has no box at all — nothing traversed, nothing reported, 0 pixels, forever. With it there is a box and a visible loading state, though what paints in that box on web today is one unclipped block rather than the placeholder you wrote, and the demo measures why.',
    file: 'src/demos/ColdMissFallback.tsx',
    source: coldMissFallbackSource,
    Component: ColdMissFallback,
  },
  {
    id: 'loading-wins',
    title: 'isLoading wins over data',
    group: 'lifecycle',
    shows:
      'Both panels hold the same non-null data for the whole demo; only the one that also passes isLoading={isFetching} enters a loading state when the refetch starts.',
    file: 'src/demos/LoadingWins.tsx',
    source: loadingWinsSource,
    Component: LoadingWins,
  },
]
