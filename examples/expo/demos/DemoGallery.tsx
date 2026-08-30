/**
 * The Expo demo index and its host.
 *
 * WHY THE PAINT-GATE STRIP STAYS ON THE HOME SCREEN and this is not the first
 * thing you see: `scripts/uniwind-paint-gate.mjs` (`npm run gate:uniwind`)
 * launches this app and then polls the raw Android framebuffer for three
 * registration-mark colours until they appear. It performs no navigation and
 * has no way to. If the fixture were behind a menu entry the gate would time
 * out with "paint-gate fixture never appeared on screen". So `App.tsx` keeps
 * the strip mounted above this index, and the index scrolls beneath it.
 */

import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { DEMOS, type DemoEntry } from './registry';
import { DEMO_COLORS } from './ui';

export function DemoGallery(): React.JSX.Element {
  const [open, setOpen] = useState<DemoEntry | null>(null);

  if (open !== null) {
    const Demo = open.component;
    return (
      <View style={styles.root}>
        <View style={styles.bar}>
          <Pressable
            accessible
            accessibilityRole="button"
            accessibilityLabel="demo-back"
            testID="demo-back"
            onPress={() => setOpen(null)}
          >
            <Text style={styles.barButtonLabel}>‹ Demos</Text>
          </Pressable>
          <Text style={styles.barSource} numberOfLines={1}>
            {open.source}
          </Text>
        </View>
        <Demo />
      </View>
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.indexBody}>
      <Text style={styles.indexTitle}>Demos</Text>
      <Text style={styles.indexClaim}>
        Every entry here has been observed working on a device. The strip above is the on-device
        theming gate fixture — it stays on screen because the gate cannot navigate.
      </Text>
      {DEMOS.map((demo) => (
        <Pressable
          key={demo.id}
          accessible
          accessibilityRole="button"
          accessibilityLabel={`demo-open-${demo.id}`}
          testID={`demo-open-${demo.id}`}
          style={styles.card}
          onPress={() => setOpen(demo)}
        >
          <Text style={styles.cardTitle}>{demo.title}</Text>
          <Text style={styles.cardSummary}>{demo.summary}</Text>
          <Text style={styles.cardSource}>{demo.source}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: DEMO_COLORS.canvas,
  },
  bar: {
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    backgroundColor: DEMO_COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: DEMO_COLORS.line,
  },
  barButtonLabel: {
    color: DEMO_COLORS.accent,
    fontWeight: '600',
    fontSize: 14,
  },
  barSource: {
    color: DEMO_COLORS.muted,
    fontSize: 11,
    fontFamily: 'Courier',
    flexShrink: 1,
  },
  indexBody: {
    padding: 16,
    gap: 12,
    paddingBottom: 48,
  },
  indexTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: DEMO_COLORS.ink,
  },
  indexClaim: {
    fontSize: 12,
    lineHeight: 17,
    color: DEMO_COLORS.muted,
  },
  card: {
    backgroundColor: DEMO_COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: DEMO_COLORS.line,
    padding: 14,
    gap: 5,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: DEMO_COLORS.ink,
  },
  cardSummary: {
    fontSize: 13,
    lineHeight: 18,
    color: DEMO_COLORS.muted,
  },
  cardSource: {
    fontSize: 11,
    fontFamily: 'Courier',
    color: DEMO_COLORS.accent,
  },
});
