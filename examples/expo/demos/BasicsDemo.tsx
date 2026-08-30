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
import { DEMO_COLORS, DemoPage, Panel, Readout, Row } from './ui';

export function BasicsDemo(): React.JSX.Element {
  const load = useFakeLoad(1800);
  const [metrics, setMetrics] = useState<SkeletonMetrics | null>(null);

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
              <View style={styles.avatar} />
              <View style={styles.headText}>
                <Text style={styles.title}>Ada Lovelace</Text>
                <Text style={styles.subtitle}>Analytical Engine</Text>
              </View>
            </View>
            <Text style={styles.body}>Note G, on the Analytical Engine</Text>
            <View style={styles.tagRow}>
              <View style={styles.tag} />
              <View style={styles.tag} />
            </View>
          </View>
        </AutoSkeleton>
      </Panel>

      <Readout>
        {metrics === null
          ? 'onMetrics has not fired yet.'
          : `platform: ${metrics.platform}   renderer: ${metrics.renderer}   shapeCount: ${metrics.shapeCount}   cacheHit: ${metrics.cacheHit}`}
      </Readout>
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
    backgroundColor: '#2563eb',
  },
  headText: {
    gap: 6,
  },
  title: {
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '700',
    color: DEMO_COLORS.ink,
    width: 180,
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 20,
    color: DEMO_COLORS.muted,
    width: 140,
  },
  body: {
    fontSize: 14,
    lineHeight: 22,
    color: DEMO_COLORS.ink,
  },
  tagRow: {
    flexDirection: 'row',
    gap: 8,
  },
  tag: {
    width: 72,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#dbeafe',
  },
});
