/**
 * DEMO — Refresh: stale-while-revalidate (default) vs `skeletonOnRefresh`.
 *
 * REQ-PTR-1. Both cards below are driven by ONE `isLoading` flag and one
 * button. The left card is the untouched default: once it has shown content,
 * a later `isLoading=true` does not blank it out. The right card opts in with
 * `skeletonOnRefresh` and goes back to a skeleton every time.
 *
 * Two cards, one switch, side by side — because a demo of a DEFAULT is only
 * legible next to the thing it is the default instead of.
 */

import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AutoSkeleton } from 'autoskeleton';
import { Button, useFakeLoad } from './controls';
import { SampleCard } from './SampleCard';
import { DEMO_COLORS, DemoPage, Panel, Row } from './ui';

export function RefreshDemo(): React.JSX.Element {
  const load = useFakeLoad(1800);
  const [refreshes, setRefreshes] = useState(0);

  return (
    <DemoPage
      title="Refresh"
      claim="A refresh over content the reader is already looking at does not blank it out. That is the default; skeletonOnRefresh opts out."
    >
      <Row>
        <Button
          label={load.isLoading ? 'loading…' : 'Refresh both'}
          testID="demo-refresh-run"
          onPress={() => {
            setRefreshes((n) => n + 1);
            load.reload();
          }}
        />
        <Button
          label="Start over (cold)"
          tone="quiet"
          testID="demo-refresh-cold"
          onPress={() => {
            setRefreshes(0);
            load.reloadCold();
          }}
        />
      </Row>
      <Text style={styles.counter}>{`refreshes since cold start: ${refreshes}`}</Text>

      <Panel
        label="default — stale-while-revalidate"
        note="Cold load shows a skeleton. Every refresh after that keeps the stale content on screen."
      >
        <View key={`default-${load.coldKey}`}>
          <AutoSkeleton isLoading={load.isLoading} skeletonKey="demo-refresh-default">
            <SampleCard />
          </AutoSkeleton>
        </View>
      </Panel>

      <Panel
        label="skeletonOnRefresh"
        note="Opted in: every refresh replaces the content with a skeleton again."
      >
        <View key={`opt-in-${load.coldKey}`}>
          <AutoSkeleton isLoading={load.isLoading} skeletonKey="demo-refresh-opt-in" skeletonOnRefresh>
            <SampleCard />
          </AutoSkeleton>
        </View>
      </Panel>
    </DemoPage>
  );
}

const styles = StyleSheet.create({
  counter: {
    fontSize: 12,
    color: DEMO_COLORS.muted,
  },
});
