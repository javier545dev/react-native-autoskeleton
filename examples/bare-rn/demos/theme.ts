/**
 * Design tokens for the demo gallery — light and dark.
 *
 * BYTE-IDENTICAL DUPLICATE. This file exists twice, at
 * `examples/bare-rn/demos/theme.ts` and `examples/expo/demos/theme.ts`, and
 * `demos/nav.tsx` is the other one. They are copied rather than extracted to a
 * shared folder on purpose: the two apps keep separate lockfiles, run
 * different React Native versions (0.87.1 vs 0.86.3) and are installed
 * independently in CI from a packed tarball, so a shared folder would need
 * `metro.config` `watchFolders` surgery in both and would undermine the
 * tarball-install realism that is the whole point of these examples. Keep the
 * two copies identical — `diff examples/bare-rn/demos/theme.ts
 * examples/expo/demos/theme.ts` must print nothing.
 *
 * `ui.tsx` and `controls.tsx` deliberately stay per-app: each carries its own
 * load-bearing rule in its header and their needs genuinely differ. They are
 * built on these tokens, which removes the drift that actually mattered
 * (colour, type, spacing).
 *
 * ── THE ONE RULE THESE TOKENS EXIST TO ENFORCE ────────────────────────────
 *
 * The skeleton is the subject. The chrome must recede and must never be
 * mistaken for it. The library paints BORDERLESS, FILLED, NEUTRAL-GREY,
 * ROUNDED, SHIMMERING rectangles (default ramp #e2e2e2 -> #f5f5f5). So, in
 * app chrome:
 *
 *   1. Never render a borderless filled grey block. Every chrome surface is
 *      text, or a hairline-bordered surface, or a small saturated-accent
 *      element. The fill-without-border look is reserved for the library's
 *      own output.
 *   2. Chrome neutrals are blue-tinted (slate), never pure grey; dark
 *      surfaces are navy-tinted. A grey that reads as "the library's grey" is
 *      a bug in the chrome.
 *   3. Never animate a gradient in chrome. Nothing shimmers on these screens
 *      except a skeleton.
 *   4. The stage is delimited: every live demo area sits inside a bordered
 *      panel whose label names the API under demonstration, so the reader
 *      always knows where "app" ends and "library output" begins.
 *   5. App chrome never sets the library's theme props. The only files that
 *      do are the theming demos, scoped to their own subtree.
 *
 * No shadows anywhere. Flatness is a distinguishability feature here, not
 * minimalism: a raised chrome surface competes with the thing being measured.
 *
 * ── MONO FAMILY: this fixes a real bug ────────────────────────────────────
 *
 * Every readout in both apps used `fontFamily: 'Courier'`. That family does
 * not exist on Android — the platform ships `monospace` / `Droid Sans Mono` —
 * so the "monospace" readouts silently fell back to the sans default on half
 * the devices these examples run on, and the column alignment the readouts
 * are written for was lost. `Platform.select` below is the fix.
 */

import { Platform, StyleSheet, useColorScheme } from 'react-native';

export interface DemoPalette {
  /** Page background. Never the surface colour — the step between them is
   *  what makes a bordered panel read as a panel. */
  readonly canvas: string;
  /** Cards, nav bars, buttons. */
  readonly surface: string;
  /** The live demo area. Same value as `surface` in both schemes today; kept
   *  as its own token because the stage is a distinct role and may need to
   *  diverge (see the web tokens, where it already does). */
  readonly stage: string;
  readonly ink: string;
  readonly muted: string;
  readonly faint: string;
  readonly line: string;
  readonly lineStrong: string;
  readonly accent: string;
  /** Text/icon colour ON `accent`. */
  readonly accentInk: string;
  /** Accent at low alpha, for a selected row's fill. */
  readonly accentSoft: string;
  readonly codeBg: string;
}

/** Slate, not grey (rule 2). The accent is a single blue, `#2f6fed`, shared
 *  with the Expo app — the two used to disagree (`#2f6fed` vs `#2563eb`) for
 *  no reason anyone could name. */
const LIGHT: DemoPalette = {
  canvas: '#f8fafc',
  surface: '#ffffff',
  stage: '#ffffff',
  ink: '#0f172a',
  muted: '#64748b',
  faint: '#94a3b8',
  line: '#e2e8f0',
  lineStrong: '#cbd5e1',
  accent: '#2f6fed',
  accentInk: '#ffffff',
  accentSoft: 'rgba(47,111,237,0.10)',
  codeBg: '#f1f5f9',
};

/** Navy-tinted (rule 2). Deliberately contains none of `#ff00ff`, `#00ff00`
 *  or `#0000ff`: `examples/expo/scripts/uniwind-paint-gate.mjs` finds its
 *  fixture in a raw framebuffer by exact match on those three, and a second
 *  region in any of them would widen the bounding box and move the sample off
 *  target. Same rule as `examples/expo/demos/ui.tsx`, restated here because
 *  this file is where a new colour would be added. */
const DARK: DemoPalette = {
  canvas: '#0b1220',
  surface: '#131c2e',
  stage: '#131c2e',
  ink: '#e7edf6',
  muted: '#93a3b8',
  faint: '#64748b',
  line: '#24314a',
  lineStrong: '#35476a',
  accent: '#7da2ff',
  accentInk: '#0b1220',
  accentSoft: 'rgba(125,162,255,0.16)',
  codeBg: '#0f1728',
};

export interface TypeToken {
  readonly fontSize: number;
  readonly lineHeight: number;
  readonly fontWeight: '400' | '500' | '600' | '700' | '800';
}

/** Seven roles, no more. Every text node on these screens is one of them. */
export const TYPE = {
  /** Gallery home title. */
  display: { fontSize: 28, lineHeight: 34, fontWeight: '800' },
  /** Demo screen title. */
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700' },
  /** Panel labels, section headers. */
  heading: { fontSize: 15, lineHeight: 20, fontWeight: '700' },
  /** Claims, notes, prose. */
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' },
  /** Buttons, segments, nav items, index rows. */
  label: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  /** Kickers, captions, source pointers. */
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '500' },
  /** Readouts. Pair with `MONO`. */
  code: { fontSize: 12, lineHeight: 17, fontWeight: '400' },
} as const satisfies Record<string, TypeToken>;

/** 4pt base. Page gutter 16, panel padding 16, control gap 8, section gap 24. */
export const SPACE = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

/** `sm` segments · `md` buttons and readouts · `lg` panels and cards. */
export const RADIUS = {
  sm: 6,
  md: 10,
  lg: 14,
} as const;

export const BORDER = {
  /** Nav rules and list separators: one physical pixel, not one point. */
  hairline: StyleSheet.hairlineWidth,
  /** Panels, cards, buttons. */
  panel: 1,
} as const;

/** See this file's header — `'Courier'` does not exist on Android. */
export const MONO: string = Platform.select({ ios: 'Menlo', default: 'monospace' }) as string;

export interface DemoTheme {
  readonly scheme: 'light' | 'dark';
  readonly color: DemoPalette;
  readonly type: typeof TYPE;
  readonly space: typeof SPACE;
  readonly radius: typeof RADIUS;
  readonly border: typeof BORDER;
  readonly mono: string;
}

const LIGHT_THEME: DemoTheme = {
  scheme: 'light',
  color: LIGHT,
  type: TYPE,
  space: SPACE,
  radius: RADIUS,
  border: BORDER,
  mono: MONO,
};

const DARK_THEME: DemoTheme = {
  scheme: 'dark',
  color: DARK,
  type: TYPE,
  space: SPACE,
  radius: RADIUS,
  border: BORDER,
  mono: MONO,
};

/**
 * The one way chrome reads a colour.
 *
 * Both themes are module constants, so the returned object is referentially
 * stable and can be put straight into a dependency array or a memo without
 * re-rendering anything that did not actually change scheme.
 *
 * `useColorScheme()` returns `null` when the platform has no preference (and
 * under `react-test-renderer`, where there is no native module to ask), so
 * light is the explicit default rather than an accident of coercion.
 */
export function useDemoTheme(): DemoTheme {
  return useColorScheme() === 'dark' ? DARK_THEME : LIGHT_THEME;
}
