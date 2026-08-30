/**
 * The browsable demo index and its host.
 *
 * WHY THIS IS NOT THE APP'S FIRST SCREEN, and must never become it:
 * the on-device gates in `android/app/src/androidTest/**` and
 * `ios/AutoskeletonBareRnPaintGateUITests/**` launch the app and assume
 * `PaintGateScreen` is already mounted, then reach the list and tier-2
 * fixtures with exactly one and exactly two taps on
 * `paint-gate-screen-toggle`. An index screen at launch would break every one
 * of them at once. The gallery is therefore reached through a SEPARATE
 * control (`demo-open-gallery`) that sits beside the switcher, and the
 * switcher's cycle is untouched.
 */

import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { DEMOS, type DemoEntry } from './registry';
import { DEMO_COLORS } from './ui';

export function DemoGallery({
  onExit,
}: {
  /** Leaves the gallery and returns to the paint-gate fixture screens. */
  onExit: () => void;
}): React.JSX.Element {
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
            style={styles.barButton}
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
    <View style={styles.root}>
      <View style={styles.bar}>
        <Pressable
          accessible
          accessibilityRole="button"
          accessibilityLabel="demo-exit-gallery"
          testID="demo-exit-gallery"
          style={styles.barButton}
          onPress={onExit}
        >
          <Text style={styles.barButtonLabel}>‹ Gate fixtures</Text>
        </Pressable>
        <Text style={styles.barSource}>autoskeleton</Text>
      </View>

      <ScrollView contentContainerStyle={styles.indexBody}>
        <Text style={styles.indexTitle}>Demos</Text>
        <Text style={styles.indexClaim}>
          One capability per screen. Every entry here has been observed working on a device.
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
    </View>
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
  barButton: {
    paddingVertical: 6,
    paddingRight: 12,
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
    fontSize: 24,
    fontWeight: '700',
    color: DEMO_COLORS.ink,
  },
  indexClaim: {
    fontSize: 13,
    lineHeight: 18,
    color: DEMO_COLORS.muted,
    marginBottom: 4,
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
