// tasks.md 7.2 native E2E fixture: `ThemedAutoSkeleton` (autoskeleton/uniwind)
// driven entirely by `className` — no separate shimmerBaseColor/
// shimmerHighlightColor/defaultRadius prop is supplied by this screen,
// which is the exact REQ-THEME-2 scenario ("the developer supplies no
// separate skeleton-specific color/radius props"). Verified end-to-end on a
// real Android emulator: colors resolve from className with zero prop
// change (screenshot/logcat evidence in tasks.md 7.2); the defaultRadius
// mapping is also correctly computed (confirmed via a temporary diagnostic)
// but its visual effect is currently masked by a PRE-EXISTING Phase 5
// architectural gap — the `getShapes` Turbo Module bridge never forwards
// `defaultRadius`/`budgetMs`/`maxShapes` from JS to the native traversal
// call at all (see tasks.md 7.2 for the full account; out of scope here).
import './global.css';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { StyleSheet, Text, View, Pressable } from 'react-native';
import { ThemedAutoSkeleton } from 'autoskeleton/uniwind';

export default function App() {
  const [isLoading, setIsLoading] = useState(true);

  return (
    <View style={styles.container}>
      <ThemedAutoSkeleton
        isLoading={isLoading}
        skeletonKey="expo-theming-fixture"
        className="bg-slate-400 text-cyan-300 rounded-2xl"
      >
        <View style={styles.card}>
          <Text style={styles.title}>Loaded content</Text>
        </View>
      </ThemedAutoSkeleton>
      <Pressable style={styles.button} onPress={() => setIsLoading((v) => !v)}>
        <Text style={styles.buttonText}>{isLoading ? 'Stop loading' : 'Start loading'}</Text>
      </Pressable>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
  },
  card: {
    width: 240,
    height: 120,
    borderRadius: 16,
    backgroundColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  button: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#2563eb',
  },
  buttonText: {
    color: 'white',
    fontWeight: '600',
  },
});
