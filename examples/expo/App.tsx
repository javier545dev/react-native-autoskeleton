// Expo example app.
//
// TWO THINGS LIVE HERE AND THEY DO NOT MIX:
//
// 1. `PaintGateStrip` — the tasks.md 7.2 / spec REQ-THEME-2 on-device fixture.
//    It MUST be visible the moment the app launches, at the top, unclipped,
//    with nothing else on screen painting its three registration colours.
//    `scripts/uniwind-paint-gate.mjs` (`npm run gate:uniwind`) launches the
//    app and polls the RAW Android framebuffer for `#ff00ff`, `#00ff00` and
//    `#0000ff`; it performs no navigation and cannot. Putting the fixture
//    behind a menu entry would make that gate time out with "paint-gate
//    fixture never appeared on screen", so it stays mounted above the demo
//    index and the index scrolls beneath it.
//
// 2. `DemoGallery` — the browsable demos (`demos/registry.ts`). Everything
//    platform-neutral lives in `examples/bare-rn/demos`; this app covers what
//    is specific to Expo: the `autoskeleton/uniwind` interop, the
//    `expo-image` handoff, and Expo autolinking.
//
// The COLOUR half of REQ-THEME-2 is gated automatically by that script — it
// reads the pixels the skeleton paints and asserts they resolve from the
// `className` values below, at every phase of the shimmer. See that file's
// header for how it separates "the theme was applied" from "the shimmer
// happened to be at a light phase".
//
// The RADIUS half is NOT gated, and the reason is measured: the
// className-derived `defaultRadius` has no visible effect on Android. The
// gate card (no radius of its own) paints a SQUARE mask despite `rounded-2xl`,
// while a card with its own `borderRadius: 16` paints a rounded one. That
// points at the native radius resolver reporting a definite 0 rather than
// "unknown", not at the bridge — which since Phase 5 does carry
// `defaultRadius` in `config` (`src/native/NativeAutoskeleton.ts`). Use
// `<AutoSkeleton.Hint radius>` on Android; iOS is unaffected.
//
// `App.web.tsx` is the Expo Web entry and imports NONE of this:
// `autoskeleton/uniwind` is native-only (spec.md §4) and Metro refuses to
// bundle its native imports for web.
import './global.css';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import { ThemedAutoSkeleton } from 'autoskeleton/uniwind';
import { DemoGallery } from './demos/DemoGallery';

/** Registration marks for `scripts/uniwind-paint-gate.mjs`. Each gate target
 *  sits inside a solid frame of one unique, saturated colour, so the gate can
 *  find it in a raw device framebuffer by exact colour match and derive the
 *  target's centre from the frame's bounding box — no hard-coded screen
 *  coordinates, no dependence on device size, status-bar height or density.
 *  None of these three collides with any other colour this app paints; see
 *  the colour rule in `demos/ui.tsx`. */
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
 *  on any interactive state elsewhere in the app. */
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
  return (
    <View style={styles.container}>
      <View style={styles.gateHost}>
        <PaintGateStrip />
      </View>
      <DemoGallery />
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  /** Clears the status bar so the marks are never clipped, and centres the
   *  strip horizontally. Fixed height, so the gallery below never pushes it
   *  off screen no matter how many demos are registered. */
  gateHost: {
    paddingTop: 56,
    paddingBottom: 12,
    alignItems: 'center',
    backgroundColor: '#fff',
  },
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
});
