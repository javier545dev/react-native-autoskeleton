/**
 * DEMO — `delay`.
 *
 * A skeleton that appears for 90 ms and vanishes is worse than no skeleton:
 * it reads as a glitch. `delay` withholds the skeleton until that many
 * milliseconds have elapsed in the current loading cycle, so a fast load
 * shows nothing at all and a slow one still gets its placeholder.
 *
 * Both cards below load on the same button with the SAME duration. Only the
 * right one has `delay={400}`. Pick a fast load and watch the right card stay
 * calm while the left one flickers.
 */

import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AutoSkeleton } from 'autoskeleton';
import { Button, Segmented, useFakeLoad } from './controls';
import { useDemoTheme } from './theme';
import { DemoPage, Panel, Readout, Row } from './ui';

const DURATIONS = [
  { value: 120, label: 'fast (120 ms)' },
  { value: 1500, label: 'slow (1500 ms)' },
] as const;

const DELAY_MS = 400;

export function DelayDemo(): React.JSX.Element {
  const [duration, setDuration] = useState<number>(120);
  const load = useFakeLoad(duration, { autoStart: false });

  return (
    <DemoPage
      title="Delay"
      claim="delay suppresses the skeleton entirely for loads that resolve quickly, so a fast response never flashes."
    >
      <Row>
        <Segmented options={DURATIONS} value={duration} onChange={setDuration} testIDPrefix="demo-delay-duration" />
      </Row>
      <Row>
        <Button label="Load both" testID="demo-delay-run" onPress={load.reloadCold} />
      </Row>
      <Readout>
        {`load duration: ${duration} ms\nleft delay: 0 ms\nright delay: ${DELAY_MS} ms\n` +
          (duration < DELAY_MS
            ? 'expected: left flashes a skeleton, right shows none at all'
            : 'expected: both show a skeleton, right starts 400 ms later')}
      </Readout>

      <Panel label="no delay">
        <View key={`plain-${load.coldKey}`}>
          <AutoSkeleton isLoading={load.isLoading} skeletonKey="demo-delay-plain">
            <Card />
          </AutoSkeleton>
        </View>
      </Panel>

      <Panel label={`delay={${DELAY_MS}}`}>
        <View key={`delayed-${load.coldKey}`}>
          <AutoSkeleton isLoading={load.isLoading} skeletonKey="demo-delay-delayed" delay={DELAY_MS}>
            <Card />
          </AutoSkeleton>
        </View>
      </Panel>
    </DemoPage>
  );
}

function Card(): React.JSX.Element {
  const t = useDemoTheme();
  return (
    <View style={styles.card}>
      <View style={[styles.line, { backgroundColor: t.color.ink }]} />
      <View style={[styles.line, styles.lineShort, { backgroundColor: t.color.ink }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 10,
  },
  line: {
    width: '100%',
    height: 24,
    borderRadius: 4,
  },
  lineShort: {
    width: '55%',
  },
});
