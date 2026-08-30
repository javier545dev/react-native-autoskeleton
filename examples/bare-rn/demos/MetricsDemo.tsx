/**
 * DEMO — `onMetrics` and `debugOverlay`.
 *
 * Every instance reports what it actually did: how long the traversal took,
 * how many shapes came back, whether the snapshot cache answered, which
 * renderer drew, and how long the reader looked at the skeleton. The payload
 * is shaped to forward straight into a RUM tool as a custom span.
 *
 * `renderer` is the honest one to watch: it reports what DREW, not what is
 * installed. Without the tier-2 opt-in it says `native`, even in an app that
 * has Skia in its dependency tree.
 *
 * `debugOverlay` is dev-only (`__DEV__`) and draws the detected shapes with
 * their index and source type — the tool for "why was this node not
 * detected".
 */

import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AutoSkeleton } from 'autoskeleton';
import type { SkeletonMetrics } from 'autoskeleton';
import { Button, useFakeLoad } from './controls';
import { SampleCard } from './SampleCard';
import { DemoPage, Panel, Readout, Row } from './ui';

function format(m: SkeletonMetrics | null): string {
  if (m === null) {
    return 'onMetrics has not fired yet — it reports once the handoff settles.';
  }
  return [
    `platform:          ${m.platform}`,
    `renderer:          ${m.renderer}`,
    `cacheHit:          ${m.cacheHit}`,
    `shapeCount:        ${m.shapeCount}`,
    `traversalMs:       ${m.traversalMs.toFixed(2)}`,
    `ttfsMs:            ${m.ttfsMs.toFixed(2)}`,
    `displayDurationMs: ${m.displayDurationMs.toFixed(2)}`,
  ].join('\n');
}

export function MetricsDemo(): React.JSX.Element {
  const load = useFakeLoad(1500);
  const [metrics, setMetrics] = useState<SkeletonMetrics | null>(null);
  const [overlay, setOverlay] = useState(false);

  return (
    <DemoPage
      title="Metrics & debug overlay"
      claim="Every instance reports what it measured, what it cached and what actually drew."
    >
      <Row>
        <Button label="Load again (cold)" testID="demo-metrics-reload" onPress={load.reloadCold} />
        <Button
          label={overlay ? 'debugOverlay: on' : 'debugOverlay: off'}
          tone="quiet"
          testID="demo-metrics-overlay"
          onPress={() => {
            // The overlay only paints while the skeleton is on screen, so
            // flipping it restarts a cold load — otherwise turning it on
            // after the content arrived would appear to do nothing.
            setOverlay((v) => !v);
            load.reloadCold();
          }}
        />
      </Row>

      <Panel label="onMetrics payload">
        <Readout>{format(metrics)}</Readout>
      </Panel>

      <Panel
        label="the instance being measured"
        note="Cold-load it once, then again: the second run should report cacheHit: true and a much smaller traversalMs."
      >
        <View style={styles.host}>
          <AutoSkeleton
            key={load.coldKey}
            isLoading={load.isLoading}
            skeletonKey="demo-metrics"
            debugOverlay={overlay}
            onMetrics={setMetrics}
          >
            <SampleCard />
          </AutoSkeleton>
        </View>
      </Panel>
    </DemoPage>
  );
}

const styles = StyleSheet.create({
  host: {
    minHeight: 180,
  },
});
