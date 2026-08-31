/**
 * DEMO — Tailwind v4 / uniwind theming (`autoskeleton/uniwind`).
 *
 * `ThemedAutoSkeleton` is the whole interop: it takes a `className` and maps
 * the resolved style onto the ordinary public props —
 * `backgroundColor -> shimmerBaseColor`, `color -> shimmerHighlightColor`,
 * `borderRadius -> defaultRadius`. There is no private channel; a consumer
 * who does not use Tailwind can set those three props directly.
 *
 * Hints are typed props, never parsed out of `className`, because uniwind
 * transforms `className` at BUILD time — by the time the component runs there
 * is no class string left to parse.
 *
 * Each row below puts the skeleton next to two plain uniwind-styled swatches
 * carrying the SAME palette entries the skeleton names. That is what makes
 * the claim checkable by eye rather than asserted: the skeleton's ramp has to
 * run between those two colours. It is also exactly what
 * `scripts/uniwind-paint-gate.mjs` automates against the raw framebuffer for
 * the fixture on the home screen.
 *
 * NOTE, measured and not glossed: `rounded-*` in the className does NOT round
 * the skeleton on Android. `borderRadius` reaches `defaultRadius` correctly,
 * but the Android radius resolver reports a definite 0 for a view whose own
 * radius it cannot read, and a definite 0 wins over the default. Use
 * `<AutoSkeleton.Hint radius>` there. iOS is unaffected.
 *
 * `autoskeleton/uniwind` is native-only (spec.md §4) — it pulls in the native
 * `AutoSkeleton`, so it is never imported from `App.web.tsx`.
 */

import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ThemedAutoSkeleton } from 'autoskeleton/uniwind';
import { Button, Segmented, useFakeLoad } from './controls';
import { useDemoTheme } from './theme';
import { Caption, DemoPage, Panel, Readout, Row } from './ui';

/** `className` is transformed at build time, so these must be complete literal
 *  class strings — not composed from fragments at runtime. */
const PALETTES = {
  slate: {
    skeleton: 'bg-slate-400 text-cyan-300 rounded-2xl',
    base: 'bg-slate-400',
    highlight: 'bg-cyan-300',
    label: 'slate → cyan',
  },
  rose: {
    skeleton: 'bg-rose-300 text-amber-200 rounded-2xl',
    base: 'bg-rose-300',
    highlight: 'bg-amber-200',
    label: 'rose → amber',
  },
  zinc: {
    skeleton: 'bg-zinc-700 text-zinc-400 rounded-2xl',
    base: 'bg-zinc-700',
    highlight: 'bg-zinc-400',
    label: 'zinc (dark)',
  },
} as const;

type PaletteName = keyof typeof PALETTES;

const OPTIONS = [
  { value: 'slate' as const, label: 'slate' },
  { value: 'rose' as const, label: 'rose' },
  { value: 'zinc' as const, label: 'zinc' },
];

export function ThemingDemo(): React.JSX.Element {
  const t = useDemoTheme();
  const [palette, setPalette] = useState<PaletteName>('slate');
  const load = useFakeLoad(60_000);
  const p = PALETTES[palette];

  return (
    <DemoPage
      title="Theming with uniwind"
      claim="One className drives the skeleton's shimmer colours. The swatches beside it carry the same Tailwind classes, so the claim is checkable by eye."
    >
      <Row>
        <Segmented options={OPTIONS} value={palette} onChange={setPalette} testIDPrefix="demo-palette" />
      </Row>
      <Readout>{`className="${p.skeleton}"`}</Readout>

      <Panel
        label={`ThemedAutoSkeleton — ${p.label}`}
        note="Left and right are plain uniwind Views painting the two palette entries the skeleton names. The shimmer must run between them."
      >
        <View style={styles.compareRow}>
          <View style={styles.swatchColumn}>
            <View className={p.base} style={styles.swatch} />
            <Caption>base</Caption>
          </View>

          <View style={styles.skeletonHost}>
            <ThemedAutoSkeleton
              key={`${palette}-${load.coldKey}`}
              isLoading={load.isLoading}
              skeletonKey={`demo-uniwind-${palette}`}
              className={p.skeleton}
            >
              <View style={[styles.card, { backgroundColor: t.color.ink }]}>
                <Text style={[t.type.label, { color: t.color.canvas }]}>Loaded content</Text>
              </View>
            </ThemedAutoSkeleton>
          </View>

          <View style={styles.swatchColumn}>
            <View className={p.highlight} style={styles.swatch} />
            <Caption>highlight</Caption>
          </View>
        </View>
      </Panel>

      <Row>
        <Button label="Reveal content" tone="quiet" testID="demo-theme-reveal" onPress={load.reveal} />
        <Button label="Show skeleton again" testID="demo-theme-cold" onPress={load.reloadCold} />
      </Row>
    </DemoPage>
  );
}

const styles = StyleSheet.create({
  compareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  swatchColumn: {
    alignItems: 'center',
    gap: 4,
  },
  swatch: {
    width: 40,
    height: 72,
    borderRadius: 6,
  },
  skeletonHost: {
    flex: 1,
  },
  card: {
    // Opaque and high-contrast against every palette above, so the skeleton
    // that replaces it is unmistakably the skeleton and not the card.
    height: 72,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
