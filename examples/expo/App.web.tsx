// tasks.md G.17 — the Expo Web (react-native-web) target of this example app.
//
// Why a separate `App.web.tsx` instead of teaching `App.tsx` about web:
// `App.tsx` is the tasks.md 7.2 NATIVE E2E fixture. It drives
// `ThemedAutoSkeleton` from `autoskeleton/uniwind`, whose implementation
// imports `src/native/AutoSkeleton` and therefore
// `react-native/Libraries/Utilities/codegenNativeComponent` — a native-only
// module Metro refuses to bundle for web. Measured, not assumed: with
// `App.tsx` as the only entry, `expo export --platform web` fails with
//     Importing native-only module
//     "react-native/Libraries/Utilities/codegenNativeComponent" on web from:
//     node_modules/autoskeleton/lib/module/native/AutoskeletonOverlayNativeComponent.ts
// Metro resolves `App.web.tsx` before `App.tsx` when `--platform web` is set,
// so this file is the web entry and `App.tsx` keeps covering native unchanged.
// The `autoskeleton/uniwind` subpath stays native-only (spec.md §4).
//
// The screen is deliberately geometry-first: every box below has explicit
// pixel dimensions and every text run sits on a `lineHeight` far larger than
// its `fontSize`, so `test/web/expo-web-export.spec.ts` can probe points that
// MUST be covered by the skeleton (a glyph run, the avatar) and points that
// MUST NOT be (the inter-line leading gap, the empty tail of a short line).
// A sensor that collapsed the card into one container rect would pass a
// "does an overlay exist" check and fail this one.
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AutoSkeleton } from 'autoskeleton';

export default function App() {
  const [isLoading, setIsLoading] = useState(true);

  return (
    <View style={styles.container}>
      <AutoSkeleton isLoading={isLoading} skeletonKey="expo-web-fixture">
        <View style={styles.card} testID="card">
          <View style={styles.row}>
            <View style={styles.avatar} testID="avatar" />
            <View style={styles.rowText}>
              <Text style={styles.title} testID="title">
                Ada Lovelace
              </Text>
              <Text style={styles.subtitle} testID="subtitle">
                Analytical Engine
              </Text>
            </View>
          </View>
          <Text style={styles.body} testID="body">
            The Analytical Engine weaves algebraic patterns, just as the
            Jacquard loom weaves flowers and leaves.
          </Text>
        </View>
      </AutoSkeleton>

      <Pressable style={styles.button} testID="toggle" onPress={() => setIsLoading((v) => !v)}>
        <Text style={styles.buttonText}>{isLoading ? 'Stop loading' : 'Start loading'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
    alignItems: 'flex-start',
    padding: 24,
    gap: 24,
  },
  card: {
    width: 320,
    padding: 16,
    gap: 16,
    borderRadius: 12,
    backgroundColor: 'transparent',
  },
  row: {
    flexDirection: 'row',
    gap: 12,
    height: 64,
  },
  rowText: {
    flex: 1,
    gap: 8,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#cbd5e1',
  },
  title: {
    fontSize: 18,
    // 40px leading over an ~18px glyph box leaves >10px of empty space above
    // and below every line — room for the "must NOT be covered" probes.
    lineHeight: 40,
    color: '#0f172a',
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 32,
    color: '#475569',
  },
  body: {
    fontSize: 14,
    lineHeight: 36,
    color: '#334155',
  },
  button: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#2563eb',
  },
  buttonText: {
    color: '#ffffff',
    fontWeight: '600',
  },
});
