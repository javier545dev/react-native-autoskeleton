/**
 * DEMO — Theming without any styling-system interop.
 *
 * Two layers, and the order matters:
 *   1. `<SkeletonProvider theme>` sets the app-wide defaults.
 *   2. `shimmerBaseColor` / `shimmerHighlightColor` / `defaultRadius` on one
 *      `<AutoSkeleton>` layer ON TOP of that, they never replace it — only
 *      the fields actually supplied are overridden.
 *
 * These three props are exactly what the `autoskeleton/uniwind` interop maps
 * a resolved `className` onto; there is no private channel. The theming demo
 * driven by Tailwind classes lives in `examples/expo`, because
 * `autoskeleton/uniwind` is native-only and that app is the one with uniwind
 * installed.
 */

import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AutoSkeleton, SkeletonProvider } from 'autoskeleton';
import { Segmented } from './controls';
import { DEMO_COLORS, DemoPage, Panel, Readout, Row } from './ui';

const THEMES = {
  light: { baseColor: '#e2e8f0', highlightColor: '#f8fafc' },
  slate: { baseColor: '#334155', highlightColor: '#64748b' },
  warm: { baseColor: '#7c2d12', highlightColor: '#f97316' },
} as const;

type ThemeName = keyof typeof THEMES;

const THEME_OPTIONS = [
  { value: 'light' as const, label: 'light' },
  { value: 'slate' as const, label: 'slate' },
  { value: 'warm' as const, label: 'warm' },
];

export function ThemingDemo(): React.JSX.Element {
  const [themeName, setThemeName] = useState<ThemeName>('slate');
  const theme = THEMES[themeName];

  return (
    <DemoPage
      title="Theming"
      claim="A provider sets the app default; a single instance can override it without losing the rest of the theme."
    >
      <Row>
        <Segmented options={THEME_OPTIONS} value={themeName} onChange={setThemeName} testIDPrefix="demo-theme" />
      </Row>
      <Readout>
        {`SkeletonProvider theme = { baseColor: '${theme.baseColor}', highlightColor: '${theme.highlightColor}' }`}
      </Readout>

      <SkeletonProvider theme={{ ...theme, defaultRadius: 8 }}>
        <Panel label="inherits the provider theme">
          <AutoSkeleton isLoading skeletonKey={`demo-theme-inherit-${themeName}`}>
            <Card />
          </AutoSkeleton>
        </Panel>

        <Panel
          label="shimmerHighlightColor override on this instance only"
          note="Only the highlight is replaced. The base colour and radius still come from the provider above."
        >
          <AutoSkeleton
            isLoading
            skeletonKey={`demo-theme-override-${themeName}`}
            shimmerHighlightColor="#22d3ee"
          >
            <Card />
          </AutoSkeleton>
        </Panel>
      </SkeletonProvider>
    </DemoPage>
  );
}

function Card(): React.JSX.Element {
  return (
    <View style={styles.card}>
      <View style={styles.line} />
      <View style={[styles.line, styles.lineShort]} />
      <View style={styles.block} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 10,
  },
  line: {
    width: '100%',
    height: 20,
    borderRadius: 4,
    backgroundColor: DEMO_COLORS.ink,
  },
  lineShort: {
    width: '60%',
  },
  block: {
    width: '100%',
    height: 72,
    borderRadius: 10,
    backgroundColor: '#334155',
  },
});
