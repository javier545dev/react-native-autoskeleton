/**
 * DEMO — tier 2 (Skia + Reanimated), opt-in.
 *
 * The default renderer has ZERO dependencies and is what every consumer gets.
 * Tier 2 is a strictly opt-in upgrade, and the opt-in is deliberately explicit
 * (ADR-5): the library never names `@shopify/react-native-skia` or
 * `react-native-reanimated` anywhere in its own module graph. The app imports
 * them, hands them to `createSkiaOverlay` from the `autoskeleton/skia`
 * subpath, and passes the result to `SkeletonProvider overlay`.
 *
 * That wiring lives in `examples/bare-rn/skiaOverlay.ts` — three imports and
 * one call, and it is the whole API.
 *
 * Whether it is worth it: the shimmer moves off the React tree entirely
 * (Reanimated shared values drive the Skia draw, no re-renders), and one
 * clock is shared, so two instances mounted seconds apart stay in phase. The
 * second card below mounts 700 ms late on purpose so you can see that.
 *
 * The `renderer` readout is the honest part: it comes from `onMetrics` and
 * reports what actually DREW. Delete the `overlay` prop and it says `native`
 * even though Skia is still installed.
 */

import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AutoSkeleton, SkeletonProvider } from 'autoskeleton';
import { SKIA_OVERLAY } from '../skiaOverlay';
import { Button } from './controls';
import { useDemoTheme } from './theme';
import { DemoPage, Panel, Readout, Row } from './ui';

const THEME = { baseColor: '#3A3A3A', highlightColor: '#E8E8E8' };

export function SkiaDemo(): React.JSX.Element {
  const theme = useDemoTheme();
  // Named `skiaOverlayOn` rather than `tier2`: `demos/ui.tsx`'s naming rule
  // forbids any identifier in this folder from starting with `tier2`, because
  // the on-device gates locate their fixtures with `By.descStartsWith("tier2-…")`.
  // A local variable never reaches the accessibility tree, but a rule with one
  // grandfathered exception is a rule nobody greps for.
  const [skiaOverlayOn, setSkiaOverlayOn] = useState(true);
  const [cycle, setCycle] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [renderer, setRenderer] = useState('pending — reveal to read it');
  const [lateMounted, setLateMounted] = useState(false);

  useEffect(() => {
    setLateMounted(false);
    setRenderer('pending — reveal to read it');
    const t = setTimeout(() => setLateMounted(true), 700);
    return () => clearTimeout(t);
  }, [cycle, skiaOverlayOn]);

  const restart = (): void => {
    setCycle((c) => c + 1);
    setIsLoading(true);
  };

  const body = (
    <>
      <Panel label="mounted immediately">
        <AutoSkeleton
          key={`early-${cycle}-${skiaOverlayOn}`}
          isLoading={isLoading}
          skeletonKey="demo-skia-early"
          onMetrics={(m) => setRenderer(m.renderer)}
        >
          <View style={[styles.block, { backgroundColor: theme.color.ink }]} />
        </AutoSkeleton>
      </Panel>
      <Panel label="mounted 700 ms later — same clock, same phase">
        {lateMounted ? (
          <AutoSkeleton key={`late-${cycle}-${skiaOverlayOn}`} isLoading={isLoading} skeletonKey="demo-skia-late">
            <View style={[styles.block, { backgroundColor: theme.color.ink }]} />
          </AutoSkeleton>
        ) : (
          <View style={[styles.block, { backgroundColor: theme.color.ink }]} />
        )}
      </Panel>
    </>
  );

  return (
    <DemoPage
      title="Tier 2 — Skia"
      claim="Opt-in. The app hands the peers to createSkiaOverlay; the library never imports them itself."
    >
      <Row>
        <Button
          label={skiaOverlayOn ? 'overlay: Skia (tap for default)' : 'overlay: none (tap for Skia)'}
          testID="demo-skia-toggle"
          onPress={() => {
            setSkiaOverlayOn((v) => !v);
            restart();
          }}
        />
        <Button
          label={isLoading ? 'Reveal (fires onMetrics)' : 'Restart'}
          tone="quiet"
          testID="demo-skia-restart"
          onPress={() => (isLoading ? setIsLoading(false) : restart())}
        />
      </Row>
      <Readout>{`onMetrics.renderer: ${renderer}`}</Readout>

      {skiaOverlayOn ? (
        <SkeletonProvider overlay={SKIA_OVERLAY} theme={THEME}>
          {body}
        </SkeletonProvider>
      ) : (
        <SkeletonProvider theme={THEME}>{body}</SkeletonProvider>
      )}
    </DemoPage>
  );
}

const styles = StyleSheet.create({
  block: {
    width: '100%',
    height: 110,
    borderRadius: 10,
  },
});
