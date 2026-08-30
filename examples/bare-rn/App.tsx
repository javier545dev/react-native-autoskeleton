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
import {
  AutoSkeleton,
  SkeletonCell,
  SkeletonList,
  SkeletonListFooter,
  SkeletonProvider,
  templateTraversalCounter,
} from 'autoskeleton';
// ADR-5/RISK-8 tier-2 opt-in, spelled exactly the way a consumer spells it.
// The optional peers are imported in the app's own module graph, never the
// library's — see `skiaOverlay.ts` for the full argument and the single
// module-scope `createSkiaOverlay` call this fixture and the browsable
// tier-2 demo both use.
import { SKIA_OVERLAY } from './skiaOverlay';
import { DemoGallery } from './demos/DemoGallery';

/** Exported so the fixture and any future test/tooling share one source of
 *  truth for the deterministic colors the paint gate asserts against. */
export const PAINT_GATE_FIXTURE = {
  skeletonKey: 'paint-gate-card',
  labels: {
    toggle: 'paint-gate-toggle',
    /** RISK-8 tier-detection readout. The element's accessibility label is
     *  `paint-gate-renderer:<kind>` so a gate can assert the tier that
     *  ACTUALLY ran without scraping visible text. */
    renderer: 'paint-gate-renderer',
    content: 'paint-gate-content',
    text: 'paint-gate-text',
    image: 'paint-gate-image',
    card: 'paint-gate-rounded-card',
    // `<AutoSkeleton.Ignore>` bug-fix gate.
    ignoredContent: 'paint-gate-ignored-content',
    ignoredSibling: 'paint-gate-ignored-sibling',
    // Typed-hint channel gate: `hintedCard` is wrapped in
    // `<AutoSkeleton.Hint radius={40}>` over a SQUARE 80x80 view (no
    // `borderRadius` style at all — the hint is the ONLY source of
    // roundedness); `unhintedCard` is the identically-sized, identically
    // square sibling with NO hint. On Android specifically (brief §9c: no
    // public API otherwise recovers a rounded view's radius), a corner
    // pixel a few px inset from the top-left corner must differ between
    // the two: painted (skeleton ramp) for the square sibling, unpainted
    // (clipped away by the r=40 rounded/near-circular hint) for the hinted
    // one — see `PaintGateInstrumentedTest.kt`'s
    // `hintedRadiusChangesThePaintedCornerOnAndroid`.
    hintedCard: 'paint-gate-hinted-card',
    unhintedCard: 'paint-gate-unhinted-card',
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
    hintedCard: '#FFD700',
    unhintedCard: '#FF1493',
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
  // RISK-8's own stated detection signal: "the without-peers build asserts
  // `renderer: 'native'` in `onMetrics`". This readout is the WITH-peers half
  // of that matrix, surfaced through the real public `onMetrics` API — never a
  // test-only import of the library's internal peer probe. `onMetrics` fires
  // once the handoff settles, so this reads `pending` until the toggle is
  // tapped, which is exactly when the paired gate reads it.
  const [renderer, setRenderer] = useState<string>('pending');

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

      <Text
        accessible
        accessibilityLabel={`${PAINT_GATE_FIXTURE.labels.renderer}:${renderer}`}
        testID="paint-gate-renderer"
        style={styles.toggleLabel}
      >
        {`renderer: ${renderer}`}
      </Text>

      {/* `skeletonOnRefresh` is REQUIRED for the toggle to show anything on a
          SECOND load. Without it, REQ-PTR-1's stale-while-revalidate default
          suppresses the skeleton on every load AFTER the first — deliberately,
          so a refresh does not blank out content the reader is already looking
          at. Opting in here is what makes the loading state observable on
          demand, which is what a fixture needs to be able to demonstrate (and
          is why this file could not show the empty-snapshot defect at all).
          Matches `examples/vite/src/App.tsx`. */}
      <AutoSkeleton
        isLoading={isLoading}
        skeletonKey={PAINT_GATE_FIXTURE.skeletonKey}
        onMetrics={(m) => setRenderer(m.renderer)}
        skeletonOnRefresh
      >
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
          {/* Typed-hint channel gate (this session's brief): `hintedCard` is
           *  a SQUARE view (no `borderRadius` style) wrapped in
           *  `<AutoSkeleton.Hint radius={40}>` — the hint is the ONLY
           *  source of roundedness, proving R0 end to end. `unhintedCard`
           *  is the identically-sized, identically square sibling with no
           *  hint at all, in the SAME frame, for direct comparison. */}
          <View
            accessible={false}
            accessibilityLabel="paint-gate-hint-row"
            testID="paint-gate-hint-row"
            style={styles.hintRow}
          >
            <AutoSkeleton.Hint id="paint-gate-hint-card" radius={40}>
              <View
                accessible
                accessibilityLabel={PAINT_GATE_FIXTURE.labels.hintedCard}
                testID="paint-gate-hinted-card"
                style={[styles.hintBlock, { backgroundColor: PAINT_GATE_FIXTURE.colors.hintedCard }]}
              />
            </AutoSkeleton.Hint>
            <View
              accessible
              accessibilityLabel={PAINT_GATE_FIXTURE.labels.unhintedCard}
              testID="paint-gate-unhinted-card"
              style={[styles.hintBlock, { backgroundColor: PAINT_GATE_FIXTURE.colors.unhintedCard }]}
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

/** Tier-2 (Skia + Reanimated) fixture. Deliberately a SEPARATE screen from
 *  `PaintGateScreen` rather than a flag on it: the existing card/list gates
 *  must keep exercising tier-1, which is the default every consumer gets.
 *  Turning tier-2 on app-wide would have silently deleted tier-1's on-device
 *  coverage while every one of its gates stayed green.
 *
 *  Two `<AutoSkeleton>` trees, the second mounted `TIER2_FIXTURE.lateMountMs`
 *  AFTER the first. ADR-8 says every instance shares one clock, so the two
 *  must shimmer in lock-step despite starting at different wall-clock times —
 *  the single most direct on-device expression of that guarantee, and one no
 *  single-instance gate can see. */
const TIER2_FIXTURE = {
  skeletonKeyEarly: 'tier2-card-early',
  skeletonKeyLate: 'tier2-card-late',
  lateMountMs: 700,
  labels: {
    root: 'tier2-root',
    toggle: 'tier2-toggle',
    renderer: 'tier2-renderer',
    early: 'tier2-early-block',
    late: 'tier2-late-block',
  },
  colors: {
    // Both content colours must be far outside the grey shimmer ramp AND far
    // from each other, exactly like the tier-1 fixture's. Both have R = 0,
    // which is 58 units below the tier-2 ramp's darkest channel — a margin no
    // compositor noise can cross, and one that survives the RGBA/BGRA channel
    // ambiguity the pixel reader documents.
    early: '#0000FF',
    late: '#00A651',
  },
  /** A DELIBERATELY HIGH-CONTRAST theme, passed through the ordinary public
   *  `SkeletonProvider theme` prop.
   *
   *  This is not decoration. The default theme's ramp spans #E2E2E2..#F5F5F5 —
   *  NINETEEN units per channel, end to end. Any pixel comparison with a
   *  tolerance at all comparable to simulator compositor noise is therefore
   *  wider than the entire signal, so two skeletons a full half-period out of
   *  phase compare EQUAL and an ADR-8 phase gate passes vacuously. That was
   *  observed here, not theorised: the first version of
   *  `testTier2InstancesMountedAtDifferentTimesShimmerInPhase` passed against a
   *  deliberately planted "ignore the shared origin" defect.
   *
   *  #3A3A3A..#E8E8E8 spans 174 units instead, so an out-of-phase pair differs
   *  by an order of magnitude more than the noise floor. The period is left at
   *  the default 1400 ms because the gate's sampling window is expressed in it. */
  theme: {
    baseColor: '#3A3A3A',
    highlightColor: '#E8E8E8',
  },
} as const;

function Tier2Block({
  label,
  color,
  skeletonKey,
  isLoading,
  onMetrics,
}: {
  label: string;
  color: string;
  skeletonKey: string;
  isLoading: boolean;
  onMetrics?: (m: { renderer: string }) => void;
}) {
  return (
    // `skeletonOnRefresh`: same rationale as `PaintGateScreen` above — without
    // it REQ-PTR-1 suppresses the skeleton on every load after the first, so
    // the tier-2 toggle could never put the Skia overlay back on screen.
    <AutoSkeleton isLoading={isLoading} skeletonKey={skeletonKey} onMetrics={onMetrics} skeletonOnRefresh>
      <View
        accessible
        accessibilityLabel={label}
        testID={label}
        style={[styles.tier2Block, { backgroundColor: color }]}
      />
    </AutoSkeleton>
  );
}

function PaintGateTier2Screen() {
  const [isLoading, setIsLoading] = useState(true);
  const [lateMounted, setLateMounted] = useState(false);
  const [renderer, setRenderer] = useState<string>('pending');

  useEffect(() => {
    const t = setTimeout(() => setLateMounted(true), TIER2_FIXTURE.lateMountMs);
    return () => clearTimeout(t);
  }, []);

  return (
    <SkeletonProvider overlay={SKIA_OVERLAY} theme={TIER2_FIXTURE.theme}>
      <View style={styles.screen} testID={TIER2_FIXTURE.labels.root}>
        <Pressable
          accessible
          accessibilityLabel={TIER2_FIXTURE.labels.toggle}
          accessibilityRole="button"
          testID={TIER2_FIXTURE.labels.toggle}
          style={styles.toggle}
          onPress={() => setIsLoading((v) => !v)}
        >
          <Text style={styles.toggleLabel}>
            {isLoading ? 'isLoading: true (tap to reveal content)' : 'isLoading: false (tap to reload)'}
          </Text>
        </Pressable>

        <Text
          accessible
          accessibilityLabel={`${TIER2_FIXTURE.labels.renderer}:${renderer}`}
          testID={TIER2_FIXTURE.labels.renderer}
          style={styles.toggleLabel}
        >
          {`renderer: ${renderer}`}
        </Text>

        <Tier2Block
          label={TIER2_FIXTURE.labels.early}
          color={TIER2_FIXTURE.colors.early}
          skeletonKey={TIER2_FIXTURE.skeletonKeyEarly}
          isLoading={isLoading}
          onMetrics={(m) => setRenderer(m.renderer)}
        />
        {lateMounted ? (
          <Tier2Block
            label={TIER2_FIXTURE.labels.late}
            color={TIER2_FIXTURE.colors.late}
            skeletonKey={TIER2_FIXTURE.skeletonKeyLate}
            isLoading={isLoading}
          />
        ) : null}
      </View>
    </SkeletonProvider>
  );
}

function App() {
  const isDarkMode = useColorScheme() === 'dark';
  const [screen, setScreen] = useState<Screen>('card');
  // The gallery is a SEPARATE route, never a fourth entry in the `Screen`
  // cycle: the on-device gates reach the list and tier-2 fixtures by tapping
  // `paint-gate-screen-toggle` exactly once and exactly twice from launch, so
  // the cycle's length and order are part of the fixture contract.
  const [galleryOpen, setGalleryOpen] = useState(false);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      <AppContent
        screen={screen}
        onToggleScreen={() => setScreen(nextScreen)}
        galleryOpen={galleryOpen}
        onOpenGallery={() => setGalleryOpen(true)}
        onCloseGallery={() => setGalleryOpen(false)}
      />
    </SafeAreaProvider>
  );
}

type Screen = 'card' | 'list' | 'tier2';

/** Cycles card -> list -> tier2 -> card. Exported shape kept trivial so the
 *  UI tests can reach the tier-2 screen with a known number of taps. */
function nextScreen(current: Screen): Screen {
  if (current === 'card') return 'list';
  if (current === 'list') return 'tier2';
  return 'card';
}

function AppContent({
  screen,
  onToggleScreen,
  galleryOpen,
  onOpenGallery,
  onCloseGallery,
}: {
  screen: Screen;
  onToggleScreen: () => void;
  galleryOpen: boolean;
  onOpenGallery: () => void;
  onCloseGallery: () => void;
}) {
  const safeAreaInsets = useSafeAreaInsets();

  if (galleryOpen) {
    return (
      <View style={[styles.container, { paddingTop: safeAreaInsets.top }]}>
        <DemoGallery onExit={onCloseGallery} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: safeAreaInsets.top }]}>
      {/* One 40pt row, exactly the height `screenToggle` occupied on its own
          before the gallery existed — so every fixture below keeps its
          previous vertical position and the pixel gates keep their framing.
          The switcher itself is unchanged: same accessibilityLabel, same
          testID, same cycle, still the app's first interactive element. */}
      <View style={styles.headerRow}>
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
        <Pressable
          accessible
          accessibilityLabel="demo-open-gallery"
          accessibilityRole="button"
          testID="demo-open-gallery"
          style={styles.galleryButton}
          onPress={onOpenGallery}
        >
          <Text style={styles.galleryButtonLabel}>Demos ›</Text>
        </Pressable>
      </View>
      {screen === 'card' ? <PaintGateScreen /> : null}
      {screen === 'list' ? <PaintGateListScreen /> : null}
      {screen === 'tier2' ? <PaintGateTier2Screen /> : null}
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
  headerRow: {
    height: 40,
    flexDirection: 'row',
  },
  screenToggle: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#cccccc',
  },
  galleryButton: {
    width: 110,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#2f6fed',
  },
  galleryButtonLabel: {
    color: '#ffffff',
    fontWeight: '700',
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
  tier2Block: {
    width: 260,
    height: 120,
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
  hintRow: {
    flexDirection: 'row',
    gap: 16,
  },
  hintBlock: {
    width: 80,
    height: 80,
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
