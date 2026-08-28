/**
 * Fixture app for the on-device VISUAL PAINT GATE.
 *
 * Renders a `PaintGateScreen` (below) wrapped in `autoskeleton`'s native
 * `<AutoSkeleton>` — known, deterministically-colored content with a runtime
 * toggle for `isLoading`, so the paired instrumented test
 * (`android/app/src/androidTest/java/com/autoskeletonbarern/PaintGateInstrumentedTest.kt`)
 * has a real screen to rasterize and inspect pixels against.
 *
 * Do not change the `accessibilityLabel`s, `skeletonKey`, or fixture colors
 * exported below without updating that test — it locates these regions by
 * accessibility label and asserts exact pixel colors.
 *
 * @format
 */

import { useState } from 'react';
import { Pressable, StatusBar, StyleSheet, Text, useColorScheme, View } from 'react-native';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { AutoSkeleton } from 'autoskeleton';

/** Exported so the fixture and any future test/tooling share one source of
 *  truth for the deterministic colors the paint gate asserts against. */
export const PAINT_GATE_FIXTURE = {
  skeletonKey: 'paint-gate-card',
  labels: {
    toggle: 'paint-gate-toggle',
    content: 'paint-gate-content',
    text: 'paint-gate-text',
    image: 'paint-gate-image',
    card: 'paint-gate-rounded-card',
  },
  colors: {
    // Real, opaque, mutually distinct fills — never derived from a shared
    // constant with the skeleton theme, so a pixel match against
    // `SKELETON_BASE_COLOR` (#e2e2e2, `native/AutoSkeleton.tsx`'s
    // `DEFAULT_THEME`) can never be a coincidence in either direction.
    text: '#101010',
    image: '#0000FF',
    card: '#00A651',
  },
} as const;

function PaintGateScreen() {
  const [isLoading, setIsLoading] = useState(true);

  return (
    <View style={styles.screen} testID="paint-gate-root">
      <Pressable
        accessible
        accessibilityLabel={PAINT_GATE_FIXTURE.labels.toggle}
        accessibilityRole="button"
        testID="paint-gate-toggle"
        style={styles.toggle}
        onPress={() => setIsLoading((v) => !v)}
      >
        <Text style={styles.toggleLabel}>
          {isLoading ? 'isLoading: true (tap to reveal content)' : 'isLoading: false (tap to reload)'}
        </Text>
      </Pressable>

      <AutoSkeleton isLoading={isLoading} skeletonKey={PAINT_GATE_FIXTURE.skeletonKey}>
        <View
          accessible
          accessibilityLabel={PAINT_GATE_FIXTURE.labels.content}
          testID="paint-gate-content"
          style={styles.content}
        >
          <View
            accessible
            accessibilityLabel={PAINT_GATE_FIXTURE.labels.text}
            testID="paint-gate-text"
            style={[styles.textBlock, { backgroundColor: PAINT_GATE_FIXTURE.colors.text }]}
          >
            <Text style={styles.textBlockLabel}>Known content text block</Text>
          </View>
          <View
            accessible
            accessibilityLabel={PAINT_GATE_FIXTURE.labels.image}
            testID="paint-gate-image"
            style={[styles.imagePlaceholder, { backgroundColor: PAINT_GATE_FIXTURE.colors.image }]}
          />
          <View
            accessible
            accessibilityLabel={PAINT_GATE_FIXTURE.labels.card}
            testID="paint-gate-rounded-card"
            style={[styles.roundedCard, { backgroundColor: PAINT_GATE_FIXTURE.colors.card }]}
          />
        </View>
      </AutoSkeleton>
    </View>
  );
}

function App() {
  const isDarkMode = useColorScheme() === 'dark';

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      <AppContent />
    </SafeAreaProvider>
  );
}

function AppContent() {
  const safeAreaInsets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingTop: safeAreaInsets.top }]}>
      <PaintGateScreen />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  screen: {
    flex: 1,
    padding: 16,
    gap: 16,
  },
  toggle: {
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#dddddd',
    borderRadius: 8,
  },
  toggleLabel: {
    color: '#000000',
  },
  content: {
    gap: 16,
  },
  textBlock: {
    width: 260,
    height: 40,
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  textBlockLabel: {
    color: '#ffffff',
  },
  imagePlaceholder: {
    width: 160,
    height: 160,
  },
  roundedCard: {
    width: 240,
    height: 90,
    borderRadius: 16,
  },
});

export default App;
