/**
 * Fixture app for the on-device VISUAL PAINT GATE.
 *
 * Renders a `PaintGateScreen` (below) wrapped in `autoskeleton`'s native
 * `<AutoSkeleton>` — known, deterministically-colored content with a runtime
 * toggle for `isLoading`, so the paired instrumented test
 * (`android/app/src/androidTest/java/com/autoskeletonbarern/PaintGateInstrumentedTest.kt`)
 * has a real screen to rasterize and inspect pixels against.
 *
 * `PaintGateListScreen` (below) extends the same real-pixel-sampling
 * discipline to Phase 6's virtualized-list skeletons (tasks.md 6.1-6.4),
 * paired with `PaintGateListInstrumentedTest.kt` — a real `FlashList` so
 * cell RECYCLING (RISK-3: view instances reused across different items) is
 * genuinely exercised, not simulated.
 *
 * Do not change the `accessibilityLabel`s, `skeletonKey`/`itemType`s, or
 * fixture colors exported below without updating the paired instrumented
 * tests — they locate these regions by accessibility label and assert exact
 * pixel colors.
 *
 * @format
 */

import { useEffect, useState } from 'react';
import { FlashList } from '@shopify/flash-list';
import { Pressable, StatusBar, StyleSheet, Text, useColorScheme, View } from 'react-native';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { AutoSkeleton, SkeletonCell, SkeletonList, SkeletonListFooter, templateTraversalCounter } from 'autoskeleton';

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
    // `<AutoSkeleton.Ignore>` bug-fix gate.
    ignoredContent: 'paint-gate-ignored-content',
    ignoredSibling: 'paint-gate-ignored-sibling',
  },
  colors: {
    // Real, opaque, mutually distinct fills — never derived from a shared
    // constant with the skeleton theme, so a pixel match against
    // `SKELETON_BASE_COLOR` (#e2e2e2, `native/AutoSkeleton.tsx`'s
    // `DEFAULT_THEME`) can never be a coincidence in either direction.
    text: '#101010',
    image: '#0000FF',
    card: '#00A651',
    // `<AutoSkeleton.Ignore>` bug-fix gate (both new, distinct from every
    // other color above and from the skeleton ramp on at least one
    // channel): `ignored` sits INSIDE `<AutoSkeleton.Ignore>`, `ignoredSibling`
    // is its NON-ignored sibling in the exact same frame — see
    // `PaintGateInstrumentedTest.kt`'s/`PaintGateUITests.swift`'s
    // `ignoredRegionPaintsNoSkeletonWhileSiblingDoes` assertion.
    ignored: '#FF6600',
    ignoredSibling: '#8000FF',
  },
} as const;

/** Phase 6 list fixture (task 6.1-6.4). `itemType`/`skeletonKey` share one
 *  value (see `SkeletonCell`'s doc comment: `skeletonKey` defaults to
 *  `itemType` when omitted — this fixture supplies it explicitly for
 *  clarity, not because it differs). */
export const PAINT_GATE_LIST_FIXTURE = {
  itemType: 'paint-gate-list-card',
  skeletonKey: 'paint-gate-list-card',
  // task 6.1: a DISTINCT itemType so `SkeletonList` (below the traversal
  // counter, above the FlashList) exercises its own independent
  // first-ever template measurement.
  headerItemType: 'paint-gate-list-header-card',
  rowHeight: 96,
  itemCount: 40,
  labels: {
    screenToggle: 'paint-gate-screen-toggle',
    root: 'paint-gate-list-root',
    traversalCounter: 'paint-gate-list-traversal-counter',
    realCardPrefix: 'paint-gate-list-real-',
    skeletonCardPrefix: 'paint-gate-list-skeleton-',
    accent: 'paint-gate-list-accent',
    // task 6.1 (REQ-LIST-EMPTY-1/2): a distinct itemType so `SkeletonList`
    // exercises its OWN first-ever template measurement, independent of
    // the per-cell itemType `SkeletonCell` rows below already warm.
    headerListRowPrefix: 'paint-gate-list-header-row-',
    // task 6.2 (REQ-LIST-PAGE-1): shares `itemType`/`skeletonKey` with the
    // per-cell rows above — by the time the footer mounts, that itemType
    // is already cached, so the footer must resolve purely from cache.
    footerRowPrefix: 'paint-gate-list-footer-row-',
  },
  colors: {
    text: '#101010',
    accent: '#0000FF',
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
          {/* `<AutoSkeleton.Ignore>` bug-fix gate (this session's brief):
           *  `ignoredContent` sits INSIDE `<AutoSkeleton.Ignore>` — it must
           *  show NO skeleton pixels while `isLoading` is true, only its own
           *  fixture color. `ignoredSibling` is a plain, NOT-ignored sibling
           *  right next to it, in the SAME frame — it must show real skeleton
           *  pixels. Both halves matter: asserting only the first would pass
           *  even if the whole skeleton failed to render at all. */}
          <View
            accessible={false}
            accessibilityLabel="paint-gate-ignore-row"
            testID="paint-gate-ignore-row"
            style={styles.ignoreRow}
          >
            <AutoSkeleton.Ignore>
              <View
                accessible
                accessibilityLabel={PAINT_GATE_FIXTURE.labels.ignoredContent}
                testID="paint-gate-ignored-content"
                style={[styles.ignoredBlock, { backgroundColor: PAINT_GATE_FIXTURE.colors.ignored }]}
              />
            </AutoSkeleton.Ignore>
            <View
              accessible
              accessibilityLabel={PAINT_GATE_FIXTURE.labels.ignoredSibling}
              testID="paint-gate-ignored-sibling"
              style={[styles.ignoredBlock, { backgroundColor: PAINT_GATE_FIXTURE.colors.ignoredSibling }]}
            />
          </View>
        </View>
      </AutoSkeleton>
    </View>
  );
}

/** Real content for one list row — the template `SkeletonCell` measures once
 *  per `itemType`, and what a "loaded" row shows once `isLoading` is false.
 *  Deterministic, distinct colors from the skeleton theme, same discipline
 *  as `PaintGateScreen`'s own fixture. */
function ListCardContent({ accessibilityLabel }: { accessibilityLabel: string }) {
  return (
    <View
      accessible
      accessibilityLabel={accessibilityLabel}
      style={[styles.listCard, { height: PAINT_GATE_LIST_FIXTURE.rowHeight }]}
    >
      <View
        style={[styles.listCardText, { backgroundColor: PAINT_GATE_LIST_FIXTURE.colors.text }]}
      />
      <View
        accessible
        accessibilityLabel={PAINT_GATE_LIST_FIXTURE.labels.accent}
        style={[styles.listCardAccent, { backgroundColor: PAINT_GATE_LIST_FIXTURE.colors.accent }]}
      />
    </View>
  );
}

interface ListItem {
  readonly id: string;
  /** Deterministic, index-derived — 2 of every 3 rows are "still loading"
   *  (skeleton), matching this fixture across every render pass, so
   *  scrolling genuinely exercises FlashList recycling REUSING native view
   *  instances across cells that flip between the fallback/measured
   *  skeleton and real content (RISK-3's exact defect class). */
  readonly isLoading: boolean;
}

const LIST_DATA: readonly ListItem[] = Array.from({ length: PAINT_GATE_LIST_FIXTURE.itemCount }, (_, i) => ({
  id: `item-${i}`,
  isLoading: i % 3 !== 0,
}));

function ListRow({ item }: { item: ListItem }) {
  if (!item.isLoading) {
    return (
      <ListCardContent accessibilityLabel={`${PAINT_GATE_LIST_FIXTURE.labels.realCardPrefix}${item.id}`} />
    );
  }
  return (
    <View
      accessible
      accessibilityLabel={`${PAINT_GATE_LIST_FIXTURE.labels.skeletonCardPrefix}${item.id}`}
      style={{ height: PAINT_GATE_LIST_FIXTURE.rowHeight }}
    >
      <SkeletonCell
        itemType={PAINT_GATE_LIST_FIXTURE.itemType}
        skeletonKey={PAINT_GATE_LIST_FIXTURE.skeletonKey}
        renderTemplate={() => <ListCardContent accessibilityLabel="paint-gate-list-template" />}
      />
    </View>
  );
}

/** Polls the dev-only `templateTraversalCounter` and renders it into an
 *  accessible `Text` node so the paired instrumented test can read the REAL
 *  traversal count off the real running app (RISK-3's "traversal counter
 *  stays flat" assertion) rather than trust an isolated formatter. */
function useTraversalCounterDisplay(): number {
  const [count, setCount] = useState(templateTraversalCounter.count);
  useEffect(() => {
    const interval = setInterval(() => {
      setCount(templateTraversalCounter.count);
    }, 150);
    return () => clearInterval(interval);
  }, []);
  return count;
}

function PaintGateListScreen() {
  const traversalCount = useTraversalCounterDisplay();

  return (
    <View
      accessible={false}
      accessibilityLabel={PAINT_GATE_LIST_FIXTURE.labels.root}
      testID="paint-gate-list-root"
      style={styles.screen}
    >
      <Text
        accessible
        accessibilityLabel={PAINT_GATE_LIST_FIXTURE.labels.traversalCounter}
        testID="paint-gate-list-traversal-counter"
        style={styles.counterLabel}
      >
        {`traversalCount:${traversalCount}`}
      </Text>
      {/* task 6.1 (REQ-LIST-EMPTY-1/2): a standalone `SkeletonList`, own
       *  itemType, own first-ever template measurement — independent of
       *  the per-cell `SkeletonCell` rows in the FlashList below. */}
      <View accessible accessibilityLabel="paint-gate-list-header-block" testID="paint-gate-list-header-block">
        <SkeletonList
          itemType={PAINT_GATE_LIST_FIXTURE.headerItemType}
          skeletonKey={PAINT_GATE_LIST_FIXTURE.headerItemType}
          estimatedCount={2}
          renderTemplate={() => <ListCardContent accessibilityLabel="paint-gate-list-header-template" />}
        />
      </View>
      <FlashList
        style={styles.flashList}
        data={LIST_DATA}
        renderItem={({ item }) => <ListRow item={item} />}
        keyExtractor={(item) => item.id}
        ListFooterComponent={
          // task 6.2 (REQ-LIST-PAGE-1): shares the MAIN list's itemType —
          // by the time this mounts, that itemType is already cached by
          // the FlashList's own `SkeletonCell` rows, so the footer must
          // resolve purely from cache, with zero additional traversal.
          <View accessible accessibilityLabel="paint-gate-list-footer-block" testID="paint-gate-list-footer-block">
            <SkeletonListFooter
              itemType={PAINT_GATE_LIST_FIXTURE.itemType}
              skeletonKey={PAINT_GATE_LIST_FIXTURE.skeletonKey}
              estimatedCount={2}
            />
          </View>
        }
      />
    </View>
  );
}

function App() {
  const isDarkMode = useColorScheme() === 'dark';
  const [screen, setScreen] = useState<'card' | 'list'>('card');

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      <AppContent screen={screen} onToggleScreen={() => setScreen((s) => (s === 'card' ? 'list' : 'card'))} />
    </SafeAreaProvider>
  );
}

function AppContent({
  screen,
  onToggleScreen,
}: {
  screen: 'card' | 'list';
  onToggleScreen: () => void;
}) {
  const safeAreaInsets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingTop: safeAreaInsets.top }]}>
      <Pressable
        accessible
        accessibilityLabel={PAINT_GATE_LIST_FIXTURE.labels.screenToggle}
        accessibilityRole="button"
        testID="paint-gate-screen-toggle"
        style={styles.screenToggle}
        onPress={onToggleScreen}
      >
        <Text style={styles.toggleLabel}>{`screen: ${screen} (tap to switch)`}</Text>
      </Pressable>
      {screen === 'card' ? <PaintGateScreen /> : <PaintGateListScreen />}
    </View>
  );
}

const styles = StyleSheet.create({
  flashList: {
    flex: 1,
  },
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  screen: {
    flex: 1,
    padding: 16,
    gap: 16,
  },
  screenToggle: {
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#cccccc',
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
  ignoreRow: {
    flexDirection: 'row',
    gap: 16,
  },
  ignoredBlock: {
    width: 100,
    height: 60,
  },
  counterLabel: {
    color: '#000000',
    padding: 8,
  },
  listCard: {
    padding: 12,
    gap: 8,
  },
  listCardText: {
    width: 200,
    height: 24,
  },
  listCardAccent: {
    width: 120,
    height: 40,
  },
});

export default App;
