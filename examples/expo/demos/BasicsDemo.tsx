/**
 * DEMO — the core component under Expo.
 *
 * Not a duplicate of `examples/bare-rn`'s cold-load demo, even though the
 * code is nearly identical, and that is the point: bare React Native and
 * Expo resolve this package through two DIFFERENT autolinking mechanisms
 * (`@react-native-community/cli` reading `react-native.config.js` and the
 * podspec, versus `expo-modules-autolinking` resolving over the manifest).
 * The same published tarball has to satisfy both. This screen running is the
 * Expo half of that proof.
 *
 * Expo Go cannot run this app: a custom native module is not in the Expo Go
 * binary, so a development build / prebuild is required. That is a documented
 * constraint of the library, not a failure of this example.
 *
 * `skeletonOnRefresh` is deliberately NOT set here — this is the cold path.
 * The stale-while-revalidate default and its opt-out are demonstrated in
 * `examples/bare-rn/demos/RefreshDemo.tsx`.
 */

import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AutoSkeleton } from 'autoskeleton';
import type { SkeletonMetrics } from 'autoskeleton';
import { Button, useFakeLoad } from './controls';
import { useDemoTheme } from './theme';
import { DemoPage, Panel, Readout, ReadoutRows, Row } from './ui';

export function BasicsDemo(): React.JSX.Element {
  const t = useDemoTheme();
  const load = useFakeLoad(1800);
  const [metrics, setMetrics] = useState<SkeletonMetrics | null>(null);
  const chip = t.scheme === 'dark' ? '#1d2b45' : '#dbeafe';

  return (
    <DemoPage
      title="Basics under Expo"
      claim="The same package, resolved through Expo autolinking instead of the RN CLI. Wrap real UI, get a measured skeleton."
    >
      <Row>
        <Button label="Load again (cold)" testID="demo-basics-reload" onPress={load.reloadCold} />
        <Button label="Reveal" tone="quiet" testID="demo-basics-reveal" onPress={load.reveal} />
      </Row>

      <Panel label="<AutoSkeleton isLoading skeletonKey='demo-expo-basics'>">
        <AutoSkeleton
          key={load.coldKey}
          isLoading={load.isLoading}
          skeletonKey="demo-expo-basics"
          onMetrics={setMetrics}
        >
          <View style={styles.card}>
            <View style={styles.headRow}>
              <View style={[styles.avatar, { backgroundColor: t.color.accent }]} />
              <View style={styles.headText}>
                <Text style={[styles.title, { color: t.color.ink }]}>Ada Lovelace</Text>
                <Text style={[styles.subtitle, { color: t.color.muted }]}>Analytical Engine</Text>
              </View>
            </View>
            <Text style={[t.type.body, { color: t.color.ink }]}>Note G, on the Analytical Engine</Text>
            <View style={styles.tagRow}>
              {/* Opaque, so the container rule counts each chip as its own
                  detected shape. A transparent sized box is a spacer. */}
              <View style={[styles.tag, { backgroundColor: chip }]} />
              <View style={[styles.tag, { backgroundColor: chip }]} />
            </View>
          </View>
        </AutoSkeleton>
      </Panel>

      {metrics === null ? (
        <Readout>onMetrics has not fired yet.</Readout>
      ) : (
        <ReadoutRows
          rows={[
            ['platform', metrics.platform],
            ['renderer', metrics.renderer],
            ['shapeCount', String(metrics.shapeCount)],
            ['cacheHit', String(metrics.cacheHit)],
          ]}
        />
      )}
    </DemoPage>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 12,
  },
  headRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
  },
  headText: {
    gap: 6,
  },
  title: {
    // Fixed widths on purpose: they make the two text leaves' measured frames
    // deterministic, which is what makes the skeleton reproducible in a
    // screenshot from one run to the next.
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '700',
    width: 180,
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 20,
    width: 140,
  },
  tagRow: {
    flexDirection: 'row',
    gap: 8,
  },
  tag: {
    width: 72,
    height: 26,
    borderRadius: 13,
  },
});
