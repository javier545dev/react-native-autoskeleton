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
 * detected". NOTE: it draws on WEB ONLY. On both native platforms the prop
 * is accepted and stored and nothing reads it, so this demo shows the
 * metrics payload and not an overlay. See docs/platform-support.md.
 *
 * That last paragraph used to be a footnote under a WORKING-LOOKING TOGGLE.
 * Tapping it restarted the load and changed nothing on screen, which reads as
 * a broken app rather than as an unimplemented platform path — the reader
 * cannot tell "this prop does nothing here" from "this prop is broken". The
 * control is now rendered visibly inert with the reason next to it, which is
 * the same information delivered as a fact instead of as a dead end.
 */

import { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { AutoSkeleton } from 'autoskeleton';
import type { SkeletonMetrics } from 'autoskeleton';
import { Button, useFakeLoad } from './controls';
import { SampleCard } from './SampleCard';
import { Caption, DemoPage, Note, Panel, Readout, ReadoutRows, Row } from './ui';

function rows(m: SkeletonMetrics): ReadonlyArray<readonly [string, string]> {
  return [
    ['platform', m.platform],
    ['renderer', m.renderer],
    ['cacheHit', String(m.cacheHit)],
    ['shapeCount', String(m.shapeCount)],
    ['traversalMs', m.traversalMs.toFixed(2)],
    ['ttfsMs', m.ttfsMs.toFixed(2)],
    ['displayDurationMs', m.displayDurationMs.toFixed(2)],
  ];
}

export function MetricsDemo(): React.JSX.Element {
  const load = useFakeLoad(1500);
  const [metrics, setMetrics] = useState<SkeletonMetrics | null>(null);

  return (
    <DemoPage
      title="Metrics & debug overlay"
      claim="Every instance reports what it measured, what it cached and what actually drew."
    >
      <Row>
        <Button label="Load again (cold)" testID="demo-metrics-reload" onPress={load.reloadCold} />
      </Row>

      <Panel label="onMetrics payload">
        {metrics === null ? (
          <Readout>onMetrics has not fired yet — it reports once the handoff settles.</Readout>
        ) : (
          <ReadoutRows rows={rows(metrics)} />
        )}
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
            onMetrics={setMetrics}
          >
            <SampleCard />
          </AutoSkeleton>
        </View>
      </Panel>

      <Panel label="debugOverlay" live={false}>
        <Row>
          {/* Deliberately inert, not hidden. `debugOverlay` is a real prop with
           *  a real implementation — on web. Hiding it here would make this
           *  screen quietly disagree with the API docs; wiring it up would make
           *  the app look broken. */}
          <Button
            label="debugOverlay: unavailable"
            tone="quiet"
            testID="demo-metrics-overlay"
            disabled
            onPress={() => {}}
          />
        </Row>
        <Caption>{`Platform.OS = ${Platform.OS}`}</Caption>
        <Note>
          The prop is accepted and stored on both native platforms, and nothing reads it: the
          overlay classes exist and are unit-tested but have no production call site. It draws on
          web only. See docs/platform-support.md §5b.
        </Note>
      </Panel>
    </DemoPage>
  );
}

const styles = StyleSheet.create({
  host: {
    minHeight: 180,
  },
});
