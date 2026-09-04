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
 *
 * WHY THERE IS NO CATEGORY SCREEN. The index is grouped, but the groups are
 * section headers on ONE scrolling list rather than a screen of their own.
 * With twelve demos, a hop per category would add a tap to every journey and
 * disclose nothing a section header does not already disclose; every demo
 * stays exactly one tap from home. `nav.tsx` carries the matching argument for
 * why there is no navigation library.
 *
 * WHY HOME OPENS WITH A RUNNING SKELETON. The first thing a newcomer needs is
 * not a list of twelve names, it is an answer to "what does this actually
 * look like". The hero below cycles on its own — about 1.5 s of skeleton, then
 * the real card — so the skeleton-to-content transition has happened before
 * anyone has finished reading the sentence above it.
 */

import { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AutoSkeleton } from 'autoskeleton';
import { NavBar, useDemoNav } from './nav';
import { findDemo, findGroup, groupedDemos, type DemoEntry } from './registry';
import { SampleCard } from './SampleCard';
import { DemoMetaProvider } from './ui';
import { useDemoTheme } from './theme';

const HERO_SKELETON_MS = 1_500;
const HERO_CONTENT_MS = 2_600;

/** Flips `isLoading` forever so the home screen is never a still picture.
 *  Paired with `skeletonOnRefresh` below: REQ-PTR-1's stale-while-revalidate
 *  default would suppress every cycle after the first, which is correct for a
 *  real refresh and useless for a demonstration. */
function useHeroCycle(): boolean {
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const id = setTimeout(
      () => setIsLoading((v) => !v),
      isLoading ? HERO_SKELETON_MS : HERO_CONTENT_MS,
    );
    return () => clearTimeout(id);
  }, [isLoading]);

  return isLoading;
}

export function DemoGallery({
  onExit,
}: {
  /** Leaves the gallery and returns to the paint-gate fixture screens. Also
   *  what the Android hardware back button does at the root of the stack. */
  readonly onExit: () => void;
}): React.JSX.Element {
  const t = useDemoTheme();
  const nav = useDemoNav({ onExitHome: onExit });

  if (nav.route.name === 'demo') {
    const demo = findDemo(nav.route.id);
    if (demo !== null) {
      return <DemoScreen demo={demo} onBack={nav.pop} />;
    }
  }

  return (
    <View style={[styles.root, { backgroundColor: t.color.canvas }]}>
      <NavBar
        title="autoskeleton"
        trailing={
          <Pressable
            accessible
            accessibilityRole="button"
            accessibilityLabel="demo-exit-gallery"
            testID="demo-exit-gallery"
            hitSlop={8}
            onPress={onExit}
          >
            <Text style={[t.type.label, { color: t.color.accent }]}>Gate fixtures ›</Text>
          </Pressable>
        }
      />
      <HomeBody onOpen={nav.openDemo} />
    </View>
  );
}

function DemoScreen({
  demo,
  onBack,
}: {
  readonly demo: DemoEntry;
  readonly onBack: () => void;
}): React.JSX.Element {
  const t = useDemoTheme();
  const Demo = demo.component;
  const group = findGroup(demo.group);

  return (
    <View style={[styles.root, { backgroundColor: t.color.canvas }]}>
      <NavBar title={demo.title} onBack={onBack} />
      <DemoMetaProvider
        meta={{ kicker: group === null ? 'Demo' : group.title, source: demo.source }}
      >
        <Demo />
      </DemoMetaProvider>
    </View>
  );
}

function HomeBody({ onOpen }: { readonly onOpen: (id: string) => void }): React.JSX.Element {
  const t = useDemoTheme();
  const isLoading = useHeroCycle();
  const sections = groupedDemos();

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={{ padding: t.space.lg, gap: t.space.xl, paddingBottom: t.space.xxl }}
    >
      <View style={styles.masthead}>
        {/* The mark, rasterised. Neither RN app has `react-native-svg`, and
            adding a native dependency to the app that hosts five instrumented
            pixel gates to draw a badge is not a trade worth making — so
            `docs/assets/autoskeleton-logo.svg` ships here as @1x/@2x/@3x PNGs
            and Metro picks the density off the filename.

            `contain` because the file is square with its own padding baked in;
            it is never stretched to fit. And it is a still image, deliberately:
            the only thing that animates anywhere in this app is the skeleton
            below it. */}
        <Image
          source={require('../assets/autoskeleton-logo.png')}
          style={styles.logo}
          resizeMode="contain"
          accessible
          accessibilityRole="image"
          accessibilityLabel="autoskeleton logo"
        />
        <Text style={[t.type.display, styles.center, { color: t.color.ink }]}>
          Skeletons you never wrote
        </Text>
        <Text style={[t.type.body, styles.center, { color: t.color.muted }]}>
          Wrap the UI you already have. autoskeleton measures it on the device and paints a
          placeholder that matches the real layout, shape for shape.
        </Text>
      </View>

      <View
        style={{
          backgroundColor: t.color.stage,
          borderColor: t.color.line,
          borderWidth: t.border.panel,
          borderRadius: t.radius.lg,
          padding: t.space.lg,
          gap: t.space.md,
        }}
      >
        <View style={styles.heroHead}>
          <Text style={[t.type.heading, styles.grow, { color: t.color.ink }]}>
            {'<AutoSkeleton isLoading>'}
          </Text>
          <Text style={[t.type.caption, styles.tag, { color: t.color.faint }]}>LIVE</Text>
        </View>
        {/* `skeletonOnRefresh`: see `useHeroCycle` above. Without it this card
            would show a skeleton once and then never again. */}
        <AutoSkeleton isLoading={isLoading} skeletonKey="demo-home-hero" skeletonOnRefresh>
          <SampleCard />
        </AutoSkeleton>
        <Text style={[t.type.caption, { color: t.color.muted }]}>
          Cycling on its own. The card underneath is ordinary product markup — no skeleton layout is
          authored anywhere in this app.
        </Text>
      </View>

      {sections.map(({ group, demos }) => (
        <View key={group.id} style={{ gap: t.space.md }}>
          <View
            accessible
            accessibilityRole="header"
            accessibilityLabel={`demo-group-${group.id}`}
            testID={`demo-group-${group.id}`}
            style={{ gap: t.space.xs }}
          >
            <Text style={[t.type.heading, { color: t.color.ink }]}>{group.title}</Text>
            <Text style={[t.type.caption, { color: t.color.muted }]}>{group.blurb}</Text>
          </View>

          <View
            style={[
              styles.clip,
              {
                backgroundColor: t.color.surface,
                borderColor: t.color.line,
                borderWidth: t.border.panel,
                borderRadius: t.radius.lg,
              },
            ]}
          >
            {demos.map((demo, index) => (
              <Pressable
                key={demo.id}
                accessible
                accessibilityRole="button"
                accessibilityLabel={`demo-open-${demo.id}`}
                testID={`demo-open-${demo.id}`}
                onPress={() => onOpen(demo.id)}
                style={{
                  paddingHorizontal: t.space.lg,
                  paddingVertical: t.space.md,
                  gap: t.space.xs,
                  borderTopWidth: index === 0 ? undefined : t.border.hairline,
                  borderTopColor: t.color.line,
                }}
              >
                <View style={styles.rowHead}>
                  <Text style={[t.type.label, styles.grow, { color: t.color.ink }]}>
                    {demo.title}
                  </Text>
                  <Text style={[t.type.label, { color: t.color.faint }]}>›</Text>
                </View>
                <Text style={[t.type.caption, { color: t.color.muted }]}>{demo.summary}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  clip: {
    overflow: 'hidden',
  },
  /** The masthead is centred and the logo leads it at 96pt. At the earlier
   *  56pt, left-aligned and sharing a row with body copy, it read as a bullet
   *  point rather than as the app's identity. */
  masthead: {
    alignItems: 'center',
    gap: 8,
  },
  logo: {
    width: 96,
    height: 96,
  },
  center: {
    textAlign: 'center',
  },
  grow: {
    flex: 1,
  },
  tag: {
    letterSpacing: 0.8,
  },
  heroHead: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowHead: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
