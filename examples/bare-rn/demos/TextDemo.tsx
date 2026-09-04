/**
 * DEMO — Text.
 *
 * What this shows is what the NATIVE sensor actually does, which is not what
 * the web sensor does, and the difference is worth being blunt about:
 *
 *   web    `element.getClientRects()` returns one rect per LINE BOX, so a
 *          wrapped paragraph becomes a stack of line placeholders with no
 *          hints from you at all.
 *   native there is no per-line geometry to read. A `<Text>` is one detected
 *          leaf and becomes ONE rect covering its whole measured frame.
 *
 * So on iOS and Android you get a text-shaped skeleton by writing text the
 * way you would anyway — one `<Text>` per line of meaning (title, subtitle,
 * metadata), which is how most real UI is already written. Panel B is that.
 *
 * MEASURED, on this device, 2026-08-29 (both an Android emulator and an iOS
 * simulator agreed): a 2-line paragraph reports `shapeCount: 1`, and three
 * stacked `<Text>` nodes report `shapeCount: 3`. The readouts below come from
 * the public `onMetrics` callback, so you can re-check the claim rather than
 * take it.
 *
 * `<AutoSkeleton.Hint lines>` deliberately does NOT appear in this demo. See
 * the note in panel C for the measurement that kept it out.
 */

import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AutoSkeleton } from 'autoskeleton';
import type { SkeletonMetrics } from 'autoskeleton';
import { Button, useFakeLoad } from './controls';
import { useDemoTheme } from './theme';
import { DemoPage, Panel, Readout, Row } from './ui';

function useShapeCount(): [string, (m: SkeletonMetrics) => void] {
  const [text, setText] = useState('shapeCount: pending');
  return [
    text,
    (m: SkeletonMetrics) => setText(`shapeCount: ${m.shapeCount}   cacheHit: ${m.cacheHit}`),
  ];
}

export function TextDemo(): React.JSX.Element {
  const t = useDemoTheme();
  const load = useFakeLoad(2200);
  const [aText, onA] = useShapeCount();
  const [bText, onB] = useShapeCount();

  return (
    <DemoPage
      title="Text"
      claim="On native a <Text> is one detected leaf, so one <Text> per line of meaning is what gives you a text-shaped skeleton."
    >
      <Row>
        <Button label="Load again (cold)" testID="demo-text-reload" onPress={load.reloadCold} />
      </Row>

      <Panel
        label="A. one paragraph"
        note="Wraps onto two lines on screen, and produces exactly one placeholder rect. Native has no per-line geometry to read."
      >
        <AutoSkeleton
          key={`a-${load.coldKey}`}
          isLoading={load.isLoading}
          skeletonKey="demo-text-a"
          onMetrics={onA}
        >
          <View style={styles.block}>
            <Text style={[t.type.body, { color: t.color.ink }]}>
              The Analytical Engine weaves algebraic patterns just as the Jacquard loom weaves
              flowers and leaves.
            </Text>
          </View>
        </AutoSkeleton>
        <Readout>{aText}</Readout>
      </Panel>

      <Panel
        label="B. three separate <Text> nodes"
        note="Title, subtitle, metadata — ordinary markup, and each one becomes its own placeholder at its own width."
      >
        <AutoSkeleton
          key={`b-${load.coldKey}`}
          isLoading={load.isLoading}
          skeletonKey="demo-text-b"
          onMetrics={onB}
        >
          <View style={styles.block}>
            <Text style={[styles.title, { color: t.color.ink }]}>Ada Lovelace</Text>
            <Text style={[t.type.body, { color: t.color.ink }]}>Note G, on the Analytical Engine</Text>
            <Text style={[t.type.caption, { color: t.color.muted }]}>1843 · 8 min read</Text>
          </View>
        </AutoSkeleton>
        <Readout>{bText}</Readout>
      </Panel>

      <Panel
        live={false}
        label="C. why there is no lines-hint panel here"
        note={
          'The typed `lines` hint synthesises N line rects, but only for a text leaf that ' +
          'measures LESS than 20 units tall — pixels on Android (about 7dp), points on iOS. ' +
          'A <Text> at any readable size never gets there: measured on both platforms, an ' +
          'empty <Text lineHeight={22}> reports shapeCount 1 with the hint and 1 without it. ' +
          'Rather than stage a 5pt font to make it fire, it is left out.'
        }
      >
        <View />
      </Panel>
    </DemoPage>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: 8,
  },
  title: {
    fontSize: 20,
    lineHeight: 28,
    fontWeight: '700',
  },
});
