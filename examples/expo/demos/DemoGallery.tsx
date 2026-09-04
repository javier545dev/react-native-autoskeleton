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
 *
 * WHICH MEANS THE FIRST CARD BELOW HAS TO EXIST. Three saturated magenta,
 * green and blue rectangles at the top of an app read as a rendering bug — a
 * broken image, a debug build, a shader that failed. They are none of those,
 * and the only way a reader can know that is to be told, right there, once.
 * `GateStripNote` turns the confusion into documentation.
 *
 * WHY THERE IS NO CATEGORY SCREEN. The index is grouped, but the groups are
 * section headers on ONE scrolling list. Every demo stays one tap from home.
 * `nav.tsx` carries the matching argument for why there is no navigation
 * library.
 */

import { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AutoSkeleton } from 'autoskeleton';
import { NavBar, useDemoNav } from './nav';
import { findDemo, findGroup, groupedDemos, type DemoEntry } from './registry';
import { SampleCard } from './SampleCard';
import { useDemoTheme } from './theme';
import { DemoMetaProvider } from './ui';

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

export function DemoGallery(): React.JSX.Element {
  const t = useDemoTheme();
  const nav = useDemoNav();

  if (nav.route.name === 'demo') {
    const demo = findDemo(nav.route.id);
    if (demo !== null) {
      return <DemoScreen demo={demo} onBack={nav.pop} />;
    }
  }

  return (
    <View style={[styles.root, { backgroundColor: t.color.canvas }]}>
      <NavBar title="autoskeleton · Expo" />
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

/**
 * What the three coloured rectangles below this card are.
 *
 * Written in ink and muted grey only. It names the three colours in prose but
 * paints none of them — see the colour rule in `ui.tsx`: a second region in
 * any of those three exact colours would widen the gate's bounding box and
 * move its sample point off the fixture.
 */
function GateStripNote(): React.JSX.Element {
  const t = useDemoTheme();
  return (
    <View
      style={{
        borderColor: t.color.line,
        borderWidth: t.border.panel,
        borderRadius: t.radius.lg,
        backgroundColor: t.color.surface,
        padding: t.space.lg,
        gap: t.space.xs,
      }}
    >
      <Text style={[t.type.caption, styles.kicker, { color: t.color.faint }]}>
        ABOUT THE STRIP BELOW
      </Text>
      <Text style={[t.type.label, { color: t.color.ink }]}>
        Not a rendering bug — a test fixture
      </Text>
      <Text style={[t.type.caption, styles.note, { color: t.color.muted }]}>
        Those three saturated frames are registration marks. `npm run gate:uniwind` launches this
        app, screenshots the RAW Android framebuffer, finds each mark by exact colour match and
        derives its centre from the bounding box — so the gate needs no screen coordinates and no
        navigation. Inside the third mark is a themed skeleton; the gate asserts the pixels it
        paints run between the two uniwind swatches beside it, at every phase of the shimmer.
      </Text>
      <Text style={[t.type.caption, styles.note, { color: t.color.muted }]}>
        It stays on screen because the gate cannot navigate — but it does not have to be in the
        way. `findMark` scans the whole framebuffer, so the fixture was moved to the bottom edge
        and everything above this card is the actual app.
      </Text>
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
      {/* The masthead. The logo leads, centred and at full size: this is the
          first thing the app says about itself, and until 2026-08-30 that slot
          belonged to the paint-gate strip — three saturated test frames, above
          a 56pt logo nobody read as identity. The fixture now sits at the
          bottom edge (see `App.tsx`) and `GateStripNote` explains it from
          there. */}
      <View style={styles.masthead}>
        {/* `Image` from `react-native`, deliberately NOT `expo-image`. This is
            chrome: it needs no cache policy, no placeholder and no transition,
            and keeping it byte-identical to `examples/bare-rn`'s home screen is
            worth more than any of those. `expo-image` earns its place in the
            image-pipeline demo, which is about exactly that handoff.

            Rasterised @1x/@2x/@3x because neither RN app has
            `react-native-svg`; Metro picks the density off the filename.
            `contain` because the file is square with its own padding baked in.
            Still, like every other piece of chrome here — the only thing that
            animates in this app is the skeleton. */}
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
          Wrap the UI you already have. This app is the Expo half of the story: uniwind theming,
          the expo-image handoff, and the same tarball resolved by Expo autolinking.
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
          <Text style={[t.type.caption, styles.kicker, { color: t.color.faint }]}>LIVE</Text>
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
                <View style={styles.heroHead}>
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

      {/* Last, because the thing it explains is now the last thing on screen.
          It is the final card in the scroll and the fixture is pinned right
          below it, so the explanation and its subject are adjacent. */}
      <GateStripNote />
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
  kicker: {
    letterSpacing: 0.8,
  },
  note: {
    lineHeight: 17,
  },
  heroHead: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
