// tasks.md 7.2 native E2E fixture: `ThemedAutoSkeleton` (autoskeleton/uniwind)
// driven entirely by `className` — no separate shimmerBaseColor/
// shimmerHighlightColor/defaultRadius prop is supplied by this screen,
// which is the exact REQ-THEME-2 scenario ("the developer supplies no
// separate skeleton-specific color/radius props").
//
// The COLOUR half of that scenario is now gated automatically, on a real
// device, by `scripts/uniwind-paint-gate.mjs` (`npm run gate:uniwind`) — it
// reads the raw Android framebuffer and asserts that the pixels the skeleton
// paints resolve from these className values, at every phase of the shimmer.
// See that file's header for how it separates "the theme was applied" from
// "the shimmer happened to be at a light phase". Before it existed, the only
// evidence was a logcat diagnostic (a prop was computed) and one screenshot
// judged by eye, neither of which is a gate.
//
// The RADIUS half is NOT gated here, and the reason has changed since 7.2 was
// written: the Phase 5 architectural gap that entry blamed (the `getShapes`
// Turbo Module bridge carrying no configuration at all, so `defaultRadius`
// never crossed to the native traversal) HAS since been closed — the spec now
// takes a `config` argument carrying `defaultRadius`/`budgetMs`/`maxShapes`
// (`src/native/NativeAutoskeleton.ts`). What is still true on Android is that
// the className-derived `defaultRadius` has no visible effect on either card
// below: measured from the framebuffer, the gate card (no radius of its own)
// paints a SQUARE mask despite `rounded-2xl`, while the big card below (its
// own `borderRadius: 16`) paints a rounded one. That points at the native
// radius resolver reporting a definite 0 rather than "unknown", not at the
// bridge — a different defect from the one 7.2 recorded, and still out of
// scope for this fixture.
import './global.css';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { StyleSheet, Text, View, Pressable } from 'react-native';
import { ThemedAutoSkeleton } from 'autoskeleton/uniwind';

/** Registration marks for `scripts/uniwind-paint-gate.mjs`. Each gate target
 *  sits inside a solid frame of one unique, saturated colour, so the gate can
 *  find it in a raw device framebuffer by exact colour match and derive the
 *  target's centre from the frame's bounding box — no hard-coded screen
 *  coordinates, no dependence on device size, status-bar height or density.
 *  None of these three collides with any other colour this screen paints
 *  (`bg-slate-400` #90a1b9, `bg-cyan-300` #53eafd, #111827, #2563eb, white). */
const GATE_MARK_BASE_SWATCH = '#ff00ff';
const GATE_MARK_HIGHLIGHT_SWATCH = '#00ff00';
const GATE_MARK_SKELETON = '#0000ff';

/** tasks.md 7.2 (spec REQ-THEME-2), on-device paint gate fixture.
 *
 *  The two swatches are plain uniwind-styled `<View>`s carrying the SAME
 *  Tailwind palette entries the skeleton's `className` names. That is what
 *  makes the gate non-circular and version-proof: it never hard-codes what
 *  `bg-slate-400` resolves to, it reads the colour uniwind actually painted
 *  for that class and requires the skeleton to paint the same one. A Tailwind
 *  palette change moves both sides together; a THEMING regression moves only
 *  the skeleton, which is the thing under test.
 *
 *  `isLoading` is a constant `true` here on purpose — the gate must not depend
 *  on the interactive fixture's toggle state below. */
function PaintGateStrip() {
  return (
    <View style={styles.gateStrip}>
      <View style={[styles.gateMark, { backgroundColor: GATE_MARK_BASE_SWATCH }]}>
        <View className="bg-slate-400" style={styles.gateSwatch} />
      </View>
      <View style={[styles.gateMark, { backgroundColor: GATE_MARK_HIGHLIGHT_SWATCH }]}>
        <View className="bg-cyan-300" style={styles.gateSwatch} />
      </View>
      <View style={[styles.gateMark, { backgroundColor: GATE_MARK_SKELETON }]}>
        <ThemedAutoSkeleton
          isLoading
          skeletonKey="expo-paint-gate"
          className="bg-slate-400 text-cyan-300 rounded-2xl"
        >
          {/* One childless opaque `<View>`: the Android sensor emits exactly
              one shape for it (`hasNonTransparentBackground`), so the overlay
              mask is a single rect and the mark's centre is unambiguously
              inside painted skeleton. */}
          <View style={styles.gateCard} />
        </ThemedAutoSkeleton>
      </View>
    </View>
  );
}

export default function App() {
  const [isLoading, setIsLoading] = useState(true);

  return (
    <View style={styles.container}>
      <PaintGateStrip />
      {/* `skeletonOnRefresh` is REQUIRED for the toggle to show anything on a
          SECOND load. Without it, REQ-PTR-1's stale-while-revalidate default
          suppresses the skeleton on every load AFTER the first — deliberately,
          so a refresh does not blank out content the reader is already looking
          at. Opting in here is what makes the loading state observable on
          demand, which is what a fixture needs to be able to demonstrate.
          Matches `examples/vite/src/App.tsx`. */}
      <ThemedAutoSkeleton
        isLoading={isLoading}
        skeletonKey="expo-theming-fixture"
        className="bg-slate-400 text-cyan-300 rounded-2xl"
        skeletonOnRefresh
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
  gateStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  gateMark: {
    padding: 8,
  },
  gateSwatch: {
    width: 48,
    height: 48,
  },
  gateCard: {
    width: 100,
    height: 56,
    backgroundColor: '#111827',
  },
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
