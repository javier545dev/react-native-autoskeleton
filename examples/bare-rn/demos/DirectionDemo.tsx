/**
 * DEMO — Writing direction: the shimmer sweeps the way you read.
 *
 * `direction` was always part of the composite shape cache key — an RTL
 * layout is different geometry, so it gets its own snapshot — but until
 * 20ff97d no renderer read it, and an Arabic or Hebrew reader got a snapshot
 * captured for their direction swept by a highlight travelling against their
 * reading order. On NATIVE (tier-1 iOS/Android, and tier-2 Skia) the sweep
 * now travels right-to-left when `I18nManager.isRTL` is true.
 *
 * The value is carried FROM JS, not read natively: `<AutoSkeleton>` computes
 * `I18nManager.isRTL ? 'rtl' : 'ltr'` once and passes that same local both
 * into `composeCacheKey` and down to the renderer (as `writingDirection` —
 * `direction` is already taken by Yoga, which parses it off the same raw
 * props). The two therefore agree by construction, not by coincidence: iOS's
 * `effectiveUserInterfaceLayoutDirection` and Android's `getLayoutDirection()`
 * can each move without `I18nManager.isRTL` moving, and the cache key is
 * built from `I18nManager`.
 *
 * WHAT THIS SCREEN CAN AND CANNOT SHOW.
 * It cannot toggle the sweep live. `I18nManager.forceRTL()` writes a native
 * flag that is read once, at startup, by the JS module AND by the native
 * layout — nothing re-reads it while the app runs, so there is no honest live
 * switch to build. What the readout below shows is real and load-bearing: the
 * live `isRTL`, and the `cacheKey` the library itself reported through
 * `onMetrics`, whose sixth segment is the direction it actually painted with.
 * The button flips the flag and reloads the JS bundle for you (dev builds
 * only — `DevSettings` is inert in release), which is the same thing you
 * would do by hand.
 *
 * WEB IS DIFFERENT, on purpose, and the root README's capability table says
 * so in one word ("Shimmer sweep follows writing direction: no"). The CSS
 * renderer pins `direction: 'ltr'` on the overlay and keeps one fixed
 * `translateX(-50%) → translateX(50%)` keyframe, so a web reader sees the
 * same left-to-right highlight either way. It does not mirror the shapes
 * either: a live web measurement is ALREADY the browser's own mirrored
 * layout. (`buildClipPath`'s direction mirroring is for geometry captured in
 * a canonical space and replayed — the SSR path.)
 *
 * OBSERVED, iPhone 17 / iOS 26.5 simulator, 2026-09-03: in LTR the highlight
 * enters at the left edge and leaves at the right; after the button flips the
 * flag it enters at the right and leaves at the left, and the reported
 * `cacheKey` goes from `v1|demo-direction|-|414|1|ltr|ios` to `…|rtl|ios`.
 * Both need a build that contains the native change — an iOS binary compiled
 * before 20ff97d has no `writingDirection` prop and ignores it silently.
 */

import { useState } from 'react';
import { DevSettings, I18nManager, Platform, StyleSheet, View } from 'react-native';
import { AutoSkeleton } from 'autoskeleton';
import type { SkeletonMetrics } from 'autoskeleton';
import { Button, useFakeLoad } from './controls';
import { useDemoTheme } from './theme';
import { Caption, DemoPage, Note, Panel, Readout, ReadoutRows, Row } from './ui';

/** `v1|<skeletonKey>|<itemType>|<width>|<fontScale>|<dir>|<platform>` — the
 *  direction is segment 5. Parsed out of the key the library emitted rather
 *  than re-derived from `I18nManager`, so this row reports what the runtime
 *  used and not what this file assumes it used. */
const CACHE_KEY_SEGMENTS = 7;
const DIRECTION_SEGMENT = 5;

function directionInCacheKey(key: string): string {
  const segments = key.split('|');
  return segments.length === CACHE_KEY_SEGMENTS ? (segments[DIRECTION_SEGMENT] ?? '?') : '?';
}

export function DirectionDemo(): React.JSX.Element {
  const t = useDemoTheme();
  const load = useFakeLoad(2400);
  const [metrics, setMetrics] = useState<SkeletonMetrics | null>(null);

  const isRTL = I18nManager.isRTL;
  const direction = isRTL ? 'rtl' : 'ltr';
  const canReload = __DEV__;

  const rows: ReadonlyArray<readonly [string, string]> = [
    ['I18nManager.isRTL', String(isRTL)],
    ['direction', direction],
    ['writingDirection', direction],
    ['Platform.OS', Platform.OS],
    ['onMetrics.cacheKey', metrics === null ? '(not fired yet)' : metrics.cacheKey],
    ['  └ direction', metrics === null ? '(not fired yet)' : directionInCacheKey(metrics.cacheKey)],
  ];

  return (
    <DemoPage
      title="Writing direction"
      claim="One value — I18nManager.isRTL — becomes the cache key's direction and the renderer's sweep direction. On native they cannot disagree."
    >
      <ReadoutRows rows={rows} />

      <Panel
        label={'<AutoSkeleton animation="shimmer">'}
        note="Wide bars, so the highlight has room to travel. Watch which edge it enters from."
      >
        <View style={styles.host}>
          <AutoSkeleton
            key={load.coldKey}
            isLoading={load.isLoading}
            skeletonKey="demo-direction"
            animation="shimmer"
            onMetrics={setMetrics}
          >
            <View style={styles.card}>
              <View style={[styles.bar, { backgroundColor: t.color.ink }]} />
              <View style={[styles.bar, { backgroundColor: t.color.ink }]} />
              <View style={[styles.bar, styles.barShort, { backgroundColor: t.color.ink }]} />
              <View style={[styles.block, { backgroundColor: t.color.lineStrong }]} />
            </View>
          </AutoSkeleton>
        </View>
      </Panel>

      <Row>
        <Button label="Load again" testID="demo-direction-reload" onPress={load.reloadCold} />
        <Button
          label={
            canReload
              ? `forceRTL(${String(!isRTL)}) + reload`
              : 'forceRTL + reload: dev builds only'
          }
          tone="quiet"
          testID="demo-direction-force-rtl"
          disabled={!canReload}
          onPress={() => {
            I18nManager.forceRTL(!isRTL);
            DevSettings.reload('autoskeleton demo: writing direction flipped');
          }}
        />
      </Row>
      <Caption>
        That button restarts the JS bundle: the whole app relaunches at the gate fixture
        screen and you have to walk back here through Demos ›. It also mirrors every layout in the app, not
        just the skeleton — that is what RTL means. Press it again to go back.
      </Caption>

      <Panel label="why there is no live toggle" live={false}>
        <Readout>
          {'I18nManager.forceRTL(true)  // writes a native flag\n// ...read once, at startup, by JS and by the native layout'}
        </Readout>
        <Note>
          Nothing re-reads that flag while the app runs, so a switch that claimed to flip the sweep
          in place would be lying. Without this app's button, the two honest ways in are the same
          call at your entry file followed by a relaunch, or giving the simulator an RTL system
          language (Settings › General › Language & Region › Arabic / Hebrew).
        </Note>
      </Panel>

      <Note>
        The sweep follows the reading direction on native only. On web the overlay pins
        `direction: ltr` and keeps one fixed keyframe, so a web reader sees the same left-to-right
        highlight either way — the root README&apos;s capability table is the short version.
      </Note>
    </DemoPage>
  );
}

const styles = StyleSheet.create({
  host: {
    minHeight: 200,
  },
  card: {
    gap: 12,
  },
  bar: {
    width: '100%',
    height: 22,
    borderRadius: 4,
  },
  barShort: {
    width: '55%',
  },
  block: {
    width: '100%',
    height: 96,
    borderRadius: 10,
  },
});
