/**
 * examples/rn-077 — the floor proof.
 *
 * `package.json` declares `react-native: ">=0.77.0"`. This app exists so that
 * number is backed by a build rather than by an argument.
 *
 * WHY A SEPARATE APP AND NOT A MATRIX ROW. `native-matrix.yml` used to "test"
 * 0.77 by taking `examples/bare-rn` — a React Native 0.87 app, pinned to Kotlin
 * 2.2.0 and Gradle 9.4.1 — and swapping its JavaScript dependencies down to
 * 0.77. Every one of those rows failed, and not one failed inside this library:
 * React Native's OWN `react-native-gradle-plugin` will not compile under a
 * toolchain that new. A version is only really tested by an app that release
 * actually ships with, which is what this is: scaffolded by
 * `@react-native-community/cli@15.0.1 --version 0.77.3`, so it carries Kotlin
 * 2.0.21, Gradle 8.10.2 and compileSdk 35 — 0.77's own numbers, untouched.
 *
 * WHAT THE BUILD PROVES. The two mechanisms that set the floor are exactly the
 * two things a native build exercises:
 *   - Android: `AutoskeletonPackage.kt` passes NAMED arguments to
 *     `ReactModuleInfo`. Those parameter names carry a leading underscore in
 *     0.76 and lose it in 0.77, so the call compiles here and cannot below.
 *   - iOS: `codegenConfig.ios.componentProvider` feeds
 *     `RCTThirdPartyComponentsProvider.mm`, whose generator does not exist in
 *     the 0.76 tarball at all.
 * Both are compile-time facts, so `assembleDebug` succeeding is the evidence.
 *
 * The screen below is deliberately ordinary. It is one card, and every shape in
 * its loading state is measured from that card's own laid-out geometry — there
 * is no skeleton markup here to keep in sync, which is the whole point of the
 * library. Nothing about this file is 0.77-specific.
 */

import React, {useEffect, useState} from 'react';
import {SafeAreaView, StatusBar, StyleSheet, Text, View} from 'react-native';
import {AutoSkeleton} from 'autoskeleton';

interface Article {
  readonly title: string;
  readonly meta: string;
}

function useSlowArticle(): Article | null {
  const [article, setArticle] = useState<Article | null>(null);
  useEffect(() => {
    const id = setTimeout(
      () => setArticle({title: 'Ada Lovelace', meta: 'Analytical Engine · 1843'}),
      1600,
    );
    return () => clearTimeout(id);
  }, []);
  return article;
}

function App(): React.JSX.Element {
  const article = useSlowArticle();

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar barStyle="light-content" backgroundColor={styles.screen.backgroundColor} />
      <View style={styles.content}>
        <Text style={styles.eyebrow}>react-native 0.77.3 · new architecture</Text>

        {/* `data` is null until the fetch resolves, and that is the whole
            loading signal — no second `isLoading` boolean to keep in step. */}
        <AutoSkeleton skeletonKey="article-card" data={article}>
          {loaded => (
            <View style={styles.card}>
              <View style={styles.avatar} />
              <View style={styles.cardBody}>
                <Text style={styles.title}>{loaded.title}</Text>
                <Text style={styles.meta}>{loaded.meta}</Text>
                <View style={styles.action}>
                  <Text style={styles.actionText}>Follow</Text>
                </View>
              </View>
            </View>
          )}
        </AutoSkeleton>

        <Text style={styles.footnote}>
          The skeleton above was never authored. It is the avatar, the two text
          runs and the action button, measured where this card actually laid out.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: '#0f0f11'},
  content: {flex: 1, padding: 24, gap: 20},
  eyebrow: {color: '#8b8b95', fontSize: 12, letterSpacing: 1, textTransform: 'uppercase'},
  card: {flexDirection: 'row', gap: 16, padding: 16, borderRadius: 14, borderWidth: 1, borderColor: '#26262c'},
  avatar: {width: 64, height: 64, borderRadius: 16, backgroundColor: '#26262c'},
  cardBody: {flex: 1, gap: 6},
  title: {color: '#f4f4f6', fontSize: 20, fontWeight: '600'},
  meta: {color: '#9b9ba5', fontSize: 14},
  action: {alignSelf: 'flex-start', marginTop: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: '#2b2b40'},
  actionText: {color: '#b9a8ff', fontSize: 14},
  footnote: {color: '#6f6f7a', fontSize: 13, lineHeight: 19},
});

export default App;
